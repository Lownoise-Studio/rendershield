#!/usr/bin/env node
/**
 * Packaging compatibility smoke test (no publish).
 *
 * 1. Build + npm pack
 * 2. Install tarball into a clean temp project
 * 3. Confirm CLI identities and core commands
 * 4. Confirm Node exports (including Doctor public API boundary)
 * 5. Confirm Doctor CLI from installed tarball (help, json, exit codes)
 * 6. Confirm TypeScript declarations resolve in a minimal consumer
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PKG_NAME = "@lownoise-studio/rendershield";
const CLI_NAME = "rendershield";

const DOCTOR_FIXTURE_CONFIG = {
  version: 1,
  site: {
    canonicalBase: "https://example.com",
    siteName: "Example",
    defaultOgImage: "https://example.com/og.jpg",
    authorName: "Author",
  },
  content: {
    markdown: {
      baseDir: "content",
      collections: [
        { name: "blog", pattern: "blog/**/*.md", routeBase: "/blog", schemaType: "Article" },
      ],
    },
  },
  output: { outDir: "dist-prerender", prettyHtml: true },
  sitemap: { enabled: false, path: "/sitemap.xml" },
  robots: { enabled: false, path: "/robots.txt" },
  worker: { enabled: false },
};

function log(step, msg) {
  console.log(`[packaging-smoke] ${step}: ${msg}`);
}

