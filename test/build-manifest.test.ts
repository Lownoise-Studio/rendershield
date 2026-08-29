import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cmdBuild } from "../dist/commands/build.js";
import {
  BUILD_MANIFEST_FILENAME,
  BUILD_MANIFEST_VERSION,
  sha256Utf8,
} from "../dist/core/buildManifest.js";
import { getPackageIdentity } from "../dist/core/packageIdentity.js";
import { isRenderShieldError } from "../dist/errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = fs.readJsonSync(path.join(__dirname, "..", "package.json")) as {
  name: string;
  version: string;
};

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

async function writeProject(
  root: string,
  opts?: { slug?: string; title?: string; body?: string; badFrontmatter?: boolean }
): Promise<void> {
  const slug = opts?.slug ?? "alpha";
  const title = opts?.title ?? "Alpha Post";
  const body =
    opts?.body ??
    "Body for alpha with enough words and characters to satisfy the prerender article contract on every build.";
  await fs.ensureDir(path.join(root, "content", "blog"));
  await fs.writeFile(
    path.join(root, "rendershield.config.json"),
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
              pattern: "blog/**/*.md",
              routeBase: "/blog",
              schemaType: "Article",
            },
          ],
        },
      },
      output: { outDir: "dist-prerender", prettyHtml: true },
      sitemap: { enabled: true, path: "/sitemap.xml" },
      robots: { enabled: true, path: "/robots.txt" },
      worker: { enabled: false },
    }),
    "utf8"
  );

  if (opts?.badFrontmatter) {
    await fs.writeFile(
      path.join(root, "content", "blog", `${slug}.md`),
      `---
title: Missing fields
---

Body
`,
      "utf8"
    );
    return;
  }

  await fs.writeFile(
    path.join(root, "content", "blog", `${slug}.md`),
    `---
title: ${title}
excerpt: Excerpt for ${slug} with enough words for validation later on.
datePublished: 2025-01-01
coverImage: /images/${slug}.jpg
slug: ${slug}
---

${body}
`,
    "utf8"
  );
}

async function writeMultiPageProject(root: string): Promise<void> {
  await writeProject(root, {
    slug: "zebra",
    title: "Zebra",
    body: "Zebra body with enough words and characters to satisfy the prerender article contract.",
  });
  await fs.writeFile(
    path.join(root, "content", "blog", "alpha.md"),
    `---
title: Alpha
excerpt: Excerpt for alpha with enough words for validation later on.
datePublished: 2025-01-02
coverImage: /images/alpha.jpg
slug: alpha
---

Alpha body with enough words and characters to satisfy the prerender article contract.
`,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "content", "blog", "middle.md"),
    `---
title: Middle
excerpt: Excerpt for middle with enough words for validation later on.
datePublished: 2025-01-03
coverImage: /images/middle.jpg
slug: middle
---

Middle body with enough words and characters to satisfy the prerender article contract.
`,
    "utf8"
  );
}

