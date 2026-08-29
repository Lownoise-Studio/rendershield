# Config reference

Default file: `rendershield.config.json` (override with `--config <path>`).

JSON Schema: [`rendershield.config.schema.json`](../rendershield.config.schema.json) (editor autocomplete).

## Top level

| Field | Required | Description |
|-------|----------|-------------|
| `version` | yes | Must be `1`. |
| `site` | yes | Site metadata for URLs and JSON-LD. |
| `content` | yes | Markdown content sources. |
| `output` | yes | Build output directory. |
| `sitemap` | no | Defaults: `enabled: true`, `path: "/sitemap.xml"`. |
| `robots` | no | Defaults: `enabled: true`, `path: "/robots.txt"`. |
| `worker` | no | Defaults: `enabled: true` in `init` sample. |

## `site`

| Field | Description |
|-------|-------------|
| `canonicalBase` | Public site origin, e.g. `https://example.com` (no trailing slash). |
| `siteName` | Appended to page titles. |
| `defaultOgImage` | Fallback OG image URL. |
| `authorName` | JSON-LD author for article types. |

## `content.markdown.collections[]`

| Field | Description |
|-------|-------------|
| `name` | Collection id (used internally). |
| `pattern` | Glob under `baseDir`, e.g. `blog/**/*.md`. Max 256 characters; no control characters; extglob syntax (`+(…)`, `*(…)`, etc.) is rejected. |
| `routeBase` | URL prefix, e.g. `/blog`. |
| `schemaType` | JSON-LD `@type`: `Article` (default), `BlogPosting`, or `WebPage`. |

### Markdown frontmatter (per file)

Required: `title`, `excerpt`, `datePublished` (`YYYY-MM-DD`), `coverImage`, `slug`.

Frontmatter must be **data-only YAML** between `---` delimiters. JavaScript / JSON language-tagged frontmatter is not supported and is rejected.

Route: `{routeBase}/{slug}` → `dist-prerender/.../index.html`.

## `output`

| Field | Description |
|-------|-------------|
| `outDir` | Relative path inside project, e.g. `dist-prerender`. |
| `prettyHtml` | Pretty-print HTML (default `true`). |

## `worker`

When `enabled: true`:

| Field | Description |
|-------|-------------|
| `spaOrigin` | Origin that serves prerendered + SPA assets, e.g. `https://app.example.com`. |
| `lovableOrigin` | **Deprecated** — same as `spaOrigin` (still accepted). |
| `rewriteRouteBases` | Bot rewrite prefixes, e.g. `["/blog/"]`. |
| `botUserAgentPatterns` | Case-insensitive substring match list. |
| `debugHeaders` | Extra `X-*` headers on Worker responses. |

## CLI flags

```bash
rendershield --config ./config/prerender.json build
rendershield verify --check              # contract-check first built page
rendershield verify --all --check        # contract-check every built page
rendershield verify --prod --all         # prod-check every route from build output
rendershield verify --prod https://example.com/blog/post
```
