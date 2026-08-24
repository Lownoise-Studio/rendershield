#!/usr/bin/env node
import { createRequire } from "node:module";
import { cmdInit } from "./commands/init.js";
import { cmdBuild } from "./commands/build.js";
import { cmdVerify } from "./commands/verify.js";
import { cmdDoctor, printDoctorHelp } from "./commands/doctor.js";
import { formatCliError, isRenderShieldError, renderShieldError } from "./errors.js";
import { extractGlobalOptions, parseDoctorArgs, parseVerifyArgs } from "./cliArgs.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version?: string };
const VERSION = pkg.version ?? "0.0.0";

function printHelp() {
  console.log(`
RenderShield v${VERSION} — boring bot-aware prerendering.

Usage:
  rendershield [--config <path>] init
  rendershield [--config <path>] build
  rendershield [--config <path>] doctor [options]
  rendershield [--config <path>] verify [options]

Global:
  --config <path>   Config file (default: rendershield.config.json)

Doctor:
  doctor              Offline read-only project health checks
  doctor --json       Machine-readable JSON on stdout
  doctor --strict     Treat WARNING as failure
  doctor --skip-output   Skip checks requiring built output

Verify:
  verify              Print curl smoke-test commands for first built page
  verify --check      Validate built HTML contract (first page)
  verify --all --check   Validate contract for every built page
  verify --prod <url> Fetch URL as bot; require x-rendershield: bot-hit + contract
  verify --prod --all Check every route from build output in production

Notes:
  - Content: content/<collection>/**/*.md (frontmatter required)
  - Output: dist-prerender/ (see config)
  - Config reference: docs/CONFIG.md
`);
}

async function main() {
  const { options: globalOptions, rest } = extractGlobalOptions(
    process.argv.slice(2)
  );
  const cmd = rest[0]?.trim();
  const cmdArgs = rest.slice(1);

  if (!cmd || cmd === "-h" || cmd === "--help") {
    printHelp();
    process.exit(0);
  }
  if (cmd === "-V" || cmd === "--version") {
    console.log(VERSION);
    process.exit(0);
  }

  try {
    if (cmd === "init") {
      await cmdInit(undefined, globalOptions);
      return;
    }
    if (cmd === "build") {
      await cmdBuild(undefined, globalOptions);
      return;
    }
    if (cmd === "doctor") {
      if (cmdArgs.includes("-h") || cmdArgs.includes("--help")) {
        printDoctorHelp(VERSION);
        process.exit(0);
      }
      const doctorOptions = parseDoctorArgs(cmdArgs, globalOptions);
      const doctorResult = await cmdDoctor(undefined, doctorOptions);
      if (!doctorResult.ok) {
        process.exit(1);
      }
      return;
    }
    if (cmd === "verify") {
      if (cmdArgs.includes("-h") || cmdArgs.includes("--help")) {
        printHelp();
        process.exit(0);
      }
      const verifyOptions = parseVerifyArgs(cmdArgs, globalOptions);
      if (verifyOptions.prod && !verifyOptions.prodUrl && !verifyOptions.all) {
        throw renderShieldError(
          "CLI_INVALID_ARGS",
          "verify --prod requires a URL, or use --prod --all. Example: rendershield verify --prod https://example.com/blog/hello-world"
        );
      }
      if (verifyOptions.all && !verifyOptions.check && !verifyOptions.prod) {
        throw renderShieldError(
          "CLI_INVALID_ARGS",
          "verify --all requires --check (local) or --prod (production). Example: rendershield verify --all --check"
        );
      }
      await cmdVerify(undefined, verifyOptions);
      return;
    }

    console.error(`Unknown command: ${cmd}\n`);
    printHelp();
    process.exit(1);
  } catch (err: unknown) {
    const msg = formatCliError(err);
    console.error(`\nRenderShield error: ${msg}\n`);
    if (isRenderShieldError(err) && err.code === "CLI_INVALID_ARGS") {
      process.exit(2);
    }
    process.exit(1);
  }
}

main();
