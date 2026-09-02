# ADR-001: Page2Agent V0.1 Browser Context Bridge Architecture

- Status: Accepted
- Date: 2026-08-30
- Applies to: Page2Agent V0.1

## Context

Page2Agent is a lightweight open-source Chrome / Edge browser extension whose
product positioning is:

> Turn any webpage into agent-ready context.

The problem it solves is not simply:

```text
Web Page → Markdown
```

but:

```text
Web Page → Capture → Extract → Normalize → Package → Deliver → Agent-ready Context
```

Future target integrations (Codex, Claude Code, ChatGPT, Obsidian, RAG, MCP)
are explicitly OUT of scope for V0.1. V0.1 establishes only:

```text
Browser page
    ↓
Structured extraction
    ↓
NormalizedDocument
    ↓
AgentPackage / Markdown
    ↓
Copy / Download
```

This ADR freezes the V0.1 product scope, architecture, trust boundaries,
canonical data flow, domain boundaries, MV3 permission strategy, state
ownership, extractor architecture, serialization architecture, dependency
strategy, testing strategy, and future extension boundaries BEFORE any product
code is written.

## Goals

- Freeze the canonical pipeline: `Capture → Extract → Normalize → Package → Deliver`.
- Make `NormalizedDocument` the single canonical representation of captured
  content; Markdown is only a serialization format, never a source of truth.
- Keep a strict, model-level separation between source content and
  Page2Agent-generated instructions.
- Define extractor architecture that keeps GitHub-specific knowledge inside the
  GitHub adapter and never leaks into generic core.
- Define MV3 runtime boundaries (Side Panel / Service Worker / Content Script)
  that respect the non-durable Service Worker lifecycle.
- Adopt least-privilege permissions with user-triggered capture as the only
  capture mode (no background surveillance).
- Define state ownership (Side Panel ephemeral state / `chrome.storage.session`
  session state / `chrome.storage.local` long-lived preferences only).
- Pre-record the race-condition model (latest capture wins).
- Treat all web page content as untrusted input end-to-end.
- Define a testing strategy that proves real extension behavior, and a
  deterministic fixture strategy independent of live github.com.
- Provide a clear starting point for TASK 02 (Manifest V3 Extension Foundation)
  without over-freezing TypeScript implementation details.

## Non-goals

The following are explicitly NOT part of V0.1. They may be recorded under
Deferred Work, but must not be implemented:

- Direct Codex execution
- Claude Code integration
- Native Messaging
- Page2Agent Bridge
- ChatGPT automation
- MCP
- RAG
- Vector Database
- Backend (FastAPI, Express, or any server)
- Database (SQLite, PostgreSQL, Redis, or any storage engine)
- LLM Summary
- OpenAI API / Anthropic API / Provider API Keys
- PDF deep parsing
- OCR / Vision
- Bilibili transcript / ASR
- Feishu-specific adapter
- GitHub PR adapter
- GitLab adapter
- Obsidian integration
- Cloud sync
- Login / Accounts
- Analytics / Telemetry / Billing
- Chrome Web Store publishing / Edge Add-ons publishing
- Git Tag / Release

## Decision

### Canonical Pipeline

```text
Web Page
    ↓
Capture
    ↓
PageContext
    ↓
ExtractorRegistry
    ↓
PageExtractor
    ↓
NormalizedDocument
    ↓
    ├──────────────→ MarkdownSerializer
    │                    ↓
    │                 Markdown
    │
    └──────────────→ AgentPackageBuilder
                         ↓
                    AgentPackage
                         ↓
                 AgentPackageSerializer
                         ↓
                 Agent-ready Context
                         ↓
                    Copy / Download
```

**Architecture invariant:** `NormalizedDocument` is the canonical
representation. The following design is FORBIDDEN:

```text
DOM
↓
Markdown
↓
all later logic parses Markdown
```

The required relationship:

```text
DOM
↓
NormalizedDocument
↓
different Serializers / Package Builders
```

Markdown is only a serialization format, not the source of truth.

### Domain Model

TASK 01 defines concepts and responsibilities only; TypeScript types are
decided during implementation.

#### PageContext

Represents the browser runtime context of one capture. Conceptual fields:

- `captureId`
- `tabId`
- `url`
- `title`
- `capturedAt`

Responsibilities:

- capture correlation
- tab correlation
- stale-result detection

`PageContext` is a runtime context. Browser-runtime fields such as `tabId`
must NOT leak into the long-lived document source model.

