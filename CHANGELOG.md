# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-08-24

### Security

- Patched transitive dependencies used by the build pipeline: `markdown-it` (typographer/smartquotes DoS), `linkify-it` (linkify/mailto DoS), `js-yaml` (YAML merge-key DoS via gray-matter frontmatter), and `picomatch` (glob matching via fast-glob).

### Changed

- Package metadata and docs now use the **RenderShield Prerender** product name in README and `package.json` description. The npm package remains `@lownoise-studio/rendershield`, the CLI remains `rendershield`, and the public API exports are unchanged.
- `SECURITY.md`: only **1.1.x** is supported; versions below 1.1 are unsupported.

## [1.1.0] - 2026-08-23

### Added

- `verify --check` and `verify --all --check`: validate built HTML locally against the bot contract (no network).
- `verify --prod --all`: production-check every route discovered from build output.
- Global `--config <path>` for `init`, `build`, and `verify`.
- `worker.spaOrigin` (replaces `lovableOrigin`; old name still accepted on read).
- Config reference ([docs/CONFIG.md](docs/CONFIG.md)) and `rendershield.config.schema.json`.

### Changed

- `VerifyLocalResult` / `VerifyProdResult` return a `pages` array (multi-route aware).
- `init` default Worker origin field is `spaOrigin`.

## [1.0.0] - 2026-08-23

### Added

- **Programmatic API**: import `@lownoise-studio/rendershield` for `cmdInit`, `cmdBuild`, `cmdVerify`, config loading, HTML rendering, contract validation, and artifact generators.
- **`RenderShieldError`**: stable error codes (`CONFIG_MISSING`, `CONFIG_INVALID`, `OUTPUT_PATH_UNSAFE`, `CONTENT_INVALID`, `BUILD_FAILED`, `VALIDATION_FAILED`, `VERIFY_FAILED`, `CLI_INVALID_ARGS`) with optional `details` for library consumers.
- **TypeScript declarations**: published `.d.ts` via `package.json` `types` and `exports` map.
- **CI**: GitHub Actions workflow runs build and tests on Node 18, 20, and 22.
- **Docs**: `CONTRIBUTING.md` and `SECURITY.md`.
- Tests for `cmdInit`, local and `--prod` `cmdVerify`, public API exports, and `schemaType` rendering.
- `schemaType` config field now drives JSON-LD `@type` (`Article`, `BlogPosting`, `WebPage`).

### Fixed

- `verify` without build output now exits with failure (`VERIFY_FAILED`) instead of succeeding silently.
- `verify --prod` without a URL is rejected with `CLI_INVALID_ARGS` instead of falling back to local verify.

### Changed

- `cmdVerify` returns structured `VerifyResult` on success for programmatic use.
- CLI errors include error codes when thrown as `RenderShieldError`.
- `package.json`: `engines.node >= 18`, `exports`, `keywords`; sample `content/**` no longer published to npm.
- README: npm install / `npx` quickstart and programmatic API section.

## [0.3.1] - 2025-02-18

### Added

- `verify --prod <url>`: production check that asserts `x-rendershield: bot-hit` and runs the same HTML contract validation as build.
- Worker response header `x-rendershield`: `bot-hit` | `bot-fallback` | `pass-through` so routing is observable without inferring from HTML.
- CLI `--version` / `-V`: prints version from package.json.
- Vitest test suite: contract validation, loadConfig (including sitemap/robots path preservation and worker validation), path safety, and integration build.

### Fixed

- Config: sitemap and robots `path` are preserved and defaulted when only `enabled` is set; no longer lost when using boolean flags.
- Config: when `worker.enabled` is true, full worker object is kept (lovableOrigin, rewriteRouteBases, etc.) instead of being replaced by the flag.
- Worker: 500 error response body is generic ("Service temporarily unavailable.") to avoid leaking internals.
- JSON-LD in generated HTML: script body is no longer HTML-escaped so contract validation and crawlers can parse it.

### Changed

- Help text shows version and documents that `verify --prod` requires `x-rendershield: bot-hit`.
- TypeScript: reduced `any`; use `unknown` and typed interfaces in CLI, loadConfig, validateOutput, loadMarkdown.
- README: added "Production check" for `verify --prod`.

## [0.3.0] - 2025-02-18

- Initial npm release with init, build, verify, optional Cloudflare Worker, and HTML contract validation.
