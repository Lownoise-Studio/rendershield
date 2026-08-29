# Open-source / commercial architecture boundary

> **Status:** Proposed v1 architectural policy  
> **Scope:** RenderShield Prerender (`@lownoise-studio/rendershield`)  
> **This document is architectural policy, not a promise of future commercial features.**

No proprietary RenderShield product or hosted control plane is assumed to exist today. This document defines a **proposed** boundary so future work can be classified deliberately, without crippling the open-source tool or reclassifying existing open capabilities.

---

## 1. Purpose

RenderShield Prerender is, and should remain, a **useful, complete open-source developer tool**: init, build, verify (including existing `verify --prod`), doctor, config/schema, artifact generation, and the public APIs needed to use them.

Any future commercial or service layer — if built — begins where RenderShield **operates ongoing infrastructure or organizational services** for users. It must not be manufactured by withholding local correctness, security, diagnostics, or safe self-hosting from the open-source package.

---

## 2. Two layers

| Layer | Role |
|-------|------|
| **OSS engine / tooling** | The published npm package, CLI, local generation, local inspection, deterministic correctness, security validation, and self-hosted deploy artifacts. Users can create, inspect, verify, debug, and safely deploy RenderShield output **without** a RenderShield-operated service. |
| **Future service / control plane** (candidate only) | Capabilities whose primary value comes from RenderShield continuously operating infrastructure: hosted dashboards, history, alerts, fleet monitoring, team/workspace features, managed orchestration, or managed integrations. |

These layers are distinct. Coupling them in packaging, licensing, or required network calls for normal local builds would violate this policy.

**RenderShield React** is a separate product boundary. Prerender must not depend on or import React / JSX / TSX tooling, and must not require React config to function. See also [DOCTOR_SPEC.md](./DOCTOR_SPEC.md) non-goals.

---

## 3. Principles

1. **Complete OSS tool** — Prerender remains useful and complete for local development and self-hosted deployment.
2. **No manufactured paid tier** — Do not deliberately cripple local functionality to create a commercial upsell.
3. **Correctness and security are OSS** — Contract validation, path safety, security fixes, and related checks stay open.
4. **Local lifecycle is OSS** — Create, inspect, verify, debug, and safely deploy output locally stay open.
5. **Existing OSS stays OSS** — Do not move currently open functionality behind a commercial boundary.
6. **Service candidates are infrastructure** — Proprietary/service candidates begin where RenderShield operates ongoing infrastructure or org-level services — not where a developer runs the CLI on their machine.
7. **Policy ≠ roadmap** — Listing a capability as a “service candidate” is not a commitment to build or sell it.

---

## 4. OSS inventory (keep open)

The following remain open source. Existing capabilities in this repository must not be reclassified as proprietary merely for monetization.

| Area | Includes (non-exhaustive) |
|------|---------------------------|
| **CLI** | `rendershield` binary and help/version behavior |
| **Commands** | `init`, `build`, `verify` (including existing `verify --prod` / `--all` / `--check`), `doctor` (including `--json`, `--strict`, `--skip-output`) |
| **Diagnostics** | Machine-readable local JSON diagnostics; human-readable doctor/verify output |
| **Configuration** | `rendershield.config.json`, runtime validation, JSON Schema |
| **Generation** | Markdown → static HTML; metadata, canonical, Open Graph, Twitter, JSON-LD; sitemap; robots; optional Worker generation |
| **Safety & correctness** | Output/path/route containment; deterministic build correctness; contract validation |
| **Local provenance** | Local build manifests / provenance and hash-based source/output freshness **if implemented for local deterministic correctness** |
| **Public API** | Package exports and types required to use the above as documented |
| **Security** | Security fixes and safety validation (see [SECURITY.md](../SECURITY.md)) |

Self-hosting and deploying generated artifacts (static output + optional Worker) using [DEPLOY.md](../DEPLOY.md) and [deploy-cloudflare.md](./deploy-cloudflare.md) remains an OSS workflow. RenderShield does not need to host the user’s application for Prerender to be complete.

---

## 5. Service / control-plane candidates (not commitments)

