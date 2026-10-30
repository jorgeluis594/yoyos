// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useCatalogSearch, type CatalogSearch } from "@core/src/features/orders/presentation/use-catalog-search";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const product = (name: string) => ({ id: crypto.randomUUID(), name, currency: "PEN" as const,
  variants: [{ id: crypto.randomUUID(), attributes: {}, sku: null, price: 10, stock: 3 }] });
type Pending = { url: URL; signal: AbortSignal; resolve: (names: string[]) => void; fail: () => void };

describe("useCatalogSearch", () => {
  let root: Root | undefined;
  let pending: Pending[];
  let latest: CatalogSearch;
  let ignoreAbort = false;

  beforeEach(() => {
    vi.useFakeTimers();
    pending = [];
    ignoreAbort = false;
    vi.stubGlobal("fetch", vi.fn((input: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      const signal = init.signal!;
      signal.addEventListener("abort", () => { if (!ignoreAbort) reject(new DOMException("aborted", "AbortError")); });
      pending.push({ url: new URL(input, "http://localhost"), signal,
        resolve: (names) => resolve(new Response(JSON.stringify(names.map(product)), { status: 200 })),
        fail: () => resolve(new Response("{}", { status: 500 })) });
    })));
  });
  afterEach(() => { act(() => root?.unmount()); root = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

  function Probe({ epoch }: { epoch: number }) { latest = useCatalogSearch({ catalogEpoch: epoch }); return null; }
  const render = (epoch: number) => act(async () => {
    root ??= createRoot(document.createElement("div"));
    root.render(createElement(Probe, { epoch }));
  });
  const settle = (work: () => void) => act(async () => { work(); await vi.advanceTimersByTimeAsync(0); });
  const names = () => latest.products.map((entry) => entry.name);
  const queries = () => pending.map((request) => `${request.url.searchParams.get("search")}|${request.url.searchParams.get("inStock")}`);

  test("loads the empty query at once when the picker opens and sends no request before", async () => {
    await render(0);
    expect(pending).toHaveLength(0);
    await settle(() => latest.open());
    expect(queries()).toEqual(["|null"]);
    expect(latest.status).toBe("loading");
    await settle(() => pending[0].resolve(["Corona"]));
    expect(latest.status).toBe("ready");
    expect(names()).toEqual(["Corona"]);
  });

  test("waits 250 ms after typing before searching but loads the empty query at once", async () => {
    await render(0);
    await settle(() => latest.open());
    await settle(() => pending[0].resolve(["Corona"]));
    await settle(() => latest.setText("prín"));
    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(pending).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(queries()).toEqual(["|null", "prín|null"]);
    await settle(() => pending[1].resolve(["Príncipe"]));
    await settle(() => latest.setText(""));
    expect(names()).toEqual(["Corona"]);
    expect(pending).toHaveLength(2);
  });

  test("aborts the previous request when the text changes", async () => {
    await render(0);
    await settle(() => latest.open());
    await settle(() => latest.setText("pr"));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(pending[0].signal.aborted).toBe(true);
    await settle(() => latest.setText("prín"));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(pending[1].signal.aborted).toBe(true);
    expect(pending[2].signal.aborted).toBe(false);
  });

  test("ignores a catalog response for an older search text", async () => {
    ignoreAbort = true;
    await render(0);
    await settle(() => latest.open());
    await settle(() => pending[0].resolve([]));
    await settle(() => latest.setText("príncipe"));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await settle(() => latest.setText("prín"));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await settle(() => pending[2].resolve(["Príncipe nuevo"]));
    await settle(() => pending[1].resolve(["Príncipe viejo"]));
    expect(names()).toEqual(["Príncipe nuevo"]);
    expect(latest.text).toBe("prín");
  });

  test("keeps the previous results visible while a new search loads", async () => {
    await render(0);
    await settle(() => latest.open());
    await settle(() => pending[0].resolve(["Corona"]));
    await settle(() => latest.setText("pr"));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(latest.status).toBe("loading");
    expect(names()).toEqual(["Corona"]);
  });

  test("asks the server for in-stock products when Con stock is chosen", async () => {
    await render(0);
    await settle(() => latest.open());
    await settle(() => pending[0].resolve(["Corona", "Capa"]));
    await settle(() => latest.setInStock(true));
    expect(queries()).toEqual(["|null", "|true"]);
    await settle(() => pending[1].resolve(["Corona"]));
    expect(names()).toEqual(["Corona"]);
  });

  test("keys the cached empty search by the Con stock filter", async () => {
    await render(0);
    await settle(() => latest.open());
    await settle(() => pending[0].resolve(["Corona", "Capa"]));
    await settle(() => latest.setInStock(true));
    await settle(() => pending[1].resolve(["Corona"]));
    await settle(() => latest.setInStock(false));
    expect(names()).toEqual(["Corona", "Capa"]);
    await settle(() => latest.setInStock(true));
    expect(names()).toEqual(["Corona"]);
    expect(pending).toHaveLength(2);
  });

  test("keeps the cached empty search across closing and reopening the picker", async () => {
    await render(0);
    await settle(() => latest.open());
    await settle(() => pending[0].resolve(["Corona"]));
    await settle(() => latest.close());
    await settle(() => latest.open());
    expect(names()).toEqual(["Corona"]);
    expect(latest.status).toBe("ready");
    expect(pending).toHaveLength(1);
  });

  test("drops the cached empty search when the catalog epoch changes and fetches again only on the next opening", async () => {
    await render(0);
    await settle(() => latest.open());
    await settle(() => pending[0].resolve(["Corona"]));
    await settle(() => latest.close());
    await render(1);
    expect(pending).toHaveLength(1);
    expect(names()).toEqual([]);
    await settle(() => latest.open());
    expect(pending).toHaveLength(2);
    await settle(() => pending[1].resolve(["Corona nueva"]));
    expect(names()).toEqual(["Corona nueva"]);
  });

  test("reports a failed catalog read and fetches again on retry keeping the text", async () => {
    await render(0);
    await settle(() => latest.open());
    await settle(() => pending[0].fail());
    expect(latest.status).toBe("error");
    await settle(() => latest.setText("pr"));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await settle(() => pending[1].fail());
    await settle(() => latest.retry());
    expect(queries()).toEqual(["|null", "pr|null", "pr|null"]);
    expect(latest.text).toBe("pr");
  });

  test("sends no request after the picker closes", async () => {
    await render(0);
    await settle(() => latest.open());
    await settle(() => latest.setText("pr"));
    await settle(() => latest.close());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(pending).toHaveLength(1);
    expect(pending[0].signal.aborted).toBe(true);
  });
});
