import { err, ok } from "@shared/functional";
import { createCatalogSettingsApi, subdomainRequired } from "@mobile/features/catalog/infrastructure/catalog-settings-api";

const mockNetwork = jest.fn();
jest.mock("expo-network", () => ({ getNetworkStateAsync: () => mockNetwork() }));

const settings = { published: false, subdomain: "fantasio", url: "https://fantasio.yoyos.lat/", domain: "yoyos.lat", suggestion: null };
const failed = (status: number, body: unknown, code: "API_ERROR" | "RATE_LIMITED" | "SERVICE_UNAVAILABLE" | "SERVER_ERROR" = "API_ERROR") =>
  err({ code, message: "Failed", http: { status, body } });
const envelope = (code: string, extra: object = {}) => ({ code, error: "Failed", ...extra });
beforeEach(() => { mockNetwork.mockReset(); mockNetwork.mockResolvedValue({ isConnected: true }); });

test("parses settings, availability and subdomain errors with the shared contract", async () => {
  const request = jest.fn(async (_path: string, _init?: RequestInit) => ok(settings));
  const api = createCatalogSettingsApi(request);
  expect(await api.get()).toEqual({ success: true, data: settings });
  expect(await api.setPublished(true)).toEqual({ success: true, data: settings });
  expect(request).toHaveBeenLastCalledWith("/api/catalog/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ published: true }) });
  expect(await createCatalogSettingsApi(async () => ok({ published: true, url: "https://yoyos.test/catalogo/1" })).get())
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });

  expect(await api.saveSubdomain("fantasio")).toEqual({ success: true, data: settings });
  expect(request).toHaveBeenLastCalledWith("/api/catalog/subdomain", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ subdomain: "fantasio" }) });

  const checking = jest.fn(async (_path: string, _init?: RequestInit) => ok({ status: "available", subdomain: "fantasio" }));
  const signal = new AbortController().signal;
  expect(await createCatalogSettingsApi(checking).checkSubdomain("fantasio", signal)).toEqual({ success: true, data: { status: "available", subdomain: "fantasio" } });
  expect(checking).toHaveBeenCalledWith("/api/catalog/subdomain-availability?value=fantasio", { signal });
  await createCatalogSettingsApi(checking).checkSubdomain("a b&c", signal);
  expect(checking).toHaveBeenLastCalledWith("/api/catalog/subdomain-availability?value=a%20b%26c", { signal });
  expect(await createCatalogSettingsApi(async () => ok({ status: "mystery" })).checkSubdomain("x")).toMatchObject({ success: false, error: { kind: "no_response" } });
});

test("reads taken, reserved and invalid with its reason from the TransportError http body", async () => {
  const save = (answer: ReturnType<typeof failed>) => createCatalogSettingsApi(async () => answer).saveSubdomain("fantasio");
  expect(await save(failed(409, envelope("SUBDOMAIN_TAKEN")))).toEqual({ success: false, error: { kind: "answered", code: "SUBDOMAIN_TAKEN", reason: null } });
  expect(await save(failed(422, envelope("SUBDOMAIN_RESERVED")))).toEqual({ success: false, error: { kind: "answered", code: "SUBDOMAIN_RESERVED", reason: null } });
  expect(await save(failed(422, envelope("INVALID_SUBDOMAIN", { issues: [{ field: "subdomain", reason: "double_hyphen" }] }))))
    .toEqual({ success: false, error: { kind: "answered", code: "INVALID_SUBDOMAIN", reason: "double_hyphen" } });
  for (const [status, code] of [[401, "UNAUTHENTICATED"], [403, "EMAIL_VERIFICATION_REQUIRED"], [409, "COMPANY_REQUIRED"], [415, "UNSUPPORTED_MEDIA_TYPE"], [400, "INVALID_CATALOG_SETTINGS"]] as const)
    expect(await save(failed(status, envelope(code)))).toMatchObject({ success: false, error: { kind: "answered", code } });
  expect(await createCatalogSettingsApi(async () => failed(429, envelope("RATE_LIMITED"), "RATE_LIMITED")).checkSubdomain("fantasio"))
    .toMatchObject({ success: false, error: { kind: "answered", code: "RATE_LIMITED" } });
  expect(subdomainRequired({ code: "API_ERROR", message: "x", http: { status: 409, body: envelope("SUBDOMAIN_REQUIRED") } })).toBe(true);
  expect(subdomainRequired({ code: "API_ERROR", message: "x", http: { status: 409, body: envelope("SUBDOMAIN_TAKEN") } })).toBe(false);
  expect(subdomainRequired({ code: "NETWORK_ERROR", message: "x" })).toBe(false);
});

test("returns not_sent without sending when expo-network reports no connection", async () => {
  mockNetwork.mockResolvedValue({ isConnected: false });
  const request = jest.fn(async () => ok(settings));
  expect(await createCatalogSettingsApi(request).saveSubdomain("fantasio")).toEqual({ success: false, error: { kind: "not_sent" } });
  expect(request).not.toHaveBeenCalled();

  // If the network state cannot be read, the save is sent.
  mockNetwork.mockRejectedValue(new Error("unavailable"));
  expect(await createCatalogSettingsApi(request).saveSubdomain("fantasio")).toEqual({ success: true, data: settings });
  expect(request).toHaveBeenCalledTimes(1);
});

test("returns no_response for NETWORK_ERROR, INVALID_RESPONSE, 5xx and an error body that fails the schema", async () => {
  const save = (answer: ReturnType<typeof err<{ code: "NETWORK_ERROR"; message: string }>> | ReturnType<typeof failed>) => createCatalogSettingsApi(async () => answer).saveSubdomain("fantasio");
  const noResponse = { success: false, error: { kind: "no_response" } };
  expect(await save(err({ code: "NETWORK_ERROR" as const, message: "offline" }))).toEqual(noResponse);
  expect(await save(failed(503, envelope("SERVICE_UNAVAILABLE"), "SERVICE_UNAVAILABLE"))).toEqual(noResponse);
  expect(await save(failed(500, envelope("INTERNAL_ERROR"), "SERVER_ERROR"))).toEqual(noResponse);
  expect(await save(failed(422, envelope("SOMETHING_NEW")))).toEqual(noResponse);
  expect(await save(failed(422, envelope("INVALID_SUBDOMAIN")))).toEqual(noResponse);
  expect(await save(err({ code: "INVALID_RESPONSE" as never, message: "bad json" }))).toEqual(noResponse);
  expect(await createCatalogSettingsApi(async () => err({ code: "NETWORK_ERROR" as const, message: "offline" })).checkSubdomain("fantasio")).toEqual({ success: false, error: { kind: "no_response" } });
});
