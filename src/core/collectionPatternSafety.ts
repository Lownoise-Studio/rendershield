import { renderShieldError } from "../errors.js";

/** Reasonable upper bound for a single Markdown collection glob. */
export const MAX_COLLECTION_PATTERN_LENGTH = 256;

/**
 * Extglob quantifier openers that picomatch compiles into complex regexes.
 * Documented collection globs (for example blog slash-star-star slash-star.md) do not need these.
 */
const EXTGLOB_OPENER_RE = /(?:^|[^\\])(?:[+@?!]\(|\*\()/;

/**
 * Validate a Markdown collection glob before it reaches fast-glob/picomatch.
 * Keeps common patterns such as nested Markdown globs under a collection folder.
 */
export function validateCollectionPattern(
  pattern: string,
  fieldName: string
): string {
  const trimmed = pattern.trim();
  if (trimmed === "") {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must be a non-empty string`
    );
  }
  if (trimmed.length > MAX_COLLECTION_PATTERN_LENGTH) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must be at most ${MAX_COLLECTION_PATTERN_LENGTH} characters`
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must not contain control characters`
    );
  }
  if (EXTGLOB_OPENER_RE.test(trimmed)) {
    throw renderShieldError(
      "CONFIG_INVALID",
      `${fieldName} must not use extglob syntax (for example +(…), *(…), @(…), ?(…), !(…)). Use simple globs such as blog/**/*.md.`
    );
  }
  return trimmed;
}
