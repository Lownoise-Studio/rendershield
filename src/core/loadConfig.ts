import fs from "fs-extra";
import path from "node:path";
import { RenderShieldConfig, SCHEMA_TYPES, type SchemaType } from "../types.js";
import { renderShieldError } from "../errors.js";

const CONFIG_NAME = "rendershield.config.json";

const DEFAULT_SITEMAP_PATH = "/sitemap.xml";
const DEFAULT_ROBOTS_PATH = "/robots.txt";

type BoolFlag = { enabled: boolean };

/** Shape of config as read from JSON (before normalization). Used for validation only. */
interface ParsedInput {
  version?: unknown;
  site?: { canonicalBase?: unknown; siteName?: unknown; defaultOgImage?: unknown; authorName?: unknown };
  content?: { markdown?: { baseDir?: unknown; collections?: unknown[] } };
  output?: { outDir?: unknown };
  sitemap?: Record<string, unknown>;
  robots?: Record<string, unknown>;
  worker?: Record<string, unknown>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceBoolFlag(
  parsed: Record<string, unknown>,
  key: "sitemap" | "robots" | "worker",
  defaultEnabled: boolean
): BoolFlag {
  // If missing, provide defaults (keeps older configs from exploding)
  if (parsed?.[key] == null) return { enabled: defaultEnabled };

  // If present, validate shape
  const v = parsed[key];
  if (!isObject(v)) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${key} must be an object like { "enabled": true }`
    );
  }
  const enabled = (v as Record<string, unknown>).enabled;
  if (typeof enabled !== "boolean") {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${key}.enabled must be a boolean`
    );
  }
  return { enabled };
}

/**
 * Worker config policy: strict mode.
 * When worker.enabled is true, all of lovableOrigin, rewriteRouteBases, and
 * botUserAgentPatterns are required and must be non-empty. No defaults are
 * supplied — build fails with a crisp error.
 * lovableOrigin: must be http: or https: only (no file:, javascript:, protocol-relative).
 * botUserAgentPatterns: substring match only (not regex); empty strings rejected to avoid overmatching.
 */
function validateWorkerWhenEnabled(parsed: Record<string, unknown>): void {
  const worker = parsed.worker as Record<string, unknown> | undefined;
  if (!worker?.lovableOrigin || typeof worker.lovableOrigin !== "string") {
    throw renderShieldError(
      "CONFIG_INVALID",
      `worker.lovableOrigin is required when worker.enabled is true. Example: "https://your-site.lovable.app"`
    );
  }
  let url: URL;
  try {
    url = new URL(worker.lovableOrigin);
  } catch {
    throw renderShieldError(
      "CONFIG_INVALID",
      `worker.lovableOrigin must be a valid URL. Got: "${worker.lovableOrigin}"`
    );
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    throw renderShieldError(
      "CONFIG_INVALID",
      `worker.lovableOrigin must use http or https. Got: "${url.protocol}"`
    );
  }
  if (
    !Array.isArray(worker.rewriteRouteBases) ||
    worker.rewriteRouteBases.length === 0
  ) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `worker.rewriteRouteBases must be a non-empty array when worker.enabled is true. Example: ["/blog/"]`
    );
  }
  if (
    !Array.isArray(worker.botUserAgentPatterns) ||
    worker.botUserAgentPatterns.length === 0
  ) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `worker.botUserAgentPatterns must be a non-empty array when worker.enabled is true. Example: ["googlebot", "bingbot"]`
    );
  }
  // Substring match only; empty string would match every User-Agent
  for (let i = 0; i < worker.botUserAgentPatterns.length; i++) {
    const p = worker.botUserAgentPatterns[i];
    if (typeof p !== "string" || p.trim() === "") {
      throw renderShieldError(
        "CONFIG_INVALID",
        `worker.botUserAgentPatterns[${i}] must be a non-empty string (substring match). Empty or invalid entry would overmatch.`
      );
    }
  }
}