#### NormalizedDocument

The most important canonical domain model of the project. Conceptual fields:

- `schemaVersion`
- `source` (a `SourceDescriptor`)
- `metadata`
- `blocks` (`ContentBlock[]`)
- `assets`

It represents the factual content of a page AFTER structuring. It does NOT
depend on React, Chrome UI, Markdown, or any Agent Provider.

#### ContentBlock

A discriminated union of semantic blocks. V0.1 supports at least:

- Heading
- Paragraph
- CodeBlock
- Quote
- Ordered / Unordered List
- Image
- Link
- Table

Goal: semantic context preservation, NOT pixel-perfect webpage reproduction.

#### SourceDescriptor

Captures where the content came from (source URL, title, capture time) as part
of the document source model. It is the durable, non-browser-runtime source
identity of a `NormalizedDocument`.

#### AgentPackage

`AgentPackage` is NOT the raw page content. It composes:

```text
NormalizedDocument
+ Task Intent
+ Page2Agent Generated Instructions
```

It MUST be possible to distinguish source content from Page2Agent-generated
instructions within the model and in the output format.

### Source / Generated Boundary

Page2Agent must never pass off its own inferences as page facts.

Example (GitHub Issue): if the source issue says only
`App crashes after deleting an Agent.` and does not contain Acceptance
Criteria, Page2Agent MUST represent:

```text
Source Acceptance Criteria: Not explicitly provided in source.
```

Forbidden: auto-inventing "Add regression tests", "Fix race condition",
"Update documentation" and presenting them as source Acceptance Criteria.
Such engineering rules, if needed at all, may only appear in
`Page2Agent Agent Instructions`.

```text
Source Data ≠ Generated Instructions
```

All future adapters must obey this boundary.

### Extractor Architecture

Freeze `PageExtractor` as the primary source extension point. Conceptual
contract:

```text
PageExtractor
├─ id
├─ canHandle(PageContext)
└─ extract(...)
       ↓
NormalizedDocument
```

The concrete TypeScript signature is decided in TASK 03; this ADR does not
over-freeze function-level detail.

`ExtractorRegistry` performs deterministic extractor selection. V0.1 priority:

```text
GitHubIssueExtractor
        ↓
GenericArticleExtractor
```

Site-specific extractors win; the generic extractor is the fallback. A
selector-chain style `extractPage() { if github ... if feishu ... }` inside
core is FORBIDDEN. All GitHub-specific knowledge stays inside the GitHub
adapter boundary.

### Generic Article Strategy

Generic extraction pipeline (decision-level):

```text
Live Document
↓
Clone
↓
Main Content Detection
↓
DOM Normalization
↓
ContentBlock[]
↓
NormalizedDocument
```

The live page DOM must never be mutated. V0.1 main-content detection adopts
`@mozilla/readability` (installed in TASK 04), executed only on a cloned,
detached document — never on the live page. Readability's HTML output is
still NOT the canonical model — extraction must continue:

```text
Readability → ContentBlock[] → NormalizedDocument
```

### GitHub Issue Adapter Strategy

GitHub Issue extraction is the V0.1 showcase. Support:

```text
https://github.com/{owner}/{repo}/issues/{number}
```

`/pull/{number}` must NOT be recognized as a GitHub Issue.

The V0.1 GitHub adapter reads the already-rendered DOM. It does NOT call:

- GitHub REST API
- GraphQL API
- any authenticated GitHub API

Out of scope: full comment threads, timeline, reactions, project boards,
linked PRs, assignee synchronization.

Selectors are encapsulated inside the GitHub adapter. Prefer stable
semantic / aria / data attributes; avoid generated CSS hashes and fragile
`nth-child` trees.

### MV3 Runtime

Chrome / Edge Manifest V3. Runtime components:

```text
Extension Action
      ↓
Side Panel
      ↓
Service Worker
      ↓
Programmatic Content Script
      ↓
Web Page
```

Responsibilities:

- **Side Panel**: UI, ephemeral interaction state, preview, copy/download
  commands. NOT responsible for GitHub DOM selector logic.
- **Service Worker**: extension orchestration, active-tab coordination, script
  injection, runtime messaging, session-level coordination. MUST NOT assume it
  stays alive.
- **Content Script**: DOM access to the current page, page capture, extractor
  execution. Page content is untrusted input.

### Permissions

Least privilege. V0.1 planned permissions:

