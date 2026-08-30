import fs from "fs-extra";
import path from "node:path";

/**
 * True when path.relative() indicates the candidate is outside the base directory.
 * Matches complete parent-segment traversal (`..` or `..${sep}...`), not names that
 * merely begin with two dots (e.g. `..metadata`).
 */
export function isOutsideBase(relativePath: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  );
}

/**
 * Lexical containment: candidateAbs must resolve at or under baseAbs.
 * Returns the normalized absolute candidate path.
 */
export function assertContainedInBase(
  baseAbs: string,
  candidateAbs: string,
  onEscape: (relative: string) => never
): string {
  const baseNorm = path.normalize(path.resolve(baseAbs));
  const candidateNorm = path.normalize(path.resolve(candidateAbs));
  const relative = path.relative(baseNorm, candidateNorm);

  if (isOutsideBase(relative)) {
    onEscape(relative);
  }

  return candidateNorm;
}

export type ContainedPathWithSymlinksResult =
  | {
      ok: true;
      /** Lexically normalized absolute candidate (may not exist). */
      candidateAbs: string;
      /** Realpath of baseAbs. */
      baseReal: string;
      /**
       * Realpath of candidate when it exists; null when missing.
       * Only set after proving containment (including symlink parents).
       */
      candidateReal: string | null;
    }
  | {
      ok: false;
      reason: "lexical-escape" | "symlink-escape" | "base-unresolvable" | "resolve-failed";
      candidateAbs: string;
      resolvedPath?: string;
      message: string;
    };

async function tryRealpath(targetAbs: string): Promise<string | null> {
  try {
    return path.normalize(await fs.realpath(targetAbs));
  } catch {
    return null;
  }
}

/**
 * Lexical containment plus realpath checks for the candidate (if present) and
 * existing ancestors under baseAbs. Rejects symlink escapes; allows contained
 * symlinks whose final target stays inside the base.
 */
export async function checkContainedPathWithSymlinks(
  baseAbs: string,
  candidateAbs: string
): Promise<ContainedPathWithSymlinksResult> {
  const baseNorm = path.normalize(path.resolve(baseAbs));
  const candidateNorm = path.normalize(path.resolve(candidateAbs));
  const lexicalRelative = path.relative(baseNorm, candidateNorm);

  if (isOutsideBase(lexicalRelative)) {
    return {
      ok: false,
      reason: "lexical-escape",
      candidateAbs: candidateNorm,
      message: `Path escapes base directory: ${candidateNorm}`,
    };
  }

  const baseReal = await tryRealpath(baseNorm);
  if (baseReal === null) {
    return {
      ok: false,
      reason: "base-unresolvable",
      candidateAbs: candidateNorm,
      message: `Cannot resolve base directory: ${baseNorm}`,
    };
  }

  let current = candidateNorm;
  const seen = new Set<string>();
  let candidateReal: string | null = null;
  let examinedCandidate = false;

  while (!seen.has(current)) {
    seen.add(current);

    let exists = false;
    try {
      await fs.lstat(current);
      exists = true;
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code !== "ENOENT") {
        return {
          ok: false,
          reason: "resolve-failed",
          candidateAbs: candidateNorm,
          message: `Cannot stat path during containment check: ${current}`,
        };
      }
    }

    if (exists) {
      const currentReal = await tryRealpath(current);
      if (currentReal === null) {
        return {
          ok: false,
          reason: "resolve-failed",
          candidateAbs: candidateNorm,
          resolvedPath: current,
          message: `Cannot realpath path during containment check: ${current}`,
        };
      }

      const relativeReal = path.relative(baseReal, currentReal);
      if (isOutsideBase(relativeReal)) {
        return {
          ok: false,
          reason: "symlink-escape",
          candidateAbs: candidateNorm,
          resolvedPath: currentReal,
          message: `Path resolves outside base via symlink: ${currentReal}`,
        };
      }

      if (!examinedCandidate) {
        candidateReal = currentReal;
        examinedCandidate = true;
      }
    } else if (!examinedCandidate) {
      candidateReal = null;
      examinedCandidate = true;
    }

    if (current === baseNorm) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    const parentRelative = path.relative(baseNorm, parent);
    if (isOutsideBase(parentRelative)) break;
    current = parent;
  }

  return {
    ok: true,
    candidateAbs: candidateNorm,
    baseReal,
    candidateReal,
  };
}
