import { afterEach, expect, it, vi } from "vitest";
import { createCloudflareImageStorage } from "@core/src/shared/images/infrastructure/cloudflare-image-storage";

afterEach(() => vi.unstubAllGlobals());

it("uploads a multipart file with server credentials and uses the public URL", async () => {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer token" });
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
    return Response.json({ success: true, result: { id: "remote-id" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const storage = createCloudflareImageStorage({ accountId: "account", apiToken: "token", deliveryHash: "hash" });
  expect(await storage.upload({ bytes: new Uint8Array([1]), filename: "a.png", contentType: "image/png" })).toEqual({ success: true, data: { key: "remote-id" } });
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.cloudflare.com/client/v4/accounts/account/images/v1");
  expect(await storage.getUrl("remote-id")).toEqual({ success: true, data: "https://imagedelivery.net/hash/remote-id/public" });
});

it("rejects malformed provider success and accepts an already deleted image", async () => {
  const storage = createCloudflareImageStorage({ accountId: "account", apiToken: "token", deliveryHash: "hash" });
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, result: {} })));
    expect((await storage.upload({ bytes: new Uint8Array([1]), filename: "a.png", contentType: "image/png" })).success).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    expect(await storage.delete("gone")).toEqual({ success: true, data: undefined });
  } finally {
    logged.mockRestore();
  }
});
