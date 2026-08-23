#!/usr/bin/env node
import { createRequire } from "node:module";
import { cmdInit } from "./commands/init.js";
import { cmdBuild } from "./commands/build.js";
import { cmdVerify } from "./commands/verify.js";
import { formatCliError, renderShieldError } from "./errors.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version?: string };
const VERSION = pkg.version ?? "0.0.0";

function printHelp() {
  console.log(`
RenderShield v${VERSION} — boring bot-aware prerendering.

Usage:
  rendershield init
  rendershield build
  rendershield verify [--prod <url>]

  verify         Print curl commands for local/build output.
  verify --prod  Fetch URL as bot and human; verify bot sees full HTML and contract fields.
                 Requires x-rendershield: bot-hit from the Worker.

Notes:
  - Config file: rendershield.config.json
  - Content: content/<collection>/**/*.md (frontmatter required)
  - Output: dist-prerender/
`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0]?.trim();

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
      await cmdInit();
      return;
    }
    if (cmd === "build") {
      await cmdBuild();
      return;
    }
    if (cmd === "verify") {
      const verifyArgs = args.slice(1);
      if (verifyArgs.includes("-h") || verifyArgs.includes("--help")) {
        printHelp();
        process.exit(0);
      }
      const prodIdx = verifyArgs.indexOf("--prod");
      if (prodIdx >= 0) {
        const prodUrl = verifyArgs[prodIdx + 1]?.trim();
        if (!prodUrl || prodUrl.startsWith("-")) {
          throw renderShieldError(
            "CLI_INVALID_ARGS",
            "verify --prod requires a URL. Example: rendershield verify --prod https://example.com/blog/hello-world"
          );
        }
        await cmdVerify(undefined, { prodUrl });
        return;
      }
      await cmdVerify();
      return;
    }

    console.error(`Unknown command: ${cmd}\n`);
    printHelp();
    process.exit(1);
  } catch (err: unknown) {
    const msg = formatCliError(err);
    console.error(`\nRenderShield error: ${msg}\n`);
    process.exit(1);
  }
}

main();
