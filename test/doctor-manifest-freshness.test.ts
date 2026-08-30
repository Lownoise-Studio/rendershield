import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { cmdBuild } from "../dist/commands/build.js";
import { BUILD_MANIFEST_FILENAME } from "../dist/core/buildManifest.js";
import { runDoctorEngine } from "../dist/doctor/engine.js";
import { sha256Utf8 } from "../dist/core/sha256.js";

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

type ManifestV1 = {
  manifestVersion: number;
  generator: { name: string; version: string };
  pages: Array<{
    route: string;
    source: string;
    sourceSha256: string;
    output: string;
    outputSha256: string;
  }>;
};

describe("Doctor manifest-based freshness (M2)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-doc-m2-"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  async function writeConfig(config: object = baseConfig) {
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify(config, null, 2),
      "utf8"
    );
  }

  async function seedAndBuild() {
    await writeConfig();
    await writePost(tmpDir, "content/blog/post.md", {
      title: "Post",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/post.jpg",
      slug: "post",
    });
    await cmdBuild(tmpDir);
  }

  function manifestPath(): string {
    return path.join(tmpDir, "dist-prerender", BUILD_MANIFEST_FILENAME);
  }

  async function readManifest(): Promise<ManifestV1> {
    return JSON.parse(await fs.readFile(manifestPath(), "utf8")) as ManifestV1;
  }

  async function writeManifest(manifest: ManifestV1) {
    await fs.writeFile(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  it("PASS when valid manifest source and output hashes still match", async () => {
    await seedAndBuild();

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_CURRENT",
        severity: "pass",
        details: expect.objectContaining({
          method: "manifest-sha256",
          routes: ["/blog/post"],
        }),
      })
    );
  });

  it("WARN when source Markdown SHA-256 differs from manifest", async () => {
    await seedAndBuild();
    const sourcePath = path.join(tmpDir, "content/blog/post.md");
    const raw = await fs.readFile(sourcePath, "utf8");
    await fs.writeFile(sourcePath, `${raw}\n<!-- edited -->\n`, "utf8");

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_SOURCE_CHANGED",
        severity: "warning",
        details: expect.objectContaining({
          method: "manifest-sha256",
          concern: "source-provenance",
          routePath: "/blog/post",
        }),
      })
    );
  });

  it("WARN when generated HTML SHA-256 differs from manifest", async () => {
    await seedAndBuild();
    const htmlPath = path.join(tmpDir, "dist-prerender/blog/post/index.html");
    const html = await fs.readFile(htmlPath, "utf8");
    await fs.writeFile(htmlPath, `${html}\n<!-- tampered -->\n`, "utf8");

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_OUTPUT_CHANGED",
        severity: "warning",
        details: expect.objectContaining({
          method: "manifest-sha256",
          concern: "output-integrity",
          routePath: "/blog/post",
        }),
      })
    );
  });

  it("FAIL when source listed in manifest is missing", async () => {
    await seedAndBuild();
    const manifest = await readManifest();
    manifest.pages[0].source = "content/blog/gone.md";
    await writeManifest(manifest);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_SOURCE_MISSING",
        severity: "fail",
        phaseId: "freshness",
        details: expect.objectContaining({ method: "manifest-sha256" }),
      })
    );
  });

  it("FAIL when output listed in manifest is missing", async () => {
    await seedAndBuild();
    await fs.remove(path.join(tmpDir, "dist-prerender/blog/post/index.html"));

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_OUTPUT_MISSING",
        severity: "fail",
        phaseId: "freshness",
        details: expect.objectContaining({ method: "manifest-sha256" }),
      })
    );
  });

  it("falls back to mtime freshness when manifest is absent", async () => {
    await seedAndBuild();
    await fs.remove(manifestPath());
    const sourcePath = path.join(tmpDir, "content/blog/post.md");
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(sourcePath, future, future);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_STALE",
        severity: "warning",
        details: expect.objectContaining({ method: "mtime-best-effort" }),
      })
    );
    expect(
      result.diagnostics.some(
        (d) =>
          d.code === "DOCTOR_FRESHNESS_CURRENT" &&
          d.details?.method === "manifest-sha256"
      )
    ).toBe(false);
  });

  it("FAIL on malformed manifest JSON without mtime fallback", async () => {
    await seedAndBuild();
    await fs.writeFile(manifestPath(), "{ not-json", "utf8");

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_MANIFEST_INVALID",
        severity: "fail",
        phaseId: "freshness",
        details: expect.objectContaining({ reason: "malformed-json" }),
      })
    );
    expect(result.diagnostics.some((d) => d.code === "DOCTOR_FRESHNESS_STALE")).toBe(
      false
    );
    expect(
      result.diagnostics.some(
        (d) =>
          d.code === "DOCTOR_FRESHNESS_CURRENT" &&
          d.details?.method === "mtime-best-effort"
      )
    ).toBe(false);
  });

  it("FAIL on unsupported manifestVersion without mtime fallback", async () => {
    await seedAndBuild();
    const manifest = await readManifest();
    manifest.manifestVersion = 99;
    await writeManifest(manifest);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_MANIFEST_UNSUPPORTED_VERSION",
        severity: "fail",
        phaseId: "freshness",
        details: expect.objectContaining({
          reason: "unsupported-version",
          manifestVersion: 99,
        }),
      })
    );
  });

  it("FAIL on structurally invalid manifest", async () => {
    await seedAndBuild();
    await fs.writeFile(
      manifestPath(),
      `${JSON.stringify(
        {
          manifestVersion: 1,
          generator: { name: "x", version: "1" },
          pages: "not-an-array",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_MANIFEST_INVALID",
        severity: "fail",
        details: expect.objectContaining({ reason: "invalid-structure" }),
      })
    );
  });

  it("FAIL on unsafe manifest source path", async () => {
    await seedAndBuild();
    const manifest = await readManifest();
    manifest.pages[0].source = "../outside.md";
    await writeManifest(manifest);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_MANIFEST_INVALID",
        severity: "fail",
        details: expect.objectContaining({ reason: "unsafe-path" }),
      })
    );
  });

  it("FAIL on unsafe manifest output path", async () => {
    await seedAndBuild();
    const manifest = await readManifest();
    manifest.pages[0].output = "../escape/index.html";
    await writeManifest(manifest);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_MANIFEST_INVALID",
        severity: "fail",
        details: expect.objectContaining({ reason: "unsafe-path" }),
      })
    );
  });

  it("FAIL on duplicate routes in manifest", async () => {
    await seedAndBuild();
    const manifest = await readManifest();
    const page = { ...manifest.pages[0] };
    page.output = "blog/post-dup/index.html";
    page.outputSha256 = sha256Utf8("dup");
    manifest.pages.push(page);
    await writeManifest(manifest);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_MANIFEST_INVALID",
        severity: "fail",
        details: expect.objectContaining({ reason: "duplicate-route" }),
      })
    );
  });

  it("FAIL on conflicting duplicate output paths in manifest", async () => {
    await seedAndBuild();
    const manifest = await readManifest();
    const page = {
      ...manifest.pages[0],
      route: "/blog/other",
      source: "content/blog/other.md",
      sourceSha256: sha256Utf8("other"),
    };
    manifest.pages.push(page);
    await writeManifest(manifest);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_MANIFEST_INVALID",
        severity: "fail",
        details: expect.objectContaining({ reason: "duplicate-output" }),
      })
    );
  });

  it("remains read-only while evaluating manifest freshness", async () => {
    await seedAndBuild();
    const before = await treeHash(tmpDir);
    await runDoctorEngine({ cwd: tmpDir });
    const after = await treeHash(tmpDir);
    expect(after).toEqual(before);
  });

  it("emits matching routes in deterministic sorted order", async () => {
    await writeConfig({
      ...baseConfig,
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
          ],
        },
      },
    });
    await writePost(tmpDir, "content/blog/zeta.md", {
      title: "Zeta",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/z.jpg",
      slug: "zeta",
    });
    await writePost(tmpDir, "content/blog/alpha.md", {
      title: "Alpha",
      excerpt: "Excerpt with enough words for validation later on here.",
      datePublished: "2025-01-01",
      coverImage: "/images/a.jpg",
      slug: "alpha",
    });
    await cmdBuild(tmpDir);

    const result = await runDoctorEngine({ cwd: tmpDir });
    const current = result.diagnostics.find(
      (d) =>
        d.code === "DOCTOR_FRESHNESS_CURRENT" &&
        d.details?.method === "manifest-sha256"
    );
    expect(current?.details?.routes).toEqual(["/blog/alpha", "/blog/zeta"]);
  });

  it("emits both source-changed and output-changed when both hashes differ", async () => {
    await seedAndBuild();
    const sourcePath = path.join(tmpDir, "content/blog/post.md");
    const htmlPath = path.join(tmpDir, "dist-prerender/blog/post/index.html");
    await fs.writeFile(sourcePath, `${await fs.readFile(sourcePath, "utf8")}\n<!-- src -->\n`, "utf8");
    await fs.writeFile(htmlPath, `${await fs.readFile(htmlPath, "utf8")}\n<!-- out -->\n`, "utf8");

    const result = await runDoctorEngine({ cwd: tmpDir });
    const freshness = result.diagnostics.filter((d) => d.phaseId === "freshness");
    const codes = freshness.map((d) => d.code);
    expect(codes).toEqual([
      "DOCTOR_FRESHNESS_SOURCE_CHANGED",
      "DOCTOR_FRESHNESS_OUTPUT_CHANGED",
    ]);
  });

  it("reports SOURCE_MISSING when the only source is deleted but manifest remains", async () => {
    await seedAndBuild();
    await fs.remove(path.join(tmpDir, "content/blog/post.md"));

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_SOURCE_MISSING",
        severity: "fail",
        phaseId: "freshness",
        details: expect.objectContaining({ method: "manifest-sha256" }),
      })
    );
  });

  it("FAIL when source path is a symlink escaping cwd", async () => {
    await seedAndBuild();
    const outside = path.join(tmpDir, "..", `rs-escape-src-${path.basename(tmpDir)}.md`);
    await fs.writeFile(outside, "secret outside\n", "utf8");
    const sourcePath = path.join(tmpDir, "content/blog/post.md");
    await fs.remove(sourcePath);
    await fs.symlink(outside, sourcePath);

    try {
      const result = await runDoctorEngine({ cwd: tmpDir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "DOCTOR_MANIFEST_INVALID",
          severity: "fail",
          details: expect.objectContaining({ reason: "unsafe-path" }),
        })
      );
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === "DOCTOR_FRESHNESS_CURRENT" &&
            d.details?.method === "mtime-best-effort"
        )
      ).toBe(false);
    } finally {
      await fs.remove(outside).catch(() => {});
    }
  });

  it("FAIL when output path is a symlink escaping outDir", async () => {
    await seedAndBuild();
    const outside = path.join(tmpDir, "outside-html.html");
    await fs.writeFile(outside, "<html>outside</html>\n", "utf8");
    const htmlPath = path.join(tmpDir, "dist-prerender/blog/post/index.html");
    await fs.remove(htmlPath);
    await fs.symlink(outside, htmlPath);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_MANIFEST_INVALID",
        severity: "fail",
        details: expect.objectContaining({ reason: "unsafe-path" }),
      })
    );
  });

  it("FAIL when a symlinked parent directory escapes the permitted root", async () => {
    await seedAndBuild();
    const outsideDir = path.join(
      tmpDir,
      "..",
      `rs-escape-parent-${path.basename(tmpDir)}`
    );
    await fs.ensureDir(outsideDir);
    await fs.writeFile(path.join(outsideDir, "post.md"), "escaped\n", "utf8");
    const blogDir = path.join(tmpDir, "content/blog");
    await fs.remove(blogDir);
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await fs.symlink(outsideDir, blogDir, linkType);

    try {
      const result = await runDoctorEngine({ cwd: tmpDir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "DOCTOR_MANIFEST_INVALID",
          severity: "fail",
          details: expect.objectContaining({ reason: "unsafe-path" }),
        })
      );
    } finally {
      await fs.remove(outsideDir).catch(() => {});
    }
  });

  it("allows a contained symlink whose realpath stays inside the project", async () => {
    await seedAndBuild();
    const sourcePath = path.join(tmpDir, "content/blog/post.md");
    const altPath = path.join(tmpDir, "content/blog/post-real.md");
    await fs.move(sourcePath, altPath);
    await fs.symlink(altPath, sourcePath);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_CURRENT",
        severity: "pass",
        details: expect.objectContaining({ method: "manifest-sha256" }),
      })
    );
  });

  it("FAIL when source path is replaced by a directory", async () => {
    await seedAndBuild();
    const sourcePath = path.join(tmpDir, "content/blog/post.md");
    await fs.remove(sourcePath);
    await fs.ensureDir(sourcePath);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_SOURCE_UNREADABLE",
        severity: "fail",
        details: expect.objectContaining({
          method: "manifest-sha256",
          reason: "not-regular-file",
        }),
      })
    );
  });

  it("FAIL when output path is replaced by a directory", async () => {
    await seedAndBuild();
    const htmlPath = path.join(tmpDir, "dist-prerender/blog/post/index.html");
    await fs.remove(htmlPath);
    await fs.ensureDir(htmlPath);

    const result = await runDoctorEngine({ cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DOCTOR_FRESHNESS_OUTPUT_UNREADABLE",
        severity: "fail",
        details: expect.objectContaining({
          method: "manifest-sha256",
          reason: "not-regular-file",
        }),
      })
    );
  });
});
