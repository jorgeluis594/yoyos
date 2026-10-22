import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { previewCatalogCards } from "@core/src/features/catalog/application/preview-catalog-cards";
import type { CatalogCard } from "@core/src/features/products/domain/catalog-product";
import type { ProductId } from "@core/src/features/products/domain/product";

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const card = (name: string): CatalogCard => ({ id: name as ProductId, name, imageUrl: null, price: { kind: "single", amount: { amount: 10, currency: "PEN" } }, soldOut: false });

test("preview cards list the first three catalog products of a hidden catalog in catalog order", async () => {
  const items = [card("Nuevo"), card("Medio"), card("Antiguo")];
  const listCatalogProducts = vi.fn(async () => ok({ items, hasMore: true }));
  const result = await previewCatalogCards({ companyId }, { readStoreCurrency: async () => ok("PEN"), listCatalogProducts });
  expect(result).toEqual({ success: true, data: items });
  expect(listCatalogProducts).toHaveBeenCalledWith({ currency: "PEN", search: null, offset: 0, limit: 3 });
});

test("preview cards fail without blocking when the store currency cannot be read", async () => {
  const listCatalogProducts = vi.fn();
  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog store" });
  expect(await previewCatalogCards({ companyId }, { readStoreCurrency: async () => failure, listCatalogProducts }))
    .toEqual({ success: false, error: failure.error });
  expect(listCatalogProducts).not.toHaveBeenCalled();
});
