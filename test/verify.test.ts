import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { cmdVerify } from "../dist/commands/verify.js";
import { cmdBuild } from "../dist/commands/build.js";
import { isRenderShieldError } from "../dist/errors.js";

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
  sitemap: { enabled: false },
  robots: { enabled: false },
  worker: { enabled: false },
};

describe("cmdVerify (local)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-verify-"));
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify(minimalValid, null, 2),
      "utf8"
    );
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    await fs.writeFile(
      path.join(tmpDir, "content", "blog", "post.md"),
      `---
title: Test Post
excerpt: A short excerpt for testing verify.
datePublished: 2025-01-01
coverImage: /images/test.jpg
slug: test-post
---

This is enough article body content to satisfy the prerender contract when built.
`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  it("throws VERIFY_FAILED when output directory is missing", async () => {
    await expect(cmdVerify(tmpDir)).rejects.toSatisfy((err: unknown) => {
      return isRenderShieldError(err) && err.code === "VERIFY_FAILED";
    });
  });

  it("returns structured result after a successful build", async () => {
    await cmdBuild(tmpDir);
    const result = await cmdVerify(tmpDir);
    expect(result.mode).toBe("local");
    if (result.mode === "local") {
      expect(result.routePath).toBe("/blog/test-post");
      expect(result.url).toBe("https://example.com/blog/test-post");
      expect(result.outputFile).toMatch(/blog[\\/]test-post[\\/]index\.html$/);
    }
  });
});
