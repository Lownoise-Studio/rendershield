import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadAllMarkdownDocs } from "../dist/core/loadMarkdown.js";
import {
  buildRoutePath,
  discoverCollectionFiles,
  parseMarkdownFile,
} from "../dist/core/markdownContent.js";
import { loadConfig } from "../dist/core/loadConfig.js";
import { isRenderShieldError } from "../dist/errors.js";
import type { RenderShieldConfig } from "../dist/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures", "build-success");

const baseConfig: RenderShieldConfig = {
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
      ],
    },
  },
  output: { outDir: "dist-prerender", prettyHtml: true },
  sitemap: { enabled: false, path: "/sitemap.xml" },
  robots: { enabled: false, path: "/robots.txt" },
  worker: {
    enabled: false,
    spaOrigin: "",
    rewriteRouteBases: [],
    botUserAgentPatterns: [],
    debugHeaders: false,
  },
};

describe("markdown primitives parity", () => {
  describe("buildRoutePath", () => {
    it("normalizes trailing slash on routeBase", () => {
      expect(buildRoutePath("/blog/", "hello")).toBe("/blog/hello");
      expect(buildRoutePath("/blog", "hello")).toBe("/blog/hello");
    });
  });

  describe("loadAllMarkdownDocs via build-success fixture", () => {
    it("produces expected MarkdownDoc for sample post", async () => {
      const cfg = await loadConfig(FIXTURE_DIR);
      const docs = await loadAllMarkdownDocs(cfg, FIXTURE_DIR);

      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        collection: "blog",
        routePath: "/blog/sample",
        title: "Sample Post",
        excerpt: "A sample post for integration tests.",
        datePublished: "2024-01-15",
        coverImage: "/images/sample.jpg",
        slug: "sample",
      });
      expect(docs[0].sourcePath).toMatch(/sample\.md$/);
      expect(docs[0].htmlContent).toContain("<p>");
      expect(docs[0].htmlContent).toContain("<strong>sample</strong>");
    });
  });

  describe("deterministic collection ordering", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-md-order-"));
      await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    });

    afterEach(async () => {
      await fs.remove(tmpDir).catch(() => {});
    });

    it("sorts docs by routePath regardless of collection iteration order", async () => {
      const writePost = async (slug: string) => {
        await fs.writeFile(
          path.join(tmpDir, "content", "blog", `${slug}.md`),
          `---
title: Post ${slug}
excerpt: Excerpt for ${slug} with enough words for validation later on.
datePublished: 2025-01-01
coverImage: /images/${slug}.jpg
slug: ${slug}
---

Body for ${slug}.
`,
          "utf8"
        );
      };

      await writePost("zebra");
      await writePost("alpha");
      await writePost("middle");

      const cfg: RenderShieldConfig = {
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
      };

      const docs = await loadAllMarkdownDocs(cfg, tmpDir);
      expect(docs.map((d) => d.routePath)).toEqual([
        "/blog/alpha",
        "/blog/middle",
        "/blog/zebra",
      ]);
    });

    it("sorts across multiple collections by routePath", async () => {
      await fs.ensureDir(path.join(tmpDir, "content", "guides"));
      await fs.writeFile(
        path.join(tmpDir, "content", "blog", "b-post.md"),
        `---
title: Blog
excerpt: Blog excerpt with enough words for validation later on here.
datePublished: 2025-01-01
coverImage: /images/b.jpg
slug: b-post
---

Blog body.
`,
        "utf8"
      );
      await fs.writeFile(
        path.join(tmpDir, "content", "guides", "a-guide.md"),
        `---
title: Guide
excerpt: Guide excerpt with enough words for validation later on here.
datePublished: 2025-01-02
coverImage: /images/g.jpg
slug: a-guide
---

Guide body.
`,
        "utf8"
      );

      const cfg: RenderShieldConfig = {
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
              {
                name: "guides",
                pattern: "guides/**/*.md",
                routeBase: "/guides/",
                schemaType: "WebPage",
              },
            ],
          },
        },
      };

      const docs = await loadAllMarkdownDocs(cfg, tmpDir);
      expect(docs.map((d) => d.routePath)).toEqual(["/blog/b-post", "/guides/a-guide"]);
    });
  });

  describe("invalid frontmatter errors", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-md-invalid-"));
      await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    });

    afterEach(async () => {
      await fs.remove(tmpDir).catch(() => {});
    });

    async function expectContentInvalid(
      frontmatter: string,
      expectedMessage: string
    ) {
      const abs = path.join(tmpDir, "content", "blog", "bad.md");
      await fs.writeFile(abs, `${frontmatter}\n\nBody.\n`, "utf8");

      try {
        await parseMarkdownFile(abs, "blog", "/blog");
        throw new Error("Expected CONTENT_INVALID");
      } catch (err: unknown) {
        expect(isRenderShieldError(err)).toBe(true);
        if (isRenderShieldError(err)) {
          expect(err.code).toBe("CONTENT_INVALID");
          expect(err.message).toBe(expectedMessage);
        }
      }

      try {
        await loadAllMarkdownDocs(baseConfig, tmpDir);
        throw new Error("Expected CONTENT_INVALID from loadAllMarkdownDocs");
      } catch (err: unknown) {
        expect(isRenderShieldError(err)).toBe(true);
        if (isRenderShieldError(err)) {
          expect(err.code).toBe("CONTENT_INVALID");
          expect(err.message).toBe(expectedMessage);
        }
      }
    }

    it("missing title matches loadAllMarkdownDocs and parseMarkdownFile", async () => {
      const abs = path.join(tmpDir, "content", "blog", "bad.md");
      const msg = `Missing required frontmatter field "title" in ${abs}. Required fields: title, excerpt, datePublished, coverImage, slug`;
      await expectContentInvalid(
        `---
excerpt: ok excerpt here
datePublished: 2025-01-01
coverImage: /images/x.jpg
slug: bad
---`,
        msg
      );
    });

    it("missing datePublished matches exact message", async () => {
      const abs = path.join(tmpDir, "content", "blog", "bad.md");
      const msg = `Missing required frontmatter field "datePublished" in ${abs}. Required fields: title, excerpt, datePublished, coverImage, slug`;
      await expectContentInvalid(
        `---
title: T
excerpt: ok excerpt here
coverImage: /images/x.jpg
slug: bad
---`,
        msg
      );
    });

    it("invalid datePublished format matches exact message", async () => {
      const abs = path.join(tmpDir, "content", "blog", "bad.md");
      const msg = `Invalid datePublished in ${abs}. Use format YYYY-MM-DD.`;
      await expectContentInvalid(
        `---
title: T
excerpt: ok excerpt here
datePublished: Jan 1 2025
coverImage: /images/x.jpg
slug: bad
---`,
        msg
      );
    });
  });

  describe("discoverCollectionFiles glob parity", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-md-glob-"));
      await fs.ensureDir(path.join(tmpDir, "content", "blog", "2025"));
    });

    afterEach(async () => {
      await fs.remove(tmpDir).catch(() => {});
    });

    it("finds nested blog/**/*.md paths", async () => {
      await fs.writeFile(
        path.join(tmpDir, "content", "blog", "2025", "nested.md"),
        `---
title: Nested
excerpt: Nested excerpt with enough words for validation later on here.
datePublished: 2025-06-02
coverImage: /images/nested.jpg
slug: nested-post
---

Nested body.
`,
        "utf8"
      );

      const baseDirAbs = path.join(tmpDir, "content");
      const matches = await discoverCollectionFiles(baseDirAbs, "blog/**/*.md");
      expect(matches.some((m) => m.replace(/\\/g, "/") === "blog/2025/nested.md")).toBe(
        true
      );

      const docs = await loadAllMarkdownDocs(baseConfig, tmpDir);
      expect(docs.some((d) => d.slug === "nested-post")).toBe(true);
      expect(docs[0].routePath).toBe("/blog/nested-post");
    });
  });
});
