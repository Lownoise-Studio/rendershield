import { RenderShieldConfig } from "../types.js";

export function generateRobotsTxt(cfg: RenderShieldConfig): string {
  const sitemapUrl = cfg.sitemap.enabled
    ? `${cfg.site.canonicalBase.replace(/\/$/, "")}${cfg.sitemap.path}`
    : "";

  const lines = [
    "User-agent: *",
    "Allow: /",
  ];

  if (sitemapUrl) {
    lines.push(`Sitemap: ${sitemapUrl}`);
  }

  return lines.join("\n") + "\n";
}
