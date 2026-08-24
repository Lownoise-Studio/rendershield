import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseDoctorArgs } from "../dist/cliArgs.js";
import { cmdDoctor } from "../dist/commands/doctor.js";
import { formatDoctorHuman } from "../dist/doctor/formatters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "..", "dist", "cli.js");
const CONFIG_NAME = "rendershield.config.json";

const minimalValid = {
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

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
}

describe("parseDoctorArgs", () => {
  it("parses supported doctor flags", () => {
    expect(
      parseDoctorArgs(["--json", "--strict", "--skip-output"], {})
    ).toEqual({
      json: true,
      strict: true,
      skipOutput: true,
    });
  });

  it("rejects unknown flags", () => {
    try {
      parseDoctorArgs(["--prod"], {});
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "CLI_INVALID_ARGS", message: /Unknown flag/ });
    }
  });

  it("rejects unexpected positional arguments", () => {
    try {
      parseDoctorArgs(["extra"], {});
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "CLI_INVALID_ARGS", message: /Unexpected positional/ });
    }
  });

  it("rejects --config without a value", () => {
    try {
      parseDoctorArgs(["--config"], {});
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "CLI_INVALID_ARGS", message: /--config requires/ });
    }
  });
});

describe("cmdDoctor", () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-doc-cli-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await fs.remove(tmpDir).catch(() => {});
  });

  async function writeConfig(config: object) {
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify(config, null, 2),
      "utf8"
    );
  }

  async function writePost() {
    const abs = path.join(tmpDir, "content/blog/post.md");
    await fs.ensureDir(path.dirname(abs));
    await fs.writeFile(
      abs,
      `---
title: Post
excerpt: Excerpt with enough words for validation later on here.
datePublished: 2025-01-01
coverImage: /images/post.jpg
slug: post
---

Body with enough words and characters to satisfy the article length requirement for the prerender contract validation. At least twenty words are required here for the build to pass.
`,
      "utf8"
    );
  }

  it("prints human-readable output by default", async () => {
    await writeConfig(minimalValid);
    await writePost();

    const result = await cmdDoctor(tmpDir);
    expect(result.command).toBe("doctor");
    expect(result.version).toMatch(/\d+\.\d+\.\d+/);
    expect(logSpy).toHaveBeenCalled();
    const output = String(logSpy.mock.calls[0]?.[0] ?? "");
    expect(output).toContain("RenderShield doctor v");
    expect(output).toContain("Doctor: OK");
  });

  it("prints JSON with --json", async () => {
    await writeConfig(minimalValid);
    await writePost();

    const result = await cmdDoctor(tmpDir, { json: true });
    const output = String(logSpy.mock.calls[0]?.[0] ?? "");
    const parsed = JSON.parse(output) as typeof result;
    expect(parsed.command).toBe("doctor");
    expect(parsed.version).toBe(result.version);
    expect(parsed.diagnostics).toEqual(result.diagnostics);
  });

  it("returns ok=false for config failures", async () => {
    await writeConfig({ version: 1, site: {} });
    const result = await cmdDoctor(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CONFIG_INVALID")).toBe(true);
  });

  it("formatDoctorHuman labels severities PASS/WARN/FAIL", () => {
    const text = formatDoctorHuman({
      version: "1.0.0",
      command: "doctor",
      ok: false,
      strict: false,
      configPath: "rendershield.config.json",
      skipOutput: true,
      summary: { pass: 1, warning: 1, fail: 1 },
      diagnostics: [
        {
          phaseId: "config",
          code: "DOCTOR_CONFIG_FOUND",
          severity: "pass",
          category: "config",
          message: "Configuration loaded",
        },
        {
          phaseId: "outputPresence",
          code: "DOCTOR_OUTPUT_MISSING",
          severity: "warning",
          category: "output",
          message: "Output missing",
        },
        {
          phaseId: "config",
          code: "DOCTOR_CONFIG_INVALID",
          severity: "fail",
          category: "config",
          message: "Bad config",
        },
      ],
    });
    expect(text).toContain("PASS   DOCTOR_CONFIG_FOUND");
    expect(text).toContain("WARN   DOCTOR_OUTPUT_MISSING");
    expect(text).toContain("FAIL   DOCTOR_CONFIG_INVALID");
  });
});

