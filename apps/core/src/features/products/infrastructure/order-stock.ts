import { log } from "@core/src/shared/infrastructure/logger";
import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { isCurrency, type Money } from "@shared/money";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { VariantId } from "@core/src/features/products/domain/product";

type CatalogItem = Readonly<{ variantId: VariantId; productName: string; variantAttributes: Readonly<Record<string, string>>; sku: string | null; unitPrice: Money }>;
type StockError = Readonly<{ code: "INSUFFICIENT_STOCK" | "PERSISTENCE_UNAVAILABLE"; message: string; variantId?: string }>;

function knownFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

export async function findSellableVariant(id: string) {
  try {
    const row = await prisma.productVariant.findFirst({ where: { id, status: "active", product: { status: "active" } }, include: { product: true } });
    if (!row) return ok<CatalogItem | null>(null);
    const attributes = row.attributes;
    if (!isCurrency(row.product.currency) || !attributes || typeof attributes !== "object" || Array.isArray(attributes) || Object.values(attributes).some((value) => typeof value !== "string")) {
      log.error({ event: "invalid_stored_sale_variant" }, "invalid_stored_sale_variant");
      return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
    }
    return ok<CatalogItem>({ variantId: row.id as VariantId, productName: row.product.name, variantAttributes: { ...attributes } as Record<string, string>, sku: row.sku,
      unitPrice: { amount: row.salePrice.toNumber(), currency: row.product.currency } });
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_sale_variant", err: cause }, "unable_to_read_sale_variant");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
}

export async function deductProductStock(variantId: VariantId, quantity: number, context?: Readonly<{ operation: string; orderId: string }>) {
  try {
    const result = await prisma.productStock.updateMany({ where: { variantId, quantity: { gte: BigInt(quantity) } }, data: { quantity: { decrement: BigInt(quantity) } } });
    return result.count === 1 ? ok<null>(null) : err<StockError>({ code: "INSUFFICIENT_STOCK", message: "Not enough stock", variantId });
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_deduct_product_stock", variantId, operation: context?.operation, orderId: context?.orderId,
      stage: "deduct_stock", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_deduct_product_stock");
    return err<StockError>({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to update stock" });
  }
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

export async function searchSaleCatalog(search: string, variantIds?: readonly string[]) {
  try {
    const variantFilter = { status: "active" as const, ...(variantIds ? { id: { in: [...variantIds] } } : {}) };
    const rows = await prisma.product.findMany({ where: { status: "active", ...(variantIds
      ? { variants: { some: variantFilter } }
      : { name: { contains: search.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const } }) },
      orderBy: { name: "asc" }, ...(variantIds ? {} : { take: 20 }),
      include: { variants: { where: variantFilter, include: { stock: true } } } });
    if (rows.some((row) => row.variants.some((variant) => !variant.attributes || typeof variant.attributes !== "object" || Array.isArray(variant.attributes) ||
      Object.values(variant.attributes).some((value) => typeof value !== "string") || !variant.stock ||
      variant.stock.quantity < 0n || variant.stock.quantity > BigInt(Number.MAX_SAFE_INTEGER)))) {
      log.error({ event: "invalid_stored_sale_catalog" }, "invalid_stored_sale_catalog");
      return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
    }
    return ok(rows.map((row) => ({ id: row.id, name: row.name, currency: row.currency,
      variants: row.variants.map((variant) => ({ id: variant.id, attributes: variant.attributes as Record<string, string>, sku: variant.sku,
        price: variant.salePrice.toNumber(), stock: Number(variant.stock!.quantity) })) })));
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_search_sale_catalog", err: cause }, "unable_to_search_sale_catalog");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to search catalog" });
  }
}
