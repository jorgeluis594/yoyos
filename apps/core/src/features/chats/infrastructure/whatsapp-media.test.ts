import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadWhatsAppMedia } from "@core/src/features/chats/infrastructure/whatsapp-media";

const connection = { companyId: "7b1d7be7-14bd-4b74-aecd-9fb56d8b64a0", phoneNumberId: "phone-1", businessAccountId: "waba-1", connectedAt: new Date(0), accessToken: "private-token" };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("downloadWhatsAppMedia", () => {
  it("uses the configured Graph API and only downloads from an allowlisted Meta host", async () => {
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v23.0");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/media", mime_type: "image/png", file_size: 3 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-length": "3" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await downloadWhatsAppMedia(connection, "media/id")).toMatchObject({ success: true, data: { bytes: new Uint8Array([1, 2, 3]), declaredContentType: "image/png" } });
    expect(fetcher.mock.calls[0][0]).toBe("https://graph.facebook.com/v23.0/media%2Fid");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer private-token");
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
    expect(fetcher.mock.calls[1][0].hostname).toBe("lookaside.fbsbx.com");
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer private-token");
  });

  it("rejects arbitrary media hosts before sending credentials to them", async () => {
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v23.0");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ url: "https://attacker.example/media", mime_type: "image/png" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await downloadWhatsAppMedia(connection, "media-1")).toMatchObject({ success: false, error: { code: "INVALID_MEDIA_RESPONSE" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects embedded credentials even on an allowlisted host", async () => {
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v23.0");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ url: "https://user:pass@lookaside.fbsbx.com/media", mime_type: "image/png" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await downloadWhatsAppMedia(connection, "media-1")).toMatchObject({ success: false, error: { code: "INVALID_MEDIA_RESPONSE" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
