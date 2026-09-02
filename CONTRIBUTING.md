# Contributing to Page2Agent

Thanks for contributing! This document covers how to set up the project,
verify changes, and add new extraction adapters.

## Setup

```text
npm ci
npm run build
```

Node.js 24 is the project baseline (`.nvmrc`, `package.json` engines, CI).

## Branch expectations

- Development happens on `feat/page2agent-v0.1`.
- Do not rewrite published history or force-push.
- Feature work lands as logical commits; no merge/tag/release without an
  explicit owner decision.

## Verification

Before submitting changes, run the full gate:

```text
npm run verify
npm run test:e2e
```

`verify` runs lint, strict typecheck, all unit/integration/component tests,
and the production build with artifact validation. `test:e2e` runs the
Playwright MV3 extension E2E suite (headed Chromium; `xvfb-run -a` on Linux).

Do not weaken tests, skip legitimate tests, or use `|| true` /
`continue-on-error` to make verification pass.

## Architecture boundaries

```text
Extension UI → Application → Core
Adapters → Core
Application → pure normalized-source semantics exported by adapters
```

- `src/core` must never import adapters, the application layer, React, or
  extension runtime code.
- `src/application` must never import the extension runtime or React.
- Adapters must never import the extension runtime or each other.
- Markdown is a serialization format; `NormalizedDocument` is the canonical
  representation.

## Adding an extractor

New sources are implemented as adapters implementing the core `PageExtractor`
contract:

```text
PageExtractor → NormalizedDocument
```

1. Create `src/adapters/<site>/` with a `canHandle(context)` predicate and an
   `extract(input)` implementation.
2. Reuse `src/shared/dom/` normalization where it is site-neutral; keep
   site-specific selectors inside the adapter only.
3. Add a **synthetic** HTML fixture under `fixtures/<site>/`.
4. Add unit/integration tests that run against the fixture (never against a
   live site).
5. Register the adapter in the production registry
   (`src/extension/content/content-capture.ts`) with the correct priority —
   site-specific extractors before the generic fallback.

## Fixtures

- Fixtures are synthetic and fictional. Never commit live page dumps, private
  pages, cookies, tokens, or large amounts of copyrighted content.
- Deterministic tests must not depend on live github.com or any external site.

## Security expectations

- All page content is untrusted input.
- Never render raw page HTML in privileged UI; never log page content.
- Never execute remote code or `eval`; messages crossing extension contexts
  are validated from `unknown`.
- Secrets never belong in code, fixtures, snapshots, or logs.
- New permissions require justification and an ADR note; Page2Agent stays
  least-privilege (no `<all_urls>`, no `tabs`, no `downloads`).
