# DOCTOR_SPEC.md — `rendershield doctor`

> **Status: Doctor v1 implemented and verified (S1–S6 complete)**  
> RenderShield Prerender exposes `rendershield doctor` in the CLI and public API.

**Target package:** `@lownoise-studio/rendershield` (RenderShield Prerender)  
**Scope (v1):** Offline diagnostics only  

---

## 1. Architecture fit

`rendershield doctor` is a **fourth CLI command** alongside `init`, `build`, and `verify`. v1 is **offline and read-only**: it inspects Prerender config, Markdown sources, and existing generated artifacts. It does **not** replace `verify --prod`.

| Existing piece | How doctor uses it |
|----------------|---------------------|
| `extractGlobalOptions()` + `--config` | Global config path |
| `loadConfig()` | Config discovery and runtime validation |
| Shared Markdown primitives in `src/core/markdownContent.ts` | Collection discovery, single-file parse, route construction — **shared with build** |
| Internal `validateOutputPath()` | Output-path safety (read-only call; **not** exported) |
| Internal `listPrerenderIndexFiles()` / `indexHtmlPathToRoute()` | Built route discovery (**not** exported) |
| `checkPrerenderContract()` | Crawler HTML-contract checks on built files |
| `generateSitemapXml()` / `generateRobotsTxt()` / `generateWorkerJs()` | Expected artifact comparison (string-level, no execution) |

**Implemented (internal):**

- `src/core/markdownContent.ts` — shared Markdown primitives (S1)
- `src/doctor/types.ts`, `collector.ts`, `phases.ts`, `engine.ts` — `runDoctorEngine()` (S2)
- `src/doctor/runners/s3Phases.ts`, `s4Phases.ts` — diagnostic phases 1–10 (S3/S4)
- `src/commands/doctor.ts`, `src/doctor/formatters.ts` — CLI command and formatters (S5)
- `test/doctor-readonly-proof.test.ts` + CI job `doctor-readonly` — read-only proof (S6)

---

## 2. Purpose and non-goals

### Purpose

Provide a **single, offline, read-only health check** for a RenderShield Prerender project:

- Config validity and coherence
- Markdown inventory and frontmatter (via shared primitives)
- Output path safety, presence, best-effort freshness
- Crawler HTML-contract validity on generated pages
- Sitemap / robots / Worker **config + generated artifact** consistency

### Non-goals (v1)

| Non-goal | Rationale |
|----------|-----------|
| `--prod` / production network checks | `verify --prod` remains authoritative |
| SPA-shell heuristics | Prod/human-response concern; belongs with verify |
| Import or inspect React / JSX / TSX | RenderShield React boundary |
| Read RenderShield React config | Separate product |
| Execute / render the SPA or run a browser | Framework-neutral, offline |
| Modify config, Markdown, or output | Read-only |
| Run `build` or `fs.remove(outDir)` | Destructive |
| Parallel Markdown / frontmatter parser | Must reuse shared primitives with build |
| Export path-safety / route-listing helpers | Keep internal |
| Inspect Wrangler / Cloudflare / other provider configs | Out of scope |
| Hosted service or paid-gated diagnostics | Full local diagnostics + JSON stay in open-source CLI |
| Hash-based freshness / build manifest | Deferred |

---

## 3. CLI syntax and flags

```
rendershield [--config <path>] doctor [options]
```

| Flag | Description |
|------|-------------|
| `--config <path>` | Global; default `rendershield.config.json` |
| `--json` | Machine-readable JSON on stdout |
| `--strict` | Treat **WARNING** as failure for exit code |
| `--skip-output` | Skip checks requiring `outDir` |
| `-h`, `--help` | Doctor help |

**Not in v1:** `--prod`, `--prod --all`, production phases, SPA-shell diagnostics.

### Flag errors → `CLI_INVALID_ARGS`, exit **2**

Unknown flags, missing option values, and unexpected positional args must throw `CLI_INVALID_ARGS` and exit **2**.

---

## 4. Read-only guarantees

Doctor **may read:** config, Markdown under `content.markdown.baseDir`, files under `output.outDir` (when not `--skip-output`).

Doctor **must not:** write/delete files, invoke build/init, network fetch, spawn browsers, read Wrangler/provider config, import React.

**Acceptance test (S6 — complete):** `test/doctor-readonly-proof.test.ts` invokes the compiled production CLI (`dist/cli.js`) against representative project fixtures. Before/after snapshots capture path names, entry kinds (file/directory/symlink), content hashes, sizes, modes, symlink targets, and mtimes (atime excluded). Any change fails. Scenarios include built output, pre-build missing output, invalid config, frontmatter failure, safe nested and double-dot-prefixed artifact paths, and in-project symlinks. CI job `doctor-readonly` runs this proof as a dedicated gate.

