import { createHash } from "node:crypto";

/** SHA-256 hex digest of a utf8 string. */
export function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
