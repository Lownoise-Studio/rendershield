# Contributing to RenderShield

Thank you for your interest in contributing.

## Development setup

Requirements: **Node.js 18+**

```bash
git clone https://github.com/Lownoise-Studio/rendershield.git
cd rendershield
npm install
npm test
```

`npm test` runs `tsc` then Vitest. Tests import from `dist/`, so always build before running tests manually.

## Making changes

1. Create a branch from `main`.
2. Keep changes focused — RenderShield is intentionally narrow in scope.
3. Add or update tests for behavior changes.
4. Run `npm test` before opening a pull request.
5. Update `CHANGELOG.md` under `[Unreleased]` for user-visible changes.

## Pull requests

- Describe the problem and the approach.
- Link related issues when applicable.
- Ensure CI passes (build + tests on Node 18, 20, 22).

## Code style

- TypeScript strict mode; prefer `unknown` over `any`.
- Match existing module layout (`src/commands`, `src/core`).
- Throw `RenderShieldError` with a stable code for user-facing failures.
- Avoid drive-by refactors unrelated to the change.

## Reporting issues

Use [GitHub Issues](https://github.com/Lownoise-Studio/rendershield/issues). Include Node version, command run, and full error output.
