import { MarkdownDoc, RenderShieldConfig } from "../types.js";

function joinUrl(base: string, pathname: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return b + p;
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function generateSitemapXml(cfg: RenderShieldConfig, docs: MarkdownDoc[]): string {
  const urls = docs.map((d) => ({
    loc: joinUrl(cfg.site.canonicalBase, d.routePath),
    lastmod: d.datePublished,
  }));

  const items = urls
    .map(
      (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${escapeXml(u.lastmod)}</lastmod>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>
`;
}
