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

async function captureEntry(fullPath: string): Promise<ProjectTreeEntry | null> {
  let stat: fs.Stats;
  try {
    stat = await fs.lstat(fullPath);
  } catch {
    return null;
  }

  const base: ProjectTreeEntry = {
    type: "other",
    mode: stat.mode,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };

  if (stat.isDirectory()) {
    return { ...base, type: "directory" };
  }

  if (stat.isSymbolicLink()) {
    let linkTarget = "";
    try {
      linkTarget = normalizeRelPath(await fs.readlink(fullPath));
    } catch {
      linkTarget = "";
    }
    return { ...base, type: "symlink", linkTarget };
  }

  if (stat.isFile()) {
    const buf = await fs.readFile(fullPath);
    return {
      ...base,
      type: "file",
      size: buf.length,
      contentHash: crypto.createHash("sha256").update(buf).digest("hex"),
    };
  }

  return base;
}

/**
 * Deterministic project-tree snapshot for read-only proofs.
 * Captures the project root (as ".") plus descendants: path, entry kind, mode,
 * size, mtime, content hash (files), and symlink targets.
 * Excludes atime (reads may update it on some filesystems).
 */
export async function captureProjectTree(root: string): Promise<ProjectTreeSnapshot> {
  const snapshot: ProjectTreeSnapshot = new Map();
  if (!(await fs.pathExists(root))) return snapshot;

  const rootEntry = await captureEntry(root);
  if (rootEntry) {
    snapshot.set(".", rootEntry);
  }

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
      const captured = await captureEntry(full);
      if (!captured) continue;

      snapshot.set(rel, captured);
      if (captured.type === "directory") {
        await walk(full);
      }
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
