export type ValidateParams = {
  html: string;
  outFile: string;
  routePath: string;
  /** Source markdown file path; included in error context when provided */
  sourcePath?: string;
  /**
   * Allowed JSON-LD @type values. Default allows Article, BlogPosting, WebPage.
   * Add types (e.g. FAQPage, Organization) if your renderer emits them.
   */
  allowedJsonLdTypes?: string[];
};

const DEFAULT_ALLOWED_JSON_LD_TYPES = ["Article", "BlogPosting", "WebPage"];

function hasNonEmptyTitle(html: string): boolean {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return false;
  const text = (m[1] ?? "").trim();
  return text.length > 0;
}

function getMetaContent(html: string, name: string): string | null {
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

/** Returns all JSON-LD script tag contents (order preserved). Many pages emit multiple: WebPage, BreadcrumbList, Organization, etc. */
function getAllJsonLdScripts(html: string): string[] {
  const re = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const content = (m[1] ?? "").trim();
    if (content.length > 0) out.push(content);
  }
  return out;
}

/** Normalize @type: schema.org allows string or array of strings. Return array of lowercase types. */
function normalizeJsonLdTypes(typeValue: unknown): string[] {
  if (typeValue == null) return [];
  if (typeof typeValue === "string") return [typeValue.toLowerCase().trim()].filter(Boolean);
  if (Array.isArray(typeValue)) {
    return typeValue
      .filter((t) => typeof t === "string")
      .map((t) => (t as string).toLowerCase().trim())
      .filter(Boolean);
  }
  return [];
}

/** Validate a single JSON-LD node (object). Returns true if it satisfies the contract. */
function validateJsonLdNode(
  node: any,
  location: string,
  allowedTypes: string[]
): void {
  const types = normalizeJsonLdTypes(node["@type"]);
  if (types.length === 0) {
    throw new Error(
      `Invalid JSON-LD at ${location}: missing or invalid @type. Required (string or array of strings).`
    );
  }

  const allowedSet = new Set(allowedTypes.map((t) => t.toLowerCase()));
  const hasAllowedType = types.some((t) => allowedSet.has(t));
  if (!hasAllowedType) {
    throw new Error(
      `Invalid JSON-LD at ${location}: @type "${node["@type"]}" is not in allowed list [${allowedTypes.join(", ")}]. Add it to allowedJsonLdTypes if your page uses this type.`
    );
  }

  const primaryType = types[0];
  const missing: string[] = [];
  if (!node["@context"]) missing.push("@context");
  if (!node["@type"]) missing.push("@type");
  if (!node.headline && !node.name) missing.push("headline or name");
  const articleLike = ["article", "blogposting"];
  if (articleLike.includes(primaryType) && !node.datePublished) {
    missing.push("datePublished");
  }

  if (missing.length > 0) {
    throw new Error(
      `Invalid JSON-LD at ${location}: missing required fields: ${missing.join(", ")}.`
    );
  }

  if (node.datePublished && typeof node.datePublished === "string") {
    const dateMatch = node.datePublished.match(/^\d{4}-\d{2}-\d{2}/);
    if (!dateMatch) {
      throw new Error(
        `Invalid JSON-LD at ${location}: datePublished must be YYYY-MM-DD or ISO 8601. Got: "${node.datePublished}"`
      );
    }
  }
}

/**
 * Validates JSON-LD: valid JSON, @type in allowed list, required fields.
 * Accepts single object or array of objects (at least one item must satisfy the contract).
 * @type may be string or array of strings (e.g. ["Article","NewsArticle"]).
 */
