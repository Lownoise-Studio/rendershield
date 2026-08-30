import fs from "fs-extra";
import path from "node:path";
import {
  BUILD_MANIFEST_FILENAME,
  BUILD_MANIFEST_VERSION,
  compareStringsCodeUnit,
  type BuildManifestPageEntry,
  type BuildManifestV1,
} from "../core/buildManifest.js";
import { assertContainedInBase } from "../core/pathContainment.js";
import { validateContentRoutePath } from "../core/routePathSafety.js";
import { sha256Utf8 } from "../core/sha256.js";
import type { DoctorDiagnosticCode } from "./types.js";

const SHA256_HEX = /^[a-f0-9]{64}$/;

export type ManifestInvalidReason =
  | "malformed-json"
  | "invalid-structure"
  | "unsupported-version"
  | "unsafe-path"
  | "duplicate-route"
  | "duplicate-output"
  | "not-a-file";

export type ManifestLoadResult =
  | { status: "absent"; path: string }
  | {
      status: "invalid";
      path: string;
      reason: ManifestInvalidReason;
      code: DoctorDiagnosticCode;
      message: string;
      details: Record<string, unknown>;
    }
  | {
      status: "valid";
      path: string;
      manifest: BuildManifestV1;
    };

function failInvalid(
  manifestPath: string,
  reason: ManifestInvalidReason,
  code: DoctorDiagnosticCode,
  message: string,
  details: Record<string, unknown> = {}
): ManifestLoadResult {
  return {
    status: "invalid",
    path: manifestPath,
    reason,
    code,
    message,
    details: { ...details, reason, method: "manifest-sha256" },
  };
}

/**
 * True when `rel` is a non-empty `/`-separated relative path with no
 * absolute, empty, `.`, or `..` segments (portable relative form).
 */
export function isSafeManifestRelativePosix(rel: unknown): rel is string {
  if (typeof rel !== "string" || rel.length === 0) return false;
  if (rel.includes("\0") || rel.includes("\\")) return false;
  if (path.isAbsolute(rel) || rel.startsWith("/") || rel.startsWith("~")) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(rel)) return false;
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/**
 * Resolve a project-relative `/`-separated path under cwd with containment.
 * Returns null when the path is unsafe.
 */
export function resolveManifestSourceAbs(
  cwd: string,
  sourceRel: string
): string | null {
  if (!isSafeManifestRelativePosix(sourceRel)) return null;
  const candidateAbs = path.resolve(cwd, ...sourceRel.split("/"));
  try {
    return assertContainedInBase(cwd, candidateAbs, () => {
      throw new Error("escape");
    });
  } catch {
    return null;
  }
}

/**
 * Resolve an outDir-relative `/`-separated path under outDirAbs with containment.
 * Returns null when the path is unsafe.
 */
export function resolveManifestOutputAbs(
  outDirAbs: string,
  outputRel: string
): string | null {
  if (!isSafeManifestRelativePosix(outputRel)) return null;
  const candidateAbs = path.resolve(outDirAbs, ...outputRel.split("/"));
  try {
    return assertContainedInBase(outDirAbs, candidateAbs, () => {
      throw new Error("escape");
    });
  } catch {
    return null;
  }
}

function validatePageEntry(
  page: unknown,
  index: number
):
  | { ok: true; entry: BuildManifestPageEntry }
  | { ok: false; result: Omit<Extract<ManifestLoadResult, { status: "invalid" }>, "path"> } {
  if (page === null || typeof page !== "object" || Array.isArray(page)) {
    return {
      ok: false,
      result: {
        status: "invalid",
        reason: "invalid-structure",
        code: "DOCTOR_MANIFEST_INVALID",
        message: `Build manifest pages[${index}] is not an object`,
        details: { index, reason: "invalid-structure", method: "manifest-sha256" },
      },
    };
  }

  const raw = page as Record<string, unknown>;
  const { route, source, sourceSha256, output, outputSha256 } = raw;

  if (!isNonEmptyString(route)) {
    return {
      ok: false,
      result: {
        status: "invalid",
        reason: "invalid-structure",
        code: "DOCTOR_MANIFEST_INVALID",
        message: `Build manifest pages[${index}].route must be a non-empty string`,
        details: { index, field: "route", reason: "invalid-structure", method: "manifest-sha256" },
      },
    };
  }

  try {
    validateContentRoutePath(route, "pages[].route", "CONTENT_INVALID");
  } catch {
    return {
      ok: false,
      result: {
        status: "invalid",
        reason: "unsafe-path",
        code: "DOCTOR_MANIFEST_INVALID",
        message: `Build manifest pages[${index}].route is not a safe content route: ${route}`,
        details: {
          index,
          field: "route",
          route,
          reason: "unsafe-path",
          method: "manifest-sha256",
        },
      },
    };
  }

  if (!isSafeManifestRelativePosix(source)) {
    return {
      ok: false,
      result: {
        status: "invalid",
        reason: "unsafe-path",
        code: "DOCTOR_MANIFEST_INVALID",
        message: `Build manifest pages[${index}].source is not a safe project-relative path`,
        details: {
          index,
          field: "source",
          source,
          reason: "unsafe-path",
          method: "manifest-sha256",
        },
      },
    };
  }

  if (!isSafeManifestRelativePosix(output)) {
    return {
      ok: false,
      result: {
        status: "invalid",
        reason: "unsafe-path",
        code: "DOCTOR_MANIFEST_INVALID",
        message: `Build manifest pages[${index}].output is not a safe outDir-relative path`,
        details: {
          index,
          field: "output",
          output,
          reason: "unsafe-path",
          method: "manifest-sha256",
        },
      },
    };
  }

  if (!isSha256Hex(sourceSha256)) {
    return {
      ok: false,
      result: {
        status: "invalid",
        reason: "invalid-structure",
        code: "DOCTOR_MANIFEST_INVALID",
        message: `Build manifest pages[${index}].sourceSha256 must be a 64-char hex digest`,
        details: {
          index,
          field: "sourceSha256",
          reason: "invalid-structure",
          method: "manifest-sha256",
        },
      },
    };
  }

  if (!isSha256Hex(outputSha256)) {
    return {
      ok: false,
      result: {
        status: "invalid",
        reason: "invalid-structure",
        code: "DOCTOR_MANIFEST_INVALID",
        message: `Build manifest pages[${index}].outputSha256 must be a 64-char hex digest`,
        details: {
          index,
          field: "outputSha256",
          reason: "invalid-structure",
          method: "manifest-sha256",
        },
      },
    };
  }

  return {
    ok: true,
    entry: {
      route,
      source,
      sourceSha256: sourceSha256.toLowerCase(),
      output,
      outputSha256: outputSha256.toLowerCase(),
    },
  };
}

