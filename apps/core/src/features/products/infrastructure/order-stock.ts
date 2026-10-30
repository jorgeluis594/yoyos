import { log } from "@core/src/shared/infrastructure/logger";
import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { isCurrency } from "@shared/money";
import { prisma, requireActiveTransaction, getCompanyId, withinReadSnapshot } from "@core/src/shared/infrastructure/persistance";
import { persistenceFailureResult, transactionEndingOrThrow } from "@core/src/shared/infrastructure/persistence-error";
import type { ContainedFailure, TransactionEndingError } from "@core/src/shared/application/contained-failure";
import type { Result } from "@shared/result";
import { loadAttributesOfProducts, loadAttributesOfVariants, savedVariantOrder, type VariantAttributes } from "@core/src/features/products/infrastructure/variant-combinations";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";

function knownFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

type SellableRow = Prisma.ProductVariantGetPayload<{ include: { product: true } }>;

function toCatalogItem(row: SellableRow, attributes: VariantAttributes): CatalogItem | null {
  if (!isCurrency(row.product.currency)) return null;
  return { variantId: row.id as VariantId, productName: row.product.name, variantAttributes: { ...attributes.get(row.id) }, sku: row.sku,
    unitPrice: { amount: row.salePrice.toNumber(), currency: row.product.currency } };
}

type SellableVariant = CatalogItem & Readonly<{ productId: string; primaryImageId: string | null; available: number }>;

/** Active variants of active products with their current stock, read without lock: nothing is reserved. */
export async function findSellableVariants(ids: readonly string[]) {
  try {
    const { rows, attributes } = await withinReadSnapshot(async () => {
      const rows = await prisma.productVariant.findMany({ where: { id: { in: [...ids] }, status: "active", product: { status: "active" } }, include: { product: { include: { photos: { where: { position: 0 }, select: { imageId: true } } } }, stock: true } });
      return { rows, attributes: await loadAttributesOfVariants(rows.map((row) => row.id)) };
    });
    const items: SellableVariant[] = [];
    for (const row of rows) {
      const item = toCatalogItem(row, attributes);
      const stock = row.stock?.quantity ?? 0n;
      if (!item) {
        log.error({ event: "invalid_stored_sale_variant", variantId: row.id }, "invalid_stored_sale_variant");
        return err({ code: "INVALID_STORED_DATA" as const, message: "Unable to read catalog" });
      }
      items.push({ ...item, productId: row.productId, primaryImageId: row.product.photos[0]?.imageId ?? null, available: stock > 99n ? 99 : Number(stock) });
    }
    return ok<readonly SellableVariant[]>(items);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_sale_variants", err: cause }, "unable_to_read_sale_variants");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
}

export async function findSellableVariantsByQrCodes(codes: readonly string[]) {
  try {
    const { rows, attributes } = await withinReadSnapshot(async () => {
      const rows = await prisma.productVariant.findMany({ where: { qrCode: { in: [...codes] }, status: "active", product: { status: "active" } }, include: { product: true } });
      return { rows, attributes: await loadAttributesOfVariants(rows.map((row) => row.id)) };
    });
    const items: Array<CatalogItem & Readonly<{ qrCode: string; productId: string }>> = [];
    for (const row of rows) {
      const item = toCatalogItem(row, attributes);
      // Una variante corrupta no debe bloquear las demás ni reintentarse: se omite como si no existiera.
      if (!item) { log.error({ event: "invalid_stored_sale_variant", variantId: row.id }, "invalid_stored_sale_variant"); continue; }
      items.push({ ...item, qrCode: row.qrCode, productId: row.productId });
    }
    return ok(items);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_sale_variants_by_qr_code", err: cause }, "unable_to_read_sale_variants_by_qr_code");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
}

export type StockRowMode = "wait" | "skip_locked";
export type StockQuantities = ReadonlyMap<VariantId, unknown>;

/** Locks the stock rows of these variants in variantId order; with "skip_locked" the rows another transaction holds are left out. Raw quantities: the caller validates them. */
export async function lockVariantStock(variantIds: readonly VariantId[], mode: StockRowMode): Promise<Result<StockQuantities, TransactionEndingError | ContainedFailure>> {
  requireActiveTransaction(getCompanyId());
  try {
    const rows = await prisma.$queryRaw<{ variantId: string; quantity: unknown }[]>(Prisma.sql`SELECT "variantId", quantity FROM "ProductStock"
      WHERE "variantId" = ANY(${[...variantIds]}::uuid[]) ORDER BY "variantId" FOR UPDATE${Prisma.raw(mode === "skip_locked" ? " SKIP LOCKED" : "")}`);
    return ok(new Map(rows.map((row) => [row.variantId as VariantId, row.quantity])));
  } catch (cause) { return err(persistenceFailureResult(cause, "Unable to lock stock")); }
}

/** One guarded statement: it decrements every line or none, and returns the number of updated rows (the number of lines, or 0 when any row is short). */
export async function deductStockBulk(lines: readonly Readonly<{ variantId: VariantId; quantity: number }>[]): Promise<Result<number, TransactionEndingError | ContainedFailure>> {
  requireActiveTransaction(getCompanyId());
  try {
    const need = Prisma.join(lines.map((line) => Prisma.sql`(${line.variantId}::uuid, ${BigInt(line.quantity)}::bigint)`));
    const count = await prisma.$executeRaw`WITH need(v, q) AS (VALUES ${need}),
      short AS (SELECT 1 FROM need LEFT JOIN "ProductStock" s ON s."variantId" = need.v WHERE s.quantity IS NULL OR s.quantity < need.q)
      UPDATE "ProductStock" s SET quantity = s.quantity - need.q FROM need WHERE s."variantId" = need.v AND NOT EXISTS (SELECT 1 FROM short)`;
    return ok(count);
  } catch (cause) { return err(persistenceFailureResult(cause, "Unable to deduct stock")); }
}

/** Current stock without lock and without a status filter: inactive variants count. Raw quantities: the caller validates them. */
export async function findVariantStock(variantIds: readonly VariantId[]): Promise<Result<StockQuantities, TransactionEndingError>> {
  try {
    const rows = await prisma.$queryRaw<{ variantId: string; quantity: unknown }[]>`SELECT "variantId", quantity FROM "ProductStock" WHERE "variantId" = ANY(${[...variantIds]}::uuid[])`;
    return ok(new Map(rows.map((row) => [row.variantId as VariantId, row.quantity])));
  } catch (cause) { return err(transactionEndingOrThrow(cause, "Unable to read stock")); }
}

export async function restoreProductStock(variantId: VariantId, quantity: number) {
  try {
    const result = await prisma.productStock.updateMany({ where: { variantId }, data: { quantity: { increment: BigInt(quantity) } } });
    if (result.count !== 1) return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to restore stock" });
    return ok<null>(null);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_restore_product_stock", err: cause }, "unable_to_restore_product_stock");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to restore stock" });
  }
}

