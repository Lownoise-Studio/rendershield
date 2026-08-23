import { describe, it, expect } from "vitest";
import { renderPageHtml } from "../dist/core/renderHtml.js";
import type { MarkdownDoc, RenderShieldConfig } from "../dist/types.js";

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
        {
          name: "pages",
          pattern: "pages/**/*.md",
          routeBase: "/pages",
          schemaType: "WebPage",
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

const baseDoc: MarkdownDoc = {
  sourcePath: "/tmp/content/blog/post.md",
  collection: "blog",
  routePath: "/blog/post",
  title: "Post Title",
  excerpt: "Post excerpt",
  datePublished: "2024-01-15",
  coverImage: "/images/post.jpg",
  slug: "post",
  htmlContent: "<p>Body</p>",
};

describe("renderPageHtml schemaType", () => {
  it("emits Article JSON-LD for blog collections", () => {
    const html = renderPageHtml(baseConfig, baseDoc);
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('"headline":"Post Title"');
    expect(html).toContain('property="og:type" content="article"');
  });

  it("emits WebPage JSON-LD and og:type website for page collections", () => {
    const doc: MarkdownDoc = {
      ...baseDoc,
      collection: "pages",
      routePath: "/pages/about",
      slug: "about",
    };
    const html = renderPageHtml(baseConfig, doc);
    expect(html).toContain('"@type":"WebPage"');
    expect(html).toContain('"name":"Post Title"');
    expect(html).not.toContain('"headline"');
    expect(html).toContain('property="og:type" content="website"');
  });

  it("emits BlogPosting when configured on the collection", () => {
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
              schemaType: "BlogPosting",
            },
          ],
        },
      },
    };
    const html = renderPageHtml(cfg, baseDoc);
    expect(html).toContain('"@type":"BlogPosting"');
    expect(html).toContain('"headline":"Post Title"');
  });
});
