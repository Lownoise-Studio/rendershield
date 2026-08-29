import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import {
  resolveRouteIndexHtmlInOutDir,
  resolveRoutePageDirInOutDir,
  validateContentRoutePath,
  validateRouteBase,
  validateRouteSlug,
} from "../dist/core/routePathSafety.js";
import { isOutsideBase } from "../dist/core/pathContainment.js";
import { cmdBuild } from "../dist/commands/build.js";
import { loadConfig } from "../dist/core/loadConfig.js";
import { parseMarkdownFile } from "../dist/core/markdownContent.js";
import { runDoctorEngine } from "../dist/doctor/engine.js";

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
  worker: {
    enabled: false,
    spaOrigin: "",
    rewriteRouteBases: [],
    botUserAgentPatterns: [],
    debugHeaders: false,
  },
};

function postMarkdown(slug: string): string {
  // Quote slug so YAML accepts values like %2e%2e/outside and backslash forms.
  const quoted = JSON.stringify(slug);
  return `---
title: Post Title With Enough Length
excerpt: Excerpt with enough words for validation later on here in this sentence.
datePublished: 2025-01-01
coverImage: /images/post.jpg
slug: ${quoted}
---

Body content with enough text for the prerender contract checks to pass cleanly.
`;
}

describe("route path safety — validation", () => {
  it("accepts ordinary slug hello-world", () => {
    expect(validateRouteSlug("hello-world")).toBe("hello-world");
  });

  it("accepts safe nested slug guides/getting-started", () => {
    expect(validateRouteSlug("guides/getting-started")).toBe("guides/getting-started");
    expect(validateContentRoutePath("/blog/guides/getting-started")).toBe(
      "/blog/guides/getting-started"
    );
  });

  it('rejects slug "../../escape"', () => {
    expect(() => validateRouteSlug("../../escape")).toThrow(/parent-directory/);
  });

  it("rejects nested traversal slug foo/../../../escape", () => {
    expect(() => validateRouteSlug("foo/../../../escape")).toThrow(/parent-directory/);
  });

  it('rejects routeBase "/../outside"', () => {
    expect(() => validateRouteBase("/../outside", "routeBase")).toThrow(/parent-directory/);
  });

  it('rejects routeBase "/" combined with slug "../outside" at routePath', () => {
    expect(() => validateRouteSlug("../outside")).toThrow(/parent-directory/);
    expect(() => validateContentRoutePath("/../outside")).toThrow(/parent-directory/);
  });

  it("rejects backslash traversal variants cross-platform", () => {
    const variants = [
      "..\\outside",
      "foo\\..\\escape",
      "/blog\\..\\outside",
      "..\\..\\escape",
    ];
    for (const value of variants) {
      expect(() => validateRouteSlug(value)).toThrow(/backslash/);
      expect(() => validateRouteBase(value, "routeBase")).toThrow(/backslash/);
      expect(() => validateContentRoutePath(value)).toThrow(/backslash/);
    }
  });

  it("rejects NUL-containing inputs", () => {
    expect(() => validateRouteSlug("hel\0lo")).toThrow(/null bytes/);
    expect(() => validateRouteBase("/bl\0og", "routeBase")).toThrow(/null bytes/);
    expect(() => validateContentRoutePath("/blog/hel\0lo")).toThrow(/null bytes/);
  });

  it("rejects current-directory (.) segments without rewriting", () => {
    expect(() => validateRouteSlug("foo/./bar")).toThrow(/current-directory/);
    expect(() => validateRouteBase("/blog/./x", "routeBase")).toThrow(/current-directory/);
  });

  it("preserves historically accepted routeBase forms without leading slash", () => {
    expect(validateRouteBase("blog/", "routeBase")).toBe("blog/");
    expect(validateRouteBase("/blog", "routeBase")).toBe("/blog");
    expect(validateRouteBase("/", "routeBase")).toBe("/");
  });

  it("documents that %2e%2e is a literal segment and not filesystem traversal", () => {
    // Node path APIs do not URL-decode segments. "%2e%2e" is not "..".
    expect(validateRouteSlug("%2e%2e/outside")).toBe("%2e%2e/outside");
    expect(validateContentRoutePath("/blog/%2e%2e/outside")).toBe("/blog/%2e%2e/outside");
  });
});

