/**
 * Stable error codes for programmatic consumers and CI integrations.
 */
export type RenderShieldErrorCode =
  | "CONFIG_MISSING"
  | "CONFIG_INVALID"
  | "OUTPUT_PATH_UNSAFE"
  | "CONTENT_INVALID"
  | "BUILD_FAILED"
  | "VALIDATION_FAILED"
  | "VERIFY_FAILED"
  | "CLI_INVALID_ARGS";

export class RenderShieldError extends Error {
  readonly code: RenderShieldErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: RenderShieldErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RenderShieldError";
    this.code = code;
    this.details = details;
  }
}

export function isRenderShieldError(err: unknown): err is RenderShieldError {
  return err instanceof RenderShieldError;
}

export function renderShieldError(
  code: RenderShieldErrorCode,
  message: string,
  details?: Record<string, unknown>
): RenderShieldError {
  return new RenderShieldError(code, message, details);
}

/** Format an error for CLI output; includes code when available. */
export function formatCliError(err: unknown): string {
  if (isRenderShieldError(err)) {
    return `[${err.code}] ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
