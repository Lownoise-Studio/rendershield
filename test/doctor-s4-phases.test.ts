import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { cmdBuild } from "../dist/commands/build.js";
import { runDoctorEngine } from "../dist/doctor/engine.js";
import { DOCTOR_PHASE_ORDER } from "../dist/doctor/phases.js";
import type { DoctorPhaseId } from "../dist/doctor/types.js";

const CONFIG_NAME = "rendershield.config.json";

const baseConfig = {
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
  sitemap: { enabled: true, path: "/sitemap.xml" },
  robots: { enabled: true, path: "/robots.txt" },
  worker: { enabled: false },
};

const workerEnabledConfig = {
  ...baseConfig,
  worker: {
    enabled: true,
    spaOrigin: "https://app.example.com",
    rewriteRouteBases: ["/blog/"],
    botUserAgentPatterns: ["googlebot", "bingbot"],
    debugHeaders: false,
  },
};

async function treeHash(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!(await fs.pathExists(root))) return out;

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const buf = await fs.readFile(full);
        out.set(rel, crypto.createHash("sha256").update(buf).digest("hex"));
      }
    }
  }

  await walk(root);
  return out;
}

async function writePost(
  dir: string,
  relPath: string,
  frontmatter: Record<string, string>,
  body = "Body with enough words and characters to satisfy the article length requirement for the prerender contract validation. At least twenty words are required here for the build to pass."
) {
  const abs = path.join(dir, relPath);
  await fs.ensureDir(path.dirname(abs));
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  await fs.writeFile(abs, `---\n${fm}\n---\n\n${body}\n`, "utf8");
}