describe("route path safety — filesystem containment primitive", () => {
  let tmpDir: string;
  let outDirAbs: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-route-contain-"));
    outDirAbs = path.join(tmpDir, "dist-prerender");
    await fs.ensureDir(outDirAbs);
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  it("resolves safe nested routes under outDir", () => {
    const pageDir = resolveRoutePageDirInOutDir(outDirAbs, "/blog/guides/getting-started");
    const relative = path.relative(outDirAbs, pageDir);
    expect(isOutsideBase(relative)).toBe(false);
    expect(relative).toBe(path.join("blog", "guides", "getting-started"));

    const indexHtml = resolveRouteIndexHtmlInOutDir(outDirAbs, "/blog/hello-world");
    expect(isOutsideBase(path.relative(outDirAbs, indexHtml))).toBe(false);
    expect(indexHtml).toBe(path.join(outDirAbs, "blog", "hello-world", "index.html"));
  });

  it("rejects escaping routes at the containment boundary", () => {
    const escaping = [
      "/blog/../../escape",
      "/blog/foo/../../../escape",
      "/../outside",
      "/../../escape",
    ];
    for (const routePath of escaping) {
      expect(() => resolveRoutePageDirInOutDir(outDirAbs, routePath)).toThrow();
      expect(() => resolveRouteIndexHtmlInOutDir(outDirAbs, routePath)).toThrow();
    }
  });

  it("keeps %2e%2e literal segments inside outDir (no traversal)", () => {
    const pageDir = resolveRoutePageDirInOutDir(outDirAbs, "/blog/%2e%2e/outside");
    const relative = path.relative(outDirAbs, pageDir);
    expect(isOutsideBase(relative)).toBe(false);
    expect(relative.split(path.sep)).toEqual(["blog", "%2e%2e", "outside"]);
  });

  it("rejects backslash routes before any filesystem join", () => {
    expect(() => resolveRoutePageDirInOutDir(outDirAbs, "/blog/..\\escape")).toThrow(
      /backslash/
    );
  });
});

describe("route path safety — build command", () => {
  let tmpDir: string;
  let outDirAbs: string;
  let outsideSentinel: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-route-build-"));
    outDirAbs = path.join(tmpDir, "dist-prerender");
    outsideSentinel = path.join(tmpDir, "escape", "index.html");
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  async function writeConfig(patch: Record<string, unknown> = {}) {
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify({ ...minimalValid, ...patch }, null, 2),
      "utf8"
    );
  }

  async function writePost(slug: string, fileName = "post.md") {
    await fs.writeFile(path.join(tmpDir, "content/blog", fileName), postMarkdown(slug), "utf8");
  }

  it('rejects slug "../../escape" with routeBase "/blog" and leaves no outside files', async () => {
    await writeConfig();
    await writePost("../../escape");

    await expect(cmdBuild(tmpDir)).rejects.toMatchObject({ code: "CONTENT_INVALID" });

    expect(await fs.pathExists(outsideSentinel)).toBe(false);
    expect(await fs.pathExists(path.join(tmpDir, "escape"))).toBe(false);
  });

  it("rejects nested traversal slug foo/../../../escape", async () => {
    await writeConfig();
    await writePost("foo/../../../escape");

    await expect(cmdBuild(tmpDir)).rejects.toMatchObject({ code: "CONTENT_INVALID" });
    expect(await fs.pathExists(path.join(tmpDir, "escape"))).toBe(false);
  });

  it('rejects routeBase "/../outside"', async () => {
    await writeConfig({
      content: {
        markdown: {
          baseDir: "content",
          collections: [
            {
              name: "blog",
              pattern: "blog/**/*.md",
              routeBase: "/../outside",
              schemaType: "Article",
            },
          ],
        },
      },
    });
    await writePost("x");

    await expect(cmdBuild(tmpDir)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(await fs.pathExists(path.join(tmpDir, "outside"))).toBe(false);
  });

  it('rejects routeBase "/" with slug "../outside"', async () => {
    await writeConfig({
      content: {
        markdown: {
          baseDir: "content",
          collections: [
            { name: "root", pattern: "blog/**/*.md", routeBase: "/", schemaType: "Article" },
          ],
        },
      },
    });
    await writePost("../outside");

    await expect(cmdBuild(tmpDir)).rejects.toMatchObject({ code: "CONTENT_INVALID" });
    expect(await fs.pathExists(path.join(tmpDir, "outside"))).toBe(false);
  });

  it("rejects backslash traversal via build", async () => {
    await writeConfig();
    await writePost("..\\escape");

    await expect(cmdBuild(tmpDir)).rejects.toMatchObject({ code: "CONTENT_INVALID" });
    expect(await fs.pathExists(path.join(tmpDir, "escape"))).toBe(false);
  });

  it("rejects NUL in slug via parse boundary", async () => {
    await writeConfig();
    const abs = path.join(tmpDir, "content/blog/nul.md");
    // Bypass YAML: unit coverage for NUL is in validation tests; parse path still
    // must reject if a NUL slug reaches validateRouteSlug.
    await fs.writeFile(
      abs,
      `---
title: Post Title With Enough Length
excerpt: Excerpt with enough words for validation later on here in this sentence.
datePublished: 2025-01-01
coverImage: /images/post.jpg
slug: "hel\0lo"
---

Body content with enough text for the prerender contract checks to pass cleanly.
`,
      "utf8"
    );

    await expect(cmdBuild(tmpDir)).rejects.toThrow();
  });

  it("builds safe nested slug guides/getting-started under outDir only", async () => {
    await writeConfig();
    await writePost("guides/getting-started");

    await cmdBuild(tmpDir);

    const expected = path.join(outDirAbs, "blog", "guides", "getting-started", "index.html");
    expect(await fs.pathExists(expected)).toBe(true);
    expect(await fs.pathExists(path.join(tmpDir, "escape"))).toBe(false);
    expect(await fs.pathExists(path.join(tmpDir, "guides"))).toBe(false);
  });

  it("builds ordinary slug hello-world under outDir", async () => {
    await writeConfig();
    await writePost("hello-world");

    await cmdBuild(tmpDir);

    expect(
      await fs.pathExists(path.join(outDirAbs, "blog", "hello-world", "index.html"))
    ).toBe(true);
  });

  it("builds %2e%2e literal slug under outDir without escaping", async () => {
    await writeConfig();
    await writePost("%2e%2e/outside");

    await cmdBuild(tmpDir);

    const expected = path.join(outDirAbs, "blog", "%2e%2e", "outside", "index.html");
    expect(await fs.pathExists(expected)).toBe(true);
    expect(isOutsideBase(path.relative(outDirAbs, expected))).toBe(false);
    expect(await fs.pathExists(path.join(tmpDir, "outside"))).toBe(false);
  });
});

