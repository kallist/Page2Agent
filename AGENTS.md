# AGENTS.md — Page2Agent

> Project: **Page2Agent V1.1 — Visual Context Workbench**
> Product positioning: **Turn any webpage into agent-ready context.**
> (V1.1: pick the right context, build the right task, send it to any agent —
> web pages → structured, source-grounded context and tasks; see
> `docs/adr/ADR-002-page2agent-v1.1-workbench.md` for the V1.1 decisions.)
> This file is the canonical, long-lived engineering contract for all agents and
> contributors working on this repository. Every stage MUST read it first.

---

## 0. Source of Truth

1. **Repository facts are the source of truth.** If this file, an ADR, or a stage
   prompt conflicts with the actual code / repo state, audit the repository first
   and trust the more reliable project facts. Never assume from thin air.
2. Never assume the repository is empty or brand new. Always inspect before acting.
3. When a stage prompt references "the contract", it means this file and the
   project ADRs, unless the stage explicitly overrides them.

---

## 1. Core Engineering Rules

1. Before modifying any code, first understand the existing repository.
2. At the start of every new stage, read, in this order:
   - `AGENTS.md` (this file)
   - `README.md`
   - `CONTRIBUTING.md`
   - `docs/adr/`
   - `package.json`
   - stage-relevant source code
   - stage-relevant tests
   - Git status
3. Never assume the repository is an empty project.
4. The repository's actual current state is the source of engineering facts.
5. Respect the existing architecture, directory structure, code style, test
   system, and CI.
6. Do not refactor unrelated code just to complete the current task.
7. Prefer the minimal, reliable, maintainable implementation.
8. Do NOT pre-add any of the following "for future needs":
   - Backend / Database / Event Bus / DI Container / Plugin Framework /
     Microservice / Cloud Infrastructure
9. Before adding any dependency, justify:
   - Why it is needed.
   - Whether an alternative already exists in the project.
   - Runtime vs Dev dependency.
   - Whether the maintenance cost is truly worth it.
10. If a requirement has only small-scope uncertainty and no major architecture /
    security / product blocker, pick a reasonable default and continue. Do not
    pester the user with frequent questions.

---

## 2. Product Definition

- **Positioning:** Turn any webpage into agent-ready context.
- **Core execution chain:**
  `Capture → Extract → Normalize → Package → Deliver`
- **V0.1 core value is NOT "webpage to Markdown".** The real core is:
  `Web Page → Structured Context → Agent-ready Context`

---

## 3. V0.1 Scope — IMPLEMENTED

V0.1 implements:

- Chrome Manifest V3
- Edge Chromium compatibility
- Side Panel
- User-triggered page capture
- Generic Article Extraction
- GitHub Issue Extraction
- `NormalizedDocument`
- `AgentPackage`
- Markdown Serialization
- Agent Context Serialization
- Copy for Agent
- Copy Markdown
- Download Markdown
- Fixtures
- Unit Tests
- Integration Tests
- Extension E2E
- CI
- Documentation
- Independent Review
- Draft PR

---

## 4. V0.1 Explicit Non-goals

The following are FORBIDDEN in V0.1 unless a future stage explicitly amends scope:

- Direct Codex execution
- Claude Code integration
- Native Messaging
- Page2Agent Bridge
- MCP
- RAG
- Vector Database
- Backend
- FastAPI
- Express
- Database
- SQLite
- PostgreSQL
- Redis
- LLM Summary
- OpenAI API
- Anthropic API
- Provider API Key
- PDF parser
- OCR
- Bilibili transcript
- ASR
- Obsidian integration
- Cloud Sync
- Login
- Account system
- Analytics
- Telemetry
- Billing
- Release
- Git Tag

Do not extend scope on your own.

---

## 5. Architecture Invariants

Canonical Pipeline:

```
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
AgentPackageBuilder
  ↓
AgentPackage
  ↓
Serializer
  ↓
Copy / Download
```

Core domain types:

- `PageContext`
- `NormalizedDocument`
- `AgentPackage`

