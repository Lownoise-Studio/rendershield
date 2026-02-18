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

/**
 * Validates output path before any destructive operation (fs.remove).
 * Pass: outDir is a subdirectory inside project root; no symlink escape.
 * Fail: "/", "C:\", "..", "../", or outDir (or any of its existing parents) resolving outside project.
 * Policy: strict — build hard-fails before any delete attempt.
 * Segment-safe: uses path.relative(root, out) only; no prefix startsWith.
 */
async function validateOutputPath(outDir: string, cwd: string): Promise<void> {
  const cwdAbs = path.resolve(cwd);
  let cwdReal: string;
  try {
    cwdReal = await fs.realpath(cwdAbs);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot resolve project root: ${cwdAbs}. ${msg}`);
  }

  const outDirAbs = path.resolve(cwdAbs, outDir);
  // Order: realpath → normalize → then case-fold for comparisons
  const normalizedCwd = path.normalize(cwdReal);
  const normalizedOut = path.normalize(outDirAbs);

  // Segment-safe: use path.relative only (no prefix startsWith on full path). Cross-platform: relative()
  // rarely returns absolute on Windows; startsWith("..") and path.isAbsolute(rel) cover escapes.
  const relative = path.relative(normalizedCwd, normalizedOut);
  if (relative.startsWith("..") || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(
      `Output directory "${outDir}" resolves outside project root. Use a relative path within the project.`
    );
  }

  // Reject: root filesystem (/, C:\, C:/) — early reject; real safety is "inside root" above
  const rootPaths = ["/", "c:\\", "c:/"];
  const outLower = normalizedOut.toLowerCase();
  if (rootPaths.includes(outLower)) {
    throw new Error(
      `Output directory "${outDir}" resolves to root filesystem. This is not allowed for safety.`
    );
  }

  // Reject: output dir equals project root (would delete entire project). Case-fold after normalize.
  const cwdLower = normalizedCwd.toLowerCase();
  if (outLower === cwdLower) {
    throw new Error(
      `Output directory "${outDir}" cannot be the project root. Use a subdirectory (e.g. dist-prerender).`
    );
  }

  if (await fs.pathExists(outDirAbs)) {
    // Path exists: resolve symlinks and ensure real path is inside root
    let outDirReal: string;
    try {
      outDirReal = await fs.realpath(outDirAbs);
    } catch {
      outDirReal = outDirAbs;
    }
    const outDirRealNorm = path.normalize(outDirReal);
    const relativeReal = path.relative(normalizedCwd, outDirRealNorm);
    if (relativeReal.startsWith("..") || relativeReal === ".." || path.isAbsolute(relativeReal)) {
      throw new Error(
        `Output directory "${outDir}" resolves (via symlink) outside project root. Use a path that does not escape the project.`
      );
    }
  } else {
    // Path does not exist: walk up to nearest existing parent, realpath it, ensure it stays inside root.
    // Guards e.g. outDir "dist-link/prerender-new" where dist-link is a symlink to /.
    // If we never find an existing parent (or the only one is root), we must reject — do not treat as "fine."
    let current = normalizedOut;
    const rootDir = path.normalize(path.parse(normalizedCwd).root);
    let foundParentInsideRoot = false;
    while (current) {
      if (await fs.pathExists(current)) {
        let parentReal: string;
        try {
          parentReal = await fs.realpath(current);
        } catch {
          parentReal = current;
        }
        const parentRealNorm = path.normalize(parentReal);
        // Nearest existing parent is filesystem root → outside project, reject
        const parentLower = parentRealNorm.toLowerCase();
        if (rootPaths.includes(parentLower)) {
          throw new Error(
            `Output directory "${outDir}" has a parent that resolves to filesystem root. Use a path inside the project.`
          );
        }
        const relParent = path.relative(normalizedCwd, parentRealNorm);
        if (relParent.startsWith("..") || relParent === ".." || path.isAbsolute(relParent)) {
          throw new Error(
            `Output directory "${outDir}" has a parent that resolves (via symlink) outside project root. Use a path that does not escape the project.`
          );
        }
        foundParentInsideRoot = true;
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (!foundParentInsideRoot) {
      // No existing parent found before hitting dirname loop stop (shouldn't happen on a normal FS)
      throw new Error(
        `Output directory "${outDir}" could not be validated: no existing parent path found. Use a path inside the project.`
      );
    }
  }
}

export async function cmdBuild(cwd = process.cwd()) {
  const cfg = await loadConfig(cwd);

  // Validate output path before any destructive operations
  await validateOutputPath(cfg.output.outDir, cwd);

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
      sourcePath: doc.sourcePath,
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
