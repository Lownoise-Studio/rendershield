# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
