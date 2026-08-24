import fs from "fs-extra";
import path from "node:path";
import { loadConfig } from "../../core/loadConfig.js";
import { validateOutputPath } from "../../core/outputPathSafety.js";
import {
  discoverCollectionFiles,
  parseMarkdownFile,
} from "../../core/markdownContent.js";
import type { DoctorCollector } from "../collector.js";
import type { DoctorPhaseContext } from "../context.js";
import {
  asRenderShieldError,
  hostnameFromUrl,
  isAbsoluteOrSiteRelativePath,
  parseHttpUrl,
} from "../helpers.js";
import type { MarkdownDoc } from "../../types.js";

export async function runConfigPhase(
  ctx: DoctorPhaseContext,
  collector: DoctorCollector
): Promise<void> {
  const configName = path.basename(ctx.configFile);
  const exists = await fs.pathExists(ctx.configFile);
  if (!exists) {
    collector.fail("config", "DOCTOR_CONFIG_MISSING", "config", `Missing ${configName}. Run: rendershield init`, {
      hint: "Run rendershield init to create a starter config and sample content.",
      details: { configPath: ctx.configFile, configFile: configName },
    });
    return;
  }

  try {
    const rawText = await fs.readFile(ctx.configFile, "utf8");
    const raw = JSON.parse(rawText) as Record<string, unknown>;
    const worker = raw.worker;
    if (
      worker &&
      typeof worker === "object" &&
      worker !== null &&
      "lovableOrigin" in worker &&
      typeof (worker as Record<string, unknown>).lovableOrigin === "string" &&
      (worker as Record<string, unknown>).lovableOrigin !== "" &&
      !("spaOrigin" in worker && typeof (worker as Record<string, unknown>).spaOrigin === "string" &&
        ((worker as Record<string, unknown>).spaOrigin as string).trim() !== "")
    ) {
      collector.warn(
        "config",
        "DOCTOR_CONFIG_DEPRECATED_FIELD",
        "config",
        "worker.lovableOrigin is deprecated; migrate to worker.spaOrigin",
        {
          hint: 'Replace "lovableOrigin" with "spaOrigin" in your config.',
          details: { field: "lovableOrigin", configPath: ctx.configFile },
        }
      );
    }
  } catch {
    // Invalid JSON handled by loadConfig below.
  }

  try {
    ctx.config = await loadConfig(ctx.cwd, { configPath: ctx.options.configPath });
    collector.pass("config", "DOCTOR_CONFIG_FOUND", "config", "Configuration loaded", {
      details: { configPath: ctx.configFile, configFile: configName },
    });
  } catch (err: unknown) {
    const rsErr = asRenderShieldError(err);
    if (rsErr?.code === "CONFIG_MISSING") {
      collector.fail("config", "DOCTOR_CONFIG_MISSING", "config", rsErr.message, {
        hint: "Run rendershield init to create a starter config and sample content.",
        details: { configPath: ctx.configFile, ...(rsErr.details ?? {}) },
      });
      return;
    }
    if (rsErr?.code === "CONFIG_INVALID") {
      collector.fail("config", "DOCTOR_CONFIG_INVALID", "config", rsErr.message, {
        details: { configPath: ctx.configFile, ...(rsErr.details ?? {}) },
      });
      return;
    }
    throw err;
  }
}

export async function runOutputPathPhase(
  ctx: DoctorPhaseContext,
  collector: DoctorCollector
): Promise<void> {
  if (!ctx.config) return;

  const outDir = ctx.config.output.outDir;
  try {
    await validateOutputPath(outDir, ctx.cwd);
    collector.pass("outputPath", "DOCTOR_OUTPUT_PATH_SAFE", "output", `Output path "${outDir}" is safe`, {
      details: { outDir, cwd: ctx.cwd },
    });
  } catch (err: unknown) {
    const rsErr = asRenderShieldError(err);
    if (rsErr?.code === "OUTPUT_PATH_UNSAFE") {
      collector.fail("outputPath", "DOCTOR_OUTPUT_PATH_UNSAFE", "output", rsErr.message, {
        hint: "Use a subdirectory inside the project (e.g. dist-prerender).",
        details: { outDir, cwd: ctx.cwd, ...(rsErr.details ?? {}) },
      });
      return;
    }
    throw err;
  }
}

