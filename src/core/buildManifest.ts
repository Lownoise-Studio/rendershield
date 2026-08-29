import { createHash } from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { getPackageIdentity } from "./packageIdentity.js";
import { resolveArtifactPathInOutDir } from "./artifactPathSafety.js";
import { renderShieldError } from "../errors.js";

/** Fixed filename written at the output directory root. */
export const BUILD_MANIFEST_FILENAME = "rendershield-manifest.json";

/** Site-relative artifact path used with resolveArtifactPathInOutDir. */
export const BUILD_MANIFEST_ARTIFACT_PATH = `/${BUILD_MANIFEST_FILENAME}`;

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
  /** Exact HTML string written to disk (utf8). */
  html: string;
  /** Absolute path of the written index.html. */
  outputPathAbs: string;
};

/** SHA-256 hex digest of a utf8 string. */
export function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
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

export async function buildManifestPageEntry(
  cwd: string,
  outDirAbs: string,
  input: BuildManifestPageInput
): Promise<BuildManifestPageEntry> {
  const sourceRaw = await fs.readFile(input.sourcePathAbs, "utf8");
  return {
    route: input.routePath,
    source: projectRelativeSourcePath(cwd, input.sourcePathAbs),
    sourceSha256: sha256Utf8(sourceRaw),
    output: outDirRelativeOutputPath(outDirAbs, input.outputPathAbs),
    outputSha256: sha256Utf8(input.html),
  };
}

export function createBuildManifestV1(
  pages: BuildManifestPageEntry[]
): BuildManifestV1 {
  const identity = getPackageIdentity();
  const sorted = [...pages].sort((a, b) => a.route.localeCompare(b.route));
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
  const tmpAbs = path.join(
    path.dirname(finalAbs),
    `.${BUILD_MANIFEST_FILENAME}.tmp`
  );

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
