// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CheckoutPreviewMessage } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
import { announcePreviewReady, listenForPreviewReady, listenForPreviewUpdates, sendPreviewUpdate } from "@core/src/features/checkout-appearance/presentation/preview-protocol";

const update: CheckoutPreviewMessage = {
  type: "checkout-appearance:update", mode: "dark", state: "payment",
  appearance: { logoUrl: null, brandColor: "forest", background: "brand_tint" },
};

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
    const received: CheckoutPreviewMessage[] = [];
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
    deliver({ data: { ...update, mode: "sepia" }, origin, source: parent });
    deliver({ data: { ...update, appearance: { ...update.appearance, brandColor: "#ff0000" } }, origin, source: parent });
    deliver({ data: { ...update, extra: true }, origin, source: parent });
    deliver({ data: "checkout-appearance:update", origin, source: parent });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test("announces readiness to the editor once loaded", () => {
    const parent = embedded();
    announcePreviewReady(window);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "checkout-appearance:ready" }, window.location.origin);
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
    const data = { type: "checkout-appearance:ready" };
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
});