export async function runContentInventoryPhase(
  ctx: DoctorPhaseContext,
  collector: DoctorCollector
): Promise<void> {
  if (!ctx.config) return;

  const baseDir = ctx.config.content.markdown.baseDir;
  const baseDirAbs = path.join(ctx.cwd, baseDir);

  if (!(await fs.pathExists(baseDirAbs))) {
    collector.fail(
      "contentInventory",
      "DOCTOR_CONTENT_BASEDIR_EXISTS",
      "content",
      `Markdown baseDir does not exist: ${baseDir}`,
      {
        hint: "Create the directory or update content.markdown.baseDir in config.",
        details: { baseDir, baseDirAbs },
      }
    );
    return;
  }

  collector.pass(
    "contentInventory",
    "DOCTOR_CONTENT_BASEDIR_EXISTS",
    "content",
    `Markdown baseDir exists: ${baseDir}`,
    { details: { baseDir, baseDirAbs } }
  );

  const docs: MarkdownDoc[] = [];
  let frontmatterFailures = 0;

  for (const col of ctx.config.content.markdown.collections) {
    const matches = await discoverCollectionFiles(baseDirAbs, col.pattern);

    if (matches.length === 0) {
      collector.warn(
        "contentInventory",
        "DOCTOR_CONTENT_COLLECTION_EMPTY",
        "content",
        `Collection "${col.name}" matched 0 files (pattern: ${col.pattern})`,
        {
          hint: "Add markdown files under the collection glob or adjust the pattern.",
          details: { collection: col.name, pattern: col.pattern, baseDir },
        }
      );
      continue;
    }

    collector.pass(
      "contentInventory",
      "DOCTOR_CONTENT_GLOB_MATCHES",
      "content",
      `Collection "${col.name}" matched ${matches.length} file(s)`,
      {
        details: {
          collection: col.name,
          pattern: col.pattern,
          fileCount: matches.length,
          files: matches.map((m: string) => path.join(baseDir, m)),
        },
      }
    );

    for (const rel of matches) {
      const abs = path.join(baseDirAbs, rel);
      try {
        docs.push(await parseMarkdownFile(abs, col.name, col.routeBase));
      } catch (err: unknown) {
        const rsErr = asRenderShieldError(err);
        if (rsErr?.code === "CONTENT_INVALID") {
          frontmatterFailures += 1;
          collector.fail(
            "contentInventory",
            "DOCTOR_CONTENT_FRONTMATTER",
            "content",
            rsErr.message,
            {
              hint: "Required frontmatter: title, excerpt, datePublished, coverImage, slug.",
              details: {
                sourcePath: abs,
                collection: col.name,
                ...(rsErr.details ?? {}),
              },
            }
          );
          continue;
        }
        throw err;
      }
    }
  }

  ctx.docs = docs.sort((a, b) => a.routePath.localeCompare(b.routePath));

  if (ctx.docs.length === 0) {
    collector.fail(
      "contentInventory",
      "DOCTOR_CONTENT_ZERO_DOCS",
      "content",
      "No valid markdown documents found across all collections",
      {
        hint: "Add content under content.markdown.baseDir or fix frontmatter errors.",
        details: { baseDir, frontmatterFailures },
      }
    );
  } else if (frontmatterFailures === 0) {
    collector.pass(
      "contentInventory",
      "DOCTOR_CONTENT_FRONTMATTER",
      "content",
      `All ${ctx.docs.length} markdown file(s) have valid frontmatter`,
      { details: { documentCount: ctx.docs.length } }
    );
  }
}

export async function runContentSemanticsPhase(
  ctx: DoctorPhaseContext,
  collector: DoctorCollector
): Promise<void> {
  if (!ctx.config) return;

  for (const col of ctx.config.content.markdown.collections) {
    const routeBase = col.routeBase;
    if (!routeBase.startsWith("/")) {
      collector.warn(
        "contentSemantics",
        "DOCTOR_ROUTE_BASE_FORMAT",
        "content",
        `Collection "${col.name}" routeBase should start with "/" (got "${routeBase}")`,
        {
          hint: 'Use a leading slash, e.g. "/blog".',
          details: { collection: col.name, routeBase },
        }
      );
    } else if (routeBase.length > 1 && routeBase.endsWith("/")) {
      collector.warn(
        "contentSemantics",
        "DOCTOR_ROUTE_BASE_FORMAT",
        "content",
        `Collection "${col.name}" routeBase has trailing slash (got "${routeBase}")`,
        {
          hint: 'Prefer "/blog" over "/blog/" for consistency.',
          details: { collection: col.name, routeBase },
        }
      );
    }
  }

  if (ctx.docs.length === 0) return;

  const byRoute = new Map<string, MarkdownDoc[]>();
  for (const doc of ctx.docs) {
    const list = byRoute.get(doc.routePath) ?? [];
    list.push(doc);
    byRoute.set(doc.routePath, list);
  }

  for (const [routePath, group] of byRoute) {
    if (group.length <= 1) continue;
    const sources = group.map((d) => d.sourcePath);
    collector.fail(
      "contentSemantics",
      "DOCTOR_ROUTE_DUPLICATE_SLUG",
      "content",
      `Duplicate route ${routePath} from ${group.length} source file(s)`,
      {
        hint: "Ensure slugs and route bases produce unique routes across collections.",
        details: { routePath, sources, slugs: group.map((d) => d.slug) },
      }
    );
    collector.fail(
      "contentSemantics",
      "DOCTOR_ROUTE_COLLISION",
      "content",
      `Route collision at ${routePath}`,
      {
        hint: "Change slug or routeBase so each document maps to a unique URL.",
        details: { routePath, sources },
      }
    );
  }

  if ([...byRoute.values()].every((g) => g.length === 1)) {
    collector.pass(
      "contentSemantics",
      "DOCTOR_ROUTE_DUPLICATE_SLUG",
      "content",
      "All document routes are unique",
      { details: { documentCount: ctx.docs.length } }
    );
  }
}

