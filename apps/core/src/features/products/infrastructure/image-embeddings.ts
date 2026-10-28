import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { EmbeddingModel, EmbeddingVector, ImageEmbedding, VisualCandidate } from "@core/src/features/products/domain/image-identification";

const unavailable = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to access image embeddings" };

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

const indexStateSchema = z.array(z.object({ imageId: z.uuid().nullable(), indexed: z.boolean() }));

/** The product's photos in position order and whether each image already has an embedding of the model; null when the product does not exist. */
export async function findPhotoIndexState(productId: ProductId, model: EmbeddingModel) {
  const rows = await guarded("unable_to_read_photo_index_state", () => prisma.$queryRaw<unknown[]>`
    SELECT pp."imageId", EXISTS (SELECT 1 FROM "ImageEmbedding" e
      WHERE e."companyId" = p."companyId" AND e."imageId" = pp."imageId" AND e.model = ${model}) AS indexed
    FROM "Product" p
    LEFT JOIN "ProductPhoto" pp ON pp."companyId" = p."companyId" AND pp."productId" = p.id
    WHERE p.id = ${productId}::uuid
    ORDER BY pp.position`);
  if (!rows.success) return rows;
  if (rows.data.length === 0) return ok(null);
  const parsed = indexStateSchema.safeParse(rows.data);
  if (!parsed.success) {
    log.error({ event: "invalid_stored_photo_index_state", errorCode: "INVALID_STORED_DATA", productId }, "invalid_stored_photo_index_state");
    return err(unavailable);
  }
  // A product without photos comes back as one row with a null image.
  return ok(parsed.data.flatMap(({ imageId, indexed }) => imageId ? [{ imageId: imageId as ImageId, indexed }] : []));
}

/** Idempotent: an existing embedding of the image and model is kept, and a deleted image writes nothing. */
export async function saveEmbedding(embedding: ImageEmbedding) {
  const vector = `[${embedding.vector.join(",")}]`;
  const written = await guarded("unable_to_save_image_embedding", () => prisma.$executeRaw`
    INSERT INTO "ImageEmbedding" ("imageId", model, embedding, "createdAt")
    SELECT i.id, ${embedding.model}, ${vector}::vector, now()
    FROM "Image" i WHERE i.id = ${embedding.imageId}::uuid
    ON CONFLICT ("companyId", "imageId", model) DO NOTHING`);
  return written.success ? ok(undefined) : written;
}

/** Active products with some current photo without an embedding of the model. */
export async function listProductsMissingEmbedding(model: EmbeddingModel) {
  const rows = await guarded("unable_to_list_products_missing_embedding", () => prisma.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM "Product" p
    WHERE p.status = 'active'
      AND EXISTS (SELECT 1 FROM "ProductPhoto" pp
        WHERE pp."companyId" = p."companyId" AND pp."productId" = p.id
          AND NOT EXISTS (SELECT 1 FROM "ImageEmbedding" e
            WHERE e."companyId" = pp."companyId" AND e."imageId" = pp."imageId" AND e.model = ${model}))
    ORDER BY p.id`);
  return rows.success ? ok(rows.data.map(({ id }) => id as ProductId)) : rows;
}

/** Whether some active product of the company (RLS) with an active variant has a current photo embedded with the model; embeddings left by removed photos are never scanned. */
export async function hasIndexedProducts(model: EmbeddingModel) {
  const rows = await guarded("unable_to_check_indexed_products", () => prisma.$queryRaw<Array<{ indexed: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM "Product" p
      JOIN "ProductPhoto" pp ON pp."companyId" = p."companyId" AND pp."productId" = p.id
      JOIN "ImageEmbedding" e ON e."companyId" = pp."companyId" AND e."imageId" = pp."imageId" AND e.model = ${model}
      WHERE p.status = 'active'
        AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')) AS indexed`);
  return rows.success ? ok(rows.data[0]?.indexed === true) : rows;
}

const candidateSchema = z.object({ productId: z.uuid(), imageId: z.uuid(), position: z.number().int().nonnegative(), distance: z.number().finite() });

/** Closest current photo of each sellable product of the company (RLS), compared only within one model; the K closest products. */
export async function findNearestProductImages(vector: EmbeddingVector, model: EmbeddingModel, limit: number) {
  const rows = await guarded("unable_to_find_nearest_product_images", () => prisma.$queryRaw<unknown[]>`
    SELECT "productId", "imageId", position, distance FROM (
      SELECT DISTINCT ON (p.id) p.id AS "productId", pp."imageId", pp.position,
             (e.embedding <=> ${`[${vector.join(",")}]`}::vector)::float8 AS distance
      FROM "Product" p
      JOIN "ProductPhoto" pp ON pp."companyId" = p."companyId" AND pp."productId" = p.id
      JOIN "ImageEmbedding" e ON e."companyId" = pp."companyId" AND e."imageId" = pp."imageId" AND e.model = ${model}
      WHERE p.status = 'active'
        AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')
      ORDER BY p.id, distance, pp.position
    ) best
    ORDER BY distance, "productId"
    LIMIT ${limit}`);
  if (!rows.success) return rows;
  const parsed = z.array(candidateSchema).safeParse(rows.data);
  if (!parsed.success) {
    log.error({ event: "invalid_stored_image_embedding", errorCode: "INVALID_STORED_DATA" }, "invalid_stored_image_embedding");
    return err(unavailable);
  }
  return ok<readonly VisualCandidate[]>(parsed.data.map((row) => ({ productId: row.productId as ProductId, imageId: row.imageId as ImageId, position: row.position, distance: row.distance })));
}
