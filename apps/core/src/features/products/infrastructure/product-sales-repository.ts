import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { transactionFailureStage } from "@core/src/shared/infrastructure/persistence-error";
import { getCompanyId, prisma } from "@core/src/shared/infrastructure/persistance";
import type { ProductId } from "@core/src/features/products/domain/product";
import { lowStockThreshold, stockLevelOf } from "@core/src/features/products/domain/stock-level";
import type { ProductReadError } from "@core/src/features/products/application/repository";
import type { DescribedVariant, DescribeVariantsInput } from "@core/src/features/products/application/describe-variants-for-assistant";
import type { ListStockedInput, StockedProduct, StockedRows } from "@core/src/features/products/application/list-stocked-for-assistant";
import { productMatchesText } from "@core/src/features/products/infrastructure/product-text-match";

type Stage = "describe_variants" | "stocked";

/** Any 8-4-4-4-12 identifier: ids are random version 4 uuids, and the load fixture derives its own from md5. */
const uuid = z.guid();
const safeInteger = z.string().regex(/^-?\d+$/).transform(Number).pipe(z.number().int().refine(Number.isSafeInteger, "outside the supported range"));

const describedRow = z.strictObject({ variantId: uuid, productId: uuid, productName: z.string(), values: z.array(z.string()), matchesText: z.boolean() });
/** One row per matching product; the product columns are null in the single row of a store without matching products. */
const stockedRow = z.strictObject({
  storeHasProducts: z.boolean(), id: uuid.nullable(), name: z.string().nullable(), createdAt: z.date().nullable(), total: safeInteger.nullable(),
  soldOut: z.number().int().min(0).nullable(), low: z.number().int().min(0).nullable(), activeCount: z.number().int().min(0).nullable(), variantIds: z.array(uuid).nullable(),
});

const invalid = (stage: Stage, reason: string): Result<never, ProductReadError> => {
  log.error({ event: "invalid_stored_product_data", companyId: getCompanyId(), stage, reason }, "invalid_stored_product_data");
  return err({ code: "INVALID_STORED_DATA", message: "Stored product data is invalid" });
};

/** Runs one statement and parses its rows; transaction failures are rethrown for the snapshot to report. */
async function read<Row>(stage: Stage, statement: Prisma.Sql, schema: z.ZodType<Row>): Promise<Result<Row[], ProductReadError>> {
  let rows: unknown[];
  try {
    rows = await prisma.$queryRaw<unknown[]>(statement);
  } catch (error) {
    if (transactionFailureStage(error)) throw error;
    log.error({ event: "product_read_persistence_failed", companyId: getCompanyId(), stage, err: error }, "product_read_persistence_failed");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read products" });
  }
  const parsed = z.array(schema).safeParse(rows);
  return parsed.success ? ok(parsed.data) : invalid(stage, parsed.error.issues[0]?.message ?? "invalid row");
}

/** The option values of a variant in option order; the joins are the ones of the search's matching variants. */
const valuesJoin = Prisma.sql`LEFT JOIN "ProductVariantOptionValue" l ON l."companyId" = v."companyId" AND l."variantId" = v.id
    LEFT JOIN "ProductOption" o ON o."companyId" = l."companyId" AND o."productId" = l."productId" AND o.id = l."optionId"
    LEFT JOIN "ProductOptionValue" ov ON ov."companyId" = l."companyId" AND ov."optionId" = l."optionId" AND ov.id = l."valueId"`;
const valuesColumn = Prisma.sql`coalesce(array_agg(ov.name ORDER BY o.position) FILTER (WHERE ov.id IS NOT NULL), '{}') AS "values"`;

/**
 * The current product name, the values in option order and whether the product matches `text`, for the given variants (at most the catalog's), or for
 * every variant of one product. The text match is evaluated once per product, not once per variant.
 */
