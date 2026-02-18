import fs from "fs-extra";
import path from "node:path";
import { RenderShieldConfig } from "../types.js";

const CONFIG_NAME = "rendershield.config.json";

type BoolFlag = { enabled: boolean };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceBoolFlag(
  parsed: any,
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
  if (typeof (v as any).enabled !== "boolean") {
    throw new Error(`${key}.enabled must be a boolean`);
  }
  return { enabled: (v as any).enabled };
}

/**
 * Worker config policy: strict mode.
 * When worker.enabled is true, all of lovableOrigin, rewriteRouteBases, and
 * botUserAgentPatterns are required and must be non-empty. No defaults are
 * supplied — build fails with a crisp error.
 * lovableOrigin: must be http: or https: only (no file:, javascript:, protocol-relative).
 * botUserAgentPatterns: substring match only (not regex); empty strings rejected to avoid overmatching.
 */
function validateWorkerWhenEnabled(parsed: any): void {
  if (!parsed.worker?.lovableOrigin || typeof parsed.worker.lovableOrigin !== "string") {
    throw new Error(
      `worker.lovableOrigin is required when worker.enabled is true. Example: "https://your-site.lovable.app"`
    );
  }
  let url: URL;
  try {
    url = new URL(parsed.worker.lovableOrigin);
  } catch {
    throw new Error(
      `worker.lovableOrigin must be a valid URL. Got: "${parsed.worker.lovableOrigin}"`
    );
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    throw new Error(
      `worker.lovableOrigin must use http or https. Got: "${url.protocol}"`
    );
  }
  if (
    !Array.isArray(parsed.worker?.rewriteRouteBases) ||
    parsed.worker.rewriteRouteBases.length === 0
  ) {
    throw new Error(
      `worker.rewriteRouteBases must be a non-empty array when worker.enabled is true. Example: ["/blog/"]`
    );
  }
  if (
    !Array.isArray(parsed.worker?.botUserAgentPatterns) ||
    parsed.worker.botUserAgentPatterns.length === 0
  ) {
    throw new Error(
      `worker.botUserAgentPatterns must be a non-empty array when worker.enabled is true. Example: ["googlebot", "bingbot"]`
    );
  }
  // Substring match only; empty string would match every User-Agent
  for (let i = 0; i < parsed.worker.botUserAgentPatterns.length; i++) {
    const p = parsed.worker.botUserAgentPatterns[i];
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
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
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

  // Validate + default these optional sections to prevent TypeErrors later
  parsed.sitemap = coerceBoolFlag(parsed, "sitemap", true);
  parsed.robots = coerceBoolFlag(parsed, "robots", true);
  const workerFlag = coerceBoolFlag(parsed, "worker", true);
  parsed.worker = workerFlag;

  if (parsed.worker.enabled) {
    validateWorkerWhenEnabled(parsed);
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
