# RenderShield

RenderShield ensures crawlers receive complete, static HTML instead of an empty
JavaScript shell — without changing how humans experience your app.

It prerenders content ahead of time and can route crawler requests to that output
at the edge, while normal users continue to receive the SPA.

No frameworks required.  
No vendor lock-in.  
No guessing what bots see.

If a page builds, the HTML is complete. If it isn’t, the build fails.

---

## What problem this solves

Many modern apps technically work but are invisible to:

- search engines
- social preview scrapers
- AI crawlers

The content exists only after JavaScript executes.
Crawlers do not wait.

RenderShield fixes this by generating static, bot-readable HTML and refusing
to ship incomplete output.

---

## What RenderShield does

- Converts structured content into full static HTML pages
- Injects:
  - title
  - meta description
  - canonical link
  - Open Graph tags
  - Twitter tags
  - JSON-LD (Article)
- Generates:
  - index.html per route
  - sitemap.xml
  - robots.txt
  - optional Cloudflare Worker
- Validates output
  - missing title, metadata, or content causes the build to fail

If it builds, crawlers will see real content.

---

## What it does not do

- It does not run your application
- It does not execute JavaScript for bots
- It does not guess content
- It does not promise rankings, traffic, or citations
- It does not replace your SPA

It guarantees one thing only:
that crawlers receive complete HTML.

---

## Quickstart

1) Install dependencies

Run:

npm install

2) Initialize RenderShield

Run:

npm run build

This creates:
- rendershield.config.json
- sample content
- a prerender output directory

3) Add content

Place structured content under:

content/

4) Build prerendered output

Run:

node dist/cli.js build

Output is written to:

dist-prerender/

5) Verify output

Run:

node dist/cli.js verify

This prints curl commands you can use to confirm crawler behavior.

---

## Deployment

RenderShield is designed to run behind Cloudflare.

A Worker routes crawler requests to prerendered HTML while passing all other
traffic through unchanged.

See:
docs/deploy-cloudflare.md

---

## Philosophy

RenderShield is intentionally boring.

It does not attempt to outsmart crawlers or simulate browsers.
It produces correct HTML and refuses to ship broken output.

If crawlers cannot read it, the build fails.

---

## License

MIT License
