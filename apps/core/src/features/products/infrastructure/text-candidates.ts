import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { currencies } from "@shared/money";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma } from "@core/src/shared/infrastructure/persistance";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { TextCandidate, TextQuery } from "@core/src/features/products/domain/text-identification";

const rowSchema = z.object({
  idx: z.coerce.number().int().min(1), id: z.uuid(), name: z.string(), currency: z.enum(currencies),
  similarity: z.number().finite(), minPrice: z.number().nonnegative(), maxPrice: z.number().nonnegative(),
});

const unavailable = (cause: unknown) => {
  log.error({ event: "unable_to_find_text_candidates", companyId: getCompanyId(), errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_find_text_candidates");
  return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
};

/**
 * Active products with a sellable variant whose name resembles each mention, in one round trip.
 * Compares without case or accents; uses the company btree, not the global trigram index, because catalogs have hundreds of products.
 */
export async function findTextCandidates(queries: readonly TextQuery[], options: Readonly<{ limit: number; minSimilarity: number }>) {
  if (!queries.length) return ok<readonly (readonly TextCandidate[])[]>([]);
  const mentions = queries.map(({ mention }) => mention);
  let rows: unknown[];
  try {
    rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`
      SELECT q.idx::int AS idx, c.id, c.name, c.currency, c.similarity, c."minPrice", c."maxPrice"
      FROM unnest(${mentions}::text[]) WITH ORDINALITY AS q(mention, idx)
      CROSS JOIN LATERAL (
        SELECT p.id, p.name, p.currency, word_similarity(unaccent(lower(q.mention)), unaccent(lower(p.name)))::float8 AS similarity,
          min(v."salePrice")::float8 AS "minPrice", max(v."salePrice")::float8 AS "maxPrice"
        FROM "Product" p
        JOIN "ProductVariant" v ON v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active'
        WHERE p."companyId" = ${getCompanyId()}::uuid AND p.status = 'active'
        GROUP BY p.id
        HAVING word_similarity(unaccent(lower(q.mention)), unaccent(lower(p.name))) >= ${options.minSimilarity}
        ORDER BY similarity DESC, p.id
        LIMIT ${options.limit}
      ) c
      ORDER BY q.idx, c.similarity DESC, c.id`);
  } catch (cause) {
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    return unavailable(cause);
  }
  const parsed = z.array(rowSchema).safeParse(rows);
  if (!parsed.success) {
    log.error({ event: "unable_to_find_text_candidates", companyId: getCompanyId(), errorCode: "INVALID_STORED_DATA" }, "unable_to_find_text_candidates");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
  const grouped: TextCandidate[][] = queries.map(() => []);
  for (const row of parsed.data) grouped[row.idx - 1]?.push({ productId: row.id as ProductId, name: row.name, similarity: row.similarity,
    minPrice: { amount: row.minPrice, currency: row.currency }, maxPrice: { amount: row.maxPrice, currency: row.currency } });
  return ok<readonly (readonly TextCandidate[])[]>(grouped);
}
