import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { EmbeddingModel, ProductImageEmbedding } from "@core/src/features/products/domain/image-identification";

const unavailable = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to access product image embeddings" };

function knownFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

async function guarded<T>(event: string, work: () => Promise<T>) {
  try { return ok(await work()); }
  catch (cause) {
    if (!knownFailure(cause)) throw cause;
    log.error({ event, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, event);
    return err(unavailable);
  }
}

const indexStateSchema = z.object({ imageId: z.uuid().nullable(), indexedImageId: z.uuid().nullable() });

export async function findImageIndexState(productId: ProductId, model: EmbeddingModel) {
  const rows = await guarded("unable_to_read_image_index_state", () => prisma.$queryRaw<unknown[]>`
    SELECT p."imageId", e."imageId" AS "indexedImageId"
    FROM "Product" p
    LEFT JOIN "ProductImageEmbedding" e ON e."companyId" = p."companyId" AND e."productId" = p.id AND e.model = ${model}
    WHERE p.id = ${productId}::uuid`);
  if (!rows.success) return rows;
  if (rows.data.length === 0) return ok(null);
  const parsed = indexStateSchema.safeParse(rows.data[0]);
  if (!parsed.success) {
    log.error({ event: "invalid_stored_image_index_state", errorCode: "INVALID_STORED_DATA", productId }, "invalid_stored_image_index_state");
    return err(unavailable);
  }
  return ok({ imageId: parsed.data.imageId as ImageId | null, indexedImageId: parsed.data.indexedImageId as ImageId | null });
}

/** Writes only while the product still has that image, so a late event never stores a replaced image. */
export async function saveEmbedding(embedding: ProductImageEmbedding) {
  const vector = `[${embedding.vector.join(",")}]`;
  const written = await guarded("unable_to_save_product_image_embedding", () => prisma.$executeRaw`
    INSERT INTO "ProductImageEmbedding" ("productId", "imageId", model, embedding, "createdAt")
    SELECT p.id, p."imageId", ${embedding.model}, ${vector}::vector, now()
    FROM "Product" p WHERE p.id = ${embedding.productId}::uuid AND p."imageId" = ${embedding.imageId}::uuid
    ON CONFLICT ("companyId", "productId", model)
    DO UPDATE SET "imageId" = EXCLUDED."imageId", embedding = EXCLUDED.embedding, "createdAt" = EXCLUDED."createdAt"`);
  if (!written.success) return written;
  return ok(written.data === 0 ? "image_replaced" as const : "saved" as const);
}

/** Active products with an image and without an embedding of that image and model. */
export async function listProductsMissingEmbedding(model: EmbeddingModel) {
  const rows = await guarded("unable_to_list_products_missing_embedding", () => prisma.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM "Product" p
    WHERE p.status = 'active' AND p."imageId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "ProductImageEmbedding" e
        WHERE e."companyId" = p."companyId" AND e."productId" = p.id AND e.model = ${model} AND e."imageId" = p."imageId")
    ORDER BY p.id`);
  return rows.success ? ok(rows.data.map(({ id }) => id as ProductId)) : rows;
}
