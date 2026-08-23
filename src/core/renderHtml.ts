import { MarkdownDoc, RenderShieldConfig, SchemaType } from "../types.js";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function joinUrl(base: string, pathname: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return b + p;
}

function resolveSchemaType(cfg: RenderShieldConfig, doc: MarkdownDoc): SchemaType {
  const collection = cfg.content.markdown.collections.find((c) => c.name === doc.collection);
  return collection?.schemaType ?? "Article";
}

function buildJsonLd(
  schemaType: SchemaType,
  cfg: RenderShieldConfig,
  doc: MarkdownDoc,
  canonicalUrl: string,
  ogImageUrl: string
): Record<string, unknown> {
  const base = {
    "@context": "https://schema.org",
    "@type": schemaType,
    mainEntityOfPage: canonicalUrl,
    image: ogImageUrl,
  };

  if (schemaType === "WebPage") {
    return { ...base, name: doc.title };
  }

  return {
    ...base,
    headline: doc.title,
    author: { "@type": "Person", name: cfg.site.authorName },
    datePublished: doc.datePublished,
  };
}

export function renderPageHtml(cfg: RenderShieldConfig, doc: MarkdownDoc): string {
  const canonicalUrl = joinUrl(cfg.site.canonicalBase, doc.routePath);
  const ogImageUrl = doc.coverImage.startsWith("http")
    ? doc.coverImage
    : joinUrl(cfg.site.canonicalBase, doc.coverImage);

  const title = `${doc.title} - ${cfg.site.siteName}`;
  const description = doc.excerpt;
  const schemaType = resolveSchemaType(cfg, doc);
  const ogType = schemaType === "WebPage" ? "website" : "article";
  const jsonLd = buildJsonLd(schemaType, cfg, doc, canonicalUrl, ogImageUrl);

  // NOTE: doc.htmlContent is already HTML from markdown-it.
  // We trust it as generated output, not user-injected raw HTML (markdown-it html:false).
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">

  <meta property="og:type" content="${ogType}">
  <meta property="og:title" content="${escapeHtml(doc.title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(ogImageUrl)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(doc.title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">

  <script type="application/ld+json">${((): string => {
    const raw = JSON.stringify(jsonLd);
    // Case-insensitive: </script> and </SCRIPT> etc. must not break out of the tag
    return raw.replace(/<\/script>/gi, "<\\/script>");
  })()}</script>
</head>
<body>
  <main>
    <article>
      <header>
        <h1>${escapeHtml(doc.title)}</h1>
        <p><time datetime="${escapeHtml(doc.datePublished)}">${escapeHtml(doc.datePublished)}</time></p>
      </header>
      ${doc.htmlContent}
    </article>
  </main>
</body>
</html>`;

  return cfg.output.prettyHtml ? html : html.replace(/\s+/g, " ");
}
