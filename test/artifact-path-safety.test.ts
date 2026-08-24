import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { loadConfig } from "../dist/core/loadConfig.js";
import {
  readArtifactPathConfig,
  resolveArtifactPathInOutDir,
  validateArtifactPathFormat,
} from "../dist/core/artifactPathSafety.js";
import { cmdBuild } from "../dist/commands/build.js";
import { runDoctorEngine } from "../dist/doctor/engine.js";

const CONFIG_NAME = "rendershield.config.json";

const REJECTED_PATHS = [
  "/../outside.xml",
  "/../../outside.txt",
  "/..\\outside.txt",
  "C:\\outside.txt",
  "//server/share/file.txt",
  "/",
];

const ACCEPTED_PATHS = ["/sitemap.xml", "/robots.txt", "/seo/sitemap.xml", "/crawler/robots.txt"];

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
  sitemap: { enabled: true, path: "/sitemap.xml" },
  robots: { enabled: true, path: "/robots.txt" },
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

async function writePost(dir: string) {
  const abs = path.join(dir, "content/blog/post.md");
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

describe("validateArtifactPathFormat", () => {
  it.each(REJECTED_PATHS)("rejects unsafe path %s", (unsafePath) => {
    for (const field of ["sitemap.path", "robots.path"] as const) {
      expect(() => validateArtifactPathFormat(unsafePath, field)).toThrow(
        expect.objectContaining({ code: "CONFIG_INVALID" })
      );
    }
  });

  it.each(ACCEPTED_PATHS)("accepts safe path %s", (safePath) => {
    expect(validateArtifactPathFormat(safePath, "sitemap.path")).toBe(safePath);
    expect(validateArtifactPathFormat(safePath, "robots.path")).toBe(safePath);
  });
});

describe("loadConfig artifact path validation", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-artifact-path-"));
    await fs.ensureDir(path.join(tmpDir, "dist-prerender"));
    await writePost(tmpDir);
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

  it.each(REJECTED_PATHS)("rejects sitemap.path %s", async (unsafePath) => {
    await writeConfig({
      ...minimalValid,
      sitemap: { enabled: true, path: unsafePath },
    });
    await expect(loadConfig(tmpDir)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it.each(REJECTED_PATHS)("rejects robots.path %s", async (unsafePath) => {
    await writeConfig({
      ...minimalValid,
      robots: { enabled: true, path: unsafePath },
    });
    await expect(loadConfig(tmpDir)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it.each(ACCEPTED_PATHS)("accepts sitemap.path %s", async (safePath) => {
    await writeConfig({
      ...minimalValid,
      sitemap: { enabled: true, path: safePath },
    });
    const cfg = await loadConfig(tmpDir);
    expect(cfg.sitemap.path).toBe(safePath);
  });

  it.each(ACCEPTED_PATHS)("accepts robots.path %s", async (safePath) => {
    await writeConfig({
      ...minimalValid,
      robots: { enabled: true, path: safePath },
    });
    const cfg = await loadConfig(tmpDir);
    expect(cfg.robots.path).toBe(safePath);
  });

  it("rejects artifact paths whose symlink parent resolves outside outDir", async () => {
    const outsideDir = path.join(tmpDir, "outside-target");
    const outDir = path.join(tmpDir, "dist-prerender");
    await fs.ensureDir(outsideDir);
    await fs.writeFile(path.join(outsideDir, "sentinel.txt"), "keep", "utf8");

    const linkPath = path.join(outDir, "escape");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await fs.symlink(outsideDir, linkPath, linkType);

    await writeConfig({
      ...minimalValid,
      sitemap: { enabled: true, path: "/escape/sitemap.xml" },
    });

    await expect(loadConfig(tmpDir)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: expect.stringContaining("outside output.outDir"),
    });
  });
});

describe("artifact path safety integration", () => {
  let tmpDir: string;
  let sentinelPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-artifact-int-"));
    sentinelPath = path.join(tmpDir, "outside-sentinel.txt");
    await fs.writeFile(sentinelPath, "unchanged", "utf8");
    await fs.ensureDir(path.join(tmpDir, "dist-prerender"));
    await writePost(tmpDir);
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

  it("Doctor returns DOCTOR_CONFIG_INVALID and never touches outside sentinel", async () => {
    await writeConfig({
      ...minimalValid,
      sitemap: { enabled: true, path: "/../outside.xml" },
    });

    const before = await treeHash(tmpDir);
    const result = await runDoctorEngine({ cwd: tmpDir });
    const after = await treeHash(tmpDir);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_CONFIG_INVALID",
        phaseId: "config",
      })
    );
    expect(after).toEqual(before);
    await expect(fs.readFile(sentinelPath, "utf8")).resolves.toBe("unchanged");
  });

  it("cmdBuild fails with CONFIG_INVALID before deleting output or writing artifacts", async () => {
    const outDir = path.join(tmpDir, "dist-prerender");
    await fs.writeFile(path.join(outDir, "keep-me.txt"), "stay", "utf8");

    await writeConfig({
      ...minimalValid,
      sitemap: { enabled: true, path: "/../outside.xml" },
    });

    await expect(cmdBuild(tmpDir)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    await expect(fs.readFile(path.join(outDir, "keep-me.txt"), "utf8")).resolves.toBe("stay");
    await expect(fs.readFile(sentinelPath, "utf8")).resolves.toBe("unchanged");
    await expect(fs.pathExists(path.join(tmpDir, "outside.xml"))).resolves.toBe(false);
  });

  it("builds and verifies nested artifact paths safely", async () => {
    await writeConfig({
      ...minimalValid,
      sitemap: { enabled: true, path: "/seo/sitemap.xml" },
      robots: { enabled: true, path: "/crawler/robots.txt" },
    });

    await cmdBuild(tmpDir);

    await expect(fs.pathExists(path.join(tmpDir, "dist-prerender/seo/sitemap.xml"))).resolves.toBe(
      true
    );
    await expect(
      fs.pathExists(path.join(tmpDir, "dist-prerender/crawler/robots.txt"))
    ).resolves.toBe(true);
    await expect(fs.readFile(sentinelPath, "utf8")).resolves.toBe("unchanged");

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_SITEMAP_URL_SET",
        severity: "pass",
      })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_ROBOTS_EXPECTED",
        severity: "pass",
      })
    );
  });

  it("resolveArtifactPathInOutDir keeps resolved targets inside outDir", async () => {
    const outDirAbs = path.join(tmpDir, "dist-prerender");
    const resolved = await resolveArtifactPathInOutDir(outDirAbs, "/seo/sitemap.xml", "sitemap.path");
    const relative = path.relative(outDirAbs, resolved);
    expect(relative.startsWith("..")).toBe(false);
    expect(relative).toBe(path.join("seo", "sitemap.xml"));
  });

  it("readArtifactPathConfig defaults to safe paths", () => {
    expect(readArtifactPathConfig(undefined, "/sitemap.xml", "sitemap.path")).toBe("/sitemap.xml");
    expect(readArtifactPathConfig(null, "/robots.txt", "robots.path")).toBe("/robots.txt");
  });
});

describe("artifact path safety public API boundary", () => {
  it("does not export artifact path helpers from package root", async () => {
    const api = await import("../dist/index.js");
    expect(Object.keys(api)).not.toContain("resolveArtifactPathInOutDir");
    expect(Object.keys(api)).not.toContain("validateArtifactPathFormat");
  });
});
