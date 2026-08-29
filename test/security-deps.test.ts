import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadAllMarkdownDocs } from "../dist/core/loadMarkdown.js";
import MarkdownIt from "markdown-it";
import type { RenderShieldConfig } from "../dist/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCKFILE = path.join(__dirname, "..", "package-lock.json");

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

function lockVersion(pkg: string): string {
  const lock = fs.readJsonSync(LOCKFILE) as {
    packages: Record<string, { version?: string }>;
  };
  const key = `node_modules/${pkg}`;
  const version = lock.packages[key]?.version;
  if (!version) throw new Error(`Missing lock entry for ${pkg}`);
  return version;
}

describe("package identity (packaging compatibility)", () => {
  it("preserves npm package name, CLI bin, and version", () => {
    const pkg = fs.readJsonSync(path.join(__dirname, "..", "package.json")) as {
      name: string;
      version: string;
      bin: Record<string, string>;
    };
    expect(pkg.name).toBe("@lownoise-studio/rendershield");
    expect(pkg.version).toBe("1.2.1");
    expect(pkg.bin.rendershield).toBe("dist/cli.js");
  });
});

describe("patched dependency versions", () => {
  it("lockfile resolves patched markdown-it, linkify-it, js-yaml, picomatch", () => {
    expect(lockVersion("markdown-it")).toMatch(/^14\.(2|3)\./);
    expect(lockVersion("linkify-it")).toBe("5.0.2");
    expect(lockVersion("js-yaml")).toMatch(/^4\./);
    expect(lockVersion("picomatch")).toBe("2.3.2");
  });

  it("does not include gray-matter in the production dependency tree", () => {
    const lock = fs.readJsonSync(LOCKFILE) as {
      packages: Record<string, unknown>;
    };
    expect(lock.packages["node_modules/gray-matter"]).toBeUndefined();
  });
});

describe("markdown rendering regression", () => {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

  it("renders typographer quote-heavy markdown without error", () => {
    const body = `"${'"'.repeat(120)}" and '${"'".repeat(80)}'`;
    const html = md.render(body);
    expect(html).toContain("<p>");
  });

  it("linkifies URLs and mailto-like text", () => {
    const html = md.render(
      "Visit https://example.com/path and mailto:user@example.com for info."
    );
    expect(html).toMatch(/href="https:\/\/example\.com\/path"/);
    expect(html).toMatch(/mailto:/);
  });
});

describe("loadAllMarkdownDocs regression", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-sec-"));
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  it("loads valid YAML frontmatter and default glob pattern", async () => {
    await fs.writeFile(
      path.join(tmpDir, "content", "blog", "post.md"),
      `---
title: Security Post
excerpt: Valid frontmatter for regression coverage.
datePublished: 2025-06-01
coverImage: /images/post.jpg
slug: security-post
tags:
  - alpha
  - beta
---

Visit https://example.com and "quoted" text with mailto:test@example.com.
`,
      "utf8"
    );

    const docs = await loadAllMarkdownDocs(baseConfig, tmpDir);
    expect(docs).toHaveLength(1);
    expect(docs[0].routePath).toBe("/blog/security-post");
    expect(docs[0].htmlContent).toMatch(/https:\/\/example\.com/);
    expect(docs[0].htmlContent).toMatch(/mailto:/);
  });

  it("finds nested blog/**/*.md via fast-glob", async () => {
    await fs.ensureDir(path.join(tmpDir, "content", "blog", "2025"));
    await fs.writeFile(
      path.join(tmpDir, "content", "blog", "2025", "nested.md"),
      `---
title: Nested Post
excerpt: Nested glob regression sample with enough words for later checks.
datePublished: 2025-06-02
coverImage: /images/nested.jpg
slug: nested-post
---

Body for nested glob regression.
`,
      "utf8"
    );

    const docs = await loadAllMarkdownDocs(baseConfig, tmpDir);
    expect(docs.some((d) => d.slug === "nested-post")).toBe(true);
  });
});

describe("hostile markdown performance (isolated child)", () => {
  it("quote-heavy typographer input completes within timeout", () => {
    const script = `
import MarkdownIt from "markdown-it";
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
const input = '"'.repeat(8000);
md.render(input);
console.log("ok");
`.trim();

    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 10_000,
      cwd: path.join(__dirname, ".."),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ok");
  });
});
