import { describe, expect, it } from "vitest";
import { ExtractorRegistry, Page2AgentError, Page2AgentErrorCode } from "../../../src/core";
import type { ExtractionInput, NormalizedDocument, PageContext, PageExtractor } from "../../../src/core";

const VALID_CONTEXT: PageContext = {
  captureId: "11111111-1111-4111-8111-111111111111",
  tabId: 7,
  url: "https://github.com/acme/widgets/issues/42",
  title: "Issue 42",
  capturedAt: "2026-08-30T00:00:00.000Z",
};

class FakeExtractor implements PageExtractor {
  readonly receivedContexts: PageContext[] = [];

  constructor(
    readonly id: string,
    private readonly canHandleResult: boolean,
  ) {}

  canHandle(context: PageContext): boolean {
    this.receivedContexts.push(context);
    return this.canHandleResult;
  }

  async extract(_input: ExtractionInput): Promise<NormalizedDocument> {
    throw new Error("extract is not exercised by registry tests");
  }
}

describe("ExtractorRegistry", () => {
  it("resolves the first matching extractor (constructor order = priority)", () => {
    const specialized = new FakeExtractor("specialized", true);
    const generic = new FakeExtractor("generic", true);
    const registry = new ExtractorRegistry([specialized, generic]);
    expect(registry.resolve(VALID_CONTEXT)).toBe(specialized);

    const reversed = new ExtractorRegistry([generic, specialized]);
    expect(reversed.resolve(VALID_CONTEXT)).toBe(generic);
  });

  it("falls back to the generic extractor when the specialized one cannot handle", () => {
    const specialized = new FakeExtractor("specialized", false);
    const generic = new FakeExtractor("generic", true);
    const registry = new ExtractorRegistry([specialized, generic]);
    expect(registry.resolve(VALID_CONTEXT)).toBe(generic);
  });

  it("returns null when no extractor matches", () => {
    const registry = new ExtractorRegistry([
      new FakeExtractor("a", false),
      new FakeExtractor("b", false),
    ]);
    expect(registry.resolve(VALID_CONTEXT)).toBeNull();
  });

  it("allows an empty registry and resolves null", () => {
    expect(new ExtractorRegistry([]).resolve(VALID_CONTEXT)).toBeNull();
  });

  it("rejects duplicate extractor ids at construction", () => {
    expect(
      () => new ExtractorRegistry([new FakeExtractor("same", true), new FakeExtractor("same", false)]),
    ).toThrow(Page2AgentError);
    try {
      new ExtractorRegistry([new FakeExtractor("same", true), new FakeExtractor("same", true)]);
      expect.unreachable("duplicate ids must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Page2AgentError);
      expect((error as Page2AgentError).code).toBe(Page2AgentErrorCode.INVALID_REGISTRY);
    }
  });

  it("passes the context to canHandle and never mutates frozen contexts", () => {
    const frozenContext = Object.freeze({ ...VALID_CONTEXT });
    const extractor = new FakeExtractor("a", true);
    const registry = new ExtractorRegistry([extractor]);
    expect(registry.resolve(frozenContext)).toBe(extractor);
    expect(extractor.receivedContexts).toEqual([frozenContext]);
  });
});
