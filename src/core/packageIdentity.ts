import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type PackageIdentity = {
  name: string;
  version: string;
};

/**
 * Read package name/version from the published package.json next to dist/.
 * Same createRequire pattern used by the CLI and Worker generator.
 */
export function getPackageIdentity(): PackageIdentity {
  try {
    const pkg = require("../../package.json") as {
      name?: string;
      version?: string;
    };
    return {
      name: pkg.name ?? "@lownoise-studio/rendershield",
      version: pkg.version ?? "0.0.0",
    };
  } catch {
    return {
      name: "@lownoise-studio/rendershield",
      version: "unknown",
    };
  }
}
