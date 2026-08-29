import fs from "fs-extra";
import path from "node:path";
import { getPackageIdentity } from "./packageIdentity.js";
import {
  resolveArtifactPathInOutDir,
  validateArtifactPathFormat,
} from "./artifactPathSafety.js";
import { renderShieldError } from "../errors.js";
import { sha256Utf8 } from "./sha256.js";
import type { RenderShieldConfig } from "../types.js";

export { sha256Utf8 } from "./sha256.js";

/** Fixed filename written at the output directory root. */
export const BUILD_MANIFEST_FILENAME = "rendershield-manifest.json";

/** Temp filename used for atomic rename (must stay under outDir). */
export const BUILD_MANIFEST_TMP_FILENAME = `.${BUILD_MANIFEST_FILENAME}.tmp`;

/** Site-relative artifact path used with resolveArtifactPathInOutDir. */
export const BUILD_MANIFEST_ARTIFACT_PATH = `/${BUILD_MANIFEST_FILENAME}`;

/** Site-relative temp path reserved alongside the final manifest. */
export const BUILD_MANIFEST_TMP_ARTIFACT_PATH = `/${BUILD_MANIFEST_TMP_FILENAME}`;

/** Configurable artifact paths must not collide with these reserved values. */
export const RESERVED_BUILD_MANIFEST_ARTIFACT_PATHS = [
  BUILD_MANIFEST_ARTIFACT_PATH,
  BUILD_MANIFEST_TMP_ARTIFACT_PATH,
] as const;

export const BUILD_MANIFEST_VERSION = 1 as const;

export type BuildManifestPageEntry = {
  route: string;
  source: string;
  sourceSha256: string;
  output: string;
  outputSha256: string;
};

export type BuildManifestV1 = {
  manifestVersion: typeof BUILD_MANIFEST_VERSION;
  generator: {
    name: string;
    version: string;
  };
  pages: BuildManifestPageEntry[];
};

export type BuildManifestPageInput = {
  routePath: string;
  sourcePathAbs: string;
  /** SHA-256 of the exact UTF-8 source used to parse/render this page. */
  sourceSha256: string;
  /** Exact HTML string written to disk (utf8). */
  html: string;
  /** Absolute path of the written index.html. */
  outputPathAbs: string;
};

/**
 * Locale-independent string ordering using ordinary JS code-unit comparison.
 * Avoids ICU / runtime-locale variance from String.prototype.localeCompare.
 */
export function compareStringsCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Reject sitemap/robots (or other) artifact paths that would overwrite the
 * reserved build-manifest final or temp filenames.
 */
export function assertArtifactPathDoesNotCollideWithManifest(
  fieldName: string,
  artifactPath: string
): void {
  const normalized = validateArtifactPathFormat(artifactPath, fieldName);
  for (const reserved of RESERVED_BUILD_MANIFEST_ARTIFACT_PATHS) {
    if (normalized === reserved) {
      throw renderShieldError(
        "CONFIG_INVALID",
        `${fieldName} collides with reserved build manifest path "${reserved}"`
      );
    }
  }
}

/** Fail closed if config artifact paths collide with reserved manifest paths. */
export function assertConfigDoesNotCollideWithBuildManifest(
  cfg: RenderShieldConfig
): void {
  assertArtifactPathDoesNotCollideWithManifest("sitemap.path", cfg.sitemap.path);
  assertArtifactPathDoesNotCollideWithManifest("robots.path", cfg.robots.path);
}

/** Normalize a filesystem path to a portable `/`-separated relative path. */
export function toPosixRelative(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

/**
 * Project-relative source path using `/` separators.
 * Rejects absolute or escaping paths so the manifest never embeds cwd.
 */
export function projectRelativeSourcePath(
  cwd: string,
  sourcePathAbs: string
): string {
  const relative = path.relative(cwd, sourcePathAbs);
  if (
    relative === "" ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).includes("..")
  ) {
    throw renderShieldError(
      "BUILD_FAILED",
      `Source path is not project-relative under the project root: ${sourcePathAbs}`
    );
  }
  return toPosixRelative(relative);
}

/** outDir-relative output path using `/` separators. */
export function outDirRelativeOutputPath(
  outDirAbs: string,
  outputPathAbs: string
): string {
  const relative = path.relative(outDirAbs, outputPathAbs);
  if (
    relative === "" ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).includes("..")
  ) {
    throw renderShieldError(
      "OUTPUT_PATH_UNSAFE",
      `Output path is not relative under output.outDir: ${outputPathAbs}`
    );
  }
  return toPosixRelative(relative);
}

/**
 * Build one manifest page entry from already-captured provenance.
 * Does not re-read the source file (avoids TOCTOU with rendered HTML).
 */
export function buildManifestPageEntry(
  cwd: string,
  outDirAbs: string,
  input: BuildManifestPageInput
): BuildManifestPageEntry {
  return {
    route: input.routePath,
    source: projectRelativeSourcePath(cwd, input.sourcePathAbs),
    sourceSha256: input.sourceSha256,
    output: outDirRelativeOutputPath(outDirAbs, input.outputPathAbs),
    outputSha256: sha256Utf8(input.html),
  };
}

export function createBuildManifestV1(
  pages: BuildManifestPageEntry[]
): BuildManifestV1 {
  const identity = getPackageIdentity();
  const sorted = [...pages].sort((a, b) =>
    compareStringsCodeUnit(a.route, b.route)
  );
  return {
    manifestVersion: BUILD_MANIFEST_VERSION,
    generator: {
      name: identity.name,
      version: identity.version,
    },
    pages: sorted,
  };
}

/** Deterministic JSON serialization (stable key order from object construction). */
export function serializeBuildManifest(manifest: BuildManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Write the build manifest under outDirAbs using a temp file + rename.
 * Call only after a successful page generation (and preferred after other artifacts).
 */
export async function writeBuildManifestAtomic(
  outDirAbs: string,
  manifest: BuildManifestV1
): Promise<string> {
  const finalAbs = await resolveArtifactPathInOutDir(
    outDirAbs,
    BUILD_MANIFEST_ARTIFACT_PATH,
    "build.manifest"
  );
  const tmpAbs = path.join(path.dirname(finalAbs), BUILD_MANIFEST_TMP_FILENAME);

  // Containment: temp must stay beside the resolved final path under outDir.
  const tmpRel = path.relative(outDirAbs, tmpAbs);
  if (
    tmpRel === "" ||
    path.isAbsolute(tmpRel) ||
    tmpRel.split(path.sep).includes("..")
  ) {
    throw renderShieldError(
      "OUTPUT_PATH_UNSAFE",
      `Manifest temp path escapes output.outDir: ${tmpAbs}`
    );
  }

  const payload = serializeBuildManifest(manifest);
  await fs.writeFile(tmpAbs, payload, "utf8");
  await fs.move(tmpAbs, finalAbs, { overwrite: true });
  return finalAbs;
}
