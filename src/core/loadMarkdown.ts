import path from "node:path";
import { MarkdownDoc, RenderShieldConfig } from "../types.js";
import {
  discoverCollectionFiles,
  parseMarkdownFile,
} from "./markdownContent.js";

export async function loadAllMarkdownDocs(
  cfg: RenderShieldConfig,
  cwd = process.cwd()
): Promise<MarkdownDoc[]> {
  const baseDirAbs = path.join(cwd, cfg.content.markdown.baseDir);

  const out: MarkdownDoc[] = [];

  for (const col of cfg.content.markdown.collections) {
    const matches = await discoverCollectionFiles(baseDirAbs, col.pattern);

    for (const rel of matches) {
      const abs = path.join(baseDirAbs, rel);
      out.push(await parseMarkdownFile(abs, col.name, col.routeBase));
    }
  }

  // Deterministic order
  out.sort((a, b) => a.routePath.localeCompare(b.routePath));
  return out;
}
