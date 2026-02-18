import { describe, it, expect, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cmdBuild } from "../dist/commands/build.js";
import { checkPrerenderContract } from "../dist/core/validateOutput.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures", "build-success");
const outDir = path.join(fixtureDir, "dist-prerender");

describe("build integration", () => {
  afterEach(async () => {
    await fs.remove(outDir).catch(() => {});
  });

  it("builds pages, sitemap, and robots and output passes contract", async () => {
    await cmdBuild(fixtureDir);

    const indexHtmlPath = path.join(outDir, "blog", "sample", "index.html");
    await expect(fs.pathExists(indexHtmlPath)).resolves.toBe(true);

    const html = await fs.readFile(indexHtmlPath, "utf8");
    const contract = checkPrerenderContract(html, { routePath: "/blog/sample" });
    expect(contract.ok).toBe(true);
    expect(contract.missing).toHaveLength(0);

    await expect(fs.pathExists(path.join(outDir, "sitemap.xml"))).resolves.toBe(true);
    await expect(fs.pathExists(path.join(outDir, "robots.txt"))).resolves.toBe(true);
  });
});
