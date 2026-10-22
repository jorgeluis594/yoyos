// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { storePreviewMessageSchema, type StorePreviewMessage } from "@core/app/components/store-preview/store-preview-schemas";
import { announcePreviewReady, listenForPreviewReady, listenForPreviewUpdates, sendPreviewUpdate } from "@core/app/components/store-preview/preview-protocol";

const update: StorePreviewMessage = {
  type: "store-appearance:update", surface: "checkout", state: "payment",
  appearance: { logoUrl: null, theme: "noche" }, catalog: { kind: "loading" },
};
const card = { id: "p1", name: "Polo", imageUrl: null, price: { kind: "single", amount: { amount: 10, currency: "PEN" } }, soldOut: false } as const;

const stops: Array<() => void> = [];
afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.restoreAllMocks(); });

/** The test window acts as the preview page embedded by its own parent. */
function embedded() {
  const parent = { postMessage: vi.fn() } as unknown as Window;
  vi.spyOn(window, "parent", "get").mockReturnValue(parent);
  return parent;
}
const deliver = (init: MessageEventInit) => window.dispatchEvent(new MessageEvent("message", init));

describe("preview messages", () => {
  test("applies a valid update from the same origin", () => {
    const parent = embedded();
    const received: StorePreviewMessage[] = [];
    stops.push(listenForPreviewUpdates(window, (message) => received.push(message)));
    deliver({ data: update, origin: window.location.origin, source: parent });
    expect(received).toEqual([update]);
  });

  test("ignores messages from another origin", () => {
    const parent = embedded();
    const onUpdate = vi.fn();
    stops.push(listenForPreviewUpdates(window, onUpdate));
    deliver({ data: update, origin: "https://evil.example", source: parent });
    deliver({ data: update, origin: window.location.origin, source: window });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test("ignores messages that do not match the schema", () => {
    const parent = embedded();
    const onUpdate = vi.fn();
    stops.push(listenForPreviewUpdates(window, onUpdate));
    const origin = window.location.origin;
    deliver({ data: { ...update, mode: "dark" }, origin, source: parent });
    deliver({ data: { ...update, appearance: { ...update.appearance, theme: "neon" } }, origin, source: parent });
    deliver({ data: { ...update, extra: true }, origin, source: parent });
    deliver({ data: "store-appearance:update", origin, source: parent });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test("announces readiness to the editor once loaded", () => {
    const parent = embedded();
    announcePreviewReady(window);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "store-appearance:ready" }, window.location.origin);
  });

  test("does not announce readiness when opened directly", () => {
    const post = vi.spyOn(window, "postMessage");
    announcePreviewReady(window);
    expect(post).not.toHaveBeenCalled();
  });

  test("the editor reacts only to readiness from its own preview frame", () => {
    const frame = { postMessage: vi.fn() } as unknown as Window;
    const onReady = vi.fn();
    stops.push(listenForPreviewReady(window, () => frame, onReady));
    const data = { type: "store-appearance:ready" };
    deliver({ data, origin: window.location.origin, source: window });
    deliver({ data, origin: "https://evil.example", source: frame });
    expect(onReady).not.toHaveBeenCalled();
    deliver({ data, origin: window.location.origin, source: frame });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  test("the editor sends the draft to the preview frame's own origin", () => {
    const frame = { postMessage: vi.fn() } as unknown as Window;
    sendPreviewUpdate(frame, update);
    expect(frame.postMessage).toHaveBeenCalledWith(update, window.location.origin);
  });

  test("does not send a draft that does not match the schema", () => {
    const frame = { postMessage: vi.fn() } as unknown as Window;
    const invalid = { ...update, appearance: { ...update.appearance, theme: "neon" } } as unknown as StorePreviewMessage;
    expect(sendPreviewUpdate(frame, invalid).success).toBe(false);
    expect(frame.postMessage).not.toHaveBeenCalled();
  });

  test("sends drafts whose logo is served from a local storage host", () => {
    const frame = { postMessage: vi.fn() } as unknown as Window;
    const local = { ...update, appearance: { ...update.appearance, logoUrl: "http://127.0.0.1:9000/b/x.png" } };
    expect(sendPreviewUpdate(frame, local).success).toBe(true);
    expect(frame.postMessage).toHaveBeenCalledTimes(1);
  });

  test("the preview message rejects mixed sample and real catalog cards", () => {
    const accepted = (catalog: unknown) => storePreviewMessageSchema.safeParse({ ...update, surface: "catalog", catalog }).success;
    expect(accepted({ kind: "products", cards: [card] })).toBe(true);
    expect(accepted({ kind: "samples" })).toBe(true);
    expect(accepted({ kind: "loading" })).toBe(true);
    expect(accepted({ kind: "samples", cards: [card] })).toBe(false);
    expect(accepted({ kind: "products", cards: [card], samples: true })).toBe(false);
    expect(accepted({ kind: "products", cards: [] })).toBe(false);
    expect(accepted({ kind: "products", cards: [card, card, card, card] })).toBe(false);
    expect(accepted({ kind: "loading", cards: [card] })).toBe(false);
  });

  test("rejects a draft without a surface or a catalog state", () => {
    expect(storePreviewMessageSchema.safeParse({ ...update, surface: undefined }).success).toBe(false);
    expect(storePreviewMessageSchema.safeParse({ ...update, catalog: undefined }).success).toBe(false);
  });
});