---

## 5. Shared Markdown primitives (S1 — complete)

Doctor **must not** reimplement Markdown discovery, frontmatter parsing, or route construction.

| Primitive | Module | Responsibility |
|-----------|--------|----------------|
| `discoverCollectionFiles` | `src/core/markdownContent.ts` | Glob under `baseDir` + collection `pattern` |
| `parseMarkdownFile` | `src/core/markdownContent.ts` | Frontmatter validation + HTML render |
| `buildRoutePath` | `src/core/markdownContent.ts` | `routeBase` + `slug` → `routePath` |

`loadAllMarkdownDocs` (and **build**) consume these primitives. Primitives are **internal** — not exported from the package root.

---

## 5b. Internal Doctor engine (S2 — complete)

S2 delivers the **pure engine** only — not the CLI command.

| Component | Module | Responsibility |
|-----------|--------|----------------|
| Types | `src/doctor/types.ts` | `DoctorSeverity`, `DoctorPhaseId`, `DoctorDiagnostic`, `DoctorResult`, etc. |
| Collector | `src/doctor/collector.ts` | PASS/WARNING/FAIL aggregation, strict `ok` semantics |
| Phases | `src/doctor/phases.ts` | `DOCTOR_PHASE_ORDER`, phase runners |
| Engine | `src/doctor/engine.ts` | `runDoctorEngine()` — structured result, **no stdout/stderr** |

Phase runners for phases **1–5** are implemented (S3). Phases **6–10** are implemented (S4).

---

## 6. Diagnostic execution order (offline only)

```
Phase 1  Config discovery & load
Phase 2  Output path safety (non-destructive, internal helper)
Phase 3  Markdown source inventory (shared primitives)
Phase 4  Content semantics (routes, duplicates, globs)
Phase 5  Site / origin / Worker config coherence
Phase 6  Generated output presence
Phase 7  Source ↔ output freshness (best-effort mtime WARN only)
Phase 8  Crawler HTML contract (built files)
Phase 9  Sitemap & robots consistency (generated artifacts)
Phase 10 Worker rewrite coverage + generated worker.js consistency
```

---

## 7. Diagnostic catalog (summary)

Stable codes use prefix `DOCTOR_`. Severity: **PASS**, **WARNING**, **FAIL**.

Key areas:

- **Config:** `DOCTOR_CONFIG_FOUND`, `DOCTOR_CONFIG_MISSING`, `DOCTOR_CONFIG_INVALID`, `DOCTOR_CONFIG_DEPRECATED_FIELD`
- **Output path:** `DOCTOR_OUTPUT_PATH_SAFE`, `DOCTOR_OUTPUT_PATH_UNSAFE`
- **Content:** `DOCTOR_CONTENT_*`, `DOCTOR_ROUTE_*`
- **Canonical/origin:** `DOCTOR_CANONICAL_*`, `DOCTOR_SPA_ORIGIN_*`, `DOCTOR_ORIGIN_HOST_MISMATCH`
- **Output:** `DOCTOR_OUTPUT_*`, `DOCTOR_ARTIFACT_*`
- **Freshness:** `DOCTOR_FRESHNESS_STALE` (WARN, best-effort mtime), `DOCTOR_FRESHNESS_CURRENT`
- **Contract:** `DOCTOR_CONTRACT_*`, `DOCTOR_CANONICAL_HREF_MISMATCH`, `DOCTOR_JSONLD_TYPE_MISMATCH`
- **Artifacts:** `DOCTOR_SITEMAP_*`, `DOCTOR_ROBOTS_*`
- **Worker:** `DOCTOR_WORKER_*`

> mtime freshness is a **best-effort warning**, not deterministic proof. Hash-based freshness is **deferred**.

Full code list and phase details: see implementation PRs for S3–S6.

---

## 8. Severity and exit codes

| Exit | Meaning |
|------|---------|
| **0** | No FAIL (and no WARN if `--strict`) |
| **1** | One or more FAIL (or WARN with `--strict`) |
| **2** | `CLI_INVALID_ARGS` |

---

## 9. Human-readable output

Version string from package metadata (`{VERSION}` placeholder), never hardcoded in formatter.

```
RenderShield doctor v{VERSION}

Config: rendershield.config.json
Output: dist-prerender/ (12 pages)

  PASS   DOCTOR_CONFIG_FOUND              Configuration loaded
  WARN   DOCTOR_FRESHNESS_STALE          /blog/post-a: source mtime newer than built HTML (best-effort)

Summary: 18 pass, 4 warn, 2 fail
Doctor: FAIL — fix 2 issue(s) before release.
```

---

## 10. Machine-readable `--json` output

