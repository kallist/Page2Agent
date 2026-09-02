# Page2Agent

Turn the current browser page into structured, agent-ready context.

Page2Agent is a lightweight open-source Chrome / Edge extension that captures
the page you are looking at, extracts it into a structured document, and
produces two deliverables you can use immediately:

- **Agent-ready Context** — a clearly separated, provider-neutral context block
  with Page2Agent instructions and source facts.
- **Source Markdown** — a faithful Markdown representation of the page content.

Supported sources:

- **Generic articles** — technical blog posts, docs pages, tutorials, and other
  long-form content.
- **GitHub Issues** — issue title, body, labels, and explicitly written
  acceptance criteria (when the issue actually contains them).

Everything runs locally inside the extension. There is no Page2Agent backend,
no analytics, and no telemetry.

## Features

- Generic article extraction (Readability-based main-content detection)
- GitHub Issue extraction with source acceptance criteria
- Structured `NormalizedDocument` as the canonical model
- Agent-ready context serialization with a prompt-injection trust boundary
- Source Markdown serialization
- Side Panel UI with Agent / Markdown previews
- Copy for Agent, Copy Markdown, and Download Markdown
- Safe filename generation
- Strictly separated Source Content / Source-derived facts / Page2Agent
  instructions

## Install (development load)

No store release exists yet — load the built extension unpacked.

Prerequisites: Node.js 24 (see `.nvmrc`).

```text
npm ci
npm run build
```

Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` folder

Edge:

1. Open `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` folder

## Usage

1. Open a normal webpage (or a GitHub issue).
2. Click the Page2Agent extension action to open the Side Panel.
3. Click **Capture Current Page**.
4. Review the **Agent** or **Markdown** preview.
5. **Copy for Agent**, **Copy Markdown**, or **Download Markdown**.

For GitHub issues, the action mode is **Fix this issue** — that is an
agent-ready context action, not direct execution. Page2Agent never runs
commands or sends the context anywhere on its own.

## Architecture

```text
Capture → Extract → Normalize → Package → Deliver
```

- **Side Panel** — user interaction, preview, copy, download.
- **Service Worker** — capture orchestration, packaging, session state.
- **Content Script** — programmatic, isolated-world DOM extraction.
- **Adapters** — Generic Article and GitHub Issue extractors.
- **Core** — domain model, validation, URL security, serialization.
- **Application** — agent packaging and delivery helpers.

## Privacy

- Capture is always user-triggered; nothing is captured in the background.
- All processing happens locally in the extension.
- No Page2Agent backend, no analytics, no telemetry, no provider API keys,
  and no automatic upload.
- Each browser window's latest capture result is stored only in
  `chrome.storage.session` (cleared when the browser closes); no capture
  history is kept.
- Full page content is never written to `chrome.storage.local`.

## Permissions

- `activeTab` — temporary page access granted when the user invokes the
  Page2Agent extension action on that tab.
- `scripting` — programmatic content-script injection.
- `sidePanel` — the Side Panel UI.
- `storage` — session-only capture state.

Page2Agent does not request `<all_urls>`, host permissions, `tabs`,
`downloads`, or any browsing-data permissions.

## Development

```text
npm run lint            ESLint
npm run typecheck       TypeScript strict check
npm run test            Vitest (unit / integration / component)
npm run test:e2e        build + Playwright MV3 extension E2E (headed Chromium)
npm run build           production extension build + artifact validation
npm run verify          fast deterministic gate (lint + typecheck + test + build)
npm run verify:all      verify + E2E
```

`npm run test:e2e` uses a **test-only harness** (`dist-e2e/`, gitignored):
the production build plus a test manifest that grants the local fixture origin
(`http://127.0.0.1/*`) host access to replace the activeTab grant that GUI
automation cannot reliably trigger. It does not validate the production
activeTab grant UX or the native Side Panel container — see below.

## Testing

- **Unit** — domain, validators, messaging, session, filename, preview.
- **Integration** — extraction pipelines and packaging through fixtures.
- **Component** — Side Panel states and actions (Testing Library).
- **Browser E2E** — the built extension in real Chromium (Playwright).
- **Manual browser QA** — native Side Panel, activeTab grant UX, real GitHub
  pages; not automated.

## Limitations

- `activeTab` grants expire with the tab/session: if the Side Panel stays open
  and you switch to a tab that never granted Page2Agent access, capture fails
  with a friendly message — reopen Page2Agent from the target page.
- Readability-based extraction is heuristic; app-like or script-rendered-only
  pages may not extract.
- GitHub DOM changes can break the GitHub adapter over time.
- iframes and PDFs are not captured.
- GitHub issue comments are intentionally excluded from captures.
- The preview is plain text, not rendered Markdown.
- Only the latest capture is kept; there is no history.
- The generated trust boundary mitigates prompt injection — it does not make
  the context immune to it.

## Roadmap (not in V0.1)

- Native Messaging bridge for direct coding-agent integration
- MCP / RAG connectors
- Additional site adapters
- Richer PDF handling

## License

MIT — see [LICENSE](LICENSE).
