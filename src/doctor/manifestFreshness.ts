import fs from "fs-extra";
import path from "node:path";
import {
  BUILD_MANIFEST_FILENAME,
  BUILD_MANIFEST_VERSION,
  compareStringsCodeUnit,
  type BuildManifestPageEntry,
  type BuildManifestV1,
} from "../core/buildManifest.js";
import { checkContainedPathWithSymlinks } from "../core/pathContainment.js";
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

export type ManifestPathResolveResult =
  | { ok: true; abs: string; real: string | null }
  | {
      ok: false;
      reason: "unsafe-path" | "resolve-failed";
      abs?: string;
      resolvedPath?: string;
      message: string;
    };

export type ManifestFileReadResult =
  | { ok: true; content: string; abs: string }
  | {
      ok: false;
      reason:
        | "missing"
        | "not-regular-file"
        | "read-failed"
        | "stat-failed"
        | "unsafe-path"
        | "resolve-failed";
      abs: string;
      resolvedPath?: string;
      message: string;
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
 * Resolve a relative posix path under baseAbs with lexical + realpath/symlink
 * containment. Does not read file contents.
 */
export async function resolveContainedManifestPath(
  baseAbs: string,
  relPosix: string
): Promise<ManifestPathResolveResult> {
  if (!isSafeManifestRelativePosix(relPosix)) {
    return {
      ok: false,
      reason: "unsafe-path",
      message: `Path is not a safe relative path: ${String(relPosix)}`,
    };
  }

  const candidateAbs = path.resolve(baseAbs, ...relPosix.split("/"));
  const contained = await checkContainedPathWithSymlinks(baseAbs, candidateAbs);
  if (!contained.ok) {
    return {
      ok: false,
      reason:
        contained.reason === "symlink-escape" || contained.reason === "lexical-escape"
          ? "unsafe-path"
          : "resolve-failed",
      abs: contained.candidateAbs,
      resolvedPath: contained.resolvedPath,
      message: contained.message,
    };
  }

  return {
    ok: true,
    abs: contained.candidateAbs,
    real: contained.candidateReal,
  };
}

export async function resolveManifestSourceAbs(
  cwd: string,
  sourceRel: string
): Promise<ManifestPathResolveResult> {
  return resolveContainedManifestPath(cwd, sourceRel);
}

export async function resolveManifestOutputAbs(
  outDirAbs: string,
  outputRel: string
): Promise<ManifestPathResolveResult> {
  return resolveContainedManifestPath(outDirAbs, outputRel);
}

/**
 * After containment is proven, ensure the path is a readable regular file and
 * return its utf8 contents. Never follows an uncontained symlink (caller must
 * pass a path already validated by resolveContainedManifestPath).
 */
export async function readContainedUtf8File(
  absPath: string
): Promise<ManifestFileReadResult> {
  let st: fs.Stats;
  try {
    st = await fs.stat(absPath);
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return {
        ok: false,
        reason: "missing",
        abs: absPath,
        message: `Path does not exist: ${absPath}`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "stat-failed",
      abs: absPath,
      message: `Cannot stat path: ${message}`,
    };
  }

  if (!st.isFile()) {
    return {
      ok: false,
      reason: "not-regular-file",
      abs: absPath,
      message: `Path is not a regular file: ${absPath}`,
    };
  }

  try {
    const content = await fs.readFile(absPath, "utf8");
    return { ok: true, content, abs: absPath };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "read-failed",
      abs: absPath,
      message: `Cannot read path: ${message}`,
    };
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

  let st: fs.Stats;
  try {
    st = await fs.stat(manifestPath);
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return { status: "absent", path: manifestPath };
    }
    const message = err instanceof Error ? err.message : String(err);
    return failInvalid(
      manifestPath,
      "malformed-json",
      "DOCTOR_MANIFEST_INVALID",
      `Build manifest could not be accessed: ${message}`,
      { path: manifestPath }
    );
  }

  if (!st.isFile()) {
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

    const sourceResolved = await resolveManifestSourceAbs(cwd, entry.source);
    if (!sourceResolved.ok) {
      return failInvalid(
        manifestPath,
        "unsafe-path",
        "DOCTOR_MANIFEST_INVALID",
        `Build manifest pages[${i}].source is unsafe under project root: ${entry.source}`,
        {
          path: manifestPath,
          field: "source",
          source: entry.source,
          index: i,
          resolveReason: sourceResolved.reason,
          resolvedPath: sourceResolved.resolvedPath,
        }
      );
    }

    const outputResolved = await resolveManifestOutputAbs(outDirAbs, entry.output);
    if (!outputResolved.ok) {
      return failInvalid(
        manifestPath,
        "unsafe-path",
        "DOCTOR_MANIFEST_INVALID",
        `Build manifest pages[${i}].output is unsafe under output.outDir: ${entry.output}`,
        {
          path: manifestPath,
          field: "output",
          output: entry.output,
          index: i,
          resolveReason: outputResolved.reason,
          resolvedPath: outputResolved.resolvedPath,
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

export type ManifestPageFreshnessFinding =
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
    }
  | {
      route: string;
      status: "source-unreadable" | "output-unreadable";
      sourcePath?: string;
      htmlPath?: string;
      reason: string;
      message: string;
      resolvedPath?: string;
    }
  | {
      route: string;
      status: "source-unsafe" | "output-unsafe";
      sourcePath?: string;
      htmlPath?: string;
      reason: string;
      message: string;
      resolvedPath?: string;
    };

/**
 * Compare current source Markdown and generated HTML to manifest SHA-256 values.
 * Read-only. Uses the same utf8 SHA-256 semantics as build (`sha256Utf8`).
 * Returns one or more findings per page (both hash mismatches when both differ).
 */
export async function compareManifestPageFreshness(
  cwd: string,
  outDirAbs: string,
  page: BuildManifestPageEntry
): Promise<ManifestPageFreshnessFinding[]> {
  const findings: ManifestPageFreshnessFinding[] = [];

  const sourceResolved = await resolveManifestSourceAbs(cwd, page.source);
  const outputResolved = await resolveManifestOutputAbs(outDirAbs, page.output);

  if (!sourceResolved.ok) {
    findings.push({
      route: page.route,
      status: "source-unsafe",
      sourcePath: sourceResolved.abs,
      reason: sourceResolved.reason,
      message: sourceResolved.message,
      resolvedPath: sourceResolved.resolvedPath,
    });
  }

  if (!outputResolved.ok) {
    findings.push({
      route: page.route,
      status: "output-unsafe",
      htmlPath: outputResolved.abs,
      reason: outputResolved.reason,
      message: outputResolved.message,
      resolvedPath: outputResolved.resolvedPath,
    });
  }

  if (!sourceResolved.ok || !outputResolved.ok) {
    return findings;
  }

  const sourcePath = sourceResolved.abs;
  const htmlPath = outputResolved.abs;

  let sourceContent: string | null = null;
  let htmlContent: string | null = null;

  if (sourceResolved.real === null) {
    findings.push({
      route: page.route,
      status: "source-missing",
      sourcePath,
      htmlPath,
    });
  } else {
    const sourceRead = await readContainedUtf8File(sourcePath);
    if (!sourceRead.ok) {
      if (sourceRead.reason === "missing") {
        findings.push({
          route: page.route,
          status: "source-missing",
          sourcePath,
          htmlPath,
        });
      } else {
        findings.push({
          route: page.route,
          status: "source-unreadable",
          sourcePath,
          htmlPath,
          reason: sourceRead.reason,
          message: sourceRead.message,
          resolvedPath: sourceRead.resolvedPath,
        });
      }
    } else {
      sourceContent = sourceRead.content;
    }
  }

  if (outputResolved.real === null) {
    findings.push({
      route: page.route,
      status: "output-missing",
      sourcePath,
      htmlPath,
    });
  } else {
    const htmlRead = await readContainedUtf8File(htmlPath);
    if (!htmlRead.ok) {
      if (htmlRead.reason === "missing") {
        findings.push({
          route: page.route,
          status: "output-missing",
          sourcePath,
          htmlPath,
        });
      } else {
        findings.push({
          route: page.route,
          status: "output-unreadable",
          sourcePath,
          htmlPath,
          reason: htmlRead.reason,
          message: htmlRead.message,
          resolvedPath: htmlRead.resolvedPath,
        });
      }
    } else {
      htmlContent = htmlRead.content;
    }
  }

  if (sourceContent !== null && htmlContent !== null) {
    const sourceActual = sha256Utf8(sourceContent);
    const outputActual = sha256Utf8(htmlContent);

    if (sourceActual !== page.sourceSha256) {
      findings.push({
        route: page.route,
        status: "source-changed",
        sourcePath,
        htmlPath,
        expectedSha256: page.sourceSha256,
        actualSha256: sourceActual,
      });
    }

    if (outputActual !== page.outputSha256) {
      findings.push({
        route: page.route,
        status: "output-changed",
        sourcePath,
        htmlPath,
        expectedSha256: page.outputSha256,
        actualSha256: outputActual,
      });
    }

    if (
      sourceActual === page.sourceSha256 &&
      outputActual === page.outputSha256
    ) {
      findings.push({
        route: page.route,
        status: "match",
        sourcePath,
        htmlPath,
      });
    }
  }

  return findings;
}
