import { afterEach, expect, test, vi } from "vitest";
import { checkSubdomainAvailability, readCatalogSettings, saveCatalogSubdomain, linkRequestTimeoutMs } from "@core/app/lib/catalog-link-client";

const settings = { published: false, subdomain: "fantasio", url: "https://fantasio.yoyos.lat/", domain: "yoyos.lat", suggestion: null };
const stubFetch = (answer: () => Promise<Response>) => { const spy = vi.fn(answer); vi.stubGlobal("fetch", spy); return spy; };
const online = (value: boolean) => vi.stubGlobal("navigator", { onLine: value });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("returns not_sent without calling fetch when the browser is offline", async () => {
  online(false);
  const spy = stubFetch(async () => Response.json(settings));
  expect(await checkSubdomainAvailability("fantasio", new AbortController().signal)).toEqual({ kind: "not_sent" });
  expect(await saveCatalogSubdomain("fantasio")).toEqual({ kind: "not_sent" });
  expect(await readCatalogSettings()).toEqual({ kind: "not_sent" });
  expect(spy).not.toHaveBeenCalled();
});

test("returns no_response when fetch rejects, times out, answers 5xx or sends a body that fails the schema", async () => {
  online(true);
  stubFetch(async () => { throw new TypeError("Failed to fetch"); });
  expect(await readCatalogSettings()).toEqual({ kind: "no_response" });

  stubFetch(async () => Response.json({ code: "SERVICE_UNAVAILABLE", error: "down" }, { status: 503 }));
  expect(await saveCatalogSubdomain("fantasio")).toEqual({ kind: "no_response" });

  stubFetch(async () => Response.json({ ...settings, extra: true }));
  expect(await readCatalogSettings()).toEqual({ kind: "no_response" });
  stubFetch(async () => Response.json({ status: "maybe" }));
  expect(await checkSubdomainAvailability("fantasio", new AbortController().signal)).toEqual({ kind: "no_response" });
  stubFetch(async () => Response.json({ message: "not an envelope" }, { status: 409 }));
  expect(await saveCatalogSubdomain("fantasio")).toEqual({ kind: "no_response" });
  stubFetch(async () => new Response("<html>", { status: 422 }));
  expect(await saveCatalogSubdomain("fantasio")).toEqual({ kind: "no_response" });

  const timeout = new AbortController();
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  stubFetch(() => new Promise((_resolve, reject) => timeout.signal.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")))));
  const pending = readCatalogSettings();
  timeout.abort();
  expect(await pending).toEqual({ kind: "no_response" });
  expect(timeoutSpy).toHaveBeenCalledWith(linkRequestTimeoutMs);
});

test("returns no_response when the caller aborts the check", async () => {
  online(true);
  const controller = new AbortController();
  stubFetch(() => new Promise((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
  const pending = checkSubdomainAvailability("fantasio", controller.signal);
  controller.abort();
  expect(await pending).toEqual({ kind: "no_response" });
});

test("returns answered with the parsed body for 200, 409, 422 and 429", async () => {
  online(true);
  const spy = stubFetch(async () => Response.json({ status: "in_use", subdomain: "fantasio" }));
  expect(await checkSubdomainAvailability("fantasio", new AbortController().signal)).toEqual({ kind: "answered", ok: true, body: { status: "in_use", subdomain: "fantasio" } });
  const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/catalog/subdomain-availability?value=fantasio");
  expect(init.credentials).toBe("same-origin");

  const saved = stubFetch(async () => Response.json(settings));
  expect(await saveCatalogSubdomain("fantasio")).toEqual({ kind: "answered", ok: true, body: settings });
  const [saveUrl, saveInit] = saved.mock.calls[0] as unknown as [string, RequestInit];
  expect(saveUrl).toBe("/api/catalog/subdomain");
  expect(saveInit.method).toBe("PUT");
  expect(JSON.parse(saveInit.body as string)).toEqual({ subdomain: "fantasio" });

  const taken = { code: "SUBDOMAIN_TAKEN", error: "taken" };
  stubFetch(async () => Response.json(taken, { status: 409 }));
  expect(await saveCatalogSubdomain("fantasio")).toEqual({ kind: "answered", ok: false, status: 409, error: taken });
  const invalid = { code: "INVALID_SUBDOMAIN", error: "bad", issues: [{ field: "subdomain", reason: "hyphen_edge" }] };
  stubFetch(async () => Response.json(invalid, { status: 422 }));
  expect(await saveCatalogSubdomain("-fantasio")).toEqual({ kind: "answered", ok: false, status: 422, error: invalid });
  const limited = { code: "RATE_LIMITED", error: "slow down" };
  stubFetch(async () => Response.json(limited, { status: 429 }));
  expect(await checkSubdomainAvailability("fantasio", new AbortController().signal)).toEqual({ kind: "answered", ok: false, status: 429, error: limited });
});

test("encodes the checked value in the query", async () => {
  online(true);
  const spy = stubFetch(async () => Response.json({ status: "reserved" }));
  await checkSubdomainAvailability("a b&c", new AbortController().signal);
  expect((spy.mock.calls[0] as unknown as [string])[0]).toBe("/api/catalog/subdomain-availability?value=a+b%26c");
});
