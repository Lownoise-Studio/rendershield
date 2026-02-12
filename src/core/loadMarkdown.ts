import path from "node:path";
import fg from "fast-glob";
import fs from "fs-extra";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import { MarkdownDoc, RenderShieldConfig } from "../types.js";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

const REQUIRED_FIELDS = "title, excerpt, datePublished, coverImage, slug";

function requireString(value: any, field: string, file: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Missing required frontmatter field "${field}" in ${file}. Required fields: ${REQUIRED_FIELDS}`
    );
  }
  return value.trim();
}

function normalizeDate(value: any, file: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  throw new Error(`Invalid datePublished in ${file}. Use format YYYY-MM-DD.`);
}

export async function loadAllMarkdownDocs(cfg: RenderShieldConfig, cwd = process.cwd()): Promise<MarkdownDoc[]> {
  const baseDirAbs = path.join(cwd, cfg.content.markdown.baseDir);

  const out: MarkdownDoc[] = [];

  for (const col of cfg.content.markdown.collections) {
    const pattern = col.pattern;
    const matches = await fg(pattern, { cwd: baseDirAbs, onlyFiles: true });

    for (const rel of matches) {
      const abs = path.join(baseDirAbs, rel);
      const raw = await fs.readFile(abs, "utf8");
      const parsed = matter(raw);

      const title = requireString(parsed.data?.title, "title", abs);
      const excerpt = requireString(parsed.data?.excerpt, "excerpt", abs);

      const datePublishedRaw = parsed.data?.datePublished;
      if (datePublishedRaw === undefined || datePublishedRaw === null) {
        throw new Error(
          `Missing required frontmatter field "datePublished" in ${abs}. Required fields: ${REQUIRED_FIELDS}`
        );
      }
      const datePublished = normalizeDate(datePublishedRaw, abs);

      const coverImage = requireString(parsed.data?.coverImage, "coverImage", abs);
      const slug = requireString(parsed.data?.slug, "slug", abs);

      // Route: /blog/<slug>
      const routeBase = col.routeBase.endsWith("/") ? col.routeBase.slice(0, -1) : col.routeBase;
      const routePath = `${routeBase}/${slug}`;

      const htmlContent = md.render(parsed.content ?? "");

      out.push({
        sourcePath: abs,
        collection: col.name,
        routePath,
        title,
        excerpt,
        datePublished,
        coverImage,
        slug,
        htmlContent,
      });
    }
  }

  // Deterministic order
  out.sort((a, b) => a.routePath.localeCompare(b.routePath));
  return out;
}
