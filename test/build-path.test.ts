import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { cmdBuild } from "../dist/commands/build.js";

const CONFIG_NAME = "rendershield.config.json";

describe("build path safety (validateOutputPath)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-build-test-"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  it("rejects outDir that resolves outside project root", async () => {
    const config = {
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
      output: { outDir: "..", prettyHtml: true },
      sitemap: { enabled: false },
      robots: { enabled: false },
      worker: { enabled: false },
    };
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify(config, null, 2),
      "utf8"
    );
    await expect(cmdBuild(tmpDir)).rejects.toThrow(/outside project root|resolves outside/);
  });

  it("rejects outDir equal to project root", async () => {
    const config = {
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
      output: { outDir: ".", prettyHtml: true },
      sitemap: { enabled: false },
      robots: { enabled: false },
      worker: { enabled: false },
    };
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify(config, null, 2),
      "utf8"
    );
    await expect(cmdBuild(tmpDir)).rejects.toThrow(/cannot be the project root|project root/);
  });

  it("rejects duplicate collection names before modifying output", async () => {
    const outDir = path.join(tmpDir, "dist-prerender");
    await fs.ensureDir(outDir);
    const sentinel = path.join(outDir, "keep-me.txt");
    await fs.writeFile(sentinel, "unchanged", "utf8");

    const config = {
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
      output: { outDir: "dist-prerender", prettyHtml: true },
      sitemap: { enabled: false },
      robots: { enabled: false },
      worker: { enabled: false },
    };
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify(config, null, 2),
      "utf8"
    );

    await expect(cmdBuild(tmpDir)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: 'Duplicate collection name "blog"; collection names must be unique',
    });
    await expect(fs.readFile(sentinel, "utf8")).resolves.toBe("unchanged");
  });
});
