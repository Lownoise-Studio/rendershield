#!/usr/bin/env node
import { createRequire } from "node:module";
import { cmdInit } from "./commands/init.js";
import { cmdBuild } from "./commands/build.js";
import { cmdVerify } from "./commands/verify.js";

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
      const prodUrl = prodIdx >= 0 && verifyArgs[prodIdx + 1] ? verifyArgs[prodIdx + 1].trim() : undefined;
      await cmdVerify(undefined, prodUrl ? { prodUrl } : undefined);
      return;
    }

    console.error(`Unknown command: ${cmd}\n`);
    printHelp();
    process.exit(1);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nRenderShield error: ${msg}\n`);
    process.exit(1);
  }
}

main();