export async function runSiteOriginWorkerPhase(
  ctx: DoctorPhaseContext,
  collector: DoctorCollector
): Promise<void> {
  if (!ctx.config) return;

  const { site, worker } = ctx.config;
  const canonical = site.canonicalBase?.trim() ?? "";

  if (!canonical) {
    collector.fail(
      "siteOriginWorker",
      "DOCTOR_CANONICAL_BASE_SET",
      "config",
      "site.canonicalBase is required",
      { details: { field: "site.canonicalBase" } }
    );
  } else {
    const parsed = parseHttpUrl(canonical);
    if (!parsed) {
      collector.fail(
        "siteOriginWorker",
        "DOCTOR_CANONICAL_BASE_SET",
        "config",
        `site.canonicalBase is not a valid http(s) URL: "${canonical}"`,
        {
          hint: 'Use a full URL, e.g. "https://example.com".',
          details: { canonicalBase: canonical },
        }
      );
    } else {
      collector.pass(
        "siteOriginWorker",
        "DOCTOR_CANONICAL_BASE_SET",
        "config",
        `site.canonicalBase is set: ${canonical}`,
        { details: { canonicalBase: canonical, hostname: parsed.hostname } }
      );
      if (parsed.protocol !== "https:") {
        collector.warn(
          "siteOriginWorker",
          "DOCTOR_CANONICAL_BASE_HTTPS",
          "config",
          `site.canonicalBase uses ${parsed.protocol}; https is recommended`,
          {
            hint: "Use https:// for production canonical URLs when possible.",
            details: { canonicalBase: canonical, protocol: parsed.protocol },
          }
        );
      }
    }
  }

  if (!isAbsoluteOrSiteRelativePath(site.defaultOgImage)) {
    collector.warn(
      "siteOriginWorker",
      "DOCTOR_OG_IMAGE_ABSOLUTE",
      "config",
      `site.defaultOgImage should be an absolute URL or site-relative path (got "${site.defaultOgImage}")`,
      {
        hint: 'Use "https://example.com/og.jpg" or "/images/og.jpg".',
        details: { field: "site.defaultOgImage", value: site.defaultOgImage },
      }
    );
  }

  for (const doc of ctx.docs) {
    if (!isAbsoluteOrSiteRelativePath(doc.coverImage)) {
      collector.warn(
        "siteOriginWorker",
        "DOCTOR_OG_IMAGE_ABSOLUTE",
        "content",
        `coverImage in ${doc.sourcePath} should be an absolute URL or site-relative path`,
        {
          hint: 'Use "https://..." or "/images/...".',
          details: { sourcePath: doc.sourcePath, coverImage: doc.coverImage },
        }
      );
    }
  }

  if (!worker.enabled) {
    collector.pass(
      "siteOriginWorker",
      "DOCTOR_SPA_ORIGIN_SET",
      "worker",
      "Worker disabled; spaOrigin not required",
      { details: { workerEnabled: false } }
    );
    return;
  }

  const spaOrigin = worker.spaOrigin?.trim() ?? "";
  if (!spaOrigin) {
    collector.fail(
      "siteOriginWorker",
      "DOCTOR_SPA_ORIGIN_SET",
      "worker",
      "worker.spaOrigin is required when worker.enabled is true",
      {
        hint: 'Set worker.spaOrigin to your human SPA hosting origin, e.g. "https://app.example.com".',
        details: { workerEnabled: true },
      }
    );
  } else {
    const spaUrl = parseHttpUrl(spaOrigin);
    if (!spaUrl) {
      collector.fail(
        "siteOriginWorker",
        "DOCTOR_SPA_ORIGIN_SET",
        "worker",
        `worker.spaOrigin is not a valid http(s) URL: "${spaOrigin}"`,
        { details: { spaOrigin } }
      );
    } else {
      collector.pass(
        "siteOriginWorker",
        "DOCTOR_SPA_ORIGIN_SET",
        "worker",
        `worker.spaOrigin is set: ${spaOrigin}`,
        { details: { spaOrigin, hostname: spaUrl.hostname } }
      );

      const canonicalHost = hostnameFromUrl(canonical);
      if (canonicalHost && spaUrl.hostname !== canonicalHost) {
        collector.warn(
          "siteOriginWorker",
          "DOCTOR_ORIGIN_HOST_MISMATCH",
          "config",
          `site.canonicalBase host (${canonicalHost}) differs from worker.spaOrigin host (${spaUrl.hostname})`,
          {
            hint: "This is common when the SPA lives on a subdomain; verify both URLs are intentional.",
            details: {
              canonicalBase: canonical,
              canonicalHost,
              spaOrigin,
              spaOriginHost: spaUrl.hostname,
            },
          }
        );
      }
    }
  }
}
