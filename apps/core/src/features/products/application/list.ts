import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { Criteria, ProductReadError, ProductRepository } from "@core/src/features/products/application/repository";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";

export type ListInput = Readonly<{ search?: string; page?: number; pageSize?: number }>;
type Summary = Readonly<{ id: ProductId; name: string; variantCount: number; sku?: string; minSalePrice: Money; hasDifferentPrices: boolean; totalStock: number }>;
export type ProductSummary = Summary & Readonly<{ imageId?: ImageId }>;
export type ProductListItem = Summary & Readonly<{ image?: Readonly<{ id: ImageId; url: string }> }>;
export type ListPage = Readonly<{ items: readonly ProductSummary[]; page: number; pageSize: number; total: number }>;
export type ListOutput = Readonly<{ items: readonly ProductListItem[]; page: number; pageSize: number; total: number }>;
export type ListDependencies = Readonly<{
  repository: Pick<ProductRepository, "list">;
  resolveImage: (imageId: ImageId) => Promise<Result<Readonly<{ id: ImageId; url: string }> | null, ProductReadError>>;
}>;
export type CriteriaField = "search" | "page" | "pageSize";
export type CriteriaValidationReason = Readonly<{ reason: "INVALID_TYPE" | "INVALID_RANGE" | "UNSAFE_PAGINATION" }>;
export type CriteriaIssue = Readonly<{ field: CriteriaField; message: string }> & CriteriaValidationReason;
export type ListError = Readonly<{ code: "VALIDATION_ERROR"; issues: readonly [CriteriaIssue, ...CriteriaIssue[]]; message: string }> | ProductReadError;

async function withImage({ imageId, ...summary }: ProductSummary, resolveImage: ListDependencies["resolveImage"]): Promise<ProductListItem> {
  if (!imageId) return summary;
  const image = await resolveImage(imageId);
  // A thumbnail is optional in listings: an unavailable image must not hide the catalog.
  return image.success && image.data ? { ...summary, image: image.data } : summary;
}

export async function listProducts(input: ListInput, deps: ListDependencies): Promise<Result<ListOutput, ListError>> {
  const issues: CriteriaIssue[] = [];
  const page = input.page === undefined ? 1 : input.page;
  const pageSize = input.pageSize === undefined ? 20 : input.pageSize;
  if (input.search !== undefined && typeof input.search !== "string") issues.push({ field: "search", reason: "INVALID_TYPE", message: "Search must be text" });
  if (!Number.isSafeInteger(page) || page < 1) issues.push({ field: "page", reason: "INVALID_RANGE", message: "Page must be a positive safe integer" });
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) issues.push({ field: "pageSize", reason: "INVALID_RANGE", message: "Page size must be between 1 and 100" });
  if (!issues.length && !Number.isSafeInteger((page - 1) * pageSize + pageSize)) issues.push({ field: "page", reason: "UNSAFE_PAGINATION", message: "Pagination exceeds the safe integer range" });
  if (issues.length) return err({ code: "VALIDATION_ERROR", issues: issues as [CriteriaIssue, ...CriteriaIssue[]], message: "Invalid listing criteria" });
  const search = typeof input.search === "string" ? input.search.trim() : "";
  const criteria: Criteria = { ...(search ? { search } : {}), page, pageSize };
  const listed = await deps.repository.list(criteria);
  if (!listed.success) return listed;
  const items = await Promise.all(listed.data.items.map((item) => withImage(item, deps.resolveImage)));
  return ok({ ...listed.data, items });
}
