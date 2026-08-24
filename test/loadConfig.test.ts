import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "../dist/core/loadConfig.js";

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
      collections: [{ name: "blog", pattern: "blog/**/*.md", routeBase: "/blog", schemaType: "Article" }],
    },
  },
  output: { outDir: "dist-prerender", prettyHtml: true },
  sitemap: { enabled: true, path: "/sitemap.xml" },
  robots: { enabled: true, path: "/robots.txt" },
  worker: { enabled: false },
};

/** Full config with worker enabled, for tests that need all worker fields. */
const fullConfigWithWorker = {
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
      collections: [{ name: "blog", pattern: "blog/**/*.md", routeBase: "/blog", schemaType: "Article" }],
    },
  },
  output: { outDir: "dist-prerender", prettyHtml: true },
  sitemap: { enabled: true, path: "/sitemap.xml" },
  robots: { enabled: true, path: "/robots.txt" },
  worker: {
    enabled: true,
    lovableOrigin: "https://origin.example.com",
    rewriteRouteBases: ["/blog/"],
    botUserAgentPatterns: ["googlebot", "bingbot"],
    debugHeaders: false,
  },
};

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-test-"));
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

  it("loads valid minimal config and defaults sitemap/robots path when missing", async () => {
    const config = { ...minimalValid };
    (config as Record<string, unknown>).sitemap = { enabled: true };
    (config as Record<string, unknown>).robots = { enabled: true };
    await writeConfig(config);
    const cfg = await loadConfig(tmpDir);
    expect(cfg.sitemap.path).toBe("/sitemap.xml");
    expect(cfg.robots.path).toBe("/robots.txt");
    expect(cfg.sitemap.enabled).toBe(true);
    expect(cfg.robots.enabled).toBe(true);
  });

  it("preserves sitemap and robots path when provided", async () => {
    await writeConfig({
      ...minimalValid,
      sitemap: { enabled: true, path: "/custom-sitemap.xml" },
      robots: { enabled: true, path: "/custom-robots.txt" },
    });
    const cfg = await loadConfig(tmpDir);
    expect(cfg.sitemap.path).toBe("/custom-sitemap.xml");
    expect(cfg.robots.path).toBe("/custom-robots.txt");
  });

  it("throws when config file is missing", async () => {
    await expect(loadConfig(tmpDir)).rejects.toThrow(/Missing.*rendershield.config.json/);
  });

  it("throws when version is not 1", async () => {
    await writeConfig({ ...minimalValid, version: 2 });
    await expect(loadConfig(tmpDir)).rejects.toThrow(/version must be 1/);
  });

  it("throws when site.canonicalBase is missing", async () => {
    const c = structuredClone(minimalValid);
    delete (c.site as Record<string, unknown>).canonicalBase;
    await writeConfig(c);
    await expect(loadConfig(tmpDir)).rejects.toThrow(/canonicalBase/);
  });

  it("throws when worker.enabled is true but spaOrigin is missing", async () => {
    await writeConfig({
      ...fullConfigWithWorker,
      worker: {
        enabled: true,
        rewriteRouteBases: ["/blog/"],
        botUserAgentPatterns: ["googlebot"],
      },
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow(/spaOrigin/);
  });

  it("accepts deprecated lovableOrigin as spaOrigin alias", async () => {
    await writeConfig(fullConfigWithWorker);
    const cfg = await loadConfig(tmpDir);
    expect(cfg.worker.spaOrigin).toBe("https://origin.example.com");
  });

  it("throws when worker.enabled is true but spaOrigin is invalid URL", async () => {
    await writeConfig({
      ...fullConfigWithWorker,
      worker: {
        ...(fullConfigWithWorker.worker as object),
        lovableOrigin: "not-a-url",
      },
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow(/valid URL/);
  });

  it("throws when worker.enabled is true but botUserAgentPatterns is empty", async () => {
    await writeConfig({
      ...fullConfigWithWorker,
      worker: {
        ...(fullConfigWithWorker.worker as object),
        botUserAgentPatterns: [],
      },
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow(/botUserAgentPatterns/);
  });

  it("loads valid config with worker enabled when all worker fields present", async () => {
    await writeConfig(fullConfigWithWorker);
    const cfg = await loadConfig(tmpDir);
    expect(cfg.worker.enabled).toBe(true);
    expect(cfg.worker.spaOrigin).toBe("https://origin.example.com");
    expect(cfg.worker.rewriteRouteBases).toEqual(["/blog/"]);
    expect(cfg.worker.botUserAgentPatterns).toEqual(["googlebot", "bingbot"]);
  });

  it("defaults collection schemaType to Article when omitted", async () => {
    await writeConfig({
      ...structuredClone(minimalValid),
      content: {
        markdown: {
          baseDir: "content",
          collections: [{ name: "blog", pattern: "blog/**/*.md", routeBase: "/blog" }],
        },
      },
    });
    const cfg = await loadConfig(tmpDir);
    expect(cfg.content.markdown.collections[0].schemaType).toBe("Article");
  });

  it("rejects non-string output.outDir", async () => {
    await writeConfig({
      ...structuredClone(minimalValid),
      output: { outDir: 1, prettyHtml: true },
    });
    await expect(loadConfig(tmpDir)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: "output.outDir must be a non-empty string",
    });
  });

  it("rejects invalid collection schemaType", async () => {
    await writeConfig({
      ...structuredClone(minimalValid),
      content: {
        markdown: {
          baseDir: "content",
          collections: [
            {
              name: "blog",
              pattern: "blog/**/*.md",
              routeBase: "/blog",
              schemaType: "FAQPage",
            },
          ],
        },
      },
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow(/schemaType must be one of/);
  });
});
