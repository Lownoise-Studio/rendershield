import fs from "fs-extra";
import path from "node:path";
import { renderShieldError } from "../errors.js";
import { isOutsideBase } from "./pathContainment.js";

/**
 * Validates output path before any destructive operation (fs.remove).
 * Pass: outDir is a subdirectory inside project root; no symlink escape.
 * Fail: "/", "C:\", "..", "../", or outDir (or any of its existing parents) resolving outside project.
 */
export async function validateOutputPath(outDir: string, cwd: string): Promise<void> {
  const cwdAbs = path.resolve(cwd);
  let cwdReal: string;
  try {
    cwdReal = await fs.realpath(cwdAbs);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw renderShieldError(
      "OUTPUT_PATH_UNSAFE",
      `Cannot resolve project root: ${cwdAbs}. ${msg}`
    );
  }

  // Resolve against the realpath'd project root so macOS /var → /private/var (and
  // similar symlink roots) do not false-positive as path traversal.
  const outDirAbs = path.resolve(cwdReal, outDir);
  const normalizedCwd = path.normalize(cwdReal);
  const normalizedOut = path.normalize(outDirAbs);

  const relative = path.relative(normalizedCwd, normalizedOut);
  if (isOutsideBase(relative)) {
    throw renderShieldError(
      "OUTPUT_PATH_UNSAFE",
      `Output directory "${outDir}" resolves outside project root. Use a relative path within the project.`
    );
  }

  const rootPaths = ["/", "c:\\", "c:/"];
  const outLower = normalizedOut.toLowerCase();
  if (rootPaths.includes(outLower)) {
    throw renderShieldError(
      "OUTPUT_PATH_UNSAFE",
      `Output directory "${outDir}" resolves to root filesystem. This is not allowed for safety.`
    );
  }

  const cwdLower = normalizedCwd.toLowerCase();
  if (outLower === cwdLower) {
    throw renderShieldError(
      "OUTPUT_PATH_UNSAFE",
      `Output directory "${outDir}" cannot be the project root. Use a subdirectory (e.g. dist-prerender).`
    );
  }

  if (await fs.pathExists(outDirAbs)) {
    let outDirReal: string;
    try {
      outDirReal = await fs.realpath(outDirAbs);
    } catch {
      outDirReal = outDirAbs;
    }
    const outDirRealNorm = path.normalize(outDirReal);
    const relativeReal = path.relative(normalizedCwd, outDirRealNorm);
    if (isOutsideBase(relativeReal)) {
      throw renderShieldError(
        "OUTPUT_PATH_UNSAFE",
        `Output directory "${outDir}" resolves (via symlink) outside project root. Use a path that does not escape the project.`
      );
    }
  } else {
    let current = normalizedOut;
    let foundParentInsideRoot = false;
    while (current) {
      if (await fs.pathExists(current)) {
        let parentReal: string;
        try {
          parentReal = await fs.realpath(current);
        } catch {
          parentReal = current;
        }
        const parentRealNorm = path.normalize(parentReal);
        const parentLower = parentRealNorm.toLowerCase();
        if (rootPaths.includes(parentLower)) {
          throw renderShieldError(
            "OUTPUT_PATH_UNSAFE",
            `Output directory "${outDir}" has a parent that resolves to filesystem root. Use a path inside the project.`
          );
        }
        const relParent = path.relative(normalizedCwd, parentRealNorm);
        if (isOutsideBase(relParent)) {
          throw renderShieldError(
            "OUTPUT_PATH_UNSAFE",
            `Output directory "${outDir}" has a parent that resolves (via symlink) outside project root. Use a path that does not escape the project.`
          );
        }
        foundParentInsideRoot = true;
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (!foundParentInsideRoot) {
      throw renderShieldError(
        "OUTPUT_PATH_UNSAFE",
        `Output directory "${outDir}" could not be validated: no existing parent path found. Use a path inside the project.`
      );
    }
  }
}