export async function loadConfig(
  cwd = process.cwd()
): Promise<RenderShieldConfig> {
  const p = path.join(cwd, CONFIG_NAME);
  const exists = await fs.pathExists(p);
  if (!exists) {
    throw renderShieldError(
      "CONFIG_MISSING",
      `Missing ${CONFIG_NAME}. Run: rendershield init`
    );
  }

  const raw = await fs.readFile(p, "utf8");
  let parsed: ParsedInput & Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as ParsedInput & Record<string, unknown>;
  } catch {
    throw renderShieldError("CONFIG_INVALID", `${CONFIG_NAME} is not valid JSON`);
  }

  // Minimal validation (v0)
  if (parsed?.version !== 1) {
    throw renderShieldError("CONFIG_INVALID", "Config version must be 1");
  }
  if (!parsed?.site?.canonicalBase) {
    throw renderShieldError("CONFIG_INVALID", "site.canonicalBase is required");
  }
  if (!parsed?.site?.siteName) {
    throw renderShieldError("CONFIG_INVALID", "site.siteName is required");
  }
  if (!parsed?.site?.defaultOgImage) {
    throw renderShieldError("CONFIG_INVALID", "site.defaultOgImage is required");
  }
  if (!parsed?.site?.authorName) {
    throw renderShieldError("CONFIG_INVALID", "site.authorName is required");
  }
  if (!parsed?.content?.markdown?.baseDir) {
    throw renderShieldError("CONFIG_INVALID", "content.markdown.baseDir is required");
  }
  if (
    !Array.isArray(parsed?.content?.markdown?.collections) ||
    parsed.content.markdown.collections.length === 0
  ) {
    throw renderShieldError(
      "CONFIG_INVALID",
      "content.markdown.collections must be a non-empty array"
    );
  }
  if (!parsed?.output?.outDir) {
    throw renderShieldError("CONFIG_INVALID", "output.outDir is required");
  }

  parsed.content.markdown.collections = normalizeCollections(
    parsed.content.markdown.collections
  );

  // Validate + default these optional sections (preserve path so it is not lost)
  const sitemapFlag = coerceBoolFlag(parsed, "sitemap", true);
  const sitemapObj = parsed.sitemap as Record<string, unknown> | undefined;
  const sitemapPathVal = sitemapObj?.path;
  const sitemapPath =
    typeof sitemapPathVal === "string" && sitemapPathVal.trim().startsWith("/")
      ? sitemapPathVal.trim()
      : DEFAULT_SITEMAP_PATH;
  parsed.sitemap = { enabled: sitemapFlag.enabled, path: sitemapPath };

  const robotsFlag = coerceBoolFlag(parsed, "robots", true);
  const robotsObj = parsed.robots as Record<string, unknown> | undefined;
  const robotsPathVal = robotsObj?.path;
  const robotsPath =
    typeof robotsPathVal === "string" && robotsPathVal.trim().startsWith("/")
      ? robotsPathVal.trim()
      : DEFAULT_ROBOTS_PATH;
  parsed.robots = { enabled: robotsFlag.enabled, path: robotsPath };

  const workerFlag = coerceBoolFlag(parsed, "worker", true);
  if (workerFlag.enabled) {
    validateWorkerWhenEnabled(parsed);
    // Keep parsed.worker as the full object from JSON (already validated)
  } else {
    parsed.worker = {
      enabled: false,
      lovableOrigin: "",
      rewriteRouteBases: [],
      botUserAgentPatterns: [],
      debugHeaders: false,
    };
  }

  return parsed as RenderShieldConfig;
}

function normalizeCollections(collections: unknown[]): RenderShieldConfig["content"]["markdown"]["collections"] {
  return collections.map((raw, index) => {
    if (!isObject(raw)) {
      throw renderShieldError(
        "CONFIG_INVALID",
        `content.markdown.collections[${index}] must be an object`
      );
    }

    const name = raw.name;
    const pattern = raw.pattern;
    const routeBase = raw.routeBase;
    const schemaTypeRaw = raw.schemaType;

    if (typeof name !== "string" || name.trim() === "") {
      throw renderShieldError(
        "CONFIG_INVALID",
        `content.markdown.collections[${index}].name must be a non-empty string`
      );
    }
    if (typeof pattern !== "string" || pattern.trim() === "") {
      throw renderShieldError(
        "CONFIG_INVALID",
        `content.markdown.collections[${index}].pattern must be a non-empty string`
      );
    }
    if (typeof routeBase !== "string" || routeBase.trim() === "") {
      throw renderShieldError(
        "CONFIG_INVALID",
        `content.markdown.collections[${index}].routeBase must be a non-empty string`
      );
    }

    const schemaType: SchemaType =
      schemaTypeRaw === undefined ? "Article" : parseSchemaType(schemaTypeRaw, index);

    return {
      name: name.trim(),
      pattern: pattern.trim(),
      routeBase: routeBase.trim(),
      schemaType,
    };
  });
}

function parseSchemaType(value: unknown, index: number): SchemaType {
  if (typeof value !== "string" || !SCHEMA_TYPES.includes(value as SchemaType)) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `content.markdown.collections[${index}].schemaType must be one of: ${SCHEMA_TYPES.join(", ")}`
    );
  }
  return value as SchemaType;
}
