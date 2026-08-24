import type { CommandOptions } from "./configPath.js";
import type { VerifyOptions } from "./commands/verify.js";
import type { DoctorCommandOptions } from "./commands/doctor.js";
import { renderShieldError } from "./errors.js";

const GLOBAL_FLAGS = new Set(["--config"]);

export function extractGlobalOptions(argv: string[]): {
  options: CommandOptions;
  rest: string[];
} {
  const options: CommandOptions = {};
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") {
      const value = argv[i + 1]?.trim();
      if (!value || value.startsWith("-")) {
        rest.push(arg);
        continue;
      }
      options.configPath = value;
      i++;
      continue;
    }
    if (!GLOBAL_FLAGS.has(arg)) {
      rest.push(arg);
    }
  }

  return { options, rest };
}

export function parseVerifyArgs(
  argv: string[],
  globalOptions: CommandOptions
): VerifyOptions {
  const options: VerifyOptions = { ...globalOptions };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prod") {
      options.prod = true;
      const value = argv[i + 1]?.trim();
      if (value && !value.startsWith("-")) {
        options.prodUrl = value;
        i++;
      }
      continue;
    }
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--all") {
      options.all = true;
      continue;
    }
    if (arg === "--config") {
      i++;
      continue;
    }
    positional.push(arg);
  }

  if (!options.prodUrl && positional[0] && !positional[0].startsWith("-")) {
    options.prodUrl = positional[0];
  }

  return options;
}

const DOCTOR_FLAGS = new Set(["--json", "--strict", "--skip-output"]);

export function parseDoctorArgs(
  argv: string[],
  globalOptions: CommandOptions
): DoctorCommandOptions {
  const options: DoctorCommandOptions = { ...globalOptions };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (DOCTOR_FLAGS.has(arg)) {
      if (arg === "--json") options.json = true;
      if (arg === "--strict") options.strict = true;
      if (arg === "--skip-output") options.skipOutput = true;
      continue;
    }
    if (arg === "--config") {
      const value = argv[i + 1]?.trim();
      if (!value || value.startsWith("-")) {
        throw renderShieldError(
          "CLI_INVALID_ARGS",
          "--config requires a path argument"
        );
      }
      options.configPath = value;
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      throw renderShieldError("CLI_INVALID_ARGS", `Unknown flag: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length > 0) {
    throw renderShieldError(
      "CLI_INVALID_ARGS",
      `Unexpected positional argument: ${positional[0]}`
    );
  }

  return options;
}