function validateJsonLdSchema(
  jsonLd: string,
  context: { routePath: string; sourcePath?: string },
  allowedTypes: string[]
): void {
  const { routePath, sourcePath } = context;
  const location = sourcePath ? `route ${routePath} (source: ${sourcePath})` : `route ${routePath}`;

  let parsed: any;
  try {
    parsed = JSON.parse(jsonLd);
  } catch (err) {
    const preview = jsonLd.length > 200 ? jsonLd.slice(0, 200) + "…" : jsonLd;
    throw new Error(
      `Invalid JSON-LD at ${location}: JSON parse error. Ensure the script tag contains valid JSON. Preview: ${preview}`
    );
  }

  const items: any[] = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length === 0) {
    throw new Error(
      `Invalid JSON-LD at ${location}: empty array or missing object.`
    );
  }

  let lastErr: Error | null = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    try {
      validateJsonLdNode(item, location, allowedTypes);
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  if (lastErr) throw lastErr;
  throw new Error(
    `Invalid JSON-LD at ${location}: no item in the array satisfies the required type contract (allowed: [${allowedTypes.join(", ")}]).`
  );
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

function formatErrorContext(params: ValidateParams): string {
  const lines: string[] = [];
  lines.push(`- routePath: ${params.routePath}`);
  lines.push(`- outFile: ${params.outFile}`);
  if (params.sourcePath) {
    lines.push(`- sourcePath: ${params.sourcePath}`);
  }
  return lines.join("\n");
}

export type ContractCheckResult = {
  ok: boolean;
  missing: string[];
};

/**
 * Runs the same contract checks as validatePrerenderHtml but returns a result instead of throwing.
 * Used by verify --prod to report whether production HTML satisfies the bot contract.
 */
export function checkPrerenderContract(
  html: string,
  options: {
    routePath?: string;
    outFile?: string;
    sourcePath?: string;
    allowedJsonLdTypes?: string[];
  } = {}
): ContractCheckResult {
  const routePath = options.routePath ?? "(production)";
  const allowedJsonLdTypes = options.allowedJsonLdTypes ?? DEFAULT_ALLOWED_JSON_LD_TYPES;
  const missing = collectContractMissing(html, routePath, options.sourcePath, allowedJsonLdTypes);
  return { ok: missing.length === 0, missing };
}

export function validatePrerenderHtml(params: ValidateParams): void {
  const {
    html,
    routePath,
    sourcePath,
    allowedJsonLdTypes = DEFAULT_ALLOWED_JSON_LD_TYPES,
  } = params;

  const missing = collectContractMissing(html, routePath, sourcePath, allowedJsonLdTypes);

  if (missing.length > 0) {
    const context = formatErrorContext(params);
    const msg =
      `RenderShield validation failed for prerendered page:\n` +
      context +
      `\nMissing/invalid requirements:\n` +
      missing.map((m) => `- ${m}`).join("\n") +
      `\n\nFix the source content or renderer so bots receive complete HTML. Check frontmatter and template (title, excerpt, datePublished, coverImage, slug).`;

    throw new Error(msg);
  }
}

/** Shared contract checks; returns missing list. validatePrerenderHtml throws when missing.length > 0. */
function collectContractMissing(
  html: string,
  routePath: string,
  sourcePath: string | undefined,
  allowedJsonLdTypes: string[]
): string[] {
  const missing: string[] = [];

  if (!hasNonEmptyTitle(html)) missing.push("Missing or empty <title>");
  const desc = getMetaContent(html, "description");
  if (!desc) missing.push('Missing <meta name="description" content="...">');
  const canonical = getLinkHref(html, "canonical");
  if (!canonical) missing.push('Missing <link rel="canonical" href="...">');

  const ogTitle = getOgContent(html, "og:title");
  const ogDesc = getOgContent(html, "og:description");
  const ogImg = getOgContent(html, "og:image");
  const ogUrl = getOgContent(html, "og:url");
  if (!ogTitle) missing.push("Missing Open Graph tag: og:title");
  if (!ogDesc) {
    missing.push("Missing Open Graph tag: og:description");
  } else if (ogDesc.length > 200) {
    missing.push(`Open Graph description too long (${ogDesc.length} chars). Max 200.`);
  }
  if (!ogImg) missing.push("Missing Open Graph tag: og:image");
  if (!ogUrl) missing.push("Missing Open Graph tag: og:url");

  const jsonLdScripts = getAllJsonLdScripts(html);
  if (jsonLdScripts.length === 0) {
    missing.push('Missing JSON-LD: <script type="application/ld+json">...</script>');
  } else {
    let onePassed = false;
    for (const scriptContent of jsonLdScripts) {
      if (scriptContent.length <= 20) continue;
      try {
        validateJsonLdSchema(
          scriptContent,
          { routePath, sourcePath },
          allowedJsonLdTypes
        );
        onePassed = true;
        break;
      } catch {
        // continue to next script
      }
    }
    if (!onePassed) missing.push("No JSON-LD script satisfied the required type contract.");
  }

  const articleInner = getArticleInnerHtml(html);
  if (!articleInner) {
    missing.push("Missing <article>...</article>");
  } else {
    const text = stripTags(articleInner);
    const words = wordCount(text);
    const okByChars = text.length >= 80;
    const okByWords = words >= 20;
    if (!okByChars && !okByWords) {
      missing.push(
        `Article content too short (${words} words, ${text.length} chars). Require >= 20 words or >= 80 chars.`
      );
    }
  }

  return missing;
}
