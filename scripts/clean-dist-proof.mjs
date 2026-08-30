#!/usr/bin/env node
/**
 * Regression proof: orphaned files under dist/ must not survive `npm run build`
 * and must not appear in `npm pack --dry-run --json` file listings.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orphanRel = path.join("dist", "core", "__orphan_from_other_branch__.js");
const orphanAbs = path.join(root, orphanRel);
const orphanPackPath = "dist/core/__orphan_from_other_branch__.js";
const marker = "RENDERSHIELD_ORPHAN_STALE_DIST_ARTIFACT";
const expectedName = "@lownoise-studio/rendershield";

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

const pack = run("npm", ["pack", "--dry-run", "--json"]);
let parsed;
try {
  parsed = JSON.parse(pack.stdout);
} catch (err) {
  fail(
    `npm pack --dry-run --json did not return parseable JSON on stdout: ${
      err instanceof Error ? err.message : String(err)
    }`
  );
}

const entry = Array.isArray(parsed) ? parsed[0] : parsed;
if (!entry || typeof entry !== "object") {
  fail("npm pack --json returned an empty or unexpected payload");
}
if (entry.name !== expectedName) {
  fail(`expected package name ${expectedName}, got ${JSON.stringify(entry.name)}`);
}
if (typeof entry.version !== "string" || entry.version.length === 0) {
  fail("npm pack --json missing package version");
}
if (!Array.isArray(entry.files)) {
  fail("npm pack --json missing files array");
}

const filePaths = entry.files.map((f) => f?.path).filter(Boolean);
if (filePaths.includes(orphanPackPath)) {
  fail(`orphan artifact appeared in pack files: ${orphanPackPath}`);
}
if (filePaths.some((p) => String(p).includes("__orphan_from_other_branch__"))) {
  fail("orphan path fragment appeared in pack files listing");
}
if (!filePaths.includes("dist/index.js")) {
  fail("expected dist/index.js in pack files listing");
}

console.log(
  `[clean-dist-proof] PASS: orphan removed by build and absent from pack (${entry.name}@${entry.version}, ${filePaths.length} files)`
);
