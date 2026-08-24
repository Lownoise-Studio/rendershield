import { isRenderShieldError } from "../errors.js";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function asRenderShieldError(err: unknown) {
  return isRenderShieldError(err) ? err : null;
}

/** True when value is an absolute URL or site-relative path (/...). */
export function isAbsoluteOrSiteRelativePath(value: string): boolean {
  if (value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function hostnameFromUrl(value: string): string | null {
  return parseHttpUrl(value)?.hostname ?? null;
}
