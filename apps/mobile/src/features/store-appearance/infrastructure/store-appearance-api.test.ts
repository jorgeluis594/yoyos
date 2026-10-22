import { err, ok } from "@shared/functional";
import { createStoreAppearanceApi } from "@mobile/features/store-appearance/infrastructure/store-appearance-api";

const logoId = "00000000-0000-4000-8000-000000000001";
const readable = { kind: "readable", appearance: { theme: "suave", logo: { id: logoId, url: "https://img.test/logo.png" } } };
const body = { theme: "suave", logoImageId: logoId } as const;
const failed = (status: number, code: string) => err({ code: "API_ERROR" as const, message: "Failed", http: { status, body: { code, error: "Failed" } } });

test("reads the readable appearance, the unknown-theme starting point and a logo without url", async () => {
  const request = jest.fn(async () => ok(readable));
  expect(await createStoreAppearanceApi(request).get()).toEqual({ success: true, data: readable });
  expect(request).toHaveBeenCalledWith("/api/store-appearance");
  expect(await createStoreAppearanceApi(async () => ok({ kind: "unknown_theme" })).get()).toEqual({ success: true, data: { kind: "unknown_theme" } });
  const noUrl = { kind: "readable", appearance: { theme: "noche", logo: { id: logoId, url: null } } };
  expect(await createStoreAppearanceApi(async () => ok(noUrl)).get()).toEqual({ success: true, data: noUrl });
});

test("sends the theme and the logo id as JSON and returns the saved appearance", async () => {
  const request = jest.fn(async (_path: string, _init?: RequestInit) => ok(readable));
  const result = await createStoreAppearanceApi(request).save(body);
  expect(result).toEqual({ success: true, data: readable });
  expect(request).toHaveBeenCalledWith("/api/store-appearance", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
});

test("store appearance API maps 400 and 422 to theme and logo errors and rejects an unexpected response shape", async () => {
  const save = (answer: ReturnType<typeof failed>) => createStoreAppearanceApi(async () => answer).save(body);
  expect(await save(failed(400, "INVALID_STORE_APPEARANCE"))).toMatchObject({ success: false, error: { code: "INVALID_STORE_APPEARANCE" } });
  expect(await createStoreAppearanceApi(async () => err({ code: "INVALID_IMAGE" as const, message: "No logo", http: { status: 422, body: { code: "INVALID_IMAGE", error: "No logo" } } })).save(body))
    .toMatchObject({ success: false, error: { code: "INVALID_IMAGE" } });
  expect(await createStoreAppearanceApi(async () => err({ code: "INVALID_IMAGE" as const, message: "x", http: { status: 400, body: { code: "INVALID_IMAGE", error: "x" } } })).save(body))
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  // A code with the wrong status is not a trustworthy answer.
  expect(await save(failed(500, "INVALID_STORE_APPEARANCE"))).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  expect(await save(failed(503, "SERVICE_UNAVAILABLE"))).toMatchObject({ success: false, error: { code: "API_ERROR" } });
  expect(await createStoreAppearanceApi(async () => err({ code: "NETWORK_ERROR" as const, message: "Offline" })).save(body)).toMatchObject({ success: false, error: { code: "NETWORK_ERROR" } });
  for (const shape of [{ kind: "readable", appearance: { theme: "rojo", logo: null } }, { kind: "readable", appearance: { theme: "suave", logo: null }, extra: 1 }, {}]) {
    expect(await createStoreAppearanceApi(async () => ok(shape)).get()).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  }
  // Saving always answers a readable appearance.
  expect(await createStoreAppearanceApi(async () => ok({ kind: "unknown_theme" })).save(body)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});

test("refuses to send a body outside the contract", async () => {
  const request = jest.fn(async () => ok(readable));
  expect(await createStoreAppearanceApi(request).save({ theme: "rojo", logoImageId: null } as never)).toMatchObject({ success: false, error: { code: "INVALID_STORE_APPEARANCE" } });
  expect(request).not.toHaveBeenCalled();
});
