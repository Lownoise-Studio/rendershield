import path from "node:path";

export const DEFAULT_CONFIG_NAME = "rendershield.config.json";

export type CommandOptions = {
  /** Relative to cwd, or absolute. Defaults to rendershield.config.json in cwd. */
  configPath?: string;
};

export function resolveConfigFile(
  cwd: string,
  configPath = DEFAULT_CONFIG_NAME
): string {
  return path.isAbsolute(configPath)
    ? configPath
    : path.join(cwd, configPath);
}