Core extractors:

- `GenericArticleExtractor`
- `GitHubIssueExtractor`

**Markdown is NOT the internal source of truth.**
Forbidden flow:

```
DOM → Markdown → all later logic operates on Markdown
```

Required flow:

```
DOM → NormalizedDocument → Markdown
```

`NormalizedDocument` is the canonical representation.

---

## 6. Architecture Boundaries

Keep these layers clean:

```
Browser UI
  ↓
Extension Runtime
  ↓
Application / Orchestration
  ↓
Domain / Extraction
  ↓
Serialization / Infrastructure
```

- Core domain MUST NOT depend on: React, Side Panel, Clipboard UI,
  Chrome UI components.
- Extractors MUST NOT be responsible for: React rendering, Clipboard,
  Download UI, `chrome.storage`, Provider API, Backend.
- GitHub-specific selectors MUST stay inside the GitHub Adapter.
  They MUST NOT leak into the Generic Core.

---

## 7. Source Truth Boundary

Strictly separate:

- **SOURCE CONTENT** (what the page actually says)
- **PAGE2AGENT GENERATED INSTRUCTIONS** (what Page2Agent itself produces)

Example: if a GitHub Issue does not contain "Acceptance Criteria", the output
MUST state:

```
Source Acceptance Criteria:
Not explicitly provided in source.
```

Forbidden: inventing requirements (e.g. "Add tests", "Fix concurrency",
"Update docs") and presenting them as the Issue's original demands.

Page2Agent-generated engineering requirements may only appear in
**Page2Agent Agent Instructions**. Source data and generated data MUST be
distinguishable in both the data model and the output format.

---

## 8. Browser Security

Treat ALL web page content as **UNTRUSTED INPUT**.

Forbidden:

- `eval`
- `new Function`
- remotely hosted executable JavaScript
- directly injecting user webpage HTML into the privileged Side Panel
- rendering un-sanitized webpage HTML via `dangerouslySetInnerHTML`

Runtime messages MUST be validated. Never trust `message as SomeType`.
Data crossing extension contexts is `unknown` first, then runtime-validated.

---

## 9. Permissions

Follow Least Privilege. V0.1 prefers:

- `activeTab`
- `scripting`
- `sidePanel`
- `storage`

Do NOT request by default:

- `<all_urls>`
- `cookies`
- `history`
- `bookmarks`
- `webRequest`
- `nativeMessaging`

An extra permission is allowed only if the implementation proves it is
unavoidable: document WHY it is needed and update the corresponding ADR.

---

## 10. Secret Security

V0.1 theoretically has no Provider API secrets. Any future secret MUST NEVER
appear in:

- Browser frontend
- Git
- Fixtures
- Test snapshots
- Console logs
- Traces
- `chrome.storage`
- Source maps

Never commit: API keys, GitHub tokens, cookies, Authorization headers, session data.

---

## 11. MV3 Runtime Rules

Manifest V3 Service Worker is NOT a durable process. Forbidden: relying on
module-level mutable state (`let currentJob = ...`, `let currentDocument = ...`)
persisting forever.

Always account for Service Worker suspend / restart. State placement by nature:

- Side Panel state
- `chrome.storage.session`
- `chrome.storage.local`

Captured page data defaults to session lifetime only. Do not permanently store
user webpage content by default.

---

## 12. Race Conditions

Must handle seriously:

```
Capture A
Capture B
B completes
A completes last
```

The final UI MUST show **B**; stale A must never overwrite it.

Every capture is associated with at least:

- `captureId`
- `tabId`
- `url`
- `capturedAt`

**Latest capture wins.** Repeated captures must not produce: duplicate
listeners, duplicate responses, stale UI state.

---

## 13. Failure Handling

No scattered `throw new Error("failed")`. Use structured errors. At minimum
consider:

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

The user UI must never show raw stack traces.

---

## 14. Testing Rules

Tests must prove real behavior. Forbidden:

