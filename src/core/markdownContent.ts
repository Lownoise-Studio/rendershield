import path from "node:path";
import fg from "fast-glob";
import fs from "fs-extra";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import type { MarkdownDoc } from "../types.js";
import { renderShieldError } from "../errors.js";
import {
  validateContentRoutePath,
  validateRouteSlug,
} from "./routePathSafety.js";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

const REQUIRED_FIELDS = "title, excerpt, datePublished, coverImage, slug";

function requireString(value: unknown, field: string, file: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw renderShieldError(
      "CONTENT_INVALID",
      `Missing required frontmatter field "${field}" in ${file}. Required fields: ${REQUIRED_FIELDS}`
    );
  }
  return value.trim();
}

function normalizeDate(value: unknown, file: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  throw renderShieldError(
    "CONTENT_INVALID",
    `Invalid datePublished in ${file}. Use format YYYY-MM-DD.`
  );
}

/** Discover Markdown source files for a collection glob under baseDir. */
export async function discoverCollectionFiles(
  baseDirAbs: string,
  pattern: string
): Promise<string[]> {
  return fg(pattern, { cwd: baseDirAbs, onlyFiles: true });
}

/** Build routePath from collection routeBase and document slug. */
export function buildRoutePath(routeBase: string, slug: string): string {
  const base = routeBase.endsWith("/") ? routeBase.slice(0, -1) : routeBase;
  return `${base}/${slug}`;
}

/** Parse one Markdown file: frontmatter validation, route construction, HTML rendering. */
export async function parseMarkdownFile(
  absPath: string,
  collection: string,
  routeBase: string
): Promise<MarkdownDoc> {
  const raw = await fs.readFile(absPath, "utf8");
  const parsed = matter(raw);

  const title = requireString(parsed.data?.title, "title", absPath);
  const excerpt = requireString(parsed.data?.excerpt, "excerpt", absPath);

  const datePublishedRaw = parsed.data?.datePublished;
  if (datePublishedRaw === undefined || datePublishedRaw === null) {
    throw renderShieldError(
      "CONTENT_INVALID",
      `Missing required frontmatter field "datePublished" in ${absPath}. Required fields: ${REQUIRED_FIELDS}`
    );
  }
  const datePublished = normalizeDate(datePublishedRaw, absPath);

  const coverImage = requireString(parsed.data?.coverImage, "coverImage", absPath);
  const slug = validateRouteSlug(
    requireString(parsed.data?.slug, "slug", absPath),
    absPath
  );
  const routePath = validateContentRoutePath(
    buildRoutePath(routeBase, slug),
    `routePath for ${absPath}`
  );
  const htmlContent = md.render(parsed.content ?? "");

  return {
    sourcePath: absPath,
    collection,
    routePath,
    title,
    excerpt,
    datePublished,
    coverImage,
    slug,
    htmlContent,
  };
}
