import path from "node:path";
import { MarkdownDoc, RenderShieldConfig } from "../types.js";
import {
  discoverCollectionFiles,
  parseMarkdownFileWithProvenance,
  type ParsedMarkdownWithProvenance,
} from "./markdownContent.js";
import { compareStringsCodeUnit } from "./buildManifest.js";
import { renderShieldError } from "../errors.js";

export type { ParsedMarkdownWithProvenance };

/**
 * Fail when multiple Markdown sources resolve to the same route/output path.
 * Prefer calling before any page writes so failed builds do not overwrite.
 */
export function assertUniqueContentRoutes(
  docs: ReadonlyArray<Pick<MarkdownDoc, "routePath" | "sourcePath">>
): void {
  const seen = new Map<string, string>();
  for (const doc of docs) {
    const previous = seen.get(doc.routePath);
    if (previous !== undefined) {
      throw renderShieldError(
        "BUILD_FAILED",
        `Duplicate content route "${doc.routePath}" from multiple sources: "${previous}" and "${doc.sourcePath}". Each route must map to exactly one generated page.`
      );
    }
    seen.set(doc.routePath, doc.sourcePath);
  }
}

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

  // Deterministic order (locale-independent; aligned with build manifest sorting)
  out.sort((a, b) => compareStringsCodeUnit(a.doc.routePath, b.doc.routePath));
  return out;
}

export async function loadAllMarkdownDocs(
  cfg: RenderShieldConfig,
  cwd = process.cwd()
): Promise<MarkdownDoc[]> {
  const parsed = await loadAllMarkdownDocsWithProvenance(cfg, cwd);
  return parsed.map((p) => p.doc);
}
