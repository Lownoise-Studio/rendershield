type ValidateParams = {
  html: string;
  outFile: string;
  routePath: string;
};

function hasNonEmptyTitle(html: string): boolean {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return false;
  const text = (m[1] ?? "").trim();
  return text.length > 0;
}

function getMetaContent(html: string, name: string): string | null {
  // matches: <meta name="description" content="...">
  const re = new RegExp(
    `<meta\\s+[^>]*name=["']${escapeRegExp(name)}["'][^>]*>`,
    "i"
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;

  const contentMatch = tag.match(/content=["']([^"']+)["']/i);
  return contentMatch?.[1]?.trim() ?? null;
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

function getOgContent(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta\\s+[^>]*property=["']${escapeRegExp(property)}["'][^>]*>`,
    "i"
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;

  const contentMatch = tag.match(/content=["']([^"']+)["']/i);
  return contentMatch?.[1]?.trim() ?? null;
}

function getJsonLd(html: string): string | null {
  const m = html.match(
    /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!m) return null;
  return (m[1] ?? "").trim();
}

function getArticleInnerHtml(html: string): string | null {
  const m = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (!m) return null;
  return (m[1] ?? "").trim();
}

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(s: string): number {
  if (!s.trim()) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validatePrerenderHtml(params: ValidateParams): void {
  const { html, outFile, routePath } = params;

  const missing: string[] = [];

  // 1) Title
  if (!hasNonEmptyTitle(html)) missing.push("Missing or empty <title>");

  // 2) Meta description
  const desc = getMetaContent(html, "description");
  if (!desc) missing.push('Missing <meta name="description" content="...">');

  // 3) Canonical
  const canonical = getLinkHref(html, "canonical");
  if (!canonical) missing.push('Missing <link rel="canonical" href="...">');

  // 4) Open Graph tags
  const ogTitle = getOgContent(html, "og:title");
  const ogDesc = getOgContent(html, "og:description");
  const ogImg = getOgContent(html, "og:image");
  const ogUrl = getOgContent(html, "og:url");

  if (!ogTitle) missing.push("Missing Open Graph tag: og:title");
  if (!ogDesc) missing.push("Missing Open Graph tag: og:description");
  if (!ogImg) missing.push("Missing Open Graph tag: og:image");
  if (!ogUrl) missing.push("Missing Open Graph tag: og:url");

  // 5) JSON-LD
  const jsonLd = getJsonLd(html);
  if (!jsonLd) {
    missing.push('Missing JSON-LD: <script type="application/ld+json">...</script>');
  } else if (jsonLd.length <= 20) {
    missing.push("JSON-LD script present but too short/empty");
  }

  // 6) Article content
  const articleInner = getArticleInnerHtml(html);
  if (!articleInner) {
    missing.push("Missing <article>...</article>");
  } else {
    const text = stripTags(articleInner);
    const words = wordCount(text);

    // Require either enough characters or enough words
    const okByChars = text.length >= 80;
    const okByWords = words >= 20;

    if (!okByChars && !okByWords) {
      missing.push(
        `Article content too short (got ${words} words, ${text.length} chars). Require >= 20 words or >= 80 chars.`
      );
    }
  }

  if (missing.length > 0) {
    const msg =
      `RenderShield validation failed for prerendered page:\n` +
      `- routePath: ${routePath}\n` +
      `- outFile: ${outFile}\n` +
      `Missing/invalid requirements:\n` +
      missing.map((m) => `- ${m}`).join("\n") +
      `\n\nFix the source content or renderer so bots receive complete HTML.`;

    throw new Error(msg);
  }
}
