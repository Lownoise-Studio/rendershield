#!/usr/bin/env node
/**
 * Regression proof: orphaned files under dist/ must not survive `npm run build`
 * and must not appear in `npm pack --dry-run` output.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orphanRel = path.join("dist", "core", "__orphan_from_other_branch__.js");
const orphanAbs = path.join(root, orphanRel);
const marker = "RENDERSHIELD_ORPHAN_STALE_DIST_ARTIFACT";

function fail(msg) {
  console.error(`[clean-dist-proof] FAIL: ${msg}`);
  process.exit(1);
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    fail(
      [
        `${cmd} ${args.join(" ")} exited ${result.status}`,
        result.stdout?.trim(),
        result.stderr?.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return result;
}

fs.mkdirSync(path.dirname(orphanAbs), { recursive: true });
fs.writeFileSync(
  orphanAbs,
  `// ${marker}\nexport const orphan = true;\n`,
  "utf8"
);
if (!fs.existsSync(orphanAbs)) {
  fail(`failed to seed orphan at ${orphanRel}`);
}

run("npm", ["run", "build"]);

if (fs.existsSync(orphanAbs)) {
  fail(`orphan still present after build: ${orphanRel}`);
}
if (!fs.existsSync(path.join(root, "dist", "index.js"))) {
  fail("dist/index.js missing after build");
}

const pack = run("npm", ["pack", "--dry-run"]);
const listing = `${pack.stdout}\n${pack.stderr}`;
if (!listing.includes("npm notice name: @lownoise-studio/rendershield")) {
  fail("npm pack --dry-run did not report package name");
}
if (
  listing.includes("__orphan_from_other_branch__") ||
  listing.includes(marker)
) {
  fail("orphan artifact appeared in npm pack --dry-run listing");
}

console.log("[clean-dist-proof] PASS: orphan removed by build and absent from pack");
