import fs from "fs-extra";
import path from "node:path";
import { resolveArtifactPathInOutDir } from "../../core/artifactPathSafety.js";
import { validateOutputPath } from "../../core/outputPathSafety.js";
import {
  indexHtmlPathToRoute,
  listPrerenderIndexFiles,
} from "../../core/listOutputRoutes.js";
import { checkPrerenderContract } from "../../core/validateOutput.js";
import { generateSitemapXml } from "../../core/generateSitemap.js";
import { generateRobotsTxt } from "../../core/generateRobots.js";
import { generateWorkerJs } from "../../core/generateWorker.js";
import type { MarkdownDoc, RenderShieldConfig, SchemaType } from "../../types.js";
import type { DoctorCollector } from "../collector.js";
import type { DoctorPhaseContext } from "../context.js";
import { asRenderShieldError, joinUrl } from "../helpers.js";

function canRunOutputPhases(ctx: DoctorPhaseContext): boolean {
  return Boolean(ctx.config && ctx.docs.length > 0);
}

async function resolveSafeOutDirAbs(ctx: DoctorPhaseContext): Promise<string | null> {
  if (!ctx.config) return null;
  try {
    await validateOutputPath(ctx.config.output.outDir, ctx.cwd);
  } catch (err: unknown) {
    const rsErr = asRenderShieldError(err);
    if (rsErr?.code === "OUTPUT_PATH_UNSAFE") return null;
    throw err;
  }
  return path.join(ctx.cwd, ctx.config.output.outDir);
}

