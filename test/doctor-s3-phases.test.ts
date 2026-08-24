import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { runDoctorEngine } from "../dist/doctor/engine.js";
import { DOCTOR_PHASE_ORDER } from "../dist/doctor/phases.js";
import type { DoctorPhaseId } from "../dist/doctor/types.js";

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
  body = "Body with enough words for later contract checks if needed."
) {
  const abs = path.join(dir, relPath);
  await fs.ensureDir(path.dirname(abs));
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  await fs.writeFile(abs, `---\n${fm}\n---\n\n${body}\n`, "utf8");
}

describe("Doctor S3 config/content phases", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-doc-s3-"));
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

  it("reports DOCTOR_CONFIG_MISSING when config absent", async () => {
    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CONFIG_MISSING")).toBe(true);
  });

  it("passes config phase for valid configuration", async () => {
    await writeConfig(minimalValid);
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    await writePost(tmpDir, "content/blog/post.md", {
      title: "Post",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/post.jpg",
      slug: "post",
    });

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CONFIG_FOUND")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CONFIG_INVALID")).toBe(false);
  });

  it("reports DOCTOR_CONFIG_INVALID for malformed config", async () => {
    await writeConfig({ version: 1, site: {} });
    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CONFIG_INVALID")).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("continues to later phases after config failure is not possible without config", async () => {
    await writeConfig({ version: 1, site: {} });
    const result = await runDoctorEngine({ cwd: tmpDir });
    const phaseIds = result.diagnostics.map((d) => d.phaseId);
    expect(phaseIds).toContain("config");
    expect(phaseIds).not.toContain("outputPath");
  });

  it("reports DOCTOR_CONFIG_INVALID for non-string output.outDir", async () => {
    await writeConfig({
      ...minimalValid,
      output: { outDir: 1, prettyHtml: true },
    });

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_CONFIG_INVALID",
        phaseId: "config",
        message: "output.outDir must be a non-empty string",
      })
    );
    expect(result.diagnostics.some((d) => d.phaseId === "outputPath")).toBe(false);
  });

  it("reports safe and unsafe output paths without modifying them", async () => {
    await writeConfig({ ...minimalValid, output: { outDir: "dist-prerender", prettyHtml: true } });
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    await writePost(tmpDir, "content/blog/a.md", {
      title: "A",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/a.jpg",
      slug: "a",
    });

    const safe = await runDoctorEngine({ cwd: tmpDir });
    expect(safe.diagnostics.some((d) => d.code === "DOCTOR_OUTPUT_PATH_SAFE")).toBe(true);

    await writeConfig({ ...minimalValid, output: { outDir: "..", prettyHtml: true } });
    const unsafe = await runDoctorEngine({ cwd: tmpDir });
    expect(unsafe.diagnostics.some((d) => d.code === "DOCTOR_OUTPUT_PATH_UNSAFE")).toBe(true);
    expect(await fs.pathExists(path.join(tmpDir, ".."))).toBe(true);
  });

  it("warns on empty collection and matches nested globs", async () => {
    await writeConfig({
      ...minimalValid,
      content: {
        markdown: {
          baseDir: "content",
          collections: [
            { name: "blog", pattern: "blog/**/*.md", routeBase: "/blog", schemaType: "Article" },
            { name: "guides", pattern: "guides/**/*.md", routeBase: "/guides", schemaType: "WebPage" },
          ],
        },
      },
    });
    await fs.ensureDir(path.join(tmpDir, "content", "blog", "2025"));
    await writePost(tmpDir, "content/blog/2025/nested.md", {
      title: "Nested",
      excerpt: "Nested excerpt with enough words for validation later on.",
      datePublished: "2025-06-01",
      coverImage: "/images/nested.jpg",
      slug: "nested-post",
    });

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CONTENT_COLLECTION_EMPTY")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CONTENT_GLOB_MATCHES")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CONTENT_FRONTMATTER")).toBe(true);
  });

  it("reports invalid frontmatter without stopping other file checks", async () => {
    await writeConfig(minimalValid);
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    await writePost(tmpDir, "content/blog/good.md", {
      title: "Good",
      excerpt: "Good excerpt with enough words for validation later on.",
      datePublished: "2025-01-01",
      coverImage: "/images/good.jpg",
      slug: "good",
    });
    await fs.writeFile(
      path.join(tmpDir, "content/blog/bad.md"),
      `---
title:
excerpt: bad
datePublished: 2025-01-01
coverImage: /images/bad.jpg
slug: bad
---

Body.
`,
      "utf8"
    );

    const result = await runDoctorEngine({ cwd: tmpDir });
    const frontmatterFails = result.diagnostics.filter((d) => d.code === "DOCTOR_CONTENT_FRONTMATTER");
    expect(frontmatterFails.some((d) => d.severity === "fail")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CONTENT_GLOB_MATCHES")).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("reports DOCTOR_CONFIG_INVALID for duplicate collection names", async () => {
    await writeConfig({
      ...minimalValid,
      content: {
        markdown: {
          baseDir: "content",
          collections: [
            {
              name: "blog",
              pattern: "blog/**/*.md",
              routeBase: "/blog",
              schemaType: "Article",
            },
            {
              name: "blog",
              pattern: "news/**/*.md",
              routeBase: "/news",
              schemaType: "BlogPosting",
            },
          ],
        },
      },
    });

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_CONFIG_INVALID",
        phaseId: "config",
        message: 'Duplicate collection name "blog"; collection names must be unique',
        details: expect.objectContaining({ collectionName: "blog", count: 2 }),
      })
    );
    expect(result.diagnostics.some((d) => d.phaseId === "contentSemantics")).toBe(false);
  });

  it("detects duplicate slugs and route collisions", async () => {
    await writeConfig({
      ...minimalValid,
      content: {
        markdown: {
          baseDir: "content",
          collections: [
            { name: "blog-a", pattern: "blog/a/**/*.md", routeBase: "/blog", schemaType: "Article" },
            { name: "blog-b", pattern: "blog/b/**/*.md", routeBase: "/blog", schemaType: "Article" },
          ],
        },
      },
    });
    await writePost(tmpDir, "content/blog/a/dup.md", {
      title: "Dup A",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/a.jpg",
      slug: "same-slug",
    });
    await writePost(tmpDir, "content/blog/b/dup.md", {
      title: "Dup B",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-02",
      coverImage: "/images/b.jpg",
      slug: "same-slug",
    });

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_ROUTE_DUPLICATE_SLUG")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_ROUTE_COLLISION")).toBe(true);
  });

  it("warns on route-base formatting issues", async () => {
    await writeConfig({
      ...minimalValid,
      content: {
        markdown: {
          baseDir: "content",
          collections: [
            { name: "blog", pattern: "blog/**/*.md", routeBase: "blog/", schemaType: "Article" },
          ],
        },
      },
    });
    await writePost(tmpDir, "content/blog/x.md", {
      title: "X",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/x.jpg",
      slug: "x",
    });

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_ROUTE_BASE_FORMAT")).toBe(true);
  });

  it("checks canonical HTTPS, spaOrigin, lovableOrigin, host mismatch, and OG image paths", async () => {
    await writeConfig({
      ...minimalValid,
      site: {
        ...minimalValid.site,
        canonicalBase: "http://example.com",
        defaultOgImage: "og-relative.jpg",
      },
      worker: {
        enabled: true,
        lovableOrigin: "https://app.example.com",
        rewriteRouteBases: ["/blog/"],
        botUserAgentPatterns: ["googlebot"],
        debugHeaders: false,
      },
    });
    await writePost(tmpDir, "content/blog/post.md", {
      title: "Post",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "images/relative.jpg",
      slug: "post",
    });

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CONFIG_DEPRECATED_FIELD")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_CANONICAL_BASE_HTTPS")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_SPA_ORIGIN_SET" && d.severity === "pass")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_ORIGIN_HOST_MISMATCH")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_OG_IMAGE_ABSOLUTE")).toBe(true);
  });

  it("preserves deterministic diagnostic phase ordering", async () => {
    await writeConfig(minimalValid);
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    await writePost(tmpDir, "content/blog/post.md", {
      title: "Post",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/post.jpg",
      slug: "post",
    });

    const result = await runDoctorEngine({ cwd: tmpDir });
    const phaseSequence = result.diagnostics.map((d) => d.phaseId);
    const s3Phases: DoctorPhaseId[] = [
      "config",
      "outputPath",
      "contentInventory",
      "contentSemantics",
      "siteOriginWorker",
    ];
    let lastIndex = -1;
    for (const phaseId of phaseSequence) {
      if (!s3Phases.includes(phaseId)) continue;
      const idx = s3Phases.indexOf(phaseId);
      expect(idx).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = idx;
    }
  });

  it("skipOutput still runs only phases 1-5", async () => {
    await writeConfig(minimalValid);
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    await writePost(tmpDir, "content/blog/post.md", {
      title: "Post",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/post.jpg",
      slug: "post",
    });

    const result = await runDoctorEngine({ cwd: tmpDir, skipOutput: true });
    const phaseIds = new Set(result.diagnostics.map((d) => d.phaseId));
    for (const phaseId of DOCTOR_PHASE_ORDER.slice(5)) {
      expect(phaseIds.has(phaseId)).toBe(false);
    }
    expect(result.skipOutput).toBe(true);
  });

  it("does not write files during doctor run", async () => {
    await writeConfig(minimalValid);
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    await writePost(tmpDir, "content/blog/post.md", {
      title: "Post",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/post.jpg",
      slug: "post",
    });

    const before = await treeHash(tmpDir);
    await runDoctorEngine({ cwd: tmpDir });
    const after = await treeHash(tmpDir);
    expect(after).toEqual(before);
  });

  it("produces no console output during S3 phases", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await writeConfig(minimalValid);
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    await writePost(tmpDir, "content/blog/post.md", {
      title: "Post",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/post.jpg",
      slug: "post",
    });

    await runDoctorEngine({ cwd: tmpDir });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("Doctor S3 public API boundary", () => {
  it("exports cmdDoctor but not runDoctorEngine from package root", async () => {
    const api = await import("../dist/index.js");
    expect(typeof api.cmdDoctor).toBe("function");
    expect(Object.keys(api)).not.toContain("runDoctorEngine");
  });
});
