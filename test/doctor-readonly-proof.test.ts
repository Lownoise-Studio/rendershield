import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cmdBuild } from "../dist/commands/build.js";
import {
  captureProjectTree,
  snapshotsEqual,
  snapshotDiffSummary,
} from "./helpers/projectTreeSnapshot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "..", "dist", "cli.js");
const CONFIG_NAME = "rendershield.config.json";

const DOCTOR_MODES: string[][] = [[], ["--json"], ["--strict"], ["--skip-output"]];

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
  worker: { enabled: false },
};

const validPostBody = `---
title: Post
excerpt: Excerpt with enough words for validation later on here.
datePublished: 2025-01-01
coverImage: /images/post.jpg
slug: post
---

Body with enough words and characters to satisfy the article length requirement for the prerender contract validation. At least twenty words are required here for the build to pass.
`;

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
}

async function writeConfig(root: string, config: object) {
  await fs.writeFile(path.join(root, CONFIG_NAME), JSON.stringify(config, null, 2), "utf8");
}

async function writeValidPost(root: string, slug = "post") {
  const abs = path.join(root, "content/blog", `${slug}.md`);
  await fs.ensureDir(path.dirname(abs));
  const body = validPostBody.replace("slug: post", `slug: ${slug}`);
  await fs.writeFile(abs, body, "utf8");
}

async function assertDoctorReadOnly(
  root: string,
  modes: string[][] = DOCTOR_MODES,
  options: { expectExit?: (args: string[], status: number | null) => void } = {}
) {
  for (const doctorArgs of modes) {
    const before = await captureProjectTree(root);
    const result = runCli(["doctor", ...doctorArgs], root);
    const after = await captureProjectTree(root);

    if (!snapshotsEqual(before, after)) {
      throw new Error(
        `Doctor mutated project tree for args [${doctorArgs.join(" ")}]:\n${snapshotDiffSummary(before, after)}`
      );
    }

    if (options.expectExit) {
      options.expectExit(doctorArgs, result.status);
    }
  }
}

describe("doctor read-only proof (compiled CLI)", () => {
  let tmpDir: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`Compiled CLI missing at ${CLI_PATH}; run npm run build first`);
    }
  });

  afterEach(async () => {
    if (tmpDir) await fs.remove(tmpDir).catch(() => {});
  });

  it("exercises doctor, --json, --strict, and --skip-output without mutating a built project", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-doc-ro-built-"));
    await writeConfig(tmpDir, minimalValid);
    await writeValidPost(tmpDir);
    await cmdBuild(tmpDir);

    await assertDoctorReadOnly(tmpDir, DOCTOR_MODES, {
      expectExit: (args, status) => {
        expect(status).toBe(0);
        if (args.includes("--json")) {
          const jsonRun = runCli(["doctor", "--json"], tmpDir);
          const parsed = JSON.parse(jsonRun.stdout.trim());
          expect(parsed.command).toBe("doctor");
          expect(parsed.ok).toBe(true);
          expect(Array.isArray(parsed.diagnostics)).toBe(true);
        }
      },
    });
  });

  it("does not mutate a valid pre-build project with missing output", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-doc-ro-prebuild-"));
    await writeConfig(tmpDir, minimalValid);
    await writeValidPost(tmpDir);

    await assertDoctorReadOnly(tmpDir, DOCTOR_MODES, {
      expectExit: (args, status) => {
        if (args.includes("--strict")) {
          expect(status).toBe(1);
        } else {
          expect(status).toBe(0);
        }
      },
    });
  });

  it("does not mutate with invalid configuration", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-doc-ro-invalid-"));
    await writeConfig(tmpDir, { version: 1, site: { canonicalBase: "not-a-url" } });

    await assertDoctorReadOnly(tmpDir, DOCTOR_MODES, {
      expectExit: (args, status) => {
        if (args.includes("--json")) {
          const jsonRun = runCli(["doctor", "--json"], tmpDir);
          expect(jsonRun.status).toBe(1);
          const parsed = JSON.parse(jsonRun.stdout.trim());
          expect(parsed.ok).toBe(false);
        } else {
          expect(status).toBe(1);
        }
      },
    });
  });

  it("does not mutate with content/frontmatter failure", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-doc-ro-frontmatter-"));
    await writeConfig(tmpDir, minimalValid);
    const abs = path.join(tmpDir, "content/blog/bad.md");
    await fs.ensureDir(path.dirname(abs));
    await fs.writeFile(abs, "---\ntitle: Missing fields\n---\nShort.\n", "utf8");

    await assertDoctorReadOnly(tmpDir, DOCTOR_MODES, {
      expectExit: (_, status) => expect(status).toBe(1),
    });
  });

  it("does not mutate with safe nested sitemap/robots artifact paths", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-doc-ro-nested-artifacts-"));
    await writeConfig(tmpDir, {
      ...minimalValid,
      sitemap: { enabled: true, path: "/seo/sitemap.xml" },
      robots: { enabled: true, path: "/crawler/robots.txt" },
    });
    await writeValidPost(tmpDir);
    await cmdBuild(tmpDir);

    await assertDoctorReadOnly(tmpDir);
  });

  it("does not mutate with safe double-dot-prefixed artifact paths", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-doc-ro-dotmeta-"));
    await writeConfig(tmpDir, {
      ...minimalValid,
      sitemap: { enabled: true, path: "/..metadata/sitemap.xml" },
      robots: { enabled: true, path: "/..well-known/robots.txt" },
    });
    await writeValidPost(tmpDir);
    await cmdBuild(tmpDir);

    await assertDoctorReadOnly(tmpDir);
  });

  it("does not mutate when in-project symlinks are present", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-doc-ro-symlink-"));
    await writeConfig(tmpDir, minimalValid);
    await writeValidPost(tmpDir);
    await cmdBuild(tmpDir);

    const linkPath = path.join(tmpDir, "content/blog/link-to-post.md");
    const target = path.join(tmpDir, "content/blog/post.md");
    try {
      if (process.platform === "win32") {
        await fs.symlink(target, linkPath, "file");
      } else {
        await fs.symlink(path.relative(path.dirname(linkPath), target), linkPath);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/EPERM|ENOTSUP|privilege|operation not permitted/i.test(message)) {
        return;
      }
      throw err;
    }

    await assertDoctorReadOnly(tmpDir);
  });

  it("returns exit 2 for invalid doctor arguments without mutating the tree", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-doc-ro-args-"));
    await writeConfig(tmpDir, minimalValid);
    await writeValidPost(tmpDir);

    const before = await captureProjectTree(tmpDir);
    const result = runCli(["doctor", "--prod"], tmpDir);
    const after = await captureProjectTree(tmpDir);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Unknown flag|invalid/i);
    expect(snapshotsEqual(before, after)).toBe(true);
  });

  it("returns exit 1 for strict warnings without mutating the tree", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-doc-ro-strict-"));
    await writeConfig(tmpDir, minimalValid);
    await writeValidPost(tmpDir);

    const warnOnly = runCli(["doctor"], tmpDir);
    expect(warnOnly.status).toBe(0);

    const before = await captureProjectTree(tmpDir);
    const strict = runCli(["doctor", "--strict"], tmpDir);
    const after = await captureProjectTree(tmpDir);

    expect(strict.status).toBe(1);
    expect(snapshotsEqual(before, after)).toBe(true);
  });
});
