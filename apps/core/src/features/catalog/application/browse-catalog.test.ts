import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { browseCatalog, getCatalogProduct } from "@core/src/features/catalog/application/browse-catalog";
import type { CatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { ProductId } from "@core/src/features/products/domain/product";
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

const product = { id: "00000000-0000-4000-8000-000000000002", name: "Polo básico" } as unknown as CatalogProduct;

test("a missing product inside a published catalog is unavailable with the store name", async () => {
  const productId = product.id as ProductId;
  const findCatalogProduct = vi.fn(async () => ok(null));
  expect(await getCatalogProduct(productId, { companyId }, { readStore: async () => ok(store), findCatalogProduct }))
    .toEqual({ success: true, data: { kind: "unavailable", storeName: "Moda Lucía" } });
  expect(findCatalogProduct).toHaveBeenCalledWith(productId, "PEN");
  expect(await getCatalogProduct(productId, { companyId }, { readStore: async () => ok(store), findCatalogProduct: async () => ok(product) }))
    .toEqual({ success: true, data: { kind: "found", storeName: "Moda Lucía", product } });
});

test("a malformed product id inside a published catalog is unavailable with the store name, and inside a hidden one the catalog is unavailable", async () => {
  const findCatalogProduct = vi.fn();
  expect(await getCatalogProduct(null, { companyId }, { readStore: async () => ok(null), findCatalogProduct }))
    .toMatchObject({ success: false, error: { code: "CATALOG_UNAVAILABLE" } });
  expect(await getCatalogProduct(null, { companyId }, { readStore: async () => ok(store), findCatalogProduct }))
    .toEqual({ success: true, data: { kind: "unavailable", storeName: "Moda Lucía" } });
  expect(findCatalogProduct).not.toHaveBeenCalled();
});
