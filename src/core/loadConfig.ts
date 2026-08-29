import fs from "fs-extra";
import path from "node:path";
import { RenderShieldConfig, SCHEMA_TYPES, type SchemaType } from "../types.js";
import { renderShieldError } from "../errors.js";
import { validateRouteBase } from "./routePathSafety.js";
import { validateCollectionPattern } from "./collectionPatternSafety.js";
import {
  readArtifactPathConfig,
  resolveArtifactPathInOutDir,
} from "./artifactPathSafety.js";
import {
  resolveConfigFile,
  DEFAULT_CONFIG_NAME,
  type CommandOptions,
} from "../configPath.js";

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
  if (parsed?.[key] == null) return { enabled: defaultEnabled };

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

function readSpaOrigin(worker: Record<string, unknown>): string | undefined {
  const spa = worker.spaOrigin ?? worker.lovableOrigin;
  return typeof spa === "string" && spa.trim() !== "" ? spa.trim() : undefined;
}

/**
 * Worker config policy: strict mode when enabled.
 * spaOrigin (or deprecated lovableOrigin) must be http(s).
 */
function validateWorkerWhenEnabled(parsed: Record<string, unknown>): void {
  const worker = parsed.worker as Record<string, unknown> | undefined;
  const spaOrigin = worker ? readSpaOrigin(worker) : undefined;

  if (!spaOrigin) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `worker.spaOrigin is required when worker.enabled is true. Example: "https://app.example.com" (lovableOrigin is accepted as a deprecated alias).`
    );
  }

  let url: URL;
  try {
    url = new URL(spaOrigin);
  } catch {
    throw renderShieldError(
      "CONFIG_INVALID",
      `worker.spaOrigin must be a valid URL. Got: "${spaOrigin}"`
    );
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    throw renderShieldError(
      "CONFIG_INVALID",
      `worker.spaOrigin must use http or https. Got: "${url.protocol}"`
    );
  }
  if (
    !Array.isArray(worker?.rewriteRouteBases) ||
    worker.rewriteRouteBases.length === 0
  ) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `worker.rewriteRouteBases must be a non-empty array when worker.enabled is true. Example: ["/blog/"]`
    );
  }
  if (
    !Array.isArray(worker?.botUserAgentPatterns) ||
    worker.botUserAgentPatterns.length === 0
  ) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `worker.botUserAgentPatterns must be a non-empty array when worker.enabled is true. Example: ["googlebot", "bingbot"]`
    );
  }
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

function normalizeWorker(
  parsed: Record<string, unknown>,
  enabled: boolean
): void {
  if (!enabled) {
    parsed.worker = {
      enabled: false,
      spaOrigin: "",
      rewriteRouteBases: [],
      botUserAgentPatterns: [],
      debugHeaders: false,
    };
    return;
  }

  validateWorkerWhenEnabled(parsed);
  const worker = parsed.worker as Record<string, unknown>;
  parsed.worker = {
    enabled: true,
    spaOrigin: readSpaOrigin(worker) as string,
    rewriteRouteBases: worker.rewriteRouteBases,
    botUserAgentPatterns: worker.botUserAgentPatterns,
    debugHeaders: worker.debugHeaders === true,
  };
}

export async function loadConfig(
  cwd = process.cwd(),
  options?: CommandOptions
): Promise<RenderShieldConfig> {
  const configFile = resolveConfigFile(cwd, options?.configPath);
  const configName = path.basename(configFile);
  const exists = await fs.pathExists(configFile);
  if (!exists) {
    throw renderShieldError(
      "CONFIG_MISSING",
      `Missing ${configName}. Run: rendershield init`
    );
  }

  const raw = await fs.readFile(configFile, "utf8");
  let parsed: ParsedInput & Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as ParsedInput & Record<string, unknown>;
  } catch {
    throw renderShieldError("CONFIG_INVALID", `${configName} is not valid JSON`);
  }

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
  if (typeof parsed.output.outDir !== "string" || parsed.output.outDir.trim() === "") {
    throw renderShieldError(
      "CONFIG_INVALID",
      "output.outDir must be a non-empty string"
    );
  }

  const collections = normalizeCollections(parsed.content.markdown.collections);
  validateUniqueCollectionNames(collections);
  parsed.content.markdown.collections = collections;

  const sitemapFlag = coerceBoolFlag(parsed, "sitemap", true);
  const sitemapObj = parsed.sitemap as Record<string, unknown> | undefined;
  const sitemapPath = readArtifactPathConfig(
    sitemapObj?.path,
    DEFAULT_SITEMAP_PATH,
    "sitemap.path"
  );
  parsed.sitemap = { enabled: sitemapFlag.enabled, path: sitemapPath };

  const robotsFlag = coerceBoolFlag(parsed, "robots", true);
  const robotsObj = parsed.robots as Record<string, unknown> | undefined;
  const robotsPath = readArtifactPathConfig(
    robotsObj?.path,
    DEFAULT_ROBOTS_PATH,
    "robots.path"
  );
  parsed.robots = { enabled: robotsFlag.enabled, path: robotsPath };

  const workerFlag = coerceBoolFlag(parsed, "worker", true);
  normalizeWorker(parsed, workerFlag.enabled);

  const outDirAbs = path.resolve(cwd, parsed.output.outDir as string);
  await resolveArtifactPathInOutDir(outDirAbs, sitemapPath, "sitemap.path");
  await resolveArtifactPathInOutDir(outDirAbs, robotsPath, "robots.path");

  return parsed as RenderShieldConfig;
}

export { DEFAULT_CONFIG_NAME };

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
    if (typeof pattern !== "string") {
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

    const patternField = `content.markdown.collections[${index}].pattern`;
    const normalizedPattern = validateCollectionPattern(pattern, patternField);
    const routeBaseField = `content.markdown.collections[${index}].routeBase`;
    const normalizedRouteBase = validateRouteBase(routeBase.trim(), routeBaseField);

    const schemaType: SchemaType =
      schemaTypeRaw === undefined ? "Article" : parseSchemaType(schemaTypeRaw, index);

    return {
      name: name.trim(),
      pattern: normalizedPattern,
      routeBase: normalizedRouteBase,
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

function validateUniqueCollectionNames(
  collections: RenderShieldConfig["content"]["markdown"]["collections"]
): void {
  const nameCounts = new Map<string, number>();
  for (const col of collections) {
    nameCounts.set(col.name, (nameCounts.get(col.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      throw renderShieldError(
        "CONFIG_INVALID",
        `Duplicate collection name "${name}"; collection names must be unique`,
        { collectionName: name, count }
      );
    }
  }
}