- `activeTab`
- `scripting`
- `sidePanel`
- `storage`

Default forbidden: `<all_urls>`. This ADR does not pre-commit `tabs`; if TASK 02
implementation proves an API genuinely requires an additional permission, that
permission must be re-evaluated and this ADR updated.

Default forbidden permission requests: `cookies`, `history`, `bookmarks`,
`webRequest`, `nativeMessaging`.

Rationale: Page2Agent capture is an explicit user-triggered action, not
background page surveillance.

### Content Script Injection Strategy

Without `<all_urls>` persistent content scripts, prefer:

```text
User-triggered Capture
↓
activeTab
↓
programmatic injection
↓
capture
```

Concrete API calls are decided in TASK 02. The architecture must handle
repeated capture without creating duplicate listeners; this becomes regression
coverage in TASK 07 / TASK 08.

### State Ownership

Manifest V3 Service Worker is not a durable process. Architecture must NOT
depend on module-level mutable state such as:

```text
let currentCapture = ...
let page = ...
```

State classification:

- **Side Panel**: ephemeral UI state only.
- **`chrome.storage.session`**: cross-context session-scoped state when
  actually needed (e.g. latest capture metadata).
- **`chrome.storage.local`**: long-lived user preferences only.

V0.1 must NOT persist full user webpage content by default. This is a privacy
decision.

TASK 07 activated the `storage` permission for `chrome.storage.session` (the
ADR-planned session-scoped state). TASK 08 separated latest user intent from
per-capture outcomes. TASK 09 additionally scopes the latest-intent key by
browser window and carries that window ID in `capture.request`, so concurrent
global Side Panels cannot overwrite each other's intent or capture the active
tab from the wrong window. The Side Panel writes its window's capturing intent
before sending the request; the Service Worker writes only the request's
per-capture outcome key. A new intent removes only the prior outcome belonging
to that same window. Captured content never enters `chrome.storage.local`/sync
and no capture history is stored. A worker that finishes after its window has
advanced to a newer intent removes only its own now-orphaned outcome. Markdown
downloads use Blob + object URL + anchor, so no `downloads` permission is
needed.

### Concurrency Model

Recorded up front:

```text
Capture A
↓
Capture B
↓
B finishes first
↓
A finishes later
```

The final UI MUST keep B; stale A must never overwrite it. Every capture is
conceptually associated with `captureId`, `tabId`, `url`, `capturedAt`.
Policy: **latest capture wins within each browser window**. The concrete
intent/outcome ownership algorithm is implemented in TASK 07–09, including a
deterministic two-window regression.

### Security Trust Boundary

```text
Untrusted Web Page
        ↓
Content Script
        ↓
Validation / Normalization
        ↓
Extension-owned Data Model
        ↓
Privileged Extension UI
```

Forbidden:

```text
Page HTML → dangerouslySetInnerHTML → Side Panel
```

without passing the security boundary. Also forbidden: `eval`, `new Function`,
remotely hosted executable code. Cross-extension-context messages are first
treated as `unknown`; runtime validation converts them into typed data. Never
trust `message as CaptureRequest` directly.

#### URL Security

Page-provided `href`, `src`, and canonical URLs are untrusted input.

- Allowed: `http`, `https`; `mailto` where genuinely needed.
- Rejected: `javascript:`, `vbscript:`.
- `data:` is decided per asset use case; arbitrary `data:` URLs must NOT be
  treated as safe links by default in V0.1.
- Relative URLs are normalized to absolute URLs based on the source URL.

#### Asset Strategy

V0.1 image assets keep only:

- absolute URL
- alt
- optional title

Not implemented: image download, Base64 persistence, OCR, vision, cloud
upload. Image handling is a context reference, not a media pipeline.

### Serialization

Two independent directions:

```text
NormalizedDocument → MarkdownSerializer → Markdown
```

```text
NormalizedDocument → AgentPackageBuilder → AgentPackage
    → AgentPackageSerializer → Agent-ready Context
```

Serializers are deterministic: same input, same output. Serializers are NOT
responsible for DOM parsing, `Date.now`, network, UI, or provider APIs.

### Failure Model

Structured typed errors. Planned error codes:

- `UNSUPPORTED_PAGE`
- `RESTRICTED_PAGE`
- `NO_CONTENT_FOUND`
- `PAGE_NAVIGATED`
- `CONTENT_TOO_LARGE`
- `CAPTURE_FAILED`
- `INVALID_MESSAGE`
- `INVALID_DOCUMENT`
- `CLIPBOARD_FAILED`
- `DOWNLOAD_FAILED`

