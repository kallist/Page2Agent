# ADR-002 — Page2Agent V1.1 Visual Context Workbench

Status: accepted
Date: 2026
Supersedes: nothing (extends ADR-001)

## Context

V0.1 turned a captured page into one AgentPackage/markdown blob. V1.1 turns
the product into a *Visual Context Workbench*: users understand a page, pick
which areas matter, combine several sources, choose what the agent should do,
inspect exactly what would be sent, and deliver it to any agent.

Six features are in scope: Context Lens, Context Cart, Context Recipes,
Semantic Adapter 2.0 (Generic + GitHub Issue + GitHub Pull Request +
Technical Documentation), TaskSpec, and Context Receipt + Context Nutrition
Label. Everything outside that list (AI chat, RAG, repository retrieval,
cloud sync, MCP, PDF/OCR, agent execution) is out of scope; repository
retrieval belongs to the separate ContextForge project.

## Decisions

### D1 — NormalizedDocument gains capture provenance, schema stays v1

`NormalizedDocument` keeps `schemaVersion: 1` and gains an OPTIONAL
`capture?: { adapter: {id, name}, scope: "full-page"|"selection"|
"text-selection" }`. Legacy session documents remain valid; new adapters
always write it. The adapter identity tells receipts/nutrition/recipes
exactly which pipeline produced the blocks; scope records user picking.
Source kinds gain `github_pull_request` (identity from URL only).

Why: additive, backward-compatible, and receipts must never re-run
detection. The strict allowed-key validator was extended, not relaxed.

### D2 — Workbench domain is pure core; serialization is application

`src/core/workbench` holds ContextSourceItem/ContextCart reducers, recipes,
TaskSpec types and receipt/nutrition derivation with strict runtime
validators — no React, no chrome. `src/application/workbench` builds
TaskSpecs, JSON/agent/markdown text, and selection fragment documents.

Why: cart/taskspec logic is testable in plain Node and reusable by future
consumers; delivery formats stay derived, never canonical.

### D3 — Markdown remains a delivery format

Sources keep their blocks; TaskSpec sources embed deterministic
`contentMarkdown` derived from blocks at build time. Agent text and Markdown
previews serialize from the same spec so tabs can never disagree.

### D4 — Semantic adapters, honest classification

Registry priority: GitHub Issue → GitHub PR → Technical Docs → Generic.
The docs adapter shares Generic's URL eligibility and inside `extract()`
classifies with a deterministic weighted detector
(`assessDocsKind`); if confidence is insufficient it returns the generic
pipeline and records `generic-article` — never a false "Technical
Documentation" claim. GitHub body regions picked by the Lens convert with
the same clone-only task-list normalization as the full-page adapter.

### D5 — Context Lens is DOM-immutable by construction

The lens resolves *semantic regions* (atomic blocks like pre/table/quote/
list/figure, or heading-anchored runs of siblings) without touching the page
tree. All visuals live in ONE shadow-root host; state events are broadcast;
cleanup removes listeners/host/rAF on deactivate/finish/Escape/pagehide and
duplicate hosts are pre-removed. An innerHTML byte-equality regression test
guards immutability.

### D6 — Cart state is a pure reducer; persistence is per-window session

Cart operations are immutable reducer functions (≤1 primary invariant,
single-shot undo, cap 12). The panel persists one key per browser window in
`chrome.storage.session`; invalid records degrade to an empty cart. Captured
documents are cached one-per-window under their own session key so "Add
current page to Context" never re-extracts; cache writes never fail a
capture.

### D7 — The panel orchestrates; the worker routes

The panel owns cart/build state and lens UI state. Lens requests
(enter/query/materialize/clear/text-selection probe & capture) travel
Panel → Service Worker router → content script and back; responses are
validated from `unknown`. Live lens inclusion counts stream to the panel via
`lens.state.event` broadcasts. No tabs permission was added.

### D8 — Recipes gate instead of guessing

Exactly five recipes exist. Compare requires ≥2 sources; a single-source
Context shows the recipe disabled with an explicit message and TaskSpec
building refuses (no fake comparisons). Suggestions are adapter-aware but
advisory only.

### D9 — TaskSpec unknowns never invent

`requirements.acceptanceCriteria` is null unless the source explicitly
provided an Acceptance/Requirements/Definition-of-Done section; a missing
value for fix tasks is also surfaced as a deterministic `unknowns` entry.
Target repository is emitted only when explicit (primary GitHub source, or
exactly one distinct repository in the cart); ambiguity is null.

### D10 — Token estimates are a labeled heuristic

One deterministic offline estimator (`page2agent-heuristic-v1`: CJK code
points count 1, other code points 1/4, ceiling) is used across lens, cart,
TaskSpec, receipt and nutrition. Every surface says "estimated tokens"; no
model-tokenizer equivalence is implied. Nutrition percentages are derived
from the same estimates and always labeled.

### D11 — Delivery formats

Agent text partitions generated task facts/instructions from the Sources;
the Markdown tab carries only the source partition. TaskSpec JSON is
pretty-printed, key-ordered and byte-deterministic for a given cart+recipe.

## Consequences

- Receipts/nutrition/task specs can be unit-tested without the browser.
- Adapter adds are localized (registry + selectors + capture field).
- Panel logic is thin over a pure model, so future consumers (ContextForge,
  CLIs, harnesses) consume TaskSpec JSON without Page2Agent internals.
- Lens DOM-immutability regression prevents overlay leaks into captures.