function fail(msg) {
  console.error(`\n[packaging-smoke] FAIL: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...opts,
  });
  if (opts.allowNonZero) return result;
  if (result.status !== 0) {
    const detail = [
      `command: ${cmd} ${args.join(" ")}`,
      result.stdout?.trim() || "",
      result.stderr?.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");
    fail(detail);
  }
  return result;
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function readPkgJson() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
}

function writeDoctorFixture(root) {
  fs.mkdirSync(path.join(root, "content/blog"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "rendershield.config.json"),
    JSON.stringify(DOCTOR_FIXTURE_CONFIG, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(root, "content/blog/post.md"),
    `---
title: Post
excerpt: Excerpt with enough words for validation later on here.
datePublished: 2025-01-01
coverImage: /images/post.jpg
slug: post
---

Body with enough words and characters to satisfy the article length requirement for the prerender contract validation. At least twenty words are required here for the build to pass.
`
  );
}

function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rendershield-pack-"));
  const consumerDir = path.join(tmpRoot, "consumer");
  const doctorFixtureDir = path.join(tmpRoot, "doctor-fixture");
  let tarballPath = null;

  try {
    const pkg = readPkgJson();

    log("1/7", "build + npm pack");
    run("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
    const pack = run("npm", ["pack", "--pack-destination", tmpRoot], {
      cwd: ROOT,
    });
    const packOut = (pack.stdout || "").trim().split(/\r?\n/).filter(Boolean);
    const tarballName = packOut[packOut.length - 1];
    if (!tarballName || !tarballName.endsWith(".tgz")) {
      fail(`npm pack did not produce a .tgz (got: ${JSON.stringify(packOut)})`);
    }
    tarballPath = path.join(tmpRoot, tarballName);
    if (!fs.existsSync(tarballPath)) {
      fail(`tarball missing at ${tarballPath}`);
    }
    log("1/7", `packed ${tarballName}`);

    log("2/7", "install tarball into clean project");
    fs.mkdirSync(consumerDir, { recursive: true });
    fs.writeFileSync(
      path.join(consumerDir, "package.json"),
      JSON.stringify(
        {
          name: "rendershield-packaging-consumer",
          version: "0.0.0",
          private: true,
          type: "module",
        },
        null,
        2
      ) + "\n"
    );
    run("npm", ["install", tarballPath], { cwd: consumerDir, stdio: "inherit" });

    log("3/7", "package identity + CLI bin");
    const installedPkgPath = path.join(consumerDir, "node_modules", PKG_NAME, "package.json");
    const installedPkg = JSON.parse(fs.readFileSync(installedPkgPath, "utf8"));
    if (installedPkg.name !== PKG_NAME) {
      fail(`expected package name ${PKG_NAME}, got ${installedPkg.name}`);
    }
    if (installedPkg.main !== "./dist/index.js") {
      fail(`unexpected main entry: ${installedPkg.main}`);
    }
    if (installedPkg.types !== "./dist/index.d.ts") {
      fail(`unexpected types entry: ${installedPkg.types}`);
    }
    if (installedPkg.bin?.rendershield !== "dist/cli.js") {
      fail(`unexpected bin mapping: ${JSON.stringify(installedPkg.bin)}`);
    }

    const help = run("npx", ["--no-install", CLI_NAME, "--help"], {
      cwd: consumerDir,
    });
    const helpText = `${help.stdout || ""}${help.stderr || ""}`;
    if (!/RenderShield/i.test(helpText) || !/Usage:/i.test(helpText)) {
      fail(`unexpected --help output:\n${helpText}`);
    }
    for (const cmd of ["init", "build", "verify", "doctor"]) {
      if (!new RegExp(`\\b${cmd}\\b`, "i").test(helpText)) {
        fail(`--help missing command: ${cmd}`);
      }
    }
    log("3/7", "CLI identity OK");

    log("4/7", `Node import ${PKG_NAME} + Doctor public API boundary`);
    const importProbe = path.join(consumerDir, "import-probe.mjs");
    fs.writeFileSync(
      importProbe,
      `
import * as rs from ${JSON.stringify(PKG_NAME)};

const fns = ["cmdInit", "cmdBuild", "cmdVerify", "cmdDoctor", "loadConfig", "checkPrerenderContract"];
const bad = [];
for (const k of fns) {
  if (typeof rs[k] !== "function") bad.push(k + " (expected function)");
}
if (typeof rs.RenderShieldError !== "function") {
  bad.push("RenderShieldError (expected constructor)");
}

const forbidden = [
  "runDoctorEngine",
  "validateArtifactPathFormat",
  "resolveArtifactPathInOutDir",
  "readArtifactPathConfig",
];
for (const k of forbidden) {
  if (k in rs) bad.push(k + " (must not be exported)");
}

if (bad.length) {
  console.error("Export check failed:", bad.join(", "));
  process.exit(1);
}
console.log("import OK", Object.keys(rs).sort().join(","));
`.trimStart()
    );
    const importResult = run("node", [importProbe], { cwd: consumerDir });
    log("4/7", (importResult.stdout || "").trim() || "import OK");

    log("5/7", "Doctor CLI from installed tarball");
    writeDoctorFixture(doctorFixtureDir);
    const cliBin = path.join(consumerDir, "node_modules", PKG_NAME, "dist", "cli.js");
    if (!fs.existsSync(cliBin)) {
      fail(`installed CLI missing at ${cliBin}`);
    }

    const doctorHelp = run("node", [cliBin, "doctor", "--help"], {
      cwd: doctorFixtureDir,
    });
    const doctorHelpText = `${doctorHelp.stdout || ""}${doctorHelp.stderr || ""}`;
    if (!/doctor/i.test(doctorHelpText) || !/skip-output/i.test(doctorHelpText)) {
      fail(`unexpected doctor --help output:\n${doctorHelpText}`);
    }

    const doctorJson = run("node", [cliBin, "doctor", "--json"], {
      cwd: doctorFixtureDir,
    });
    if (doctorJson.status !== 0) {
      fail(`doctor --json expected exit 0, got ${doctorJson.status}`);
    }
    let parsed;
    try {
      parsed = JSON.parse((doctorJson.stdout || "").trim());
    } catch (err) {
      fail(`doctor --json stdout is not valid JSON: ${err}`);
    }
    if (parsed.command !== "doctor" || typeof parsed.ok !== "boolean") {
      fail(`doctor --json missing expected fields: ${JSON.stringify(parsed)}`);
    }
    if (!Array.isArray(parsed.diagnostics)) {
      fail("doctor --json diagnostics must be an array");
    }

    fs.writeFileSync(
      path.join(doctorFixtureDir, "rendershield.config.json"),
      JSON.stringify({ version: 1, site: { canonicalBase: "not-a-url" } }, null, 2) + "\n"
    );
    const doctorFail = run(
      "node",
      [cliBin, "doctor", "--json"],
      { cwd: doctorFixtureDir, allowNonZero: true }
    );
    if (doctorFail.status !== 1) {
      fail(`doctor --json on invalid config expected exit 1, got ${doctorFail.status}`);
    }

    writeDoctorFixture(doctorFixtureDir);
    const doctorStrict = run(
      "node",
      [cliBin, "doctor", "--strict"],
      { cwd: doctorFixtureDir, allowNonZero: true }
    );
    if (doctorStrict.status !== 1) {
      fail(`doctor --strict on warn-only project expected exit 1, got ${doctorStrict.status}`);
    }

    const doctorArgs = run(
      "node",
      [cliBin, "doctor", "--prod"],
      { cwd: doctorFixtureDir, allowNonZero: true }
    );
    if (doctorArgs.status !== 2) {
      fail(`doctor --prod expected exit 2, got ${doctorArgs.status}`);
    }

    const largeFixtureDir = path.join(tmpRoot, "doctor-large-json");
    fs.mkdirSync(path.join(largeFixtureDir, "content/blog"), { recursive: true });
    fs.writeFileSync(
      path.join(largeFixtureDir, "rendershield.config.json"),
      JSON.stringify(DOCTOR_FIXTURE_CONFIG, null, 2) + "\n"
    );
    for (let i = 0; i < 280; i++) {
      fs.writeFileSync(
        path.join(largeFixtureDir, "content/blog", `bad-${i}.md`),
        `---\ntitle: Bad ${i}\n---\nToo short.\n`
      );
    }
    const largeJson = run(
      "node",
      [cliBin, "doctor", "--json"],
      { cwd: largeFixtureDir, allowNonZero: true }
    );
    if (largeJson.status !== 1) {
      fail(`large doctor --json expected exit 1, got ${largeJson.status}`);
    }
    const largeOut = (largeJson.stdout || "").trim();
    if (largeOut.length < 64 * 1024) {
      fail(`large doctor --json output unexpectedly short (${largeOut.length} bytes)`);
    }
    try {
      const largeParsed = JSON.parse(largeOut);
      if (!Array.isArray(largeParsed.diagnostics) || largeParsed.diagnostics.length === 0) {
        fail("large doctor --json missing diagnostics");
      }
    } catch (err) {
      fail(`large doctor --json not parseable: ${err}`);
    }
    log("5/7", "Doctor CLI OK");

    log("6/7", "TypeScript declarations resolve");
    run("npm", ["install", "--no-save", "typescript@~5.5.4"], {
      cwd: consumerDir,
      stdio: "inherit",
    });
    const consumerTs = path.join(consumerDir, "consumer.ts");
    fs.writeFileSync(
      consumerTs,
      `
import {
  cmdBuild,
  cmdDoctor,
  cmdInit,
  cmdVerify,
  loadConfig,
  checkPrerenderContract,
  RenderShieldError,
  type RenderShieldConfig,
  type ContractCheckResult,
  type DoctorCliResult,
  type DoctorCommandOptions,
  type DoctorSeverity,
  type DoctorCategory,
  type DoctorPhaseId,
  type DoctorDiagnosticCode,
  type DoctorDiagnosticDetails,
  type DoctorDiagnostic,
  type DoctorSummary,
  type DoctorEngineOptions,
  type DoctorResult,
} from ${JSON.stringify(PKG_NAME)};

declare const cfg: RenderShieldConfig;
declare const contract: ContractCheckResult;
declare const doctorResult: DoctorCliResult;
declare const doctorOptions: DoctorCommandOptions;
declare const severity: DoctorSeverity;
declare const category: DoctorCategory;
declare const phase: DoctorPhaseId;
declare const code: DoctorDiagnosticCode;
declare const details: DoctorDiagnosticDetails;
declare const diagnostic: DoctorDiagnostic;
declare const summary: DoctorSummary;
declare const engineOptions: DoctorEngineOptions;
declare const result: DoctorResult;

void cmdInit;
void cmdBuild;
void cmdVerify;
void cmdDoctor;
void loadConfig;
void checkPrerenderContract;
void RenderShieldError;
void cfg;
void contract;
void doctorResult;
void doctorOptions;
void severity;
void category;
void phase;
void code;
void details;
void diagnostic;
void summary;
void engineOptions;
void result;
`.trimStart()
    );
    const tsconfigPath = path.join(consumerDir, "tsconfig.json");
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            skipLibCheck: false,
            noEmit: true,
          },
          include: ["consumer.ts"],
        },
        null,
        2
      ) + "\n"
    );
    run("npx", ["--no-install", "tsc", "-p", "tsconfig.json"], {
      cwd: consumerDir,
      stdio: "inherit",
    });
    log("6/7", "tsc --noEmit OK");

    log("7/7", `package version ${pkg.version} unchanged`);
    if (installedPkg.version !== pkg.version) {
      fail(`installed version ${installedPkg.version} != source ${pkg.version}`);
    }

    console.log("\n[packaging-smoke] PASS\n");
  } finally {
    cleanupDir(tmpRoot);
  }
}

main();