UI shows user-readable messages, never raw stack traces.

#### Large Content Policy

Avoid freezing the browser on huge pages. V0.1 plans a reasonable safety
limit, approximately 500,000 extracted characters; the exact value is tuned
during implementation/testing.

- Silent truncation is FORBIDDEN. If the real document exceeds the hard safety
  limit, return `CONTENT_TOO_LARGE`.
- The UI preview MAY truncate separately for performance (e.g. full document
  100,000 chars, preview 20,000 chars) but MUST indicate "Preview truncated".
- Copy / Download must not lose content due to preview truncation.

### Delivery

V0.1 delivery is limited to:

- Clipboard: `Copy for Agent`, `Copy Markdown`.
- Local Markdown download: prefer Blob + Object URL + browser download
  interaction. Do NOT request the `downloads` permission for a simple Markdown
  download; re-evaluate only if TASK 07 proves it necessary.

### Direct Codex Integration (deferred)

Future architecture for local coding-agent integration:

```text
Browser Extension
↓
Native Messaging
↓
Page2Agent Bridge
↓
Codex / Claude Code
```

V0.1 must NOT create an empty bridge folder, placeholder native protocol, fake
Codex button, or a `Send to Codex` UI. The real V0.1 action is `Copy for Agent`.

## Dependency Strategy

No dependency is installed in TASK 01. Planned stack:

Runtime:

- TypeScript-compiled JavaScript
- React, React DOM
- `@mozilla/readability` (adopted in TASK 04 for Generic main-content detection)

Development:

- Vite
- TypeScript
- Vitest
- jsdom
- Playwright
- ESLint
- `@types/chrome`
- React type packages

Runtime schema validator (e.g. Zod): NOT auto-approved.

- Why: cross-context runtime messages and persisted data need runtime
  validation.
- Alternatives: hand-written type guards; small schema library.
- Decision rule: with only a few message contracts, prefer small explicit type
  guards; introduce a schema library only if schema count / nesting clearly
  grows. Never add a runtime dependency just to look advanced.

### Technology Decisions

Default direction: TypeScript, React, Vite, native MV3 APIs, Vitest, Playwright.

Explicitly NOT adopted for V0.1: Next.js, WXT, Plasmo, Electron, Redux,
Zustand, Tailwind, shadcn, Axios, any backend framework. Rationale: V0.1's
value includes clearly demonstrating Manifest / Service Worker / Content
Script / Side Panel / Messaging; an extension framework would hide the core MV3
mechanics. If TASK 02 proves native Vite building seriously unmaintainable,
re-evaluate — but only after proof.

### Package Manager

Default: `npm` (ships with Node, lowest open-source barrier, simple V0.1
workspace). TASK 02 creates `package-lock.json`; CI uses `npm ci` for
reproducible installs.

### Node Version Strategy

Do not hardcode a possibly outdated Node version. Before TASK 02: check the
installed Node, choose a version that is currently supported, compatible with
the dependency set, suitable for hosted GitHub Actions, and a stable LTS
baseline. Then unify it across `package.json` engines, CI, and README. Three
different versions in Local / CI / Docs is forbidden.

## Testing Strategy

Test layers:

- **Unit tests**: URL parsing, domain utilities, extractor registry,
  serializers, error mapping, filename sanitization.
- **Fixture tests**: Generic Article extraction, GitHub Issue extraction,
  malicious HTML, Acceptance Criteria behavior.
- **Integration tests**: extraction pipeline, messaging contracts, capture
  state logic.
- **Browser Extension E2E**: loads the production build as a real Chromium
  extension. A Vite webpage test must NOT be presented as extension E2E.
- **Real Browser QA**: Chrome Side Panel, Edge smoke test when available. Live
  GitHub is read-only QA only and never a deterministic CI dependency.

### Fixture Strategy

All deterministic site-parsing tests use synthetic fixtures:

```text
fixtures/
├─ generic/
│  ├─ article-basic.html
│  ├─ article-no-content.html
│  └─ article-malicious.html
│
└─ github/
   ├─ issue-basic.html
   ├─ issue-with-acceptance-criteria.html
   ├─ issue-without-acceptance-criteria.html
   └─ issue-code-fence.html
```

