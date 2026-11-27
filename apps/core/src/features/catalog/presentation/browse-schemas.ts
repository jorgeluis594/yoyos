import { z } from "zod";
import { maxCatalogPages, parseCatalogSearch, type CatalogSearch } from "@core/src/features/catalog/domain/catalog";
import type { ProductId } from "@core/src/features/products/domain/product";

export const catalogProductPathSchema = z.object({ productId: z.uuid().transform((value) => value as ProductId) });

/** Malformed query values fall back to the first page without search instead of failing the page; a page past the cap clamps to it. */
export function parseCatalogQuery(params: URLSearchParams): Readonly<{ q: string; search: CatalogSearch | null; page: number }> {
  const q = params.get("q") ?? "";
  const search = parseCatalogSearch(q);
  const page = z.coerce.number().int().min(1).safeParse(params.get("page") ?? undefined);
  return { q: q.trim(), search: search.success ? search.data : null, page: page.success ? Math.min(page.data, maxCatalogPages) : 1 };
}