describe("Doctor S4 output phases", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-doc-s4-"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  async function writeConfig(config: object) {
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify(config, null, 2),
      "utf8"
    );
  }

  async function seedProject(config: object = baseConfig) {
    await writeConfig(config);
    await writePost(tmpDir, "content/blog/post.md", {
      title: "Post",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/post.jpg",
      slug: "post",
    });
  }

  async function buildProject(config: object = baseConfig) {
    await seedProject(config);
    await cmdBuild(tmpDir);
  }

  it("passes S4 checks on valid post-build output", async () => {
    await buildProject();

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_OUTPUT_DIR_EXISTS")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_OUTPUT_PAGE_COUNT")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_FRESHNESS_CURRENT")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CONTRACT_PASS")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_SITEMAP_URL_SET" && d.severity === "pass")).toBe(
      true
    );
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_ROBOTS_EXPECTED" && d.severity === "pass")).toBe(
      true
    );
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_WORKER_DISABLED")).toBe(true);
  });

  it("warns on missing output for a valid pre-build project", async () => {
    await seedProject();

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_OUTPUT_MISSING",
        severity: "warning",
        phaseId: "outputPresence",
      })
    );
    expect(result.diagnostics.some((d) => d.phaseId === "contract")).toBe(false);
  });

  it("warns when source mtime is newer than built HTML (best-effort)", async () => {
    await buildProject();
    // Legacy mtime path: only when no build manifest is present.
    await fs.remove(path.join(tmpDir, "dist-prerender/rendershield-manifest.json"));
    const sourcePath = path.join(tmpDir, "content/blog/post.md");
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(sourcePath, future, future);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_STALE",
        severity: "warning",
        message: expect.stringContaining("best-effort"),
        details: expect.objectContaining({ method: "mtime-best-effort" }),
      })
    );
  });

  it("reports current freshness when source mtime is not newer", async () => {
    await buildProject();
    await fs.remove(path.join(tmpDir, "dist-prerender/rendershield-manifest.json"));

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_CURRENT",
        severity: "pass",
        message: expect.stringContaining("best-effort"),
        details: expect.objectContaining({ method: "mtime-best-effort" }),
      })
    );
  });

  it("uses manifest SHA-256 freshness after a successful build", async () => {
    await buildProject();

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_CURRENT",
        severity: "pass",
        details: expect.objectContaining({ method: "manifest-sha256" }),
      })
    );
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_FRESHNESS_STALE")).toBe(
      false
    );
  });

  it("fails when expected routes are missing from output", async () => {
    await buildProject();
    await fs.remove(path.join(tmpDir, "dist-prerender/blog/post/index.html"));

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_OUTPUT_ROUTE_MISSING",
        severity: "fail",
        details: expect.objectContaining({ routePath: "/blog/post" }),
      })
    );
  });

  it("reports orphan routes in deterministic order", async () => {
    await buildProject();
    const orphanDir = path.join(tmpDir, "dist-prerender/blog/orphan");
    await fs.ensureDir(orphanDir);
    await fs.writeFile(
      path.join(orphanDir, "index.html"),
      "<html><head><title>Orphan</title></head><body>Orphan</body></html>",
      "utf8"
    );

    const result = await runDoctorEngine({ cwd: tmpDir });
    const orphanDiagnostics = result.diagnostics.filter((d) => d.code === "DOCTOR_OUTPUT_ORPHAN");
    expect(orphanDiagnostics).toHaveLength(1);
    expect(orphanDiagnostics[0]?.details).toEqual(
      expect.objectContaining({ routePath: "/blog/orphan" })
    );
  });

  it("fails crawler contract validation on invalid generated HTML", async () => {
    await buildProject();
    const htmlPath = path.join(tmpDir, "dist-prerender/blog/post/index.html");
    const html = await fs.readFile(htmlPath, "utf8");
    await fs.writeFile(htmlPath, html.replace(/<title>[\s\S]*?<\/title>/i, "<title></title>"), "utf8");

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_CONTRACT_FAIL",
        severity: "fail",
        details: expect.objectContaining({ routePath: "/blog/post" }),
      })
    );
  });

  it("fails on canonical href mismatch", async () => {
    await buildProject();
    const htmlPath = path.join(tmpDir, "dist-prerender/blog/post/index.html");
    const html = await fs.readFile(htmlPath, "utf8");
    await fs.writeFile(
      htmlPath,
      html.replace(
        'href="https://example.com/blog/post"',
        'href="https://wrong.example.com/blog/post"'
      ),
      "utf8"
    );

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_CANONICAL_HREF_MISMATCH",
        severity: "fail",
      })
    );
  });

  it("fails on JSON-LD @type mismatch", async () => {
    await buildProject();
    const htmlPath = path.join(tmpDir, "dist-prerender/blog/post/index.html");
    const html = await fs.readFile(htmlPath, "utf8");
    await fs.writeFile(htmlPath, html.replace('"@type":"Article"', '"@type":"WebPage"'), "utf8");

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_JSONLD_TYPE_MISMATCH",
        severity: "fail",
        details: expect.objectContaining({
          expectedSchemaType: "Article",
          actualSchemaType: "WebPage",
        }),
      })
    );
  });

  it("fails when built sitemap does not match expected content", async () => {
    await buildProject();
    await fs.writeFile(
      path.join(tmpDir, "dist-prerender/sitemap.xml"),
      "<?xml version=\"1.0\"?><urlset></urlset>\n",
      "utf8"
    );

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_SITEMAP_URL_SET",
        severity: "fail",
      })
    );
  });

  it("fails when built robots.txt does not match expected content", async () => {
    await buildProject();
    await fs.writeFile(path.join(tmpDir, "dist-prerender/robots.txt"), "User-agent: *\nDisallow: /\n", "utf8");

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_ROBOTS_EXPECTED",
        severity: "fail",
      })
    );
  });

  it("fails when enabled sitemap artifact is missing", async () => {
    await buildProject();
    await fs.remove(path.join(tmpDir, "dist-prerender/sitemap.xml"));

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_ARTIFACT_SITEMAP_MISSING",
        severity: "fail",
      })
    );
  });

  it("respects disabled sitemap and robots configuration", async () => {
    await buildProject({
      ...baseConfig,
      sitemap: { enabled: false, path: "/sitemap.xml" },
      robots: { enabled: false, path: "/robots.txt" },
    });
    await fs.remove(path.join(tmpDir, "dist-prerender/sitemap.xml"));
    await fs.remove(path.join(tmpDir, "dist-prerender/robots.txt"));

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_ARTIFACT_SITEMAP_MISSING")).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_ARTIFACT_ROBOTS_MISSING")).toBe(false);
  });

  it("passes DOCTOR_WORKER_DISABLED when worker generation is disabled", async () => {
    await buildProject();

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_WORKER_DISABLED",
        severity: "pass",
      })
    );
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_ARTIFACT_WORKER_MISSING")).toBe(false);
  });

  it("fails when worker is enabled but worker.js is missing", async () => {
    await buildProject(workerEnabledConfig);
    await fs.remove(path.join(tmpDir, "dist-prerender/worker.js"));

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_ARTIFACT_WORKER_MISSING",
        severity: "fail",
      })
    );
  });

  it("fails when built worker.js does not match generated content", async () => {
    await buildProject(workerEnabledConfig);
    await fs.writeFile(path.join(tmpDir, "dist-prerender/worker.js"), "// stale worker\n", "utf8");

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_WORKER_GENERATED",
        severity: "fail",
      })
    );
  });

  it("passes worker checks when worker.js matches generated content", async () => {
    await buildProject(workerEnabledConfig);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_WORKER_FILE_PRESENT",
        severity: "pass",
      })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_WORKER_GENERATED",
        severity: "pass",
      })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_WORKER_REWRITE_COVERAGE",
        severity: "pass",
      })
    );
  });

  it("fails when worker rewrite bases do not cover all routes", async () => {
    await buildProject({
      ...workerEnabledConfig,
      worker: {
        ...(workerEnabledConfig.worker as object),
        rewriteRouteBases: ["/news/"],
      },
    });

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_WORKER_REWRITE_COVERAGE",
        severity: "fail",
        details: expect.objectContaining({ routePath: "/blog/post" }),
      })
    );
  });

  it("preserves deterministic diagnostic phase ordering through S4", async () => {
    await buildProject();

    const result = await runDoctorEngine({ cwd: tmpDir });
    const phaseSequence = result.diagnostics.map((d) => d.phaseId);
    let lastIndex = -1;
    for (const phaseId of phaseSequence) {
      const idx = DOCTOR_PHASE_ORDER.indexOf(phaseId as DoctorPhaseId);
      expect(idx).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = idx;
    }
  });

  it("skipOutput bypasses all S4 phases", async () => {
    await buildProject();

    const result = await runDoctorEngine({ cwd: tmpDir, skipOutput: true });
    const s4Phases = DOCTOR_PHASE_ORDER.slice(5);
    for (const phaseId of s4Phases) {
      expect(result.diagnostics.some((d) => d.phaseId === phaseId)).toBe(false);
    }
    expect(result.skipOutput).toBe(true);
  });

  it("does not write files during S4 doctor run", async () => {
    await buildProject();

    const before = await treeHash(tmpDir);
    await runDoctorEngine({ cwd: tmpDir });
    const after = await treeHash(tmpDir);
    expect(after).toEqual(before);
  });

  it("produces no console output during S4 phases", async () => {
    await buildProject();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runDoctorEngine({ cwd: tmpDir });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("Doctor S4 public API boundary", () => {
  it("exports cmdDoctor but not runDoctorEngine from package root", async () => {
    const api = await import("../dist/index.js");
    expect(typeof api.cmdDoctor).toBe("function");
    expect(Object.keys(api)).not.toContain("runDoctorEngine");
  });
});
