# RenderShield

RenderShield produces complete, static HTML for crawlers — and can prove
that bots receive it in production.

It prerenders structured content ahead of time and optionally routes crawler
requests to that output at the edge, while normal users continue to receive
your SPA.

No frameworks required.
No browser rendering.
No guessing what bots see.

If a page builds, the HTML contract is satisfied.
If verify --prod passes, crawlers are actually receiving it.

---

## What problem this solves

Modern SPAs often render content only after JavaScript executes.

Search engines, social scrapers, and AI crawlers may:

- see an empty shell
- see partial metadata
- receive inconsistent output

RenderShield enforces two guarantees:

- **Build-time contract** — Generated HTML must contain required metadata and content.
- **Production routing proof** — Bots must receive prerendered HTML (verified via header).

---

## What RenderShield does

- Converts structured content (Markdown) into full static HTML pages
- Injects:
  - `<title>`
  - meta description
  - canonical link
  - Open Graph tags
  - Twitter tags
  - JSON-LD (Article, BlogPosting, WebPage)
- Generates:
  - index.html per route
  - sitemap.xml
  - robots.txt
  - optional Cloudflare Worker
- Validates output:
  - missing title, metadata, or article body causes the build to fail
- Verifies production behavior:
  - `verify --prod` asserts `x-rendershield: bot-hit`
  - fails if the Worker is missing or falling back

---

## What it does not do

- It does not execute your application
- It does not render JavaScript for bots
- It does not guess content
- It does not guarantee rankings or traffic
- It does not replace your SPA

It guarantees one thing only:
that bot-facing HTML meets a defined contract —
and (optionally) that production routing serves it.

---

## Quickstart

**Install dependencies**

```bash
npm install
```

**Initialize**

```bash
rendershield init
```

**Add content**

```
content/blog/
```

**Build**

```bash
rendershield build
```

**Output**

```
dist-prerender/
```

**Local verify**

```bash
rendershield verify
```

**Production verify (after deploying Worker)**

```bash
rendershield verify --prod https://your-domain.com
```

This command:

- Fetches as Googlebot
- Requires `x-rendershield: bot-hit`
- Validates metadata + JSON-LD + article content
- Exits with code 1 if anything fails

---

## Deployment

Designed for Cloudflare Workers.

The generated Worker:

- Rewrites bot requests
- Sets `x-rendershield` on all responses
- Makes routing observable and testable

See: [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)

---

## Philosophy

RenderShield is intentionally narrow.

It does not attempt to simulate browsers.
It does not promise SEO outcomes.
It enforces a deterministic HTML contract and observable crawler routing.

Boring on purpose.

---

## License

MIT
