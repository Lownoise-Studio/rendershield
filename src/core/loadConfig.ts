import fs from "fs-extra";
import path from "node:path";
import { RenderShieldConfig } from "../types.js";

const CONFIG_NAME = "rendershield.config.json";

export async function loadConfig(cwd = process.cwd()): Promise<RenderShieldConfig> {
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
  if (!parsed?.site?.canonicalBase) throw new Error(`site.canonicalBase is required`);
  if (!parsed?.site?.siteName) throw new Error(`site.siteName is required`);
  if (!parsed?.site?.defaultOgImage) throw new Error(`site.defaultOgImage is required`);
  if (!parsed?.site?.authorName) throw new Error(`site.authorName is required`);
  if (!parsed?.content?.markdown?.baseDir) throw new Error(`content.markdown.baseDir is required`);
  if (!Array.isArray(parsed?.content?.markdown?.collections) || parsed.content.markdown.collections.length === 0) {
    throw new Error(`content.markdown.collections must be a non-empty array`);
  }
  if (!parsed?.output?.outDir) throw new Error(`output.outDir is required`);

  return parsed as RenderShieldConfig;
}