These are **candidates only** for a future RenderShield-operated service layer. They are not product promises and are not required for the OSS tool to be complete.

Examples of where value comes primarily from RenderShield operating infrastructure or organizational services:

- Hosted project dashboard
- Scheduled / continuous production monitoring
- Historical deployment or verification records
- Hosted alerts and notifications
- Multi-project / fleet monitoring
- Team / workspace management
- Managed deployment orchestration
- Hosted analytics / trends
- Organization policy / compliance management
- Managed integrations that require RenderShield-operated infrastructure

A one-shot local `verify --prod` against a URL the user provides remains OSS. Recurring hosted verification of that URL across time, with history and alerts, is a service candidate.

---

## 6. Feature-classification test

When evaluating a future feature, ask where its **primary value** comes from.

### Remain OSS when the feature is fundamentally required for:

- Local correctness
- Security
- Deterministic generation
- Local inspection / debugging
- Interoperability (documented formats, APIs, schemas)
- Safe self-hosting
- Using the published package as documented

### May belong to a commercial / service layer when primary value comes from:

- RenderShield continuously operating infrastructure
- Persistence / history hosted by RenderShield
- Organization / team coordination
- Managed automation
- Centralized monitoring across deployments or projects
- Service-level integrations or operational convenience that depend on a RenderShield-operated backend

**Tie-breaker:** If the feature is necessary to trust or debug a local build or a self-hosted deploy without RenderShield’s servers, prefer OSS. If removing RenderShield’s hosted infrastructure removes most of the feature’s value, it may be a service candidate.

---

## 7. Anti-patterns

Do **not**:

- Intentionally degrade OSS output quality or completeness to upsell
- Withhold security checks from the open-source package
- Hide essential local diagnostics behind a paid or hosted gate
- Require a proprietary file format to use the OSS tool
- Force a hosted service for normal local builds
- Couple RenderShield React into Prerender
- Retroactively reclassify already-open features merely for monetization
- Gate `doctor` JSON, contract validation, or path-safety behind a service

---

## 8. Licensing

- **Current repository licensing remains unchanged** (MIT for this package as published today).
- This document does **not** select or invent a license for any future proprietary software.
- Any future service / control-plane implementation should live behind a **deliberate repository, package, and licensing decision before code is written** — not as an ad-hoc carve-out inside this package.

---

## 9. Classification of likely next work

| Item | Classification | Notes |
|------|----------------|-------|
| Hash-based freshness | **OSS** | Local correctness / diagnostics |
| Deterministic build manifest | **OSS** | Local deterministic correctness / provenance |
| Runtime config validation improvements | **OSS** | Required to use the package safely |
| Local doctor enhancements | **OSS** | Local inspection / debugging |
| `verify --prod` (existing functionality) | **OSS** | Already open; must remain open |
| Hosted recurring verification | **Service candidate** | Continuous RenderShield-operated monitoring |
| Verification history dashboard | **Service candidate** | Hosted persistence / history |
| Alerts | **Service candidate** | Hosted notifications |
| Fleet / project dashboard | **Service candidate** | Multi-project / org coordination |
| Managed deployment | **Service candidate** | Managed orchestration |
| `doctor --fix` | **Undecided** | Requires separate safety and design review; not classified by this document |

---

## 10. Relation to existing docs

| Document | Relationship |
|----------|----------------|
| [README.md](../README.md) | Product overview; links here for architecture policy |
| [DOCTOR_SPEC.md](./DOCTOR_SPEC.md) | Already states full local diagnostics + JSON stay OSS; `doctor --fix` deferred — consistent with §9 |
| [CONFIG.md](./CONFIG.md) | Config remains OSS |
| [DEPLOY.md](../DEPLOY.md), [deploy-cloudflare.md](./deploy-cloudflare.md) | Self-hosted deploy remains OSS; “RenderShield does not host your application” aligns with §4 |

---

## 11. Non-goals of this document

- Implementing or scaffolding a commercial product
- Changing package behavior, exports, tests, dependencies, licensing, CLI, or build
- Promising timelines, pricing, or feature availability
- Moving any existing open capability behind a paywall
