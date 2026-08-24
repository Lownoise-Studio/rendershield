# RenderShield Prerender

**RenderShield Prerender** produces complete, static HTML for crawlers — and can prove
that bots receive it in production.

It prerenders structured content ahead of time and optionally routes crawler
requests to that output at the edge, while normal users continue to receive
your SPA.

The npm package and CLI remain `@lownoise-studio/rendershield` and `rendershield`.

No frameworks required.
No browser rendering.
No guessing what bots see.

If a page builds, the HTML contract is satisfied.
If `verify --prod` passes for a URL, that URL is receiving prerendered HTML to bots in production.

---

## What problem this solves

Modern SPAs often render content only after JavaScript executes.

Search engines, social scrapers, and AI crawlers may:

- see an empty shell
- see partial metadata
- receive inconsistent output

RenderShield Prerender enforces two guarantees:

- **Build-time contract** — Generated HTML must contain required metadata and content.
- **Production routing proof** — Bots must receive prerendered HTML (verified via header).

---

## What RenderShield Prerender does

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
- Verifies behavior:
  - `verify` (local) — prints curl smoke-test commands for built output; fails if output is missing (does not fetch URLs or validate HTML)
  - `verify --prod <url>` — fetches production as Googlebot, asserts `x-rendershield: bot-hit`, and validates the HTML contract; fails if the Worker is missing or falling back

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

Requires **Node.js 18+**.

### From npm

```bash
npm install -D @lownoise-studio/rendershield
```

```bash
npx rendershield init
npx rendershield build
npx rendershield verify
```

Add a script to `package.json` if you prefer:

```json
{
  "scripts": {
    "prerender": "rendershield build",
    "prerender:verify": "rendershield verify"
  }
}
```

### From source

```bash
git clone https://github.com/Lownoise-Studio/rendershield.git
cd rendershield
npm install
npm run build
```

**Initialize**

```bash
npx rendershield init
```

Or:

```bash
npm run start -- init
```

**Add content**

```
content/blog/
```

**Build**

```bash
rendershield build
```

Or with npx:

```bash
npx rendershield build
```

**Output**

```
dist-prerender/
```

**Local verify**

```bash
rendershield verify
```

Prints curl commands for a built page (from `dist-prerender/`). Use this after `build` to get smoke-test commands for your Worker setup. Exits with code 1 if output is missing; it does **not** fetch URLs or validate HTML.

**Local contract check (CI-friendly)**

```bash
rendershield verify --check
rendershield verify --all --check
```

Validates built HTML against the same bot contract as `build`, without network access.

**Production verify (after deploying Worker)**

Pass a **prerendered route URL** (not just the domain root):

```bash
rendershield verify --prod https://your-domain.com/blog/hello-world
```

This command:

- Fetches the URL as Googlebot (and as a human browser for comparison)
- Requires `x-rendershield: bot-hit` on the bot response
- Validates metadata + JSON-LD + article content on the bot response
- Exits with code 1 if anything fails

Proves routing for **that URL** only. Use `rendershield verify --prod --all` to check every route from build output.

**Local diagnostics (`doctor`)**

`rendershield doctor` is an **offline, read-only** health check. It inspects your Prerender configuration, Markdown sources, and existing build output. It does **not** build, repair, or modify your project, and it does **not** perform network requests.

```bash
npx rendershield doctor
npx rendershield doctor --json
npx rendershield doctor --strict
npx rendershield doctor --skip-output
npx rendershield --config path/to/rendershield.config.json doctor
```

Doctor checks:

- Configuration validity and coherence
- Markdown inventory and frontmatter
- Output path safety, presence, and best-effort freshness
- Crawler HTML-contract validity on built pages
- Sitemap, robots, and Worker artifact consistency

| Flag | Behavior |
|------|----------|
| `--skip-output` | Run only checks that do not require built output (config and content phases) |
| `--strict` | Treat warnings as failure (exit 1) |
| `--json` | Emit the complete machine-readable result to **stdout** |

Human-readable results also go to **stdout**. Invalid CLI arguments are reported on **stderr**.

| Exit code | Meaning |
|-----------|----------|
| **0** | No failures (and no warnings when `--strict`) |
| **1** | One or more diagnostic failures, or warnings with `--strict` |
| **2** | Invalid Doctor arguments (`CLI_INVALID_ARGS`) |

Example human output (abbreviated):

```text
RenderShield doctor v1.1.1

Config: rendershield.config.json

  PASS   DOCTOR_CONFIG_FOUND              Configuration loaded
  WARN   DOCTOR_OUTPUT_MISSING            Built output directory is missing

Summary: 12 pass, 1 warn, 0 fail
Doctor: OK — no blocking issues found.
```

Example JSON shape (abbreviated; real output includes every diagnostic field):

```json
{
  "version": "1.1.1",
  "command": "doctor",
  "ok": true,
  "strict": false,
  "configPath": "rendershield.config.json",
  "summary": { "pass": 12, "warning": 1, "fail": 0 },
  "diagnostics": []
}
```

Production network verification remains a separate command:

```bash
npx rendershield verify --prod <url>
```

Config reference: [docs/CONFIG.md](docs/CONFIG.md) · JSON Schema: `rendershield.config.schema.json` · Doctor spec: [docs/DOCTOR_SPEC.md](docs/DOCTOR_SPEC.md)

---

## Programmatic API

RenderShield Prerender can be used as a library through the existing package name:

```ts
import {
  cmdBuild,
  cmdDoctor,
  loadConfig,
  checkPrerenderContract,
  RenderShieldError,
} from "@lownoise-studio/rendershield";

await cmdBuild(process.cwd());
await cmdDoctor(process.cwd(), { json: true });
```

Exported commands, config loaders, HTML renderer, contract validators, artifact generators, and Doctor types are available from the package root. Errors throw `RenderShieldError` with stable `code` values for CI and tooling. ESM `import` only (no CommonJS `require`).

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

---

## Deployment

Designed for Cloudflare Workers.

The generated Worker (enabled by default in `init`; set `worker.enabled: false` to skip):

- Rewrites bot requests on configured route bases (e.g. `/blog/`)
- Sets `x-rendershield` on all responses
- Makes routing observable and testable

See: [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)

---

## Philosophy

RenderShield Prerender is intentionally narrow.

It does not attempt to simulate browsers.
It does not promise SEO outcomes.
It enforces a deterministic HTML contract and observable crawler routing.

Boring on purpose.

---

## License

MIT