function routeToIndexHtmlPath(outDirAbs: string, routePath: string): string {
  const clean = routePath.replace(/^\//, "");
  return path.join(outDirAbs, clean, "index.html");
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function resolveSchemaType(cfg: RenderShieldConfig, doc: MarkdownDoc): SchemaType {
  const collection = cfg.content.markdown.collections.find((c) => c.name === doc.collection);
  return collection?.schemaType ?? "Article";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getLinkHref(html: string, rel: string): string | null {
  const re = new RegExp(
    `<link\\s+[^>]*rel=["']${escapeRegExp(rel)}["'][^>]*>`,
    "i"
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
  return hrefMatch?.[1]?.trim() ?? null;
}

function getPrimaryJsonLdType(html: string): string | null {
  const re =
    /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i;
  const match = html.match(re);
  if (!match?.[1]) return null;

  try {
    const parsed = JSON.parse(match[1].trim()) as Record<string, unknown>;
    const typeValue = parsed["@type"];
    if (typeof typeValue === "string") return typeValue;
    if (Array.isArray(typeValue)) {
      const first = typeValue.find((item) => typeof item === "string");
      return typeof first === "string" ? first : null;
    }
    return null;
  } catch {
    return null;
  }
}

function isRouteCoveredByWorker(routePath: string, rewriteRouteBases: string[]): boolean {
  return rewriteRouteBases.some((base) => routePath.startsWith(base));
}

export async function runOutputPresencePhase(
  ctx: DoctorPhaseContext,
  collector: DoctorCollector
): Promise<void> {
  if (!canRunOutputPhases(ctx) || !ctx.config) return;

  const outDirAbs = await resolveSafeOutDirAbs(ctx);
  if (!outDirAbs) return;

  const outDir = ctx.config.output.outDir;
  const exists = await fs.pathExists(outDirAbs);
  if (!exists) {
    collector.warn(
      "outputPresence",
      "DOCTOR_OUTPUT_MISSING",
      "output",
      `Output directory "${outDir}" not found`,
      {
        hint: "Run rendershield build to generate prerendered pages.",
        details: { outDir, outDirAbs },
      }
    );
    return;
  }

  ctx.outDirAbs = outDirAbs;

  collector.pass(
    "outputPresence",
    "DOCTOR_OUTPUT_DIR_EXISTS",
    "output",
    `Output directory exists: ${outDir}`,
    { details: { outDir, outDirAbs } }
  );

  const indexFiles = await listPrerenderIndexFiles(outDirAbs);
  const builtRoutes = indexFiles
    .map((filePath) => indexHtmlPathToRoute(outDirAbs, filePath))
    .sort((a, b) => a.localeCompare(b));
  const expectedRoutes = ctx.docs.map((doc) => doc.routePath).sort((a, b) => a.localeCompare(b));

  const builtSet = new Set(builtRoutes);
  const expectedSet = new Set(expectedRoutes);
  const missingRoutes = expectedRoutes.filter((routePath) => !builtSet.has(routePath));
  const orphanRoutes = builtRoutes.filter((routePath) => !expectedSet.has(routePath));

  for (const routePath of missingRoutes) {
    collector.fail(
      "outputPresence",
      "DOCTOR_OUTPUT_ROUTE_MISSING",
      "output",
      `Missing built page for route ${routePath}`,
      {
        hint: "Run rendershield build or check that the route was generated.",
        details: {
          routePath,
          expectedIndexHtml: routeToIndexHtmlPath(outDirAbs, routePath),
        },
      }
    );
  }

  for (const routePath of orphanRoutes) {
    collector.warn(
      "outputPresence",
      "DOCTOR_OUTPUT_ORPHAN",
      "output",
      `Unexpected built page for route ${routePath}`,
      {
        hint: "Remove stale output or add matching markdown source content.",
        details: { routePath },
      }
    );
  }

  if (missingRoutes.length === 0 && expectedRoutes.length > 0) {
    collector.pass(
      "outputPresence",
      "DOCTOR_OUTPUT_PAGE_COUNT",
      "output",
      `${expectedRoutes.length} expected route(s) present in output`,
      {
        details: {
          expectedCount: expectedRoutes.length,
          builtCount: builtRoutes.length,
          orphanCount: orphanRoutes.length,
          routes: expectedRoutes,
        },
      }
    );
  }
}

export async function runFreshnessPhase(
  ctx: DoctorPhaseContext,
  collector: DoctorCollector
): Promise<void> {
  if (!canRunOutputPhases(ctx) || !ctx.config || !ctx.outDirAbs) return;

  const staleRoutes: string[] = [];
  const currentRoutes: string[] = [];

  for (const doc of ctx.docs) {
    const htmlPath = routeToIndexHtmlPath(ctx.outDirAbs, doc.routePath);
    if (!(await fs.pathExists(htmlPath))) continue;

    const sourceStat = await fs.stat(doc.sourcePath);
    const htmlStat = await fs.stat(htmlPath);

    if (sourceStat.mtimeMs > htmlStat.mtimeMs) {
      staleRoutes.push(doc.routePath);
      collector.warn(
        "freshness",
        "DOCTOR_FRESHNESS_STALE",
        "output",
        `${doc.routePath}: source mtime newer than built HTML (best-effort)`,
        {
          hint: "Run rendershield build to refresh stale pages. Mtime comparison is best-effort, not proof of freshness.",
          details: {
            routePath: doc.routePath,
            sourcePath: doc.sourcePath,
            htmlPath,
            sourceMtime: sourceStat.mtime.toISOString(),
            htmlMtime: htmlStat.mtime.toISOString(),
            method: "mtime-best-effort",
          },
        }
      );
    } else {
      currentRoutes.push(doc.routePath);
    }
  }

  if (currentRoutes.length > 0) {
    collector.pass(
      "freshness",
      "DOCTOR_FRESHNESS_CURRENT",
      "output",
      `${currentRoutes.length} built page(s) current by mtime (best-effort)`,
      {
        details: {
          routes: currentRoutes.sort((a, b) => a.localeCompare(b)),
          staleCount: staleRoutes.length,
          method: "mtime-best-effort",
        },
      }
    );
  }
}

export async function runContractPhase(
  ctx: DoctorPhaseContext,
  collector: DoctorCollector
): Promise<void> {
  if (!canRunOutputPhases(ctx) || !ctx.config || !ctx.outDirAbs) return;

  for (const doc of ctx.docs) {
    const htmlPath = routeToIndexHtmlPath(ctx.outDirAbs, doc.routePath);
    if (!(await fs.pathExists(htmlPath))) continue;

    const html = await fs.readFile(htmlPath, "utf8");
    const contract = checkPrerenderContract(html, {
      routePath: doc.routePath,
      outFile: htmlPath,
      sourcePath: doc.sourcePath,
    });

    let routeFailed = false;

    if (!contract.ok) {
      routeFailed = true;
      collector.fail(
        "contract",
        "DOCTOR_CONTRACT_FAIL",
        "contract",
        `Crawler HTML contract failed for ${doc.routePath}`,
        {
          hint: "Fix source frontmatter or rebuild so bots receive complete HTML.",
          details: {
            routePath: doc.routePath,
            sourcePath: doc.sourcePath,
            htmlPath,
            missing: contract.missing,
          },
        }
      );
    }

    const expectedCanonical = joinUrl(ctx.config.site.canonicalBase, doc.routePath);
    const actualCanonical = getLinkHref(html, "canonical");
    if (actualCanonical !== expectedCanonical) {
      routeFailed = true;
      collector.fail(
        "contract",
        "DOCTOR_CANONICAL_HREF_MISMATCH",
        "contract",
        `Canonical href mismatch for ${doc.routePath}`,
        {
          hint: "Ensure canonical links use site.canonicalBase + routePath.",
          details: {
            routePath: doc.routePath,
            expectedCanonical,
            actualCanonical,
          },
        }
      );
    }

    const expectedSchemaType = resolveSchemaType(ctx.config, doc);
    const actualSchemaType = getPrimaryJsonLdType(html);
    if (actualSchemaType !== expectedSchemaType) {
      routeFailed = true;
      collector.fail(
        "contract",
        "DOCTOR_JSONLD_TYPE_MISMATCH",
        "contract",
        `JSON-LD @type mismatch for ${doc.routePath}`,
        {
          hint: "Ensure collection schemaType matches generated JSON-LD @type.",
          details: {
            routePath: doc.routePath,
            collection: doc.collection,
            expectedSchemaType,
            actualSchemaType,
          },
        }
      );
    }

    if (!routeFailed) {
      collector.pass(
        "contract",
        "DOCTOR_CONTRACT_PASS",
        "contract",
        `Crawler HTML contract passed for ${doc.routePath}`,
        {
          details: {
            routePath: doc.routePath,
            sourcePath: doc.sourcePath,
            htmlPath,
            schemaType: expectedSchemaType,
          },
        }
      );
    }
  }
}

export async function runSitemapRobotsPhase(
  ctx: DoctorPhaseContext,
  collector: DoctorCollector
): Promise<void> {
  if (!canRunOutputPhases(ctx) || !ctx.config || !ctx.outDirAbs) return;

  const cfg = ctx.config;

  if (cfg.sitemap.enabled) {
    collector.pass(
      "sitemapRobots",
      "DOCTOR_SITEMAP_CONFIG_PATH",
      "artifacts",
      `Sitemap enabled at ${cfg.sitemap.path}`,
      { details: { path: cfg.sitemap.path } }
    );

    const sitemapPath = await resolveArtifactPathInOutDir(
      ctx.outDirAbs,
      cfg.sitemap.path,
      "sitemap.path"
    );
    if (!(await fs.pathExists(sitemapPath))) {
      collector.fail(
        "sitemapRobots",
        "DOCTOR_ARTIFACT_SITEMAP_MISSING",
        "artifacts",
        `Missing sitemap artifact at ${cfg.sitemap.path}`,
        {
          hint: "Run rendershield build with sitemap.enabled true.",
          details: { path: cfg.sitemap.path, filePath: sitemapPath },
        }
      );
    } else {
      const expected = generateSitemapXml(cfg, ctx.docs);
      const actual = await fs.readFile(sitemapPath, "utf8");
      if (normalizeText(actual) !== normalizeText(expected)) {
        collector.fail(
          "sitemapRobots",
          "DOCTOR_SITEMAP_URL_SET",
          "artifacts",
          "Built sitemap.xml does not match expected URLs",
          {
            hint: "Rebuild output or fix sitemap configuration.",
            details: { path: cfg.sitemap.path, filePath: sitemapPath },
          }
        );
      } else {
        collector.pass(
          "sitemapRobots",
          "DOCTOR_SITEMAP_URL_SET",
          "artifacts",
          "Sitemap URLs match expected routes",
          {
            details: {
              path: cfg.sitemap.path,
              urlCount: ctx.docs.length,
              routes: ctx.docs.map((doc) => doc.routePath).sort((a, b) => a.localeCompare(b)),
            },
          }
        );
      }
    }
  }

  if (cfg.robots.enabled) {
    const robotsPath = await resolveArtifactPathInOutDir(
      ctx.outDirAbs,
      cfg.robots.path,
      "robots.path"
    );
    const expectedRobots = generateRobotsTxt(cfg);

    if (!(await fs.pathExists(robotsPath))) {
      collector.fail(
        "sitemapRobots",
        "DOCTOR_ARTIFACT_ROBOTS_MISSING",
        "artifacts",
        `Missing robots artifact at ${cfg.robots.path}`,
        {
          hint: "Run rendershield build with robots.enabled true.",
          details: { path: cfg.robots.path, filePath: robotsPath },
        }
      );
    } else {
      const actualRobots = await fs.readFile(robotsPath, "utf8");

      if (cfg.sitemap.enabled) {
        const expectedSitemapLine = `Sitemap: ${joinUrl(
          cfg.site.canonicalBase.replace(/\/$/, ""),
          cfg.sitemap.path
        )}`;
        if (!actualRobots.includes(expectedSitemapLine)) {
          collector.fail(
            "sitemapRobots",
            "DOCTOR_ROBOTS_SITEMAP_LINE",
            "artifacts",
            "robots.txt missing expected Sitemap line",
            {
              hint: "Rebuild robots.txt or ensure sitemap.enabled matches config.",
              details: { expectedSitemapLine, path: cfg.robots.path },
            }
          );
        } else {
          collector.pass(
            "sitemapRobots",
            "DOCTOR_ROBOTS_SITEMAP_LINE",
            "artifacts",
            "robots.txt includes expected Sitemap line",
            { details: { expectedSitemapLine, path: cfg.robots.path } }
          );
        }
      }

      if (normalizeText(actualRobots) !== normalizeText(expectedRobots)) {
        collector.fail(
          "sitemapRobots",
          "DOCTOR_ROBOTS_EXPECTED",
          "artifacts",
          "Built robots.txt does not match expected content",
          {
            hint: "Rebuild output or fix robots configuration.",
            details: { path: cfg.robots.path, filePath: robotsPath },
          }
        );
      } else {
        collector.pass(
          "sitemapRobots",
          "DOCTOR_ROBOTS_EXPECTED",
          "artifacts",
          "robots.txt matches expected content",
          { details: { path: cfg.robots.path } }
        );
      }
    }
  }
}

export async function runWorkerPhase(
  ctx: DoctorPhaseContext,
  collector: DoctorCollector
): Promise<void> {
  if (!canRunOutputPhases(ctx) || !ctx.config || !ctx.outDirAbs) return;

  const cfg = ctx.config;
  if (!cfg.worker.enabled) {
    collector.pass(
      "worker",
      "DOCTOR_WORKER_DISABLED",
      "worker",
      "Worker generation disabled in config",
      { details: { workerEnabled: false } }
    );
    return;
  }

  const workerPath = path.join(ctx.outDirAbs, "worker.js");
  if (!(await fs.pathExists(workerPath))) {
    collector.fail(
      "worker",
      "DOCTOR_ARTIFACT_WORKER_MISSING",
      "worker",
      "Missing worker.js in output directory",
      {
        hint: "Run rendershield build with worker.enabled true.",
        details: { filePath: workerPath },
      }
    );
  } else {
    collector.pass(
      "worker",
      "DOCTOR_WORKER_FILE_PRESENT",
      "worker",
      "worker.js present in output",
      { details: { filePath: workerPath } }
    );

    const expectedWorker = generateWorkerJs(cfg);
    const actualWorker = await fs.readFile(workerPath, "utf8");
    if (normalizeText(actualWorker) !== normalizeText(expectedWorker)) {
      collector.fail(
        "worker",
        "DOCTOR_WORKER_GENERATED",
        "worker",
        "Built worker.js does not match generated content",
        {
          hint: "Rebuild output after changing worker configuration.",
          details: { filePath: workerPath },
        }
      );
    } else {
      collector.pass(
        "worker",
        "DOCTOR_WORKER_GENERATED",
        "worker",
        "worker.js matches generated content",
        { details: { filePath: workerPath } }
      );
    }
  }

  const uniqueRoutes = [...new Set(ctx.docs.map((doc) => doc.routePath))].sort((a, b) =>
    a.localeCompare(b)
  );
  const uncoveredRoutes = uniqueRoutes.filter(
    (routePath) => !isRouteCoveredByWorker(routePath, cfg.worker.rewriteRouteBases)
  );

  for (const routePath of uncoveredRoutes) {
    collector.fail(
      "worker",
      "DOCTOR_WORKER_REWRITE_COVERAGE",
      "worker",
      `Route ${routePath} not covered by worker.rewriteRouteBases`,
      {
        hint: 'Add a rewrite base prefix (e.g. "/blog/") that matches this route.',
        details: {
          routePath,
          rewriteRouteBases: cfg.worker.rewriteRouteBases,
        },
      }
    );
  }

  if (uncoveredRoutes.length === 0 && uniqueRoutes.length > 0) {
    collector.pass(
      "worker",
      "DOCTOR_WORKER_REWRITE_COVERAGE",
      "worker",
      "All routes covered by worker rewrite bases",
      {
        details: {
          routeCount: uniqueRoutes.length,
          rewriteRouteBases: cfg.worker.rewriteRouteBases,
          routes: uniqueRoutes,
        },
      }
    );
  }
}
