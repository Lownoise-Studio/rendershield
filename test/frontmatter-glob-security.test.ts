import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { parseYamlFrontmatter } from "../dist/core/parseYamlFrontmatter.js";
import { parseMarkdownFile } from "../dist/core/markdownContent.js";
import { loadConfig } from "../dist/core/loadConfig.js";
import { isRenderShieldError } from "../dist/errors.js";
import {
  MAX_COLLECTION_PATTERN_LENGTH,
  validateCollectionPattern,
} from "../dist/core/collectionPatternSafety.js";

describe("YAML frontmatter security boundary", () => {
  it("parses normal YAML frontmatter and preserves Markdown body", () => {
    const raw = `---
title: Hello
excerpt: A short excerpt for parsing.
datePublished: 2025-06-01
coverImage: /images/hello.jpg
slug: hello
---

Body paragraph with **markdown**.
`;
    const parsed = parseYamlFrontmatter(raw, "fixture.md");
    expect(parsed.data.title).toBe("Hello");
    expect(parsed.data.slug).toBe("hello");
    expect(parsed.data.datePublished).toBeInstanceOf(Date);
    expect(parsed.content).toContain("Body paragraph with **markdown**.");
  });

  it("parses UTF-8 BOM-prefixed YAML frontmatter and preserves body", () => {
    const raw =
      "\uFEFF---\n" +
      "title: Bom Post\n" +
      "excerpt: Excerpt for BOM-prefixed frontmatter parsing.\n" +
      "datePublished: 2025-06-02\n" +
      "coverImage: /images/bom.jpg\n" +
      "slug: bom-post\n" +
      "---\n\n" +
      "BOM body with **emphasis**.\n";
    const parsed = parseYamlFrontmatter(raw, "bom.md");
    expect(parsed.data.title).toBe("Bom Post");
    expect(parsed.data.slug).toBe("bom-post");
    expect(parsed.content).toContain("BOM body with **emphasis**.");
    expect(parsed.content.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("strips a leading BOM when no frontmatter is present", () => {
    const parsed = parseYamlFrontmatter("\uFEFFJust body text\n", "plain.md");
    expect(parsed.data).toEqual({});
    expect(parsed.content).toBe("Just body text\n");
  });

  it("rejects BOM-prefixed JavaScript-tagged frontmatter without evaluating it", () => {
    let evaluated = false;
    const marker = {
      set ran(v: boolean) {
        evaluated = v;
      },
    };
    (globalThis as { __rsFrontmatterProbe?: typeof marker }).__rsFrontmatterProbe =
      marker;

    const payload =
      "\uFEFF---js\n" +
      "({ get title() { globalThis.__rsFrontmatterProbe.ran = true; return \"x\"; } })\n" +
      "---\n\nBody\n";
    try {
      expect(() => parseYamlFrontmatter(payload, "hostile-bom.md")).toThrow(
        /Unsupported frontmatter language/
      );
      expect(evaluated).toBe(false);
    } finally {
      delete (globalThis as { __rsFrontmatterProbe?: typeof marker })
        .__rsFrontmatterProbe;
    }
  });

  it("accepts quoted datePublished strings", () => {
    const parsed = parseYamlFrontmatter(
      `---
title: T
excerpt: E
datePublished: "2024-01-15"
coverImage: /x.jpg
slug: s
---

Body
`,
      "fixture.md"
    );
    expect(parsed.data.datePublished).toBe("2024-01-15");
  });

  it("rejects JavaScript-tagged frontmatter without evaluating it", () => {
    let evaluated = false;
    const marker = {
      set ran(v: boolean) {
        evaluated = v;
      },
    };
    // Attach a setter only if somehow executed; the payload must not run.
    (globalThis as { __rsFrontmatterProbe?: typeof marker }).__rsFrontmatterProbe =
      marker;

    const payload = `---js
({ get title() { globalThis.__rsFrontmatterProbe.ran = true; return "x"; } })
---

Body
`;
    try {
      expect(() => parseYamlFrontmatter(payload, "hostile.md")).toThrow();
      expect(evaluated).toBe(false);
    } finally {
      delete (globalThis as { __rsFrontmatterProbe?: typeof marker })
        .__rsFrontmatterProbe;
    }
  });

  it("rejects javascript and json language tags", () => {
    for (const lang of ["javascript", "json", "coffee"]) {
      expect(() =>
        parseYamlFrontmatter(
          `---${lang}\n{"title":"x"}\n---\nBody\n`,
          "fixture.md"
        )
      ).toThrow(/Unsupported frontmatter language/);
    }
  });

  it("allows optional yaml language tag", () => {
    const parsed = parseYamlFrontmatter(
      `---yaml
title: Tagged
excerpt: Excerpt text for yaml tag coverage.
datePublished: 2025-01-01
coverImage: /images/t.jpg
slug: tagged
---

Body
`,
      "fixture.md"
    );
    expect(parsed.data.title).toBe("Tagged");
  });

  it("fails safely on malformed YAML", () => {
    expect(() =>
      parseYamlFrontmatter(
        `---
title: [unterminated
---
Body
`,
        "bad.md"
      )
    ).toThrow(/Invalid YAML frontmatter/);
  });

  it("fails safely on unterminated frontmatter", () => {
    expect(() =>
      parseYamlFrontmatter(
        `---
title: Missing close
`,
        "bad.md"
      )
    ).toThrow(/Unterminated YAML frontmatter/);
  });

  it("does not execute JavaScript-like text inside YAML string values", () => {
    const parsed = parseYamlFrontmatter(
      `---
title: "(() => { throw new Error('boom') })()"
excerpt: Safe excerpt text for value coverage.
datePublished: 2025-01-01
coverImage: /images/x.jpg
slug: safe-js-text
---

Body stays data-only.
`,
      "fixture.md"
    );
    expect(parsed.data.title).toBe("(() => { throw new Error('boom') })()");
    expect(parsed.content).toContain("Body stays data-only.");
  });
});

describe("parseMarkdownFile uses YAML-only frontmatter", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-fm-"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  it("loads required fields through the Markdown parse path", async () => {
    const file = path.join(tmpDir, "post.md");
    await fs.writeFile(
      file,
      `---
title: Parsed Post
excerpt: Excerpt for end-to-end frontmatter parsing.
datePublished: 2025-03-01
coverImage: /images/post.jpg
slug: parsed-post
---

Hello **world**.
`,
      "utf8"
    );

    const doc = await parseMarkdownFile(file, "blog", "/blog");
    expect(doc.title).toBe("Parsed Post");
    expect(doc.datePublished).toBe("2025-03-01");
    expect(doc.slug).toBe("parsed-post");
    expect(doc.htmlContent).toContain("<strong>world</strong>");
  });

  it("loads required fields from a BOM-prefixed Markdown file", async () => {
    const file = path.join(tmpDir, "bom-post.md");
    await fs.writeFile(
      file,
      "\uFEFF---\n" +
        "title: BOM Parsed Post\n" +
        "excerpt: Excerpt for BOM-prefixed Markdown parse path.\n" +
        "datePublished: 2025-03-02\n" +
        "coverImage: /images/bom-post.jpg\n" +
        "slug: bom-parsed-post\n" +
        "---\n\n" +
        "Hello **bom** body.\n",
      "utf8"
    );

    const doc = await parseMarkdownFile(file, "blog", "/blog");
    expect(doc.title).toBe("BOM Parsed Post");
    expect(doc.datePublished).toBe("2025-03-02");
    expect(doc.slug).toBe("bom-parsed-post");
    expect(doc.htmlContent).toContain("<strong>bom</strong>");
  });

  it("rejects ---js frontmatter on the Markdown parse path", async () => {
    const file = path.join(tmpDir, "js.md");
    await fs.writeFile(
      file,
      `---js
module.exports = { title: "nope" }
---

Body
`,
      "utf8"
    );

    try {
      await parseMarkdownFile(file, "blog", "/blog");
      expect.unreachable("expected CONTENT_INVALID");
    } catch (err) {
      expect(isRenderShieldError(err)).toBe(true);
      if (isRenderShieldError(err)) {
        expect(err.code).toBe("CONTENT_INVALID");
        expect(err.message).toMatch(/Unsupported frontmatter language/);
      }
    }
  });
});

