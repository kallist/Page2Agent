# Page2Agent V1.1 — User Guide

Page2Agent turns pages into structured, source-grounded context and tasks for
AI agents: **Pick → Add → Choose Task → Copy**.

## 1. Capture a page

Click the Page2Agent toolbar icon **on the page you care about**. The Side
Panel opens and capture starts automatically for that exact tab.

The panel then shows the **source card** (page type, adapter, URL, capture
time, estimated tokens) and a ready-to-use agent context for a single page.
To capture again or another tab, click the toolbar icon there.

## 2. Pick the right context (Context Lens)

1. Click **Pick Context** in the panel.
2. On the page, move the mouse: semantic areas (sections, code blocks,
   tables, quotes, lists) highlight softly with a floating label and an
   estimated token count.
3. **Click an area** to include it; click it again to exclude. The dock
   counts selected areas and estimated tokens live.
4. Press **Done** in the dock (or **Esc** to cancel without keeping picks).
5. In the panel choose **Add to Context** to save the picked areas as one
   Context source.

The lens never modifies the page: highlights live in an overlay and are
removed when you leave lens mode.

### Plain text selection

Selected text on the page can be added directly: when the panel detects a
selection it shows **+ Add selection to Context** — no lens needed.

## 3. Combine sources (Context Cart)

- **+ Add to Context** stores the current capture (or picked sections) in
  the Context Cart — session-only, per browser window.
- Change each source's **role** (Task / Reference / Evidence / Example /
  Selection) with the dropdown and mark the **primary** source with ★.
- Use ↑/↓ to order sources, **Clear**/**Undo** for destructive actions.
- The cart is the build basis: with two or more sources **Compare** unlocks.

## 4. Choose what the agent should do (Recipes)

Pick one of five: Learn, Compare, Verify, Build, Fix. Page2Agent recommends a
recipe based on the adapters (e.g. issue → Fix, docs → Build, article →
Learn) — the choice is always yours. Compare is disabled until the cart has
two sources; Page2Agent never fabricates comparisons or requirements.

## 5. Inspect (Agent | Markdown | TaskSpec + Context Receipt)

Three preview tabs always show what would be sent:

- **Agent** — generated task facts + instructions, then every source clearly
  separated with role/type/URL/capture metadata.
- **Markdown** — the faithful source partition.
- **TaskSpec** — the versioned JSON task contract (`schemaVersion "1.0"`),
  with **Copy JSON** / **Download JSON**.

The **Context Receipt** below lists observable facts: what is Included vs
Excluded, what Page2Agent Generated, what remains Unknown, estimated tokens
and a deterministic Context facts block (source/generated/metadata share
bars, counts, explicit acceptance criteria ✓/✗/—, provenance, status).

## 6. Deliver

- **Copy for Agent** — paste into any AI agent; the generated instructions
  are separated from untrusted source content by an explicit trust boundary.
- Or copy/download TaskSpec JSON for structured consumers.

## Trust & privacy notes

- Source content on web pages is **untrusted data**: instructions found on a
  page are never treated as higher-priority instructions by Page2Agent.
- Everything runs locally. No backend, no accounts, no sync, no telemetry.
- Token numbers are heuristic **estimates**, not model tokenizer output.
