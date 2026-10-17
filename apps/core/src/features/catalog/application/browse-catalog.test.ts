import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { browseCatalog, getCatalogProduct } from "@core/src/features/catalog/application/browse-catalog";
import { catalogPageSize, maxCatalogPages } from "@core/src/features/catalog/domain/catalog";

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const store = { name: "Moda Lucía", currency: "PEN" as const };

test("the last allowed page hides «Ver más» even when more products exist", async () => {
  const listCatalogProducts = vi.fn(async () => ok({ items: [], hasMore: true }));
  const deps = { readStore: async () => ok(store), listCatalogProducts };
  expect(await browseCatalog({ search: null, pages: maxCatalogPages - 1 }, { companyId }, deps)).toMatchObject({ data: { hasMore: true } });
  expect(await browseCatalog({ search: null, pages: maxCatalogPages }, { companyId }, deps)).toMatchObject({ data: { hasMore: false } });
  expect(listCatalogProducts).toHaveBeenLastCalledWith({ currency: "PEN", search: null, offset: 0, limit: maxCatalogPages * catalogPageSize });
});

test("a malformed product id reads as an unavailable catalog when hidden and as a missing product when published", async () => {
  const findCatalogProduct = vi.fn();
  expect(await getCatalogProduct(null, { companyId }, { readStore: async () => ok(null), findCatalogProduct }))
    .toMatchObject({ success: false, error: { code: "CATALOG_UNAVAILABLE" } });
  expect(await getCatalogProduct(null, { companyId }, { readStore: async () => ok(store), findCatalogProduct }))
    .toMatchObject({ success: false, error: { code: "PRODUCT_UNAVAILABLE" } });
  expect(findCatalogProduct).not.toHaveBeenCalled();
});
