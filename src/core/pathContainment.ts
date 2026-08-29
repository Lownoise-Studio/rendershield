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
