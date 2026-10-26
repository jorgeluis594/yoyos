import { log } from "@core/src/shared/infrastructure/logger";
import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { isCurrency } from "@shared/money";
import { getCompanyId, prisma, withinReadSnapshot } from "@core/src/shared/infrastructure/persistance";
import { loadAttributesOfProducts, loadAttributesOfVariants, type VariantAttributes } from "@core/src/features/products/infrastructure/variant-combinations";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";
type StockError = Readonly<{ code: "INSUFFICIENT_STOCK" | "PERSISTENCE_UNAVAILABLE"; message: string; variantId?: string }>;

function knownFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

type SellableRow = Prisma.ProductVariantGetPayload<{ include: { product: true } }>;

function toCatalogItem(row: SellableRow, attributes: VariantAttributes): CatalogItem | null {
  if (!isCurrency(row.product.currency)) return null;
  return { variantId: row.id as VariantId, productName: row.product.name, variantAttributes: { ...attributes.get(row.id) }, sku: row.sku,
    unitPrice: { amount: row.salePrice.toNumber(), currency: row.product.currency } };
}

type JoinedRow = Readonly<{ id: string; sku: string | null; salePrice: Prisma.Decimal; productName: string; currency: string; pairs: readonly (readonly [string, string])[] }>;

/** One join: the variant, its product and its combination in saved option order. */
export async function findSellableVariant(id: string) {
  try {
    const [row] = await prisma.$queryRaw<JoinedRow[]>(Prisma.sql`SELECT v.id, v.sku, v."salePrice", p.name AS "productName", p.currency,
      COALESCE((SELECT json_agg(json_build_array(o.name, ov.name) ORDER BY o.position)
        FROM "ProductVariantOptionValue" l
        JOIN "ProductOption" o ON o."companyId" = l."companyId" AND o."productId" = l."productId" AND o.id = l."optionId"
        JOIN "ProductOptionValue" ov ON ov."companyId" = l."companyId" AND ov."optionId" = l."optionId" AND ov.id = l."valueId"
        WHERE l."companyId" = v."companyId" AND l."variantId" = v.id), '[]'::json) AS pairs
      FROM "ProductVariant" v JOIN "Product" p ON p."companyId" = v."companyId" AND p.id = v."productId"
      WHERE v."companyId" = ${getCompanyId()}::uuid AND v.id = ${id}::uuid AND v.status = 'active' AND p.status = 'active'`);
    if (!row) return ok<CatalogItem | null>(null);
    if (!isCurrency(row.currency)) {
      log.error({ event: "invalid_stored_sale_variant" }, "invalid_stored_sale_variant");
      return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
    }
    return ok<CatalogItem | null>({ variantId: row.id as VariantId, productName: row.productName, variantAttributes: Object.fromEntries(row.pairs), sku: row.sku,
      unitPrice: { amount: new Prisma.Decimal(row.salePrice).toNumber(), currency: row.currency } });
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_sale_variant", err: cause }, "unable_to_read_sale_variant");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
}

type SellableVariant = CatalogItem & Readonly<{ productId: string; imageId: string | null; available: number }>;

/** Active variants of active products with their current stock, read without lock: nothing is reserved. */
export async function findSellableVariants(ids: readonly string[]) {
  try {
    const { rows, attributes } = await withinReadSnapshot(async () => {
      const rows = await prisma.productVariant.findMany({ where: { id: { in: [...ids] }, status: "active", product: { status: "active" } }, include: { product: true, stock: true } });
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
      items.push({ ...item, productId: row.productId, imageId: row.product.imageId, available: stock > 99n ? 99 : Number(stock) });
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
    const items: Array<CatalogItem & Readonly<{ qrCode: string }>> = [];
    for (const row of rows) {
      const item = toCatalogItem(row, attributes);
      // Una variante corrupta no debe bloquear las demás ni reintentarse: se omite como si no existiera.
      if (!item) { log.error({ event: "invalid_stored_sale_variant", variantId: row.id }, "invalid_stored_sale_variant"); continue; }
      items.push({ ...item, qrCode: row.qrCode });
    }
    return ok(items);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_sale_variants_by_qr_code", err: cause }, "unable_to_read_sale_variants_by_qr_code");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
}

export async function findSellableVariantsOfProduct(productId: ProductId) {
  try {
    const { rows, attributes } = await withinReadSnapshot(async () => {
      const rows = await prisma.productVariant.findMany({ where: { productId, status: "active", product: { status: "active" } }, include: { product: true }, orderBy: { id: "asc" } });
      return { rows, attributes: await loadAttributesOfVariants(rows.map((row) => row.id)) };
    });
    const items: CatalogItem[] = [];
    for (const row of rows) {
      const item = toCatalogItem(row, attributes);
      if (!item) { log.error({ event: "invalid_stored_sale_variant", variantId: row.id }, "invalid_stored_sale_variant"); continue; }
      items.push(item);
    }
    return ok<readonly CatalogItem[]>(items);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_sale_variants_of_product", err: cause }, "unable_to_read_sale_variants_of_product");
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
    const { rows, attributes } = await withinReadSnapshot(async () => {
      const rows = await prisma.product.findMany({ where: { status: "active", variants: { some: variantFilter }, ...(variantIds
        ? {}
        : { name: { contains: search.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const } }) },
        orderBy: { name: "asc" }, ...(variantIds ? {} : { take: 20 }),
        include: { variants: { where: variantFilter, include: { stock: true } } } });
      return { rows, attributes: await loadAttributesOfProducts(rows.map((row) => row.id), true) };
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
