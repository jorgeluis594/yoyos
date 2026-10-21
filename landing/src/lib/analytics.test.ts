import { afterEach, describe, expect, test, vi } from "vitest";
import { eventFromDataset, track } from "@landing/src/lib/analytics";

afterEach(() => vi.unstubAllGlobals());

describe("track", () => {
  test("forwards the event name and props to the installed adapter", () => {
    const adapter = { track: vi.fn() };
    vi.stubGlobal("window", { yoyosAnalytics: adapter });
    track({ name: "whatsapp_click", location: "hero" });
    track({ name: "faq_open", location: "faq", q: 3 });
    expect(adapter.track).toHaveBeenNthCalledWith(1, "whatsapp_click", { location: "hero" });
    expect(adapter.track).toHaveBeenNthCalledWith(2, "faq_open", { location: "faq", q: 3 });
  });

  test("does nothing when no adapter is installed", () => {
    vi.stubGlobal("window", {});
    expect(() => track({ name: "call_click", location: "footer" })).not.toThrow();
    vi.stubGlobal("window", undefined);
    expect(() => track({ name: "call_click", location: "footer" })).not.toThrow();
  });
});

describe("eventFromDataset", () => {
  test("builds the event of a CTA or FAQ element from its data attributes", () => {
    expect(eventFromDataset({ event: "whatsapp_click", location: "precio" })).toEqual({ name: "whatsapp_click", location: "precio" });
    expect(eventFromDataset({ event: "call_click", location: "header" })).toEqual({ name: "call_click", location: "header" });
    expect(eventFromDataset({ event: "demo_form_open", location: "hero" })).toEqual({ name: "demo_form_open", location: "hero" });
    expect(eventFromDataset({ event: "faq_open", location: "faq", q: "7" })).toEqual({ name: "faq_open", location: "faq", q: 7 });
  });

  test("ignores unknown events and locations that the event does not allow", () => {
    expect(eventFromDataset({ event: "whatsapp_click", location: "sidebar" })).toBeNull();
    expect(eventFromDataset({ event: "call_click", location: "404" })).toBeNull();
    expect(eventFromDataset({ event: "demo_form_open", location: "footer" })).toBeNull();
    expect(eventFromDataset({ event: "faq_open", location: "faq", q: "x" })).toBeNull();
    expect(eventFromDataset({ event: "anything" })).toBeNull();
    expect(eventFromDataset({})).toBeNull();
  });
});