describe("deterministic build manifest (M1)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-manifest-"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  it("emits rendershield-manifest.json with v1 contract", async () => {
    await writeProject(tmpDir);
    await cmdBuild(tmpDir);

    const manifestPath = path.join(tmpDir, "dist-prerender", BUILD_MANIFEST_FILENAME);
    await expect(fs.pathExists(manifestPath)).resolves.toBe(true);

    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as ManifestV1;
    const identity = getPackageIdentity();

    expect(manifest.manifestVersion).toBe(BUILD_MANIFEST_VERSION);
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.generator.name).toBe(PKG.name);
    expect(manifest.generator.version).toBe(PKG.version);
    expect(manifest.generator).toEqual(identity);
    expect(manifest.pages).toHaveLength(1);

    const page = manifest.pages[0];
    expect(page.route).toBe("/blog/alpha");
    expect(page.source).toBe("content/blog/alpha.md");
    expect(page.output).toBe("blog/alpha/index.html");
    expect(page.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(page.outputSha256).toMatch(/^[a-f0-9]{64}$/);

    const sourceRaw = await fs.readFile(
      path.join(tmpDir, "content", "blog", "alpha.md"),
      "utf8"
    );
    const htmlRaw = await fs.readFile(
      path.join(tmpDir, "dist-prerender", "blog", "alpha", "index.html"),
      "utf8"
    );
    expect(page.sourceSha256).toBe(sha256Utf8(sourceRaw));
    expect(page.outputSha256).toBe(sha256Utf8(htmlRaw));
    expect(page.outputSha256).toBe(
      createHash("sha256").update(htmlRaw, "utf8").digest("hex")
    );

    expect(raw.includes(tmpDir)).toBe(false);
    expect(raw).not.toMatch(/generatedAt|timestamp|cwd/i);
    expect(page.source.includes("\\")).toBe(false);
    expect(page.output.includes("\\")).toBe(false);
    expect(path.isAbsolute(page.source)).toBe(false);
    expect(path.isAbsolute(page.output)).toBe(false);

    // Existing artifacts unchanged
    await expect(
      fs.pathExists(path.join(tmpDir, "dist-prerender", "sitemap.xml"))
    ).resolves.toBe(true);
    await expect(
      fs.pathExists(path.join(tmpDir, "dist-prerender", "robots.txt"))
    ).resolves.toBe(true);
  });

  it("orders pages by route deterministically", async () => {
    await writeMultiPageProject(tmpDir);
    await cmdBuild(tmpDir);

    const manifest = JSON.parse(
      await fs.readFile(
        path.join(tmpDir, "dist-prerender", BUILD_MANIFEST_FILENAME),
        "utf8"
      )
    ) as ManifestV1;

    expect(manifest.pages.map((p) => p.route)).toEqual([
      "/blog/alpha",
      "/blog/middle",
      "/blog/zebra",
    ]);
  });

  it("produces byte-identical manifests for identical inputs across different project roots", async () => {
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rs-manifest-b-"));
    try {
      await writeProject(tmpDir, {
        slug: "same",
        title: "Same Post",
        body: "Identical body for determinism with enough words and characters for the article contract.",
      });
      await writeProject(otherRoot, {
        slug: "same",
        title: "Same Post",
        body: "Identical body for determinism with enough words and characters for the article contract.",
      });

      await cmdBuild(tmpDir);
      await cmdBuild(otherRoot);

      const a = await fs.readFile(
        path.join(tmpDir, "dist-prerender", BUILD_MANIFEST_FILENAME),
        "utf8"
      );
      const b = await fs.readFile(
        path.join(otherRoot, "dist-prerender", BUILD_MANIFEST_FILENAME),
        "utf8"
      );
      expect(a).toBe(b);
      expect(a.includes(tmpDir)).toBe(false);
      expect(b.includes(otherRoot)).toBe(false);
    } finally {
      await fs.remove(otherRoot).catch(() => {});
    }
  });

  it("changes sourceSha256 when source content changes", async () => {
    await writeProject(tmpDir, {
      slug: "hash",
      body: "Original body with enough words and characters to satisfy the prerender article contract.",
    });
    await cmdBuild(tmpDir);
    const first = JSON.parse(
      await fs.readFile(
        path.join(tmpDir, "dist-prerender", BUILD_MANIFEST_FILENAME),
        "utf8"
      )
    ) as ManifestV1;

    await writeProject(tmpDir, {
      slug: "hash",
      body: "Changed body with enough words and characters to satisfy the prerender article contract.",
    });
    await cmdBuild(tmpDir);
    const second = JSON.parse(
      await fs.readFile(
        path.join(tmpDir, "dist-prerender", BUILD_MANIFEST_FILENAME),
        "utf8"
      )
    ) as ManifestV1;

    expect(first.pages[0].sourceSha256).not.toBe(second.pages[0].sourceSha256);
    expect(first.pages[0].outputSha256).not.toBe(second.pages[0].outputSha256);
  });

  it("does not leave a success manifest when page generation fails", async () => {
    await writeProject(tmpDir, { badFrontmatter: true });

    try {
      await cmdBuild(tmpDir);
      expect.unreachable("expected build failure");
    } catch (err) {
      expect(isRenderShieldError(err)).toBe(true);
    }

    await expect(
      fs.pathExists(path.join(tmpDir, "dist-prerender", BUILD_MANIFEST_FILENAME))
    ).resolves.toBe(false);
  });

  it("does not leave a success manifest when required frontmatter is empty", async () => {
    await fs.ensureDir(path.join(tmpDir, "content", "blog"));
    await writeProject(tmpDir, { slug: "placeholder" });
    await fs.writeFile(
      path.join(tmpDir, "content", "blog", "placeholder.md"),
      `---
title: Bad
excerpt: ""
datePublished: 2025-01-01
coverImage: /images/bad.jpg
slug: bad
---

Body
`,
      "utf8"
    );

    try {
      await cmdBuild(tmpDir);
      expect.unreachable("expected build failure");
    } catch (err) {
      expect(isRenderShieldError(err)).toBe(true);
    }

    await expect(
      fs.pathExists(path.join(tmpDir, "dist-prerender", BUILD_MANIFEST_FILENAME))
    ).resolves.toBe(false);
  });
});
