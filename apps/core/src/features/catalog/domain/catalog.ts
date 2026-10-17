import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type CatalogSearch = string & { readonly __brand: "CatalogSearch" };
export type CartQuantity = number & { readonly __brand: "CartQuantity" };
export type CatalogValidationError = Readonly<{ code: "INVALID_SEARCH" | "INVALID_QUANTITY"; message: string }>;

export const catalogPageSize = 24;

export function parseCatalogSearch(value: string): Result<CatalogSearch, CatalogValidationError> {
  const search = value.trim();
  return search.length >= 2 && search.length <= 80 ? ok(search as CatalogSearch)
    : err({ code: "INVALID_SEARCH", message: "Search must have 2 to 80 characters" });
}

export function parseCartQuantity(value: number): Result<CartQuantity, CatalogValidationError> {
  return Number.isInteger(value) && value >= 1 && value <= 99 ? ok(value as CartQuantity)
    : err({ code: "INVALID_QUANTITY", message: "Quantity must be a whole number from 1 to 99" });
}
