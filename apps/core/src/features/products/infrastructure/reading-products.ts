import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { currencies } from "@shared/money";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, withinReadSnapshot } from "@core/src/shared/infrastructure/persistance";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ReadingRows } from "@core/src/features/products/application/find-products-for-reading";

const productRowSchema = z.object({ id: z.uuid(), name: z.string(), currency: z.enum(currencies), status: z.string() });
const variantRowSchema = z.object({ id: z.uuid(), productId: z.uuid(), sku: z.string().nullable(), salePrice: z.instanceof(Prisma.Decimal) });
const optionRowSchema = z.object({ variantId: z.uuid(), optionName: z.string(), optionPosition: z.number().int(), valueName: z.string(), valuePosition: z.number().int() });

function knownFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

/**
 * The rows the reader needs for these products, in one read snapshot and three queries whatever the product count:
 * products by (companyId, id), active variants driven from (companyId, productId, id), and their option links by (companyId, variantId).
 */
export async function readProductRowsForReading(productIds: readonly ProductId[]) {
  const companyId = getCompanyId();
  try {
    const { products, variants, options } = await withinReadSnapshot(async () => {
      const products = await prisma.product.findMany({ where: { companyId, id: { in: [...productIds] } }, select: { id: true, name: true, currency: true, status: true } });
      const variants = await prisma.productVariant.findMany({ where: { companyId, productId: { in: [...productIds] }, status: "active" },
        select: { id: true, productId: true, sku: true, salePrice: true } });
      const options = variants.length ? await prisma.$queryRaw<unknown[]>(Prisma.sql`
        SELECT l."variantId" AS "variantId", o.name AS "optionName", o.position AS "optionPosition", v.name AS "valueName", v.position AS "valuePosition"
        FROM "ProductVariantOptionValue" l
        JOIN "ProductOption" o ON o."companyId" = l."companyId" AND o."productId" = l."productId" AND o.id = l."optionId"
        JOIN "ProductOptionValue" v ON v."companyId" = l."companyId" AND v."optionId" = l."optionId" AND v.id = l."valueId"
        WHERE l."companyId" = ${companyId}::uuid AND l."variantId" = ANY(${variants.map(({ id }) => id)}::uuid[])`) : [];
      return { products, variants, options };
    });
    const parsedProducts = z.array(productRowSchema).safeParse(products);
    const parsedVariants = z.array(variantRowSchema).safeParse(variants);
    const parsedOptions = z.array(optionRowSchema).safeParse(options);
    if (!parsedProducts.success || !parsedVariants.success || !parsedOptions.success) {
      log.error({ event: "invalid_stored_reading_product", companyId, errorCode: "INVALID_STORED_DATA" }, "invalid_stored_reading_product");
      return err({ code: "INVALID_STORED_DATA" as const, message: "Unable to read catalog" });
    }
    const currencyOf = new Map(parsedProducts.data.map(({ id, currency }) => [id, currency]));
    const rows: ReadingRows = {
      products: parsedProducts.data.map(({ id, name, status }) => ({ id: id as ProductId, name, status })),
      variants: parsedVariants.data.flatMap(({ id, productId, sku, salePrice }) => {
        const currency = currencyOf.get(productId);
        return currency ? [{ id: id as VariantId, productId: productId as ProductId, sku, unitPrice: { amount: salePrice.toNumber(), currency } }] : [];
      }),
      options: parsedOptions.data.map((option) => ({ ...option, variantId: option.variantId as VariantId })),
    };
    return ok(rows);
  } catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_products_for_reading", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_products_for_reading");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
}
