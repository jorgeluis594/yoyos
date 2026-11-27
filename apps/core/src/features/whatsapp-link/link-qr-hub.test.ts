import { describe, expect, it, vi } from "vitest";
import { createLinkQrHub } from "@core/src/features/whatsapp-link/link-qr-hub";

const at = Date.parse("2026-11-27T12:00:00.000Z");
const qr = { value: "2@abc", expiresAt: "2026-11-27T12:00:20.000Z" };

describe("link QR hub", () => {
  it("relays a shared QR only to the sessions of the same company", () => {
    const hub = createLinkQrHub(() => at);
    const mine = vi.fn();
    const other = vi.fn();
    hub.subscribe("company-a", mine);
    hub.subscribe("company-b", other);
    hub.share("company-a", qr);
    expect(mine).toHaveBeenCalledWith(qr);
    expect(other).not.toHaveBeenCalled();
  });

  it("gives a session opened later the QR that is still live", () => {
    const hub = createLinkQrHub(() => at);
    hub.share("company-a", qr);
    const listener = vi.fn();
    hub.subscribe("company-a", listener);
    expect(listener).toHaveBeenCalledWith(qr);
  });

  it("does not replay an expired QR", () => {
    let now = at;
    const hub = createLinkQrHub(() => now);
    hub.share("company-a", qr);
    now = Date.parse(qr.expiresAt);
    const listener = vi.fn();
    hub.subscribe("company-a", listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it("tells open sessions when the QR is cleared and stops after unsubscribing", () => {
    const hub = createLinkQrHub(() => at);
    const listener = vi.fn();
    const unsubscribe = hub.subscribe("company-a", listener);
    hub.share("company-a", null);
    expect(listener).toHaveBeenLastCalledWith(null);
    unsubscribe();
    hub.share("company-a", qr);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