Complete JSON results available in the **open-source CLI** — no hosted service required.

```json
{
  "version": "{VERSION}",
  "command": "doctor",
  "ok": false,
  "strict": false,
  "configPath": "rendershield.config.json",
  "summary": { "pass": 18, "warning": 4, "fail": 2 },
  "diagnostics": []
}
```

---

## 11. Programmatic API (public surface — S5/S6)

### Public (exported from `@lownoise-studio/rendershield`)

- `cmdDoctor`
- `DoctorCommandOptions`
- `DoctorSeverity`, `DoctorCategory`, `DoctorPhaseId`, `DoctorDiagnosticCode`
- `DoctorDiagnosticDetails`, `DoctorDiagnostic`, `DoctorSummary`
- `DoctorEngineOptions`, `DoctorResult`, `DoctorCliResult`

### Internal (not exported from package root)

- `runDoctorEngine`
- `DoctorCollector`
- Phase runners (`runPhase*`)
- Formatters (`formatDoctorHuman`, `formatDoctorJson`)
- Doctor context objects
- Artifact-path safety helpers (`validateArtifactPathFormat`, `resolveArtifactPathInOutDir`, `readArtifactPathConfig`)
- Path-safety, route listing, Markdown primitives, freshness helpers

Packaging smoke (`scripts/packaging-smoke.mjs`) verifies the public/internal boundary from an installed tarball consumer.

---

## 12. Behavior before and after build

| State | Behavior |
|-------|----------|
| No config | FAIL `DOCTOR_CONFIG_MISSING` |
| Config + content, pre-build | WARN `DOCTOR_OUTPUT_MISSING` |
| Post-build | Output + contract + artifacts checks |
| `--skip-output` | Phases 1–5 only |

Recommended flow:

```
rendershield doctor
rendershield build
rendershield doctor
rendershield verify --prod <url>
```

---

## 13. Implementation slices

| Slice | Scope | Status |
|-------|-------|--------|
| **S1** | Shared Markdown primitives (`discoverCollectionFiles`, `parseMarkdownFile`, `buildRoutePath`); refactor `loadAllMarkdownDocs`; parity tests | **Complete** |
| **S2** | Internal Doctor types, collector, phase runner, and `runDoctorEngine()` (no CLI, no filesystem diagnostics, no public exports) | **Complete** |
| **S3** | Config/content diagnostic phases 1–5 | **Complete** |
| **S4** | Output diagnostic phases 6–10 | **Complete** |
| **S5** | `cmdDoctor`, CLI parsing/dispatch, human + `--json` formatters, public types | **Complete** |
| **S6** | Read-only proof (tree snapshot), packaging/public-API tests, user documentation, CI gate | **Complete** |

**Doctor v1:** Implemented and verified.

**Note:** Earlier drafts described S2 as including `cmdDoctor`. That was split: S2 ships the internal engine only; S5 ships the CLI command and public API.

---

## 14. Acceptance criteria (offline v1)

1. After build, `doctor` exits 0 with no FAIL on valid fixture. ✓
2. Pre-build valid project exits 0 with WARN-only for missing output. ✓
3. Duplicate slug → FAIL, exit 1. ✓
4. Unknown flags → `CLI_INVALID_ARGS`, exit **2**. ✓
5. `--json` includes all FAIL/WARN; `version` from package metadata. ✓
6. Read-only: before/after file-tree snapshot unchanged (S6 proof). ✓
7. Build and doctor share Markdown primitives. ✓
8. Public API adds only `cmdDoctor` + Doctor types. ✓
9. No React imports; no network in v1. ✓

---

## 15. RenderShield React boundary

```
┌─────────────────────────────────────────────────────────────┐
│                      Same website                           │
├──────────────────────────┬──────────────────────────────────┤
│  RenderShield Prerender  │  RenderShield React                │
│  rendershield doctor     │  (separate tooling)                │
│  Markdown → static HTML  │  Framework-aware concerns          │
├──────────────────────────┴──────────────────────────────────┤
│  Coexistence docs OK. NO shared implementation dependency.   │
│  Doctor: no React imports, source inspection, or React cfg.  │
└─────────────────────────────────────────────────────────────┘
```

---

## 16. Deferred work

| Item | Status |
|------|--------|
| Production / `--prod` / SPA-shell | Use `verify --prod` |
| Hash-based freshness / build manifest | Deferred |
| Runtime JSON Schema (`ajv`) | Deferred |
| Wrangler / provider config inspection | Deferred |
| `doctor --fix` | Deferred |

---

## 17. Verdict

**Doctor v1 complete** — S1–S6 are implemented, tested, documented, and verified in CI. Remaining release actions (version bump, npm publish, GitHub Release) are outside S6.
