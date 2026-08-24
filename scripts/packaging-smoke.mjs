#!/usr/bin/env node
/**
 * Packaging compatibility smoke test (no publish).
 *
 * 1. Build + npm pack
 * 2. Install tarball into a clean temp project
 * 3. Confirm CLI `rendershield --help` works
 * 4. Confirm Node can import `@lownoise-studio/rendershield`
 * 5. Confirm TypeScript declarations resolve in a minimal consumer
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

function log(step, msg) {
  console.log(`[packaging-smoke] ${step}: ${msg}`);
}

function fail(msg) {
  console.error(`\n[packaging-smoke] FAIL: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  // Windows needs shell for npm/npx .cmd shims; CI (Linux) uses shell:false.
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...opts,
  });
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

function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rendershield-pack-"));
  const consumerDir = path.join(tmpRoot, "consumer");
  let tarballPath = null;

  try {
    log("1/5", "build + npm pack");
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
    log("1/5", `packed ${tarballName}`);

    log("2/5", "install tarball into clean project");
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

    log("3/5", `CLI ${CLI_NAME} --help`);
    const help = run("npx", ["--no-install", CLI_NAME, "--help"], {
      cwd: consumerDir,
    });
    const helpText = `${help.stdout || ""}${help.stderr || ""}`;
    if (!/RenderShield/i.test(helpText) || !/Usage:/i.test(helpText)) {
      fail(`unexpected --help output:\n${helpText}`);
    }
    log("3/5", "CLI help OK");

    log("4/5", `Node import ${PKG_NAME}`);
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
if (bad.length) {
  console.error("Missing/invalid exports:", bad.join(", "));
  process.exit(1);
}
console.log("import OK", Object.keys(rs).sort().join(","));
`.trimStart()
    );
    const importResult = run("node", [importProbe], { cwd: consumerDir });
    log("4/5", (importResult.stdout || "").trim() || "import OK");

    log("5/5", "TypeScript declarations resolve");
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
  loadConfig,
  checkPrerenderContract,
  RenderShieldError,
  type RenderShieldConfig,
  type ContractCheckResult,
  type DoctorCliResult,
  type DoctorDiagnostic,
  type DoctorCommandOptions,
} from ${JSON.stringify(PKG_NAME)};

declare const cfg: RenderShieldConfig;
declare const contract: ContractCheckResult;
declare const doctorResult: DoctorCliResult;
declare const diagnostic: DoctorDiagnostic;
declare const doctorOptions: DoctorCommandOptions;

void cmdBuild;
void cmdDoctor;
void loadConfig;
void checkPrerenderContract;
void RenderShieldError;
void cfg;
void contract;
void doctorResult;
void diagnostic;
void doctorOptions;
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
    log("5/5", "tsc --noEmit OK");

    console.log("\n[packaging-smoke] PASS\n");
  } finally {
    cleanupDir(tmpRoot);
  }
}

main();