/**
 * Discover and validate the build manifest at outDir/rendershield-manifest.json only.
 * Read-only. Does not search other locations.
 */
export async function loadBuildManifestForDoctor(
  cwd: string,
  outDirAbs: string
): Promise<ManifestLoadResult> {
  const manifestPath = path.join(outDirAbs, BUILD_MANIFEST_FILENAME);

  if (!(await fs.pathExists(manifestPath))) {
    return { status: "absent", path: manifestPath };
  }

  const stat = await fs.stat(manifestPath);
  if (!stat.isFile()) {
    return failInvalid(
      manifestPath,
      "not-a-file",
      "DOCTOR_MANIFEST_INVALID",
      `Build manifest path exists but is not a file: ${BUILD_MANIFEST_FILENAME}`,
      { path: manifestPath }
    );
  }

  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return failInvalid(
      manifestPath,
      "malformed-json",
      "DOCTOR_MANIFEST_INVALID",
      `Build manifest could not be read: ${message}`,
      { path: manifestPath }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return failInvalid(
      manifestPath,
      "malformed-json",
      "DOCTOR_MANIFEST_INVALID",
      `Build manifest is not valid JSON: ${message}`,
      { path: manifestPath }
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return failInvalid(
      manifestPath,
      "invalid-structure",
      "DOCTOR_MANIFEST_INVALID",
      "Build manifest root must be a JSON object",
      { path: manifestPath }
    );
  }

  const root = parsed as Record<string, unknown>;
  const { manifestVersion, generator, pages } = root;

  if (typeof manifestVersion !== "number" || !Number.isInteger(manifestVersion)) {
    return failInvalid(
      manifestPath,
      "invalid-structure",
      "DOCTOR_MANIFEST_INVALID",
      "Build manifest manifestVersion must be an integer",
      { path: manifestPath, manifestVersion }
    );
  }

  if (manifestVersion !== BUILD_MANIFEST_VERSION) {
    return failInvalid(
      manifestPath,
      "unsupported-version",
      "DOCTOR_MANIFEST_UNSUPPORTED_VERSION",
      `Build manifest version ${manifestVersion} is unsupported (expected ${BUILD_MANIFEST_VERSION})`,
      {
        path: manifestPath,
        manifestVersion,
        expectedVersion: BUILD_MANIFEST_VERSION,
      }
    );
  }

  if (
    generator === null ||
    typeof generator !== "object" ||
    Array.isArray(generator)
  ) {
    return failInvalid(
      manifestPath,
      "invalid-structure",
      "DOCTOR_MANIFEST_INVALID",
      "Build manifest generator must be an object",
      { path: manifestPath }
    );
  }

  const gen = generator as Record<string, unknown>;
  if (!isNonEmptyString(gen.name) || !isNonEmptyString(gen.version)) {
    return failInvalid(
      manifestPath,
      "invalid-structure",
      "DOCTOR_MANIFEST_INVALID",
      "Build manifest generator.name and generator.version must be non-empty strings",
      { path: manifestPath }
    );
  }

  if (!Array.isArray(pages)) {
    return failInvalid(
      manifestPath,
      "invalid-structure",
      "DOCTOR_MANIFEST_INVALID",
      "Build manifest pages must be an array",
      { path: manifestPath }
    );
  }

  const entries: BuildManifestPageEntry[] = [];
  const routesSeen = new Map<string, number>();
  const outputsSeen = new Map<string, number>();

  for (let i = 0; i < pages.length; i++) {
    const validated = validatePageEntry(pages[i], i);
    if (!validated.ok) {
      return { ...validated.result, path: manifestPath };
    }

    const entry = validated.entry;
    const priorRoute = routesSeen.get(entry.route);
    if (priorRoute !== undefined) {
      return failInvalid(
        manifestPath,
        "duplicate-route",
        "DOCTOR_MANIFEST_INVALID",
        `Build manifest has duplicate route "${entry.route}" at pages[${priorRoute}] and pages[${i}]`,
        {
          path: manifestPath,
          route: entry.route,
          indices: [priorRoute, i],
        }
      );
    }
    routesSeen.set(entry.route, i);

    const priorOutput = outputsSeen.get(entry.output);
    if (priorOutput !== undefined) {
      return failInvalid(
        manifestPath,
        "duplicate-output",
        "DOCTOR_MANIFEST_INVALID",
        `Build manifest has conflicting output path "${entry.output}" at pages[${priorOutput}] and pages[${i}]`,
        {
          path: manifestPath,
          output: entry.output,
          indices: [priorOutput, i],
        }
      );
    }
    outputsSeen.set(entry.output, i);

    // Containment probes: reject entries that escape project root or outDir.
    if (resolveManifestSourceAbs(cwd, entry.source) === null) {
      return failInvalid(
        manifestPath,
        "unsafe-path",
        "DOCTOR_MANIFEST_INVALID",
        `Build manifest pages[${i}].source escapes project root: ${entry.source}`,
        {
          path: manifestPath,
          field: "source",
          source: entry.source,
          index: i,
        }
      );
    }

    if (resolveManifestOutputAbs(outDirAbs, entry.output) === null) {
      return failInvalid(
        manifestPath,
        "unsafe-path",
        "DOCTOR_MANIFEST_INVALID",
        `Build manifest pages[${i}].output escapes output.outDir: ${entry.output}`,
        {
          path: manifestPath,
          field: "output",
          output: entry.output,
          index: i,
        }
      );
    }

    entries.push(entry);
  }

  const sorted = [...entries].sort((a, b) =>
    compareStringsCodeUnit(a.route, b.route)
  );

  const manifest: BuildManifestV1 = {
    manifestVersion: BUILD_MANIFEST_VERSION,
    generator: { name: gen.name, version: gen.version },
    pages: sorted,
  };

  return { status: "valid", path: manifestPath, manifest };
}

export type ManifestPageFreshness =
  | {
      route: string;
      status: "match";
      sourcePath: string;
      htmlPath: string;
    }
  | {
      route: string;
      status: "source-changed" | "output-changed";
      sourcePath: string;
      htmlPath: string;
      expectedSha256: string;
      actualSha256: string;
    }
  | {
      route: string;
      status: "source-missing" | "output-missing";
      sourcePath?: string;
      htmlPath?: string;
    };

/**
 * Compare current source Markdown and generated HTML to manifest SHA-256 values.
 * Read-only. Uses the same utf8 SHA-256 semantics as build (`sha256Utf8`).
 */
export async function compareManifestPageFreshness(
  cwd: string,
  outDirAbs: string,
  page: BuildManifestPageEntry
): Promise<ManifestPageFreshness> {
  const sourceAbs = resolveManifestSourceAbs(cwd, page.source);
  if (sourceAbs === null) {
    return { route: page.route, status: "source-missing" };
  }

  const htmlAbs = resolveManifestOutputAbs(outDirAbs, page.output);
  if (htmlAbs === null) {
    return { route: page.route, status: "output-missing" };
  }

  if (!(await fs.pathExists(sourceAbs))) {
    return {
      route: page.route,
      status: "source-missing",
      sourcePath: sourceAbs,
      htmlPath: htmlAbs,
    };
  }

  if (!(await fs.pathExists(htmlAbs))) {
    return {
      route: page.route,
      status: "output-missing",
      sourcePath: sourceAbs,
      htmlPath: htmlAbs,
    };
  }

  const sourceText = await fs.readFile(sourceAbs, "utf8");
  const sourceActual = sha256Utf8(sourceText);
  if (sourceActual !== page.sourceSha256) {
    return {
      route: page.route,
      status: "source-changed",
      sourcePath: sourceAbs,
      htmlPath: htmlAbs,
      expectedSha256: page.sourceSha256,
      actualSha256: sourceActual,
    };
  }

  const htmlText = await fs.readFile(htmlAbs, "utf8");
  const outputActual = sha256Utf8(htmlText);
  if (outputActual !== page.outputSha256) {
    return {
      route: page.route,
      status: "output-changed",
      sourcePath: sourceAbs,
      htmlPath: htmlAbs,
      expectedSha256: page.outputSha256,
      actualSha256: outputActual,
    };
  }

  return {
    route: page.route,
    status: "match",
    sourcePath: sourceAbs,
    htmlPath: htmlAbs,
  };
}