describe("collection pattern safety", () => {
  it("accepts documented simple globs", () => {
    expect(validateCollectionPattern("blog/**/*.md", "pattern")).toBe(
      "blog/**/*.md"
    );
    expect(validateCollectionPattern("**/*.md", "pattern")).toBe("**/*.md");
  });

  it("rejects oversized patterns", () => {
    const huge = `${"a".repeat(MAX_COLLECTION_PATTERN_LENGTH + 1)}/**/*.md`;
    expect(() => validateCollectionPattern(huge, "pattern")).toThrow(
      /at most 256 characters/
    );
  });

  it("rejects control characters including NUL", () => {
    expect(() =>
      validateCollectionPattern("blog/**/*.md\u0000", "pattern")
    ).toThrow(/control characters/);
  });

  it("rejects extglob quantifier syntax", () => {
    for (const pattern of ["+(a|aa).md", "blog/*(a).md", "@(a|b).md", "!(x).md"]) {
      expect(() => validateCollectionPattern(pattern, "pattern")).toThrow(
        /extglob/
      );
    }
  });

  it("loadConfig rejects unsafe collection patterns", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-pat-"));
    try {
      await fs.writeFile(
        path.join(tmpDir, "rendershield.config.json"),
        JSON.stringify({
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
                  pattern: "+(a|aa).md",
                  routeBase: "/blog",
                },
              ],
            },
          },
          output: { outDir: "dist-prerender" },
          worker: { enabled: false },
        }),
        "utf8"
      );

      try {
        await loadConfig(tmpDir);
        expect.unreachable("expected CONFIG_INVALID");
      } catch (err) {
        expect(isRenderShieldError(err)).toBe(true);
        if (isRenderShieldError(err)) {
          expect(err.code).toBe("CONFIG_INVALID");
          expect(err.message).toMatch(/extglob/);
        }
      }
    } finally {
      await fs.remove(tmpDir).catch(() => {});
    }
  });
});
