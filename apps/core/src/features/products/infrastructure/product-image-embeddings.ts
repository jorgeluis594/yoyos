import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { EmbeddingModel, EmbeddingVector, VisualCandidate } from "@core/src/features/products/domain/image-identification";

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

const candidateSchema = z.object({ productId: z.uuid(), imageId: z.uuid(), distance: z.number().finite() });

/** Closest current images of sellable products of the company (RLS), compared only within one model. */
export async function findNearestProductImages(vector: EmbeddingVector, model: EmbeddingModel, limit: number) {
  const rows = await guarded("unable_to_find_nearest_product_images", () => prisma.$queryRaw<unknown[]>`
    SELECT e."productId", e."imageId", (e.embedding <=> ${`[${vector.join(",")}]`}::vector)::float8 AS distance
    FROM "ProductImageEmbedding" e
    JOIN "Product" p ON p."companyId" = e."companyId" AND p.id = e."productId"
    WHERE e.model = ${model} AND p."imageId" = e."imageId" AND p.status = 'active'
      AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')
    ORDER BY distance, e."productId"
    LIMIT ${limit}`);
  if (!rows.success) return rows;
  const parsed = z.array(candidateSchema).safeParse(rows.data);
  if (!parsed.success) {
    log.error({ event: "invalid_stored_product_image_embedding", errorCode: "INVALID_STORED_DATA" }, "invalid_stored_product_image_embedding");
    return err(unavailable);
  }
  return ok<readonly VisualCandidate[]>(parsed.data.map((row) => ({ productId: row.productId as ProductId, imageId: row.imageId as ImageId, distance: row.distance })));
}
