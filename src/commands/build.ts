import fs from "fs-extra";
import path from "node:path";
import { loadConfig } from "../core/loadConfig.js";
import { loadAllMarkdownDocs } from "../core/loadMarkdown.js";
import { renderPageHtml } from "../core/renderHtml.js";
import { generateSitemapXml } from "../core/generateSitemap.js";
import { generateRobotsTxt } from "../core/generateRobots.js";
import { generateWorkerJs } from "../core/generateWorker.js";
import { validatePrerenderHtml } from "../core/validateOutput.js";

function routeToOutDir(outDirAbs: string, routePath: string): string {
  // /blog/slug -> outDir/blog/slug/index.html
  const clean = routePath.replace(/^\//, "");
  return path.join(outDirAbs, clean);
}

export async function cmdBuild(cwd = process.cwd()) {
  const cfg = await loadConfig(cwd);
  const outDirAbs = path.join(cwd, cfg.output.outDir);

  // Clean output (boring + deterministic)
  await fs.remove(outDirAbs);
  await fs.ensureDir(outDirAbs);

  const docs = await loadAllMarkdownDocs(cfg, cwd);

  if (docs.length === 0) {
    throw new Error("No markdown documents found. Check content paths/patterns.");
  }

  // Generate pages (validate BEFORE writing)
  for (const doc of docs) {
    const pageDir = routeToOutDir(outDirAbs, doc.routePath);
    await fs.ensureDir(pageDir);

    const outFile = path.join(pageDir, "index.html");
    const html = renderPageHtml(cfg, doc);

    validatePrerenderHtml({
      html,
      outFile,
      routePath: doc.routePath,
    });

    await fs.writeFile(outFile, html, "utf8");
  }

  // sitemap.xml
  if (cfg.sitemap.enabled) {
    const sitemapXml = generateSitemapXml(cfg, docs);
    const sitemapPath = path.join(outDirAbs, cfg.sitemap.path.replace(/^\//, ""));
    await fs.writeFile(sitemapPath, sitemapXml, "utf8");
  }

  // robots.txt
  if (cfg.robots.enabled) {
    const robotsTxt = generateRobotsTxt(cfg);
    const robotsPath = path.join(outDirAbs, cfg.robots.path.replace(/^\//, ""));
    await fs.writeFile(robotsPath, robotsTxt, "utf8");
  }

  // worker.js
  if (cfg.worker.enabled) {
    const workerJs = generateWorkerJs(cfg);
    await fs.writeFile(path.join(outDirAbs, "worker.js"), workerJs, "utf8");
  }

  console.log(`Built ${docs.length} pages into ${cfg.output.outDir}/`);
  console.log(
    `Output includes: ${cfg.sitemap.enabled ? "sitemap.xml " : ""}${cfg.robots.enabled ? "robots.txt " : ""}${cfg.worker.enabled ? "worker.js" : ""}`
  );
}
