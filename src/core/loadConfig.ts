import fs from "fs-extra";
import path from "node:path";
import { RenderShieldConfig } from "../types.js";

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
    throw new Error(`${key} must be an object like { "enabled": true }`);
  }
  const enabled = (v as Record<string, unknown>).enabled;
  if (typeof enabled !== "boolean") {
    throw new Error(`${key}.enabled must be a boolean`);
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
    throw new Error(
      `worker.lovableOrigin is required when worker.enabled is true. Example: "https://your-site.lovable.app"`
    );
  }
  let url: URL;
  try {
    url = new URL(worker.lovableOrigin);
  } catch {
    throw new Error(
      `worker.lovableOrigin must be a valid URL. Got: "${worker.lovableOrigin}"`
    );
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    throw new Error(
      `worker.lovableOrigin must use http or https. Got: "${url.protocol}"`
    );
  }
  if (
    !Array.isArray(worker.rewriteRouteBases) ||
    worker.rewriteRouteBases.length === 0
  ) {
    throw new Error(
      `worker.rewriteRouteBases must be a non-empty array when worker.enabled is true. Example: ["/blog/"]`
    );
  }
  if (
    !Array.isArray(worker.botUserAgentPatterns) ||
    worker.botUserAgentPatterns.length === 0
  ) {
    throw new Error(
      `worker.botUserAgentPatterns must be a non-empty array when worker.enabled is true. Example: ["googlebot", "bingbot"]`
    );
  }
  // Substring match only; empty string would match every User-Agent
  for (let i = 0; i < worker.botUserAgentPatterns.length; i++) {
    const p = worker.botUserAgentPatterns[i];
    if (typeof p !== "string" || p.trim() === "") {
      throw new Error(
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
    throw new Error(`Missing ${CONFIG_NAME}. Run: rendershield init`);
  }

  const raw = await fs.readFile(p, "utf8");
  let parsed: ParsedInput & Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as ParsedInput & Record<string, unknown>;
  } catch {
    throw new Error(`${CONFIG_NAME} is not valid JSON`);
  }

  // Minimal validation (v0)
  if (parsed?.version !== 1) throw new Error(`Config version must be 1`);
  if (!parsed?.site?.canonicalBase)
    throw new Error(`site.canonicalBase is required`);
  if (!parsed?.site?.siteName) throw new Error(`site.siteName is required`);
  if (!parsed?.site?.defaultOgImage)
    throw new Error(`site.defaultOgImage is required`);
  if (!parsed?.site?.authorName)
    throw new Error(`site.authorName is required`);
  if (!parsed?.content?.markdown?.baseDir)
    throw new Error(`content.markdown.baseDir is required`);
  if (
    !Array.isArray(parsed?.content?.markdown?.collections) ||
    parsed.content.markdown.collections.length === 0
  ) {
    throw new Error(`content.markdown.collections must be a non-empty array`);
  }
  if (!parsed?.output?.outDir) throw new Error(`output.outDir is required`);

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
