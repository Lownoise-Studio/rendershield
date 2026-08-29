# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.2] - 2026-08-29

### Security

- Remove `gray-matter` and its JavaScript/eval-capable frontmatter engine from the dependency tree and parse path.
- Parse Markdown frontmatter as data-only YAML via direct `js-yaml` (`DEFAULT_SCHEMA`); reject executable/alternate openers such as `---js`, `---javascript`, and `---json` (plain `---` preferred; `---yaml` / `---yml` accepted). Preserve leading UTF-8 BOM compatibility.
- Harden Markdown collection globs: max pattern length, reject control characters and extglob syntax; disable fast-glob `extglob` / `braceExpansion` for collection discovery. Keep `picomatch@2.3.2` override (patched ReDoS line for micromatch).
- Dependency hygiene from the Socket-driven hardening pass: direct `js-yaml@4.3.2`; remove obsolete `js-yaml` override used only for transitive gray-matter.

## [1.2.1] - 2026-08-29

### Security

- Content-route path traversal hardening: validate `slug` / `routeBase` / `routePath` segments (reject `.`, `..`, NUL, backslashes) and enforce filesystem containment under `output.outDir` at the page write boundary. Doctor route resolution uses the same primitive and will not probe escaped paths.
- `validateOutputPath` resolves `outDir` against the realpath'd project root so symlink roots (e.g. macOS `/var` → `/private/var`) do not false-positive as traversal.

## [1.2.0] - 2026-08-24

### Added

- Offline, read-only `rendershield doctor` command for local project health checks (no network, no build, no file modifications).
- Human-readable stdout output and complete machine-readable `--json` output for the full Doctor result.
- `--strict` (treat warnings as failure) and `--skip-output` (limit to checks that do not require built output).
- Exit codes: `0` success / warn-only (non-strict), `1` diagnostic failure or strict warnings, `2` invalid Doctor arguments (`CLI_INVALID_ARGS`).
- Public API: `cmdDoctor`, `DoctorCommandOptions`, and Doctor result/diagnostic types (`DoctorSeverity`, `DoctorCategory`, `DoctorPhaseId`, `DoctorDiagnosticCode`, `DoctorDiagnosticDetails`, `DoctorDiagnostic`, `DoctorSummary`, `DoctorEngineOptions`, `DoctorResult`, `DoctorCliResult`).
- Diagnostics covering configuration, Markdown content/frontmatter, output presence, HTML contract, sitemap/robots artifacts, Worker output, and best-effort freshness warnings.
- Dedicated CI read-only proof (`test:doctor-readonly` / `doctor-readonly` job) that snapshots the project root and descendants before/after real CLI Doctor invocations.

### Fixed

- Artifact-path safety hardening for sitemap/robots paths (traversal rejection, drive-relative rejection, safe nested and double-dot-prefixed paths such as `/..metadata/sitemap.xml`).

### Compatibility

- npm package remains `@lownoise-studio/rendershield`.
- CLI bin remains `rendershield` → `dist/cli.js`.
- Existing `init`, `build`, and `verify` commands and previously exported public API paths remain compatible.
- Internal Doctor engine (`runDoctorEngine`) and artifact-path helpers are not exported.

## [1.1.1] - 2026-08-24

### Security

- Patched direct and transitive dependencies used by the build pipeline: `markdown-it` (typographer/smartquotes DoS), `linkify-it` (linkify/mailto DoS), `js-yaml` (YAML merge-key DoS via gray-matter frontmatter), and `picomatch` (glob matching via fast-glob).

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
