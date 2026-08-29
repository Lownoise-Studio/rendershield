import path from "node:path";
import { MarkdownDoc, RenderShieldConfig } from "../types.js";
import {
  discoverCollectionFiles,
  parseMarkdownFileWithProvenance,
  type ParsedMarkdownWithProvenance,
} from "./markdownContent.js";

export type { ParsedMarkdownWithProvenance };

/** Load all Markdown docs with source SHA-256 from the same read used for parsing. */
export async function loadAllMarkdownDocsWithProvenance(
  cfg: RenderShieldConfig,
  cwd = process.cwd()
): Promise<ParsedMarkdownWithProvenance[]> {
  const baseDirAbs = path.join(cwd, cfg.content.markdown.baseDir);

  const out: ParsedMarkdownWithProvenance[] = [];

  for (const col of cfg.content.markdown.collections) {
    const matches = await discoverCollectionFiles(baseDirAbs, col.pattern);

    for (const rel of matches) {
      const abs = path.join(baseDirAbs, rel);
      out.push(await parseMarkdownFileWithProvenance(abs, col.name, col.routeBase));
    }
  }

  // Deterministic order (same as public loadAllMarkdownDocs)
  out.sort((a, b) => a.doc.routePath.localeCompare(b.doc.routePath));
  return out;
}

export async function loadAllMarkdownDocs(
  cfg: RenderShieldConfig,
  cwd = process.cwd()
): Promise<MarkdownDoc[]> {
  const parsed = await loadAllMarkdownDocsWithProvenance(cfg, cwd);
  return parsed.map((p) => p.doc);
}
