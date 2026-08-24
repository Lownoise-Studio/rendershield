import { createRequire } from "node:module";
import { runDoctorEngine } from "../doctor/engine.js";
import { formatDoctorHuman, formatDoctorJson } from "../doctor/formatters.js";
import type { DoctorCliResult, DoctorEngineOptions } from "../doctor/types.js";
import type { CommandOptions } from "../configPath.js";

const require = createRequire(import.meta.url);
let VERSION = "0.0.0";
try {
  const pkg = require("../../package.json") as { version?: string };
  VERSION = pkg.version ?? "0.0.0";
} catch {
  VERSION = "unknown";
}

export type DoctorCommandOptions = CommandOptions &
  DoctorEngineOptions & {
    json?: boolean;
  };

export async function cmdDoctor(
  cwd = process.cwd(),
  options: DoctorCommandOptions = {}
): Promise<DoctorCliResult> {
  const result = await runDoctorEngine({
    cwd,
    strict: options.strict,
    skipOutput: options.skipOutput,
    configPath: options.configPath,
  });

  const cliResult: DoctorCliResult = {
    version: VERSION,
    command: "doctor",
    ...result,
  };

  if (options.json) {
    console.log(formatDoctorJson(cliResult));
  } else {
    console.log(formatDoctorHuman(cliResult));
  }

  return cliResult;
}

export function printDoctorHelp(version = VERSION): void {
  console.log(`
RenderShield doctor v${version} — offline project health checks.

Usage:
  rendershield [--config <path>] doctor [options]

Options:
  --json           Machine-readable JSON on stdout
  --strict         Treat WARNING diagnostics as failure
  --skip-output    Skip checks that require built output
  -h, --help       Show this help

Notes:
  - Offline and read-only; does not run build or modify files
  - For production network checks, use: rendershield verify --prod <url>
`);
}
