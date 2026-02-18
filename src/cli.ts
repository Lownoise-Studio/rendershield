#!/usr/bin/env node
import { cmdInit } from "./commands/init.js";
import { cmdBuild } from "./commands/build.js";
import { cmdVerify } from "./commands/verify.js";

function printHelp() {
  console.log(`
RenderShield (v0) — boring bot-aware prerendering.

Usage:
  rendershield init
  rendershield build
  rendershield verify [--prod <url>]

  verify         Print curl commands for local/build output.
  verify --prod  Fetch URL as bot and human; verify bot sees full HTML and contract fields.

Notes:
  - Config file: rendershield.config.json
  - Content: content/<collection>/**/*.md (frontmatter required)
  - Output: dist-prerender/
`);
}

async function main() {
  const cmd = process.argv[2]?.trim();

  if (!cmd || cmd === "-h" || cmd === "--help") {
    printHelp();
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
      const args = process.argv.slice(3);
      const prodIdx = args.indexOf("--prod");
      const prodUrl = prodIdx >= 0 && args[prodIdx + 1] ? args[prodIdx + 1].trim() : undefined;
      await cmdVerify(undefined, prodUrl ? { prodUrl } : undefined);
      return;
    }

    console.error(`Unknown command: ${cmd}\n`);
    printHelp();
    process.exit(1);
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : String(err);
    console.error(`\nRenderShield error: ${msg}\n`);
    process.exit(1);
  }
}

main();
