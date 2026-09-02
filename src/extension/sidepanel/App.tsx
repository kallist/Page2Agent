import { useMemo, useState } from "react";
import {
  createProductionSessionDeps,
  useCaptureSession,
} from "./capture-session";
import type { CaptureSessionDeps } from "./capture-session";
import { copyTextToClipboard } from "./clipboard";
import { downloadMarkdown } from "./download";
import { createPreview, PREVIEW_TRUNCATED_MESSAGE } from "./preview";

type Feedback =
  | null
  | "copied-agent"
  | "copied-markdown"
  | "downloaded"
  | "clipboard-error"
  | "download-error";

const CLIPBOARD_ERROR_MESSAGE = "Could not copy to the clipboard. Please try again.";
const DOWNLOAD_ERROR_MESSAGE = "Could not create the Markdown download.";
export const TOOLBAR_CAPTURE_MESSAGE =
  "To capture this page, click the Page2Agent toolbar icon.";
export const TOOLBAR_RECAPTURE_MESSAGE =
  "To capture this page again, click the Page2Agent toolbar icon.";

/**
 * Production Side Panel product slice (TASK 07): Idle / Capturing / Captured /
 * Error states, Agent + Markdown previews (plain text), Copy for Agent,
 * Copy Markdown, and Download Markdown.
 */
export default function App({ deps }: { deps?: CaptureSessionDeps }) {
  const sessionDeps = useMemo(() => deps ?? createProductionSessionDeps(), [deps]);
  const { view } = useCaptureSession(sessionDeps);
  const [activeTab, setActiveTab] = useState<"agent" | "markdown">("agent");
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function handleCopyAgent(): Promise<void> {
    if (view.status !== "captured") {
      return;
    }
    try {
      await copyTextToClipboard(view.result.agentContext);
      setFeedback("copied-agent");
    } catch {
      setFeedback("clipboard-error");
    }
  }

  async function handleCopyMarkdown(): Promise<void> {
    if (view.status !== "captured") {
      return;
    }
    try {
      await copyTextToClipboard(view.result.markdown);
      setFeedback("copied-markdown");
    } catch {
      setFeedback("clipboard-error");
    }
  }

  function handleDownload(): void {
    if (view.status !== "captured") {
      return;
    }
    try {
      downloadMarkdown(view.result.filename, view.result.markdown);
      setFeedback("downloaded");
    } catch {
      setFeedback("download-error");
    }
  }

  return (
    <main className="panel">
      <header className="panel-header">
        <h1>Page2Agent</h1>
        <p className="tagline">Agent-ready context from the current page.</p>
      </header>

      {view.status === "idle" && (
        <section className="status" aria-label="Extension status">
          <p>No page captured yet.</p>
          <p>{TOOLBAR_CAPTURE_MESSAGE}</p>
        </section>
      )}

      {view.status === "capturing" && (
        <section className="status" aria-live="polite">
          <p>Capturing current page…</p>
        </section>
      )}

      {view.status === "error" && (
        <section className="status" aria-live="polite">
          <p className="result-error">{view.error.message}</p>
          <p>{TOOLBAR_RECAPTURE_MESSAGE}</p>
        </section>
      )}

      {view.status === "captured" && (
        <CapturedView
          title={view.result.title}
          sourceKind={view.result.sourceKind}
          actionKind={view.result.actionKind}
          url={view.result.url}
          stats={view.result.stats}
          agentContext={view.result.agentContext}
          markdown={view.result.markdown}
          filename={view.result.filename}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          feedback={feedback}
          onCopyAgent={() => void handleCopyAgent()}
          onCopyMarkdown={() => void handleCopyMarkdown()}
          onDownload={handleDownload}
        />
      )}
    </main>
  );
}

interface CapturedViewProps {
  title: string;
  sourceKind: "web" | "github_issue";
  actionKind: "use_as_context" | "fix_issue";
  url: string;
  stats: { characters: number; codeBlocks: number; links: number };
  agentContext: string;
  markdown: string;
  filename: string;
  activeTab: "agent" | "markdown";
  onTabChange(tab: "agent" | "markdown"): void;
  feedback: Feedback;
  onCopyAgent(): void;
  onCopyMarkdown(): void;
  onDownload(): void;
}

function CapturedView(props: CapturedViewProps) {
  const preview = createPreview(
    props.activeTab === "agent" ? props.agentContext : props.markdown,
  );
  const sourceLabel = props.sourceKind === "github_issue" ? "GitHub Issue" : "Web Page";
  const actionLabel = props.actionKind === "fix_issue" ? "Fix this issue" : "Use as context";

  return (
    <section className="captured" aria-live="polite">
      <div className="summary">
        <span className="source-badge">{sourceLabel}</span>
        <span className="action-badge">{actionLabel}</span>
        <h2 className="summary-title" title={props.title}>
          {props.title}
        </h2>
        <p className="summary-url" title={props.url}>
          {props.url}
        </p>
      </div>

      <div className="stats">
        <span className="stat">{formatNumber(props.stats.characters)} chars</span>
        <span className="stat">{props.stats.codeBlocks} code blocks</span>
        <span className="stat">{props.stats.links} links</span>
      </div>

      <div className="preview">
        <div className="tabs" role="tablist" aria-label="Preview type">
          <button
            type="button"
            role="tab"
            aria-selected={props.activeTab === "agent"}
            className={props.activeTab === "agent" ? "tab active" : "tab"}
            onClick={() => props.onTabChange("agent")}
          >
            Agent
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={props.activeTab === "markdown"}
            className={props.activeTab === "markdown" ? "tab active" : "tab"}
            onClick={() => props.onTabChange("markdown")}
          >
            Markdown
          </button>
        </div>
        <div
          role="tabpanel"
          className="preview-body"
          aria-label={props.activeTab === "agent" ? "Agent context preview" : "Markdown preview"}
        >
          <pre>{preview.text}</pre>
          {preview.truncated && <p className="preview-note">{PREVIEW_TRUNCATED_MESSAGE}</p>}
        </div>
      </div>

      <div className="actions">
        <button type="button" onClick={props.onCopyAgent}>
          Copy for Agent
        </button>
        <button type="button" onClick={props.onCopyMarkdown}>
          Copy Markdown
        </button>
        <button type="button" onClick={props.onDownload}>
          Download Markdown
        </button>
      </div>

      <p className="recapture-note">{TOOLBAR_RECAPTURE_MESSAGE}</p>

      <p className="feedback" role="status" aria-live="polite">
        {props.feedback === "copied-agent" && "Agent context copied."}
        {props.feedback === "copied-markdown" && "Markdown copied."}
        {props.feedback === "downloaded" && "Markdown downloaded."}
        {props.feedback === "clipboard-error" && CLIPBOARD_ERROR_MESSAGE}
        {props.feedback === "download-error" && DOWNLOAD_ERROR_MESSAGE}
      </p>
    </section>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}