describe("doctor CLI exit codes", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-doc-cli-exit-"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  async function writeValidProject() {
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify(minimalValid, null, 2),
      "utf8"
    );
    const postPath = path.join(tmpDir, "content/blog/post.md");
    await fs.ensureDir(path.dirname(postPath));
    await fs.writeFile(
      postPath,
      `---
title: Post
excerpt: Excerpt with enough words for validation later on here.
datePublished: 2025-01-01
coverImage: /images/post.jpg
slug: post
---

Body with enough words and characters to satisfy the article length requirement for the prerender contract validation. At least twenty words are required here for the build to pass.
`,
      "utf8"
    );
  }

  it("exits 2 for unknown doctor flags", () => {
    const result = runCli(["doctor", "--prod"], tmpDir);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/CLI_INVALID_ARGS/);
  });

  it("exits 1 when doctor finds failures and still prints human output", async () => {
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify({ version: 1, site: {} }, null, 2),
      "utf8"
    );
    const result = runCli(["doctor"], tmpDir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("RenderShield doctor v");
    expect(result.stdout).toContain("DOCTOR_CONFIG_INVALID");
    expect(result.stdout).toContain("Doctor: FAIL");
  });

  it("exits 0 for valid pre-build project with warning-only output", async () => {
    await writeValidProject();

    const result = runCli(["doctor"], tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/DOCTOR_OUTPUT_MISSING/);
  });

  it("exits 1 under --strict when only warnings are present", async () => {
    await writeValidProject();

    const result = runCli(["doctor", "--strict"], tmpDir);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/DOCTOR_OUTPUT_MISSING/);
  });

  it("emits complete valid JSON for normal failure cases", async () => {
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify({ version: 1, site: {} }, null, 2),
      "utf8"
    );
    const result = runCli(["doctor", "--json"], tmpDir);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.command).toBe("doctor");
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.some((d: { code: string }) => d.code === "DOCTOR_CONFIG_INVALID")).toBe(
      true
    );
  });

  it(
    "drains large piped --json stdout before exit code 1",
    async () => {
      await fs.writeFile(
        path.join(tmpDir, CONFIG_NAME),
        JSON.stringify(minimalValid, null, 2),
        "utf8"
      );

      const blogDir = path.join(tmpDir, "content", "blog");
      await fs.ensureDir(blogDir);

      // Enough failing frontmatter diagnostics for JSON to exceed the typical 64 KiB pipe buffer.
      const fileCount = 280;
      for (let i = 0; i < fileCount; i++) {
        const slug = `bad-post-${String(i).padStart(4, "0")}`;
        await fs.writeFile(
          path.join(blogDir, `${slug}.md`),
          `---
excerpt: Excerpt with enough words for validation later on here but title is intentionally missing for ${slug}.
datePublished: 2025-01-01
coverImage: /images/${slug}.jpg
slug: ${slug}
---

Body for ${slug} with enough words and characters to satisfy article length if frontmatter were valid. Extra padding text for diagnostic volume.
`,
          "utf8"
        );
      }

      const result = spawnSync(process.execPath, [CLI_PATH, "doctor", "--json"], {
        cwd: tmpDir,
        encoding: "utf8",
        shell: false,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.signal).toBeNull();

      const stdout = result.stdout ?? "";
      expect(Buffer.byteLength(stdout, "utf8")).toBeGreaterThan(64 * 1024);

      const parsed = JSON.parse(stdout) as {
        command: string;
        ok: boolean;
        summary: { pass: number; warning: number; fail: number };
        diagnostics: Array<{ code: string; severity: string; message: string }>;
      };

      expect(parsed.command).toBe("doctor");
      expect(parsed.ok).toBe(false);
      expect(parsed.summary.fail).toBeGreaterThanOrEqual(fileCount);
      expect(parsed.diagnostics.length).toBe(
        parsed.summary.pass + parsed.summary.warning + parsed.summary.fail
      );

      const frontmatterFails = parsed.diagnostics.filter(
        (d) => d.code === "DOCTOR_CONTENT_FRONTMATTER" && d.severity === "fail"
      );
      expect(frontmatterFails.length).toBe(fileCount);
      expect(frontmatterFails[0]?.message).toBeTruthy();
      expect(frontmatterFails[frontmatterFails.length - 1]?.message).toBeTruthy();
      expect(parsed.diagnostics[0]?.code).toBeTruthy();
      expect(parsed.diagnostics[parsed.diagnostics.length - 1]?.code).toBeTruthy();
    },
    120_000
  );
});

describe("doctor public API boundary", () => {
  it("exports cmdDoctor and Doctor types but not runDoctorEngine", async () => {
    const api = await import("../dist/index.js");
    expect(typeof api.cmdDoctor).toBe("function");
    expect(api.DoctorCliResult).toBeUndefined();
    expect(Object.keys(api)).not.toContain("runDoctorEngine");
  });
});
