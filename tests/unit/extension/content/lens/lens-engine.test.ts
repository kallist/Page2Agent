// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createLensEngine,
  LENS_HOST_ID,
} from "../../../../../src/extension/content/lens/lens-engine";
import type { LensEngine } from "../../../../../src/extension/content/lens/lens-engine";

function pageHtml(): void {
  document.body.innerHTML = `
    <main>
      <h2 id="h-repro">Reproduction</h2>
      <p id="p1">First paragraph with content.</p>
      <p id="p2">Second paragraph with more content.</p>
      <button id="btn" type="button">A button</button>
    </main>
  `;
}

function makeEngine(extra: { onState?: () => void; onFinish?: () => void } = {}): LensEngine {
  pageHtml();
  return createLensEngine({
    document,
    window,
    onState: extra.onState,
    onFinish: extra.onFinish,
  });
}

function clickOn(target: Element): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  target.dispatchEvent(event);
  return event;
}

function keyOnDocument(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

function host(): HTMLElement | null {
  return document.getElementById(LENS_HOST_ID);
}

describe("lens engine lifecycle", () => {
  it("activates once with a shadow host and deactivates cleanly", () => {
    const engine = makeEngine();
    expect(engine.isActive()).toBe(false);
    expect(engine.activate()).toBe(true);
    expect(engine.activate()).toBe(false); // idempotent
    expect(engine.isActive()).toBe(true);
    expect(host()).not.toBeNull();
    expect(host()?.shadowRoot).not.toBeNull();
    expect(engine.deactivate()).toBe(true);
    expect(engine.isActive()).toBe(false);
    expect(host()).toBeNull();
  });

  it("leaves the page DOM byte-identical after activation and interaction", () => {
    const engine = makeEngine();
    const before = document.documentElement.innerHTML;
    engine.activate();
    const p2 = document.getElementById("p2")!;
    p2.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
    clickOn(p2);
    clickOn(p2);
    engine.deactivate();
    expect(document.documentElement.innerHTML).toBe(before);
  });

  it("toggles regions on click and reports state", () => {
    const states: number[] = [];
    const engine = makeEngine({ onState: () => states.push(engine.snapshot().selectedCount) });
    engine.activate();
    const p2 = document.getElementById("p2")!;
    const event = clickOn(p2);
    expect(event.defaultPrevented).toBe(true);
    expect(engine.snapshot().selectedCount).toBe(1);
    expect(engine.snapshot().estimatedTokens).toBeGreaterThan(0);
    clickOn(p2);
    expect(engine.snapshot().selectedCount).toBe(0);
    expect(states).toEqual([0, 1, 0]);
  });

  it("selects the paragraph under a link while preventing navigation", () => {
    document.body.innerHTML = `<main><p id="a1">Read <a id="lnk" href="https://example.com/x">this</a>.</p></main>`;
    const engine = createLensEngine({ document, window });
    engine.activate();
    const event = clickOn(document.getElementById("lnk")!);
    expect(event.defaultPrevented).toBe(true);
    expect(engine.snapshot().selectedCount).toBe(1);
  });

  it("never picks interactive controls", () => {
    const engine = makeEngine();
    engine.activate();
    const event = clickOn(document.getElementById("btn")!);
    expect(event.defaultPrevented).toBe(false);
    expect(engine.snapshot().selectedCount).toBe(0);
  });

  it("cancels with Escape and discards picks", () => {
    const engine = makeEngine();
    engine.activate();
    clickOn(document.getElementById("p1")!);
    const event = keyOnDocument("Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(engine.isActive()).toBe(false);
    expect(host()).toBeNull();
  });

  it("finishes with picks retained and notifies the caller", () => {
    let finished = 0;
    const engine = makeEngine({ onFinish: () => (finished += 1) });
    engine.activate();
    clickOn(document.getElementById("p1")!);
    engine.finish();
    expect(engine.isActive()).toBe(false);
    expect(finished).toBe(1);
    expect(engine.snapshot().selectedCount).toBe(1);
    expect(engine.selectedRegions()).toHaveLength(1);
    // The next lens session starts clean.
    engine.activate();
    expect(engine.snapshot().selectedCount).toBe(0);
  });

  it("reset clears picks while staying active", () => {
    const engine = makeEngine();
    engine.activate();
    // Two DISTINCT regions: heading-led section vs paragraph-only run.
    clickOn(document.getElementById("h-repro")!);
    clickOn(document.getElementById("p2")!);
    expect(engine.snapshot().selectedCount).toBe(2);
    expect(engine.reset()).toBe(true);
    expect(engine.isActive()).toBe(true);
    expect(engine.snapshot().selectedCount).toBe(0);
  });
});

describe("lens engine dock", () => {
  it("renders a status dock with controls inside the shadow root", () => {
    const engine = makeEngine();
    engine.activate();
    const root = host()?.shadowRoot;
    expect(root?.querySelector(".p2a-dock")).not.toBeNull();
    expect(root?.querySelector(".p2a-button")?.textContent).toBe("Cancel");
    engine.deactivate();
  });

  it("finishes through the Done button", () => {
    let finished = 0;
    const engine = makeEngine({ onFinish: () => (finished += 1) });
    engine.activate();
    clickOn(document.getElementById("p1")!);
    const root = host()?.shadowRoot;
    expect(root).not.toBeNull();
    const buttons = [...root!.querySelectorAll(".p2a-button")];
    const done = buttons.find((button) => button.textContent === "Done")!;
    done.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }),
    );
    expect(finished).toBe(1);
    expect(engine.isActive()).toBe(false);
  });
});
