import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { Criteria, ProductReadError, ProductRepository } from "@core/src/features/products/application/repository";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";

export type StockFilter = "in_stock" | "sold_out";
export type ListSort = "recent" | "name";
export type ListInput = Readonly<{ search?: string; stock?: StockFilter; sort?: ListSort; page?: number; pageSize?: number }>;
type Summary = Readonly<{ id: ProductId; name: string; variantCount: number; sku?: string; minSalePrice: Money; hasDifferentPrices: boolean; totalStock: number }>;
export type ProductSummary = Summary & Readonly<{ imageId?: ImageId }>;
export type ProductListItem = Summary & Readonly<{ image?: Readonly<{ id: ImageId; url: string }> }>;
export type ListPage = Readonly<{ items: readonly ProductSummary[]; page: number; pageSize: number; total: number }>;
export type ListOutput = Readonly<{ items: readonly ProductListItem[]; page: number; pageSize: number; total: number }>;
export type ListImage = Readonly<{ id: ImageId; url: string }>;
export type ListImageFailure = Readonly<{ imageId: ImageId; code: string; message: string }>;
export type ListImages = Readonly<{ images: readonly ListImage[]; failures: readonly ListImageFailure[] }>;
export type ListImageDependencies = Readonly<{
  /** Resolves every requested thumbnail in one batch; IDs with no stored image are omitted. */
  resolve: (imageIds: readonly ImageId[]) => Promise<Result<ListImages, ProductReadError>>;
  /** Receives every thumbnail failure of one listing at once, so callers can report them together. */
  report: (failures: readonly ListImageFailure[]) => void;
}>;
export type ListDependencies = Readonly<{
  repository: Pick<ProductRepository, "list">;
  /** Thumbnails are opt-in: without this dependency, listings carry no images. */
  images?: ListImageDependencies;
}>;
export type CriteriaField = "search" | "stock" | "sort" | "page" | "pageSize";
export type CriteriaValidationReason = Readonly<{ reason: "INVALID_TYPE" | "INVALID_RANGE" | "UNSAFE_PAGINATION" }>;
export type CriteriaIssue = Readonly<{ field: CriteriaField; message: string }> & CriteriaValidationReason;
export type ListError = Readonly<{ code: "VALIDATION_ERROR"; issues: readonly [CriteriaIssue, ...CriteriaIssue[]]; message: string }> | ProductReadError;

const noImages: ReadonlyMap<ImageId, ListImage> = new Map();

function toListItem({ imageId, ...summary }: ProductSummary, images: ReadonlyMap<ImageId, ListImage>): ProductListItem {
  const image = imageId === undefined ? undefined : images.get(imageId);
  return image ? { ...summary, image } : summary;
}

// A thumbnail is optional in listings: an unavailable image must not hide the catalog.
async function withImages(items: readonly ProductSummary[], deps: ListImageDependencies): Promise<readonly ProductListItem[]> {
  const imageIds = [...new Set(items.flatMap((item) => item.imageId === undefined ? [] : [item.imageId]))];
  if (!imageIds.length) return items.map((item) => toListItem(item, noImages));
  const resolved = await deps.resolve(imageIds);
  const failures: readonly ListImageFailure[] = resolved.success
    ? resolved.data.failures
    : imageIds.map((imageId) => ({ imageId, code: resolved.error.code, message: resolved.error.message }));
  if (failures.length) deps.report(failures);
  const images = new Map(resolved.success ? resolved.data.images.map((image) => [image.id, image] as const) : []);
  return items.map((item) => toListItem(item, images));
}

export async function listProducts(input: ListInput, deps: ListDependencies): Promise<Result<ListOutput, ListError>> {
  const issues: CriteriaIssue[] = [];
  const page = input.page === undefined ? 1 : input.page;
  const pageSize = input.pageSize === undefined ? 20 : input.pageSize;
  if (input.search !== undefined && typeof input.search !== "string") issues.push({ field: "search", reason: "INVALID_TYPE", message: "Search must be text" });
  if (input.stock !== undefined && input.stock !== "in_stock" && input.stock !== "sold_out") issues.push({ field: "stock", reason: "INVALID_TYPE", message: "Stock filter must be in_stock or sold_out" });
  if (input.sort !== undefined && input.sort !== "recent" && input.sort !== "name") issues.push({ field: "sort", reason: "INVALID_TYPE", message: "Sort must be recent or name" });
  if (!Number.isSafeInteger(page) || page < 1) issues.push({ field: "page", reason: "INVALID_RANGE", message: "Page must be a positive safe integer" });
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) issues.push({ field: "pageSize", reason: "INVALID_RANGE", message: "Page size must be between 1 and 100" });
  if (!issues.length && !Number.isSafeInteger((page - 1) * pageSize + pageSize)) issues.push({ field: "page", reason: "UNSAFE_PAGINATION", message: "Pagination exceeds the safe integer range" });
  if (issues.length) return err({ code: "VALIDATION_ERROR", issues: issues as [CriteriaIssue, ...CriteriaIssue[]], message: "Invalid listing criteria" });
  const search = typeof input.search === "string" ? input.search.trim() : "";
  const criteria: Criteria = { ...(search ? { search } : {}), ...(input.stock ? { stock: input.stock } : {}), sort: input.sort ?? "recent", page, pageSize };
  const listed = await deps.repository.list(criteria);
  if (!listed.success) return listed;
  const items = deps.images ? await withImages(listed.data.items, deps.images) : listed.data.items.map((item) => toListItem(item, noImages));
  return ok({ ...listed.data, items });
}