Fixtures are created in later tasks. Never commit private repository HTML,
user sessions, cookies, tokens, or large amounts of copyrighted content.

### CI Strategy

CI expectation (workflow itself is created in a later task):

```text
install
↓
lint
↓
typecheck
↓
unit/integration
↓
build
↓
E2E
```

Hosted-Chromium E2E display needs (e.g. xvfb) are solved in TASK 08. Forbidden:
`continue-on-error: true`, `|| true`, skipping core tests, weak assertions.
Local PASS does not equal hosted CI PASS.

## Module Boundaries

Planned structure (design only — directories are created in later tasks):

```text
src/
├─ extension/
│  ├─ background/
│  ├─ content/
│  ├─ sidepanel/
│  └─ messaging/
│
├─ core/
│  ├─ capture/
│  ├─ extract/
│  ├─ normalize/
│  ├─ package/
│  ├─ serialize/
│  ├─ errors/
│  └─ types/
│
└─ adapters/
   ├─ generic/
   └─ github/

fixtures/
├─ generic/
└─ github/

tests/
├─ unit/
├─ integration/
└─ e2e/

docs/
└─ adr/
```

The real constraint is dependency direction:

```text
Extension UI
      ↓
Application/Core
      ↓
Domain
```

Adapters implement core-defined contracts. Core never imports React or Side
Panel components.

Agent package construction and agent-ready serialization belong to the
application/orchestration layer (introduced in TASK 06). That layer may
consume Core domain objects and pure normalized-source semantics exported by
source adapters (e.g. Source Acceptance Criteria extraction); Core never
imports adapters or the application layer. Serialization of canonical domain
objects to source Markdown remains in Core. Agent-ready output structurally
separates Page2Agent Agent Instructions from source facts, and treats all
source material as untrusted reference content.

## Alternatives Considered

- **Alternative A — DOM → Markdown directly.** Rejected: Markdown becomes the
  accidental source of truth, multi-target export is hard, semantic model is
  weak.
- **Alternative B — Backend-first architecture.** Rejected for V0.1:
  unnecessary, privacy cost, deployment cost, higher installation friction.
- **Alternative C — `<all_urls>` persistent content scripts.** Rejected by
  default: Page2Agent uses explicit user-triggered capture; least privilege.
- **Alternative D — Extension framework (WXT / Plasmo).** Deferred/rejected
  initially: V0.1 benefits from explicit MV3 architecture and does not yet
  need framework-level complexity.
- **Alternative E — Direct DOM automation of ChatGPT/Codex webpages.**
  Rejected: brittle, UI-coupled, not a reliable integration contract.
- **Alternative F — Direct browser → local Codex execution.** Rejected: a
  browser extension cannot safely treat local CLI execution as normal browser
  JS capability. Future architecture: Native Messaging Bridge.

## Consequences

Positive:

- source/target decoupling
- better testing
- local-first privacy
- minimal install requirements
- easier future target support

Negative (recorded honestly):

- requires an explicit normalization model
- site-specific adapters require maintenance
- GitHub DOM changes may break the adapter
- MV3 service-worker lifecycle introduces runtime complexity
- no direct Codex one-click flow in V0.1

## Deferred Work

- Codex / Claude Code integration via Native Messaging + Page2Agent Bridge
- MCP, RAG, vector database
- Obsidian integration
- Additional site adapters (Feishu, GitLab, GitHub PR)
- PDF deep parsing, OCR / Vision
- Chrome Web Store / Edge Add-ons publishing
- Git Tag / Release

## V0.1 Architecture Invariants

1. `NormalizedDocument` is the canonical representation; Markdown is only a
   serialization format.
2. `DOM → NormalizedDocument → Markdown`; never `DOM → Markdown → logic`.
3. Source content and Page2Agent-generated instructions are distinguishable in
   the data model and the output format.
4. GitHub-specific selectors live only inside the GitHub adapter.
5. Site-specific extractors win; generic extractor is the fallback; no
   selector-chain in core.
6. MV3 Service Worker is not durable; no reliance on module-level mutable
   state.
7. Least-privilege permissions; no `<all_urls>`; capture is user-triggered.
8. All page content is untrusted input; messages are validated at runtime.
9. Latest capture wins; no duplicate listeners on repeated capture.
10. Structured typed errors only; UI shows user-readable messages.
11. No backend, database, provider API, or secret handling in V0.1.
12. Deterministic serializers; no silent content truncation.