- skipping legitimate tests
- weakening assertions
- deleting failing regression tests
- `continue-on-error`
- `|| true`
- mocking away the core real behavior and then declaring the feature passes

Must be specifically covered:

- Extraction
- Serialization
- Source/generated separation
- GitHub Issue parsing
- No invented Acceptance Criteria
- Unsafe URL handling
- Race conditions
- Repeated capture
- Malformed messages
- Build artifacts
- Extension runtime
- E2E

Local PASS does not imply Hosted CI PASS.

---

## 15. Fixtures

Tests MUST NOT depend on live github.com to pass.

- GitHub and Generic Article tests use synthetic HTML fixtures.
- Never commit: real private GitHub pages, user privacy, cookies, tokens,
  private repository HTML, large amounts of copyrighted content.
- Live GitHub may only be used as extra Browser QA — never as the sole source
  of truth for deterministic CI.

---

## 16. Git Rules

Development defaults to branch:

```
feat/page2agent-v0.1
```

(or the actual established feature branch/worktree).

Forbidden:

- `git reset --hard`
- force push
- deleting user work
- overwriting uncommitted changes

…unless provably safe and genuinely necessary.

On feature completion, default to: **Commit → Push → Draft PR**.
Never automatically: Merge, Tag, Release — unless the user explicitly asks.

---

## 17. Independent Review

Implementation done ≠ engineering done. Final step is an independent review.

The reviewer MUST re-inspect:

```
git diff <base>...HEAD
```

Review dimensions:

- Architecture
- Correctness
- MV3
- Security
- Permissions
- Race conditions
- Failure handling
- Type safety
- Extraction
- Serialization
- UI
- Testing
- CI
- Documentation
- Scope creep

Findings classified: `BLOCKER` / `HIGH` / `MEDIUM` / `LOW`.

After findings: Fix → Regression Test → Re-run Tests → Final Verification.
Forbidden: changing code after review without re-running tests.

---

## 18. Truthful Reporting

Never fabricate:

- Command output
- Test results / test counts
- Browser QA
- Commit SHA
- Branch
- Git status
- PR URL
- Hosted CI
- GitHub state

Final reports MUST clearly distinguish:

- `IMPLEMENTED`
- `TESTED`
- `NOT TESTED`
- `NOT IMPLEMENTED`

No test → write `NOT TESTED`. Environment prevents execution → write `BLOCKED`.
Never write "should pass", "basically fine", "looks OK".

---

## 19. Stage Execution Rules

V0.1 is developed in stages (`TASK 03`, `TASK 04`, ...). On receiving a stage
task, the FIRST step is always:

1. Read the current repository.
2. Read `AGENTS.md`.
3. Read the Architecture ADR.
4. Read stage-relevant code.
5. Read stage-relevant tests.
6. Check git diff/status.
7. Then make the stage's internal execution plan.

Then execute immediately — do not only output a plan.
Do NOT enter the next stage without permission.
Stop after completing the current stage.

---

## 20. Harness Subagent Rules

When delegating to a DeepSeek Harness subagent:

- Write the task as a complete standalone instruction.
- Never assume the subagent can see the main agent's chat context.
- Delegated tasks MUST include:
  - Project context
  - Goal
  - Scope
  - Relevant files/modules
  - Constraints
  - Expected output
  - Verification requirements

The main agent MUST re-check subagent output. Subagent results are NOT
automatically trustworthy. Final engineering correctness is the main agent's
responsibility.

---

## 21. Stage Completion Report

Every completed stage MUST output:

```
PAGE2AGENT TASK XX REPORT

STATUS

IMPLEMENTED
- ...

TESTED
- <actual command> → <actual result>

NOT TESTED
- ...

NOT IMPLEMENTED
- ...

FILES CHANGED
- ...

ARCHITECTURE DECISIONS
- ...

TEST / VERIFICATION
- ...

RISKS / LIMITATIONS
- ...

GIT
Branch: ...
HEAD: ...
Working Tree: ...

NEXT STAGE READY:
YES / NO
```

If `NO`: state the blocker explicitly.
