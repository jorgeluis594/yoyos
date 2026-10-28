import { err, ok } from "@shared/functional";
import { Prisma } from "@prisma/client";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { ProductId } from "@core/src/features/products/domain/product";

export type ProductNoticeNames = Readonly<{ name: string; attributeNames: readonly string[] }>;

const isKnownFailure = (cause: unknown) => cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;

/** What a seller notice may say about a product: its name and the attribute names its variants use («talla», «color»). A deleted product is absent. */
export async function findProductNoticeNames(productIds: readonly ProductId[]) {
  if (productIds.length === 0) return ok<ReadonlyMap<ProductId, ProductNoticeNames>>(new Map());
  try {
    const rows = await prisma.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, name: true, options: { select: { name: true }, orderBy: { position: "asc" } } } });
    return ok<ReadonlyMap<ProductId, ProductNoticeNames>>(new Map(rows.map((row) =>
      [row.id as ProductId, { name: row.name, attributeNames: [...new Set(row.options.map((option) => option.name.toLowerCase()))] }])));
  } catch (cause) {
    if (!isKnownFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_product_notice_names", err: cause }, "unable_to_read_product_notice_names");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
}
