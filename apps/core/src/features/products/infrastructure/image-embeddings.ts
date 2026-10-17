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

const indexStateSchema = z.object({ imageId: z.uuid().nullable(), indexed: z.boolean() });

/** The product's current image and whether that image already has an embedding of the model. */
export async function findImageIndexState(productId: ProductId, model: EmbeddingModel) {
  const rows = await guarded("unable_to_read_image_index_state", () => prisma.$queryRaw<unknown[]>`
    SELECT p."imageId", EXISTS (SELECT 1 FROM "ImageEmbedding" e
      WHERE e."companyId" = p."companyId" AND e."imageId" = p."imageId" AND e.model = ${model}) AS indexed
    FROM "Product" p
    WHERE p.id = ${productId}::uuid`);
  if (!rows.success) return rows;
  if (rows.data.length === 0) return ok(null);
  const parsed = indexStateSchema.safeParse(rows.data[0]);
  if (!parsed.success) {
    log.error({ event: "invalid_stored_image_index_state", errorCode: "INVALID_STORED_DATA", productId }, "invalid_stored_image_index_state");
    return err(unavailable);
  }
  return ok({ imageId: parsed.data.imageId as ImageId | null, indexed: parsed.data.indexed });
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

/** Active products with an image and without an embedding of that image and model. */
export async function listProductsMissingEmbedding(model: EmbeddingModel) {
  const rows = await guarded("unable_to_list_products_missing_embedding", () => prisma.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM "Product" p
    WHERE p.status = 'active' AND p."imageId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "ImageEmbedding" e
        WHERE e."companyId" = p."companyId" AND e."imageId" = p."imageId" AND e.model = ${model})
    ORDER BY p.id`);
  return rows.success ? ok(rows.data.map(({ id }) => id as ProductId)) : rows;
}

/** Whether some active product of the company (RLS) has its current image embedded with the model. */
export async function hasIndexedProducts(model: EmbeddingModel) {
  const rows = await guarded("unable_to_check_indexed_products", () => prisma.$queryRaw<Array<{ indexed: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM "ImageEmbedding" e
      JOIN "Product" p ON p."companyId" = e."companyId" AND p."imageId" = e."imageId"
      WHERE e.model = ${model} AND p.status = 'active') AS indexed`);
  return rows.success ? ok(rows.data[0]?.indexed === true) : rows;
}

const candidateSchema = z.object({ productId: z.uuid(), imageId: z.uuid(), distance: z.number().finite() });

/** Closest current images of sellable products of the company (RLS), compared only within one model. */
export async function findNearestProductImages(vector: EmbeddingVector, model: EmbeddingModel, limit: number) {
  const rows = await guarded("unable_to_find_nearest_product_images", () => prisma.$queryRaw<unknown[]>`
    SELECT p.id AS "productId", e."imageId", (e.embedding <=> ${`[${vector.join(",")}]`}::vector)::float8 AS distance
    FROM "ImageEmbedding" e
    JOIN "Product" p ON p."companyId" = e."companyId" AND p."imageId" = e."imageId"
    WHERE e.model = ${model} AND p.status = 'active'
      AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')
    ORDER BY distance, p.id
    LIMIT ${limit}`);
  if (!rows.success) return rows;
  const parsed = z.array(candidateSchema).safeParse(rows.data);
  if (!parsed.success) {
    log.error({ event: "invalid_stored_image_embedding", errorCode: "INVALID_STORED_DATA" }, "invalid_stored_image_embedding");
    return err(unavailable);
  }
  return ok<readonly VisualCandidate[]>(parsed.data.map((row) => ({ productId: row.productId as ProductId, imageId: row.imageId as ImageId, distance: row.distance })));
}
