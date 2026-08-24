import fs from "fs-extra";
import path from "node:path";
import { renderShieldError } from "../errors.js";

/**
 * True when path.relative() indicates the candidate is outside the base directory.
 * Matches complete parent-segment traversal (`..` or `..${sep}...`), not names that
 * merely begin with two dots (e.g. `..metadata`).
 */
function isOutsideBase(relativePath: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  );
}

/**
 * Validates a site-relative artifact path from config (sitemap.path, robots.path).
 * Must be a URL-style path beneath output.outDir when resolved.
 */
export function validateArtifactPathFormat(
  artifactPath: string,
  fieldName: string
): string {
  if (typeof artifactPath !== "string" || artifactPath.trim() === "") {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must be a non-empty site-relative path starting with /`
    );
  }

  const trimmed = artifactPath.trim();

  if (trimmed.includes("\0")) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must not contain null bytes`
    );
  }

  if (!trimmed.startsWith("/")) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must begin with exactly / (site-relative URL path)`
    );
  }

  if (trimmed.startsWith("//")) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must not be a UNC or protocol-relative path`
    );
  }

  if (trimmed.includes("\\")) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must use forward slashes, not backslashes`
    );
  }

  // After the leading slash: reject Windows drive-letter / drive-relative forms
  // (e.g. /C:custom.xml). Checked on all platforms for portable config safety.
  if (/^\/[a-zA-Z]:/.test(trimmed)) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must not contain a Windows drive-letter path`
    );
  }

  if (trimmed === "/") {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must identify a file inside output.outDir, not the output root`
    );
  }

  if (trimmed.endsWith("/")) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must identify a file, not a directory`
    );
  }

  const segments = trimmed.split("/").slice(1);
  if (segments.length === 0) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must identify a file inside output.outDir`
    );
  }

  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      throw renderShieldError(
        "CONFIG_INVALID",
        `${fieldName} contains an empty or current-directory segment`
      );
    }
    if (segment === "..") {
      throw renderShieldError(
        "CONFIG_INVALID",
        `${fieldName} must not contain parent-directory (..) segments`
      );
    }
    // Drive-relative segment after leading slash (e.g. /C:custom.xml → "C:custom.xml")
    if (/^[a-zA-Z]:/.test(segment)) {
      throw renderShieldError(
        "CONFIG_INVALID",
        `${fieldName} must not contain a Windows drive-letter path`
      );
    }
  }

  return trimmed;
}

function assertLexicallyInsideOutDir(
  outDirAbs: string,
  candidateAbs: string,
  fieldName: string,
  artifactPath: string
): void {
  const outDirNorm = path.normalize(path.resolve(outDirAbs));
  const candidateNorm = path.normalize(candidateAbs);
  const relative = path.relative(outDirNorm, candidateNorm);

  if (relative === "" || relative === ".") {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must identify a file inside output.outDir, not the output root`,
      { field: fieldName, path: artifactPath }
    );
  }

  if (isOutsideBase(relative)) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} resolves outside output.outDir`,
      { field: fieldName, path: artifactPath, outDir: outDirAbs }
    );
  }
}

async function resolveExistingPathRealpath(targetAbs: string): Promise<string> {
  try {
    return path.normalize(await fs.realpath(targetAbs));
  } catch {
    return path.normalize(targetAbs);
  }
}

async function assertSymlinkParentsStayInsideOutDir(
  outDirAbs: string,
  candidateAbs: string,
  fieldName: string,
  artifactPath: string
): Promise<void> {
  const outDirNorm = path.normalize(path.resolve(outDirAbs));
  let outDirReal: string;
  try {
    outDirReal = await resolveExistingPathRealpath(outDirNorm);
  } catch {
    outDirReal = outDirNorm;
  }

  let current = path.normalize(candidateAbs);
  const seen = new Set<string>();

  while (!seen.has(current)) {
    seen.add(current);

    if (await fs.pathExists(current)) {
      const currentReal = await resolveExistingPathRealpath(current);
      const relativeReal = path.relative(outDirReal, currentReal);
      if (isOutsideBase(relativeReal)) {
        throw renderShieldError(
          "CONFIG_INVALID",
          `${fieldName} resolves outside output.outDir via symlink`,
          { field: fieldName, path: artifactPath, outDir: outDirAbs, resolvedPath: currentReal }
        );
      }
    }

    if (current === outDirNorm) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    const parentRelative = path.relative(outDirNorm, parent);
    if (isOutsideBase(parentRelative)) break;
    current = parent;
  }
}

/**
 * Resolves an artifact path beneath outDirAbs and proves the target stays inside outDir,
 * including existing symlink parents that would escape the output directory.
 */
export async function resolveArtifactPathInOutDir(
  outDirAbs: string,
  artifactPath: string,
  fieldName: string
): Promise<string> {
  const normalizedPath = validateArtifactPathFormat(artifactPath, fieldName);
  const relativePath = normalizedPath.slice(1);
  const candidateAbs = path.resolve(outDirAbs, relativePath);

  assertLexicallyInsideOutDir(outDirAbs, candidateAbs, fieldName, normalizedPath);
  await assertSymlinkParentsStayInsideOutDir(outDirAbs, candidateAbs, fieldName, normalizedPath);

  return candidateAbs;
}

export function readArtifactPathConfig(
  value: unknown,
  defaultPath: string,
  fieldName: string
): string {
  if (value === undefined || value === null) {
    return validateArtifactPathFormat(defaultPath, fieldName);
  }
  if (typeof value !== "string") {
    throw renderShieldError("CONFIG_INVALID", `${fieldName} must be a string`);
  }
  return validateArtifactPathFormat(value.trim(), fieldName);
}
