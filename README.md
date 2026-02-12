---
# RenderShield

RenderShield makes sure bots see **real HTML**, not an empty SPA shell.

It prerenders content into static HTML files and helps route crawlers to those files at the edge, while humans continue to get the SPA experience.

No frameworks required.  
No vendor lock-in.  
No guessing what bots see.

If a page is generated, RenderShield verifies it's complete. If it isn't, the build fails.

---

## What problem this solves

Many SPAs technically "work" but are invisible to:
- search engines
- social preview scrapers
- AI crawlers

The content exists, but only after JavaScript runs. Bots don't wait.

RenderShield fixes that by generating **bot-visible HTML** ahead of time and refusing to ship broken output.

---

## What RenderShield does

- Converts markdown content into full static HTML pages
- Injects:
  - `<title>`
  - meta description
  - canonical link
  - Open Graph tags
  - Twitter tags
  - JSON-LD (Article)
- Generates:
  - `index.html` per route
  - `sitemap.xml`
  - `robots.txt`
  - an optional Cloudflare Worker
- **Validates output**
  - Missing title, meta, JSON-LD, or article content → build fails

If it builds, bots will see real content.

---

## What it does *not* do

- It does not run your app
- It does not guess content
- It does not promise rankings, traffic, or citations
- It does not replace your SPA

It only guarantees one thing:
**the HTML it generates is complete and readable by bots**

---

## Installation

```bash
npm install
npm run build
```