export function describeVariantsSql(companyId: string, input: DescribeVariantsInput): Prisma.Sql {
  if (input.by === "product") {
    return Prisma.sql`SELECT v.id::text AS "variantId", p.id::text AS "productId", p.name AS "productName", ${valuesColumn}, true AS "matchesText"
      FROM "Product" p JOIN "ProductVariant" v ON v."companyId" = p."companyId" AND v."productId" = p.id ${valuesJoin}
      WHERE p."companyId" = ${companyId}::uuid AND p.id = ${input.productId}::uuid
      GROUP BY v.id, p.id, p.name`;
  }
  const matches = input.text ? productMatchesText(input.text) : Prisma.sql`true`;
  return Prisma.sql`WITH picked AS (
      SELECT v.id, v."productId" FROM "ProductVariant" v WHERE v."companyId" = ${companyId}::uuid AND v.id = ANY(${[...input.variantIds]}::uuid[])
    ), products AS (
      SELECT p.id, p.name, ${matches} AS matches FROM "Product" p
      WHERE p."companyId" = ${companyId}::uuid AND p.id IN (SELECT "productId" FROM picked)
    )
    SELECT v.id::text AS "variantId", p.id::text AS "productId", p.name AS "productName", ${valuesColumn}, p.matches AS "matchesText"
    FROM picked pk JOIN products p ON p.id = pk."productId" JOIN "ProductVariant" v ON v."companyId" = ${companyId}::uuid AND v.id = pk.id ${valuesJoin}
    GROUP BY v.id, p.id, p.name, p.matches`;
}

export async function readDescribedVariants(input: DescribeVariantsInput): Promise<Result<readonly DescribedVariant[], ProductReadError>> {
  const rows = await read("describe_variants", describeVariantsSql(getCompanyId(), input), describedRow);
  if (!rows.success) return rows;
  return ok(rows.data.map((row): DescribedVariant => ({ variantId: row.variantId, productId: row.productId as ProductId, productName: row.productName, values: row.values, matchesText: row.matchesText })));
}

/**
 * One row per product matching `text` (all when none) with the stock summary of its active variants, plus whether the store has any product.
 * The variant ids (every variant, deactivated included) are returned only for the products the tool will check: stock today and created before the cutoff.
 */
export function stockedSql(companyId: string, input: ListStockedInput): Prisma.Sql {
  const matching = input.text ? Prisma.sql`AND ${productMatchesText(input.text)}` : Prisma.empty;
  const active = Prisma.sql`v.status = 'active'`;
  return Prisma.sql`WITH matching AS (
      SELECT p.id, p.name, p."createdAt" FROM "Product" p WHERE p."companyId" = ${companyId}::uuid ${matching}
    ), stocked AS (
      SELECT m.id, m.name, m."createdAt",
        (coalesce(sum(s.quantity) FILTER (WHERE ${active}), 0))::text AS total,
        (count(*) FILTER (WHERE ${active} AND s.quantity = 0))::int AS "soldOut",
        (count(*) FILTER (WHERE ${active} AND s.quantity BETWEEN 1 AND ${lowStockThreshold}))::int AS low,
        (count(*) FILTER (WHERE ${active}))::int AS "activeCount",
        CASE WHEN m."createdAt" < ${input.createdBefore} AND coalesce(sum(s.quantity) FILTER (WHERE ${active}), 0) > 0
          THEN array_agg(v.id::text) ELSE ARRAY[]::text[] END AS "variantIds"
      FROM matching m
      JOIN "ProductVariant" v ON v."companyId" = ${companyId}::uuid AND v."productId" = m.id
      JOIN "ProductStock" s ON s."companyId" = v."companyId" AND s."variantId" = v.id
      GROUP BY m.id, m.name, m."createdAt"
    )
    SELECT e.has AS "storeHasProducts", st.id::text AS id, st.name, st."createdAt", st.total, st."soldOut", st.low, st."activeCount", st."variantIds"
    FROM (SELECT EXISTS (SELECT 1 FROM "Product" WHERE "companyId" = ${companyId}::uuid) AS has) e LEFT JOIN stocked st ON true`;
}

export async function readStockedProducts(input: ListStockedInput): Promise<Result<StockedRows, ProductReadError>> {
  const rows = await read("stocked", stockedSql(getCompanyId(), input), stockedRow);
  if (!rows.success) return rows;
  const storeHasProducts = rows.data[0]?.storeHasProducts ?? false;
  const products: StockedProduct[] = [];
  for (const row of rows.data) {
    if (row.id === null) continue;
    if (row.name === null || row.createdAt === null || row.total === null || row.soldOut === null || row.low === null || row.activeCount === null || row.variantIds === null)
      return invalid("stocked", "incomplete product row");
    products.push({
      id: row.id as ProductId, name: row.name, createdAt: row.createdAt, variantIds: row.variantIds,
      stock: { total: row.total, soldOut: row.soldOut, low: row.low, onlyLevel: row.activeCount === 1 ? stockLevelOf(row.total) : null },
    });
  }
  return ok({ storeHasProducts, products });
}
