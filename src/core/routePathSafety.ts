import path from "node:path";
import { renderShieldError, type RenderShieldErrorCode } from "../errors.js";
import { assertContainedInBase } from "./pathContainment.js";

/**
 * Content-route safety for slug / routeBase / routePath → filesystem mapping.
 *
 * URL-encoded lookalikes such as `%2e%2e` are NOT decoded. They are treated as
 * literal path segments and therefore cannot produce filesystem parent traversal
 * via Node path APIs. They remain allowed (and stay under outDir) unless they
 * independently violate other rules (NUL, backslash, empty segments).
 */

function rejectUnsafeRouteSegments(
  segments: string[],
  fieldName: string,
  code: RenderShieldErrorCode
): void {
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      throw renderShieldError(
        code,
        `${fieldName} contains an empty or current-directory (.) segment`
      );
    }
    if (segment === "..") {
      throw renderShieldError(
        code,
        `${fieldName} must not contain parent-directory (..) segments`
      );
    }
  }
}

function rejectNulAndBackslash(
  value: string,
  fieldName: string,
  code: RenderShieldErrorCode
): void {
  if (value.includes("\0")) {
    throw renderShieldError(code, `${fieldName} must not contain null bytes`);
  }
  if (value.includes("\\")) {
    throw renderShieldError(
      code,
      `${fieldName} must use forward slashes only, not backslashes`
    );
  }
}

/**
 * Validate a frontmatter slug. Allows nested segments (guides/getting-started).
 * Rejects `.` / `..` / empty segments, NUL, and backslashes. Does not rewrite input.
 */
export function validateRouteSlug(slug: string, sourcePath?: string): string {
  const fieldName = sourcePath ? `slug in ${sourcePath}` : "slug";

  if (typeof slug !== "string" || slug.trim().length === 0) {
    throw renderShieldError("CONTENT_INVALID", `${fieldName} must be a non-empty string`);
  }

  // Callers typically trim first; refuse untrimmed malicious padding that would
  // otherwise pass segment checks after a silent trim-only normalize.
  if (slug !== slug.trim()) {
    throw renderShieldError(
      "CONTENT_INVALID",
      `${fieldName} must not have leading or trailing whitespace`
    );
  }

  rejectNulAndBackslash(slug, fieldName, "CONTENT_INVALID");

  if (slug.startsWith("/") || slug.endsWith("/")) {
    throw renderShieldError(
      "CONTENT_INVALID",
      `${fieldName} must not begin or end with /`
    );
  }

  rejectUnsafeRouteSegments(slug.split("/"), fieldName, "CONTENT_INVALID");
  return slug;
}

/**
 * Validate a collection routeBase from config.
 * Preserves historically accepted forms (optional leading /, optional trailing /)
 * while rejecting traversal segments, NUL, and backslashes.
 */
export function validateRouteBase(routeBase: string, fieldName: string): string {
  if (typeof routeBase !== "string" || routeBase.trim().length === 0) {
    throw renderShieldError("CONFIG_INVALID", `${fieldName} must be a non-empty string`);
  }

  if (routeBase !== routeBase.trim()) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must not have leading or trailing whitespace`
    );
  }

  rejectNulAndBackslash(routeBase, fieldName, "CONFIG_INVALID");

  if (routeBase.startsWith("//")) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must not be a UNC or protocol-relative path`
    );
  }

  // "/" is a valid root route base.
  if (routeBase === "/") {
    return routeBase;
  }

  // Trailing slash is historically accepted (buildRoutePath strips it).
  const withoutTrailing =
    routeBase.length > 1 && routeBase.endsWith("/") ? routeBase.slice(0, -1) : routeBase;

  const segments = withoutTrailing.startsWith("/")
    ? withoutTrailing.split("/").slice(1)
    : withoutTrailing.split("/");

  rejectUnsafeRouteSegments(segments, fieldName, "CONFIG_INVALID");
  return routeBase;
}

/**
 * Validate a full content routePath (routeBase + slug) before filesystem mapping.
 */
export function validateContentRoutePath(
  routePath: string,
  fieldName = "routePath",
  code: RenderShieldErrorCode = "CONTENT_INVALID"
): string {
  if (typeof routePath !== "string" || routePath.trim().length === 0) {
    throw renderShieldError(code, `${fieldName} must be a non-empty string`);
  }

  if (routePath !== routePath.trim()) {
    throw renderShieldError(
      code,
      `${fieldName} must not have leading or trailing whitespace`
    );
  }

  rejectNulAndBackslash(routePath, fieldName, code);

  if (routePath.startsWith("//")) {
    throw renderShieldError(
      code,
      `${fieldName} must not be a UNC or protocol-relative path`
    );
  }

  if (routePath.endsWith("/")) {
    throw renderShieldError(code, `${fieldName} must not end with /`);
  }

  const segments = routePath.startsWith("/")
    ? routePath.split("/").slice(1)
    : routePath.split("/");

  if (segments.length === 0) {
    throw renderShieldError(
      code,
      `${fieldName} must identify a page path, not the site root alone`
    );
  }

  rejectUnsafeRouteSegments(segments, fieldName, code);
  return routePath;
}

/**
 * Relative path under outDir derived from a validated content route (no leading /).
 * Rejects residual absolute forms that would reset path.resolve/path.join.
 */
function routeToRelativeUnderOutDir(routePath: string): string {
  const validated = validateContentRoutePath(routePath, "routePath", "OUTPUT_PATH_UNSAFE");
  const relative = validated.startsWith("/") ? validated.slice(1) : validated;

  if (relative === "" || relative.startsWith("/") || path.isAbsolute(relative)) {
    throw renderShieldError(
      "OUTPUT_PATH_UNSAFE",
      `routePath resolves to an absolute or empty filesystem path: ${routePath}`,
      { routePath }
    );
  }

  // Defense: even after format checks, never pass a string that path.resolve
  // would treat as absolute on any platform.
  if (path.win32.isAbsolute(relative) || path.posix.isAbsolute(relative)) {
    throw renderShieldError(
      "OUTPUT_PATH_UNSAFE",
      `routePath resolves to an absolute filesystem path: ${routePath}`,
      { routePath }
    );
  }

  return relative;
}

/**
 * Resolve the page output directory for a content route and prove it stays under outDirAbs.
 * Does not create directories. Callers must use the returned path for ensureDir/writeFile.
 */
export function resolveRoutePageDirInOutDir(outDirAbs: string, routePath: string): string {
  const relative = routeToRelativeUnderOutDir(routePath);
  // Join per-segment so a single absolute-looking fragment cannot reset the base.
  const segments = relative.split("/");
  const candidateAbs = path.resolve(outDirAbs, ...segments);

  return assertContainedInBase(outDirAbs, candidateAbs, (rel) => {
    throw renderShieldError(
      "OUTPUT_PATH_UNSAFE",
      `Content route resolves outside output.outDir: ${routePath}`,
      { routePath, outDir: outDirAbs, relative: rel }
    );
  });
}

/**
 * Resolve index.html for a content route under outDirAbs with the same containment invariant.
 */
export function resolveRouteIndexHtmlInOutDir(outDirAbs: string, routePath: string): string {
  return path.join(resolveRoutePageDirInOutDir(outDirAbs, routePath), "index.html");
}
