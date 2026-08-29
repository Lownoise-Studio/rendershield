import fs from "fs-extra";
import path from "node:path";
import { loadConfig } from "../core/loadConfig.js";
import { loadAllMarkdownDocs } from "../core/loadMarkdown.js";
import { renderPageHtml } from "../core/renderHtml.js";
import { generateSitemapXml } from "../core/generateSitemap.js";
import { generateRobotsTxt } from "../core/generateRobots.js";
import { generateWorkerJs } from "../core/generateWorker.js";
import { validatePrerenderHtml } from "../core/validateOutput.js";
import { validateOutputPath } from "../core/outputPathSafety.js";
import { resolveArtifactPathInOutDir } from "../core/artifactPathSafety.js";
import { resolveRoutePageDirInOutDir } from "../core/routePathSafety.js";
import { renderShieldError } from "../errors.js";
import type { CommandOptions } from "../configPath.js";

export async function cmdBuild(cwd = process.cwd(), options?: CommandOptions) {
  const cfg = await loadConfig(cwd, options);

  // Validate output path before any destructive operations
  await validateOutputPath(cfg.output.outDir, cwd);

  const outDirAbs = path.join(cwd, cfg.output.outDir);

  // Clean output (boring + deterministic)
  await fs.remove(outDirAbs);
  await fs.ensureDir(outDirAbs);

  const docs = await loadAllMarkdownDocs(cfg, cwd);

  if (docs.length === 0) {
    throw renderShieldError(
      "BUILD_FAILED",
      "No markdown documents found. Check content paths/patterns."
    );
  }

  // Generate pages (containment enforced at write boundary; validate BEFORE writing)
  for (const doc of docs) {
    const pageDir = resolveRoutePageDirInOutDir(outDirAbs, doc.routePath);
    await fs.ensureDir(pageDir);

    const outFile = path.join(pageDir, "index.html");
    const html = renderPageHtml(cfg, doc);

    validatePrerenderHtml({
      html,
      outFile,
      routePath: doc.routePath,
      sourcePath: doc.sourcePath,
    });

    await fs.writeFile(outFile, html, "utf8");
  }

  // sitemap.xml
  if (cfg.sitemap.enabled) {
    const sitemapXml = generateSitemapXml(cfg, docs);
    const sitemapPath = await resolveArtifactPathInOutDir(
      outDirAbs,
      cfg.sitemap.path,
      "sitemap.path"
    );
    await fs.ensureDir(path.dirname(sitemapPath));
    await fs.writeFile(sitemapPath, sitemapXml, "utf8");
  }

  // robots.txt
  if (cfg.robots.enabled) {
    const robotsTxt = generateRobotsTxt(cfg);
    const robotsPath = await resolveArtifactPathInOutDir(
      outDirAbs,
      cfg.robots.path,
      "robots.path"
    );
    await fs.ensureDir(path.dirname(robotsPath));
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
