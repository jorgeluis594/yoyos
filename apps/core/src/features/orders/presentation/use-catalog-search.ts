import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { orderCatalogSchema } from "@shared/contracts/orders";

export type CatalogProduct = z.infer<typeof orderCatalogSchema>[number];
export type CatalogVariant = CatalogProduct["variants"][number];
export type CatalogStatus = "idle" | "loading" | "ready" | "error";

/** What the picker reads: the request policy lives in the hook, so the cache outlives the dialog. */
export type CatalogSearch = Readonly<{
  text: string; inStock: boolean; status: CatalogStatus; products: readonly CatalogProduct[];
  open: () => void; close: () => void; setText: (text: string) => void; setInStock: (inStock: boolean) => void; retry: () => void;
}>;

export const catalogSearchDebounceMs = 250;
/** The server answers at most this many products for a text search. */
export const catalogResultLimit = 20;

async function readCatalog(text: string, inStock: boolean, signal: AbortSignal): Promise<readonly CatalogProduct[] | null> {
  const query = new URLSearchParams({ search: text, ...(inStock ? { inStock: "true" } : {}) });
  const response = await fetch(`/api/orders/catalog?${query}`, { signal });
  if (!response.ok) return null;
  const parsed = orderCatalogSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

/**
 * Debounced, abortable catalog search for the product picker: the latest request wins, the previous results stay while a new
 * one loads, and only the empty text is cached (per `inStock`). A catalog epoch change drops the cache; nothing is requested
 * until the picker opens again.
 */
export function useCatalogSearch({ catalogEpoch, debounceMs = catalogSearchDebounceMs }: Readonly<{ catalogEpoch: number; debounceMs?: number }>): CatalogSearch {
  const [text, setTextState] = useState("");
  const [inStock, setInStockState] = useState(false);
  const [status, setStatus] = useState<CatalogStatus>("idle");
  const [products, setProducts] = useState<readonly CatalogProduct[]>([]);
  const cache = useRef(new Map<boolean, readonly CatalogProduct[]>());
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);
  const isOpen = useRef(false);
  // The latest text and filter for the callbacks; written only in the handlers that change them.
  const current = useRef({ text: "", inStock: false });

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
    controller.current = null;
    latest.current += 1;
  }, []);

  const load = useCallback(async (nextText: string, nextInStock: boolean) => {
    cancel();
    const query = nextText.trim();
    const cached = query === "" ? cache.current.get(nextInStock) : undefined;
    if (cached) { setProducts(cached); setStatus("ready"); return; }
    const request = new AbortController();
    controller.current = request;
    const ticket = latest.current;
    setStatus("loading");
    const result = await readCatalog(query, nextInStock, request.signal).catch(() => null);
    if (request.signal.aborted || ticket !== latest.current) return;
    controller.current = null;
    if (!result) { setStatus("error"); return; }
    if (query === "") cache.current.set(nextInStock, result);
    setProducts(result);
    setStatus("ready");
  }, [cancel]);

  const open = useCallback(() => {
    isOpen.current = true;
    current.current = { ...current.current, text: "" };
    setTextState("");
    void load("", current.current.inStock);
  }, [load]);
  const close = useCallback(() => { isOpen.current = false; cancel(); }, [cancel]);
  const setText = useCallback((next: string) => {
    current.current = { ...current.current, text: next };
    setTextState(next);
    if (!isOpen.current) return;
    if (next.trim() === "") { void load("", current.current.inStock); return; }
    cancel();
    timer.current = setTimeout(() => { timer.current = null; void load(next, current.current.inStock); }, debounceMs);
  }, [cancel, load, debounceMs]);
  const setInStock = useCallback((next: boolean) => {
    current.current = { ...current.current, inStock: next };
    setInStockState(next);
    if (isOpen.current) void load(current.current.text, next);
  }, [load]);
  const retry = useCallback(() => { void load(current.current.text, current.current.inStock); }, [load]);

  // A closed picker sends no request: the epoch only drops what was cached and shown.
  const epoch = useRef(catalogEpoch);
  useEffect(() => {
    if (epoch.current === catalogEpoch) return;
    epoch.current = catalogEpoch;
    cache.current.clear();
    if (!isOpen.current) { setProducts([]); setStatus("idle"); }
  }, [catalogEpoch]);
  useEffect(() => cancel, [cancel]);

  return useMemo(() => ({ text, inStock, status, products, open, close, setText, setInStock, retry }),
    [text, inStock, status, products, open, close, setText, setInStock, retry]);
}
