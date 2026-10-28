import { err, ok } from "@shared/functional";
import { createPushDeviceApi } from "./push-device-api";

const device = { version: 1, token: "ExponentPushToken[abc]", platform: "ios", locale: "es" } as const;

test("registers the device with an authenticated PUT and maps a failure", async () => {
  const request = jest.fn(async () => ok(null));
  const api = createPushDeviceApi(request, "https://core.test");

  expect(await api.register(device)).toEqual(ok(null));
  expect(request).toHaveBeenCalledWith("/api/push-devices/current", expect.objectContaining({ method: "PUT", body: JSON.stringify(device) }));

  request.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" }) as never);
  expect(await api.register(device)).toMatchObject({ success: false, error: { code: "NETWORK_ERROR" } });
});

test("unregisters a token without credentials and succeeds only on 204", async () => {
  const fetcher = jest.fn(async () => new Response(null, { status: 204 }));
  const api = createPushDeviceApi(jest.fn(), "https://core.test", fetcher as unknown as typeof fetch);

  expect(await api.unregister("ExponentPushToken[abc]")).toEqual(ok(null));
  expect(fetcher).toHaveBeenCalledWith("https://core.test/api/push-devices/unregister", expect.objectContaining({ method: "POST" }));
  expect(JSON.stringify(fetcher.mock.calls[0])).not.toContain("authorization");

  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect((await api.unregister("ExponentPushToken[abc]")).success).toBe(false);
  fetcher.mockRejectedValueOnce(new Error("offline"));
  expect((await api.unregister("ExponentPushToken[abc]")).success).toBe(false);
});
