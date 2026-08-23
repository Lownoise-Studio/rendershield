import fs from "fs-extra";
import path from "node:path";

/** All routed index.html files under outDir (excludes bare outDir/index.html). */
export async function listPrerenderIndexFiles(
  outDirAbs: string
): Promise<string[]> {
  const results: string[] = [];
  const stack: string[] = [outDirAbs];

  while (stack.length > 0) {
    const current = stack.pop() as string;

    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase() === "index.html") {
        const rel = path.relative(outDirAbs, full);
        const parts = rel.split(path.sep).filter(Boolean);
        if (parts.length >= 2) results.push(full);
      }
    }
  }

  results.sort((a, b) => a.localeCompare(b));
  return results;
}

export function indexHtmlPathToRoute(
  outDirAbs: string,
  indexPathAbs: string
): string {
  const rel = path.relative(outDirAbs, indexPathAbs);
  const noFile = rel.replace(/index\.html$/i, "");
  const normalized = noFile.split(path.sep).join("/").replace(/\/+$/, "");
  return "/" + normalized.replace(/^\/+/, "");
}
