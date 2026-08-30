import { useState } from "react";
import {
  isRuntimeCheckFailure,
  isRuntimeCheckSuccess,
  RUNTIME_CHECK_REQUEST,
} from "../messaging/runtime-messages";

type CheckState = "idle" | "checking" | "success" | "error";

const FALLBACK_ERROR_MESSAGE = "Current page cannot be accessed.";

/**
 * TASK 02 foundation UI. This is a runtime foundation check, NOT a page
 * capture: it only proves the Service Worker → Content Script round-trip.
 */
export default function App() {
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function checkCurrentPageAccess(): Promise<void> {
    setCheckState("checking");
    setErrorMessage(null);
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: RUNTIME_CHECK_REQUEST,
        requestId: crypto.randomUUID(),
      });
      if (isRuntimeCheckSuccess(response)) {
        setCheckState("success");
        return;
      }
      if (isRuntimeCheckFailure(response)) {
        setCheckState("error");
        setErrorMessage(response.message);
        return;
      }
      setCheckState("error");
      setErrorMessage(FALLBACK_ERROR_MESSAGE);
    } catch {
      setCheckState("error");
      setErrorMessage(FALLBACK_ERROR_MESSAGE);
    }
  }

  return (
    <main className="panel">
      <header className="panel-header">
        <h1>Page2Agent</h1>
        <p className="tagline">Browser context bridge</p>
      </header>

      <section className="status" aria-label="Extension status">
        <p className="runtime-status">Extension runtime ready.</p>
        <p className="capture-hint">No page has been captured yet.</p>
      </section>

      <button
        type="button"
        className="primary-action"
        onClick={() => void checkCurrentPageAccess()}
        disabled={checkState === "checking"}
        aria-busy={checkState === "checking"}
      >
        {checkState === "checking" ? "Checking…" : "Check Current Page Access"}
      </button>

      <section className="result" aria-live="polite">
        {checkState === "success" && (
          <p className="result-success">Current page is accessible.</p>
        )}
        {checkState === "error" && (
          <p className="result-error">{errorMessage ?? FALLBACK_ERROR_MESSAGE}</p>
        )}
      </section>
    </main>
  );
}
