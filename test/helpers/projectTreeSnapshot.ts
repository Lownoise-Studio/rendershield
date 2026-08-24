import fs from "fs-extra";
import path from "node:path";
import crypto from "node:crypto";

export type ProjectTreeEntry = {
  type: "file" | "directory" | "symlink" | "other";
  mode: number;
  size: number;
  mtimeMs: number;
  contentHash?: string;
  linkTarget?: string;
};

export type ProjectTreeSnapshot = Map<string, ProjectTreeEntry>;

function normalizeRelPath(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

/**
 * Deterministic project-tree snapshot for read-only proofs.
 * Captures path, entry kind, mode, size, mtime, content hash (files), and symlink targets.
 * Excludes atime (reads may update it on some filesystems).
 */
export async function captureProjectTree(root: string): Promise<ProjectTreeSnapshot> {
  const snapshot: ProjectTreeSnapshot = new Map();
  if (!(await fs.pathExists(root))) return snapshot;

  async function walk(current: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = normalizeRelPath(path.relative(root, full));
      let stat: fs.Stats;
      try {
        stat = await fs.lstat(full);
      } catch {
        continue;
      }

      const base: ProjectTreeEntry = {
        type: "other",
        mode: stat.mode,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };

      if (stat.isDirectory()) {
        snapshot.set(rel, { ...base, type: "directory" });
        await walk(full);
        continue;
      }

      if (stat.isSymbolicLink()) {
        let linkTarget = "";
        try {
          linkTarget = normalizeRelPath(await fs.readlink(full));
        } catch {
          linkTarget = "";
        }
        snapshot.set(rel, { ...base, type: "symlink", linkTarget });
        continue;
      }

      if (stat.isFile()) {
        const buf = await fs.readFile(full);
        snapshot.set(rel, {
          ...base,
          type: "file",
          size: buf.length,
          contentHash: crypto.createHash("sha256").update(buf).digest("hex"),
        });
        continue;
      }

      snapshot.set(rel, base);
    }
  }

  await walk(root);
  return snapshot;
}

export function snapshotsEqual(
  before: ProjectTreeSnapshot,
  after: ProjectTreeSnapshot
): boolean {
  if (before.size !== after.size) return false;
  for (const [rel, entryBefore] of before) {
    const entryAfter = after.get(rel);
    if (!entryAfter) return false;
    if (JSON.stringify(entryBefore) !== JSON.stringify(entryAfter)) return false;
  }
  return true;
}

export function snapshotDiffSummary(
  before: ProjectTreeSnapshot,
  after: ProjectTreeSnapshot
): string {
  const lines: string[] = [];
  const allPaths = new Set([...before.keys(), ...after.keys()]);
  for (const rel of [...allPaths].sort()) {
    const a = before.get(rel);
    const b = after.get(rel);
    if (!a) lines.push(`+ ${rel}`);
    else if (!b) lines.push(`- ${rel}`);
    else if (JSON.stringify(a) !== JSON.stringify(b)) lines.push(`~ ${rel}`);
  }
  return lines.join("\n");
}