/** `inStock` keeps the products with at least one active variant in stock, still shown with all their active variants. */
export async function searchSaleCatalog(search: string, variantIds?: readonly string[], filter: Readonly<{ inStock: boolean }> = { inStock: false }) {
  try {
    const variantFilter = { status: "active" as const, ...(variantIds ? { id: { in: [...variantIds] } } : {}) };
    const productVariantFilter = filter.inStock ? { ...variantFilter, stock: { is: { quantity: { gt: 0 } } } } : variantFilter;
    const { rows, attributes } = await withinReadSnapshot(async () => {
      const rows = await prisma.product.findMany({ where: { status: "active", variants: { some: productVariantFilter }, ...(variantIds
        ? {}
        : { name: { contains: search.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const } }) },
        orderBy: { name: "asc" }, ...(variantIds ? {} : { take: 20 }),
        include: { variants: { where: variantFilter, include: { stock: true } } } });
      const productIds = rows.map((row) => row.id);
      const bySavedOrder = await savedVariantOrder(productIds);
      return { rows: rows.map((row) => ({ ...row, variants: [...row.variants].sort(bySavedOrder) })), attributes: await loadAttributesOfProducts(productIds, true) };
    });
    if (rows.some((row) => row.variants.some((variant) => !variant.stock || variant.stock.quantity < 0n || variant.stock.quantity > BigInt(Number.MAX_SAFE_INTEGER)))) {
      log.error({ event: "invalid_stored_sale_catalog" }, "invalid_stored_sale_catalog");
      return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
    }
    return ok(rows.map((row) => ({ id: row.id, name: row.name, currency: row.currency,
      variants: row.variants.map((variant) => ({ id: variant.id, attributes: { ...attributes.get(variant.id) }, sku: variant.sku,
        price: variant.salePrice.toNumber(), stock: Number(variant.stock!.quantity) })) })));
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_search_sale_catalog", err: cause }, "unable_to_search_sale_catalog");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to search catalog" });
  }
}

/** The product of each variant, in one query; a variant that does not exist is simply absent from the map. */
export async function findProductIdsOfVariants(variantIds: readonly VariantId[]) {
  try {
    const rows = await prisma.productVariant.findMany({ where: { id: { in: [...variantIds] } }, select: { id: true, productId: true } });
    return ok<ReadonlyMap<VariantId, ProductId>>(new Map(rows.map((row) => [row.id as VariantId, row.productId as ProductId])));
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_product_ids_of_variants", err: cause }, "unable_to_read_product_ids_of_variants");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
}