describe("route path safety — config and parse boundaries", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-route-cfg-"));
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  it("loadConfig rejects unsafe routeBase", async () => {
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify(
        {
          ...minimalValid,
          content: {
            markdown: {
              baseDir: "content",
              collections: [
                {
                  name: "blog",
                  pattern: "blog/**/*.md",
                  routeBase: "/../outside",
                  schemaType: "Article",
                },
              ],
            },
          },
        },
        null,
        2
      ),
      "utf8"
    );

    await expect(loadConfig(tmpDir)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("parseMarkdownFile rejects unsafe slug", async () => {
    const abs = path.join(tmpDir, "content/blog/evil.md");
    await fs.writeFile(abs, postMarkdown("../../escape"), "utf8");

    await expect(parseMarkdownFile(abs, "blog", "/blog")).rejects.toMatchObject({
      code: "CONTENT_INVALID",
    });
  });
});

describe("route path safety — Doctor does not probe escaped paths", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-route-doc-"));
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    await fs.ensureDir(path.join(tmpDir, "dist-prerender"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  it("reports frontmatter failure for traversal slug and does not create outside paths", async () => {
    await fs.writeFile(
      path.join(tmpDir, CONFIG_NAME),
      JSON.stringify(minimalValid, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(tmpDir, "content/blog/evil.md"),
      postMarkdown("../../escape"),
      "utf8"
    );

    const outsideDir = path.join(tmpDir, "escape");
    const result = await runDoctorEngine({ cwd: tmpDir });

    expect(
      result.diagnostics.some(
        (d) => d.code === "DOCTOR_CONTENT_FRONTMATTER" && /parent-directory|\.\./.test(d.message)
      )
    ).toBe(true);
    expect(await fs.pathExists(outsideDir)).toBe(false);

    // Containment helper itself must refuse escaped routes (Doctor uses the same primitive).
    const outDirAbs = path.join(tmpDir, "dist-prerender");
    expect(() => resolveRouteIndexHtmlInOutDir(outDirAbs, "/blog/../../escape")).toThrow();
  });
});
