import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { isCurrency, type Money } from "@shared/money";
import { getCompanyId, prisma } from "@core/src/shared/infrastructure/persistance";
import { transactionFailureStage } from "@core/src/shared/infrastructure/persistence-error";
import { log } from "@core/src/shared/infrastructure/logger";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { VocabularyRow } from "@core/src/features/products/domain/product-search";
import { stockLevelOf } from "@core/src/features/products/domain/stock-level";
import type { AssistantReadError } from "@core/src/features/products/application/assistant-read";
import type { ActiveSummary, ProductSearchPage, ProductSearchQuery, SearchedProduct, SearchedVariant, SkuSummary } from "@core/src/features/products/application/search-for-assistant";

type Stage = "vocabulary" | "page" | "summaries" | "matching_variants" | "sku_owner";

const uuid = z.uuid();
const safeInteger = z.string().regex(/^-?\d+$/).transform(Number).pipe(z.number().int().refine(Number.isSafeInteger, "outside the supported range"));
const decimal = z.string().regex(/^\d+(\.\d+)?$/);

export const vocabularyRowSchema = z.strictObject({ optionName: z.string(), valueName: z.string(), productRank: z.number().int().min(1), position: z.number().int().min(0) });
export const pageRowSchema = z.strictObject({ ids: z.array(uuid), total: z.number().int().min(0), storeHasProducts: z.boolean() });
export const summaryRowSchema = z.strictObject({
  id: uuid, name: z.string(), currency: z.string().refine(isCurrency, "Stored currency is invalid"),
  variantCount: z.number().int().min(1), activeCount: z.number().int().min(0), soldOut: z.number().int().min(0), low: z.number().int().min(0),
  minPrice: decimal.nullable(), hasDifferentPrices: z.boolean(), totalStock: safeInteger,
  activeSku: z.string().nullable(), allSku: z.string().nullable(),
});
export const matchingVariantRowSchema = z.strictObject({
  productId: uuid, id: uuid, sku: z.string().nullable(), salePrice: decimal, stock: safeInteger,
  values: z.array(z.string()), total: z.number().int().min(1),
});
export const skuOwnerRowSchema = z.strictObject({ variantId: uuid, productId: uuid });

const invalid = (stage: Stage, reason: string): Result<never, AssistantReadError> => {
  log.error({ event: "invalid_stored_product_data", companyId: getCompanyId(), stage, reason }, "invalid_stored_product_data");
  return err({ code: "INVALID_STORED_DATA", message: "Stored product data is invalid" });
};

/** Runs one statement and parses its rows; transaction failures are rethrown for the snapshot to report. */
async function read<Row>(stage: Stage, statement: Prisma.Sql, schema: z.ZodType<Row>): Promise<Result<Row[], AssistantReadError>> {
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

// ICU Spanish collation, as the app list: case- and accent-insensitive at the primary level.
const orders = { name: Prisma.sql`name COLLATE "es-x-icu" ASC, id ASC`, recent: Prisma.sql`"createdAt" DESC, id ASC` } as const;

const likePattern = (text: string) => `%${text.trim().replace(/[\\%_]/g, "\\$&")}%`;

const hasVariantFilters = (query: ProductSearchQuery) =>
  query.valueSets.length > 0 || query.priceFrom !== undefined || query.priceTo !== undefined || query.stock !== undefined;

/** The conditions one active variant `v` (with its stock `s`) must meet together; they all apply to the same variant. */
function variantConditions(query: ProductSearchQuery): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (query.priceFrom !== undefined) conditions.push(Prisma.sql`v."salePrice" >= ${query.priceFrom}::numeric / 100`);
  if (query.priceTo !== undefined) conditions.push(Prisma.sql`v."salePrice" <= ${query.priceTo}::numeric / 100`);
  if (query.stock === "sold_out") conditions.push(Prisma.sql`s.quantity = 0`);
  if (query.stock === "low") conditions.push(Prisma.sql`s.quantity BETWEEN 1 AND ${query.lowStockThreshold}`);
  if (query.stock === "in_stock") conditions.push(Prisma.sql`s.quantity > 0`);
  for (const spellings of query.valueSets)
    conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "ProductVariantOptionValue" l
        JOIN "ProductOption" o ON o."companyId" = l."companyId" AND o."productId" = l."productId" AND o.id = l."optionId"
        JOIN "ProductOptionValue" ov ON ov."companyId" = l."companyId" AND ov."optionId" = l."optionId" AND ov.id = l."valueId"
        WHERE l."companyId" = v."companyId" AND l."variantId" = v.id
          AND (o.name, ov.name) IN (${Prisma.join(spellings.map(({ optionName, valueName }) => Prisma.sql`(${optionName}, ${valueName})`))}))`);
  return conditions;
}

const and = (conditions: readonly Prisma.Sql[]) => Prisma.join(conditions, " AND ");

/** Names of the options and values held by active variants, one row per distinct spelling, with the saved-order key of the newest product that holds it. */
export function vocabularySql(companyId: string): Prisma.Sql {
  // The existence test stops at the first active variant that holds each value, instead of joining every variant link of the store.
  return Prisma.sql`SELECT o.name AS "optionName", ov.name AS "valueName",
      (min(p.rank))::int AS "productRank", ((array_agg(ov.position ORDER BY p.rank, ov.position))[1])::int AS position
    FROM "ProductOption" o
    JOIN "ProductOptionValue" ov ON ov."companyId" = o."companyId" AND ov."optionId" = o.id
    JOIN (SELECT id, row_number() OVER (ORDER BY "createdAt" DESC, id) AS rank FROM "Product" WHERE "companyId" = ${companyId}::uuid) p ON p.id = o."productId"
    WHERE o."companyId" = ${companyId}::uuid
      AND EXISTS (SELECT 1 FROM "ProductVariantOptionValue" l
        JOIN "ProductVariant" v ON v."companyId" = l."companyId" AND v.id = l."variantId" AND v.status = 'active'
        WHERE l."companyId" = ov."companyId" AND l."optionId" = ov."optionId" AND l."valueId" = ov.id)
    GROUP BY o.name, ov.name`;
}

/** The ids of one page, the total of the filter and whether the store has any product, in one statement. */
export function pageSql(companyId: string, query: ProductSearchQuery): Prisma.Sql {
  const product: Prisma.Sql[] = [Prisma.sql`p."companyId" = ${companyId}::uuid`];
  const text = query.text?.trim();
  if (text) {
    const pattern = likePattern(text);
    product.push(Prisma.sql`(unaccent(lower(p.name)) LIKE unaccent(lower(${pattern}))
      OR EXISTS (SELECT 1 FROM "ProductVariant" sv WHERE sv."companyId" = p."companyId" AND sv."productId" = p.id
        AND unaccent(lower(sv.sku)) LIKE unaccent(lower(${pattern}))))`);
  }
  if (hasVariantFilters(query)) {
    product.push(Prisma.sql`EXISTS (SELECT 1 FROM "ProductVariant" v
      JOIN "ProductStock" s ON s."companyId" = v."companyId" AND s."variantId" = v.id
      WHERE ${and([Prisma.sql`v."companyId" = p."companyId"`, Prisma.sql`v."productId" = p.id`, Prisma.sql`v.status = 'active'`, ...variantConditions(query)])})`);
  } else if (query.inCatalog !== undefined) {
    product.push(Prisma.sql`${query.inCatalog ? Prisma.empty : Prisma.sql`NOT `}EXISTS (SELECT 1 FROM "ProductVariant" a
      WHERE a."companyId" = p."companyId" AND a."productId" = p.id AND a.status = 'active')`);
  }
  return Prisma.sql`WITH matching AS (SELECT p.id, p.name, p."createdAt" FROM "Product" p WHERE ${and(product)})
    SELECT ARRAY(SELECT id FROM matching ORDER BY ${orders[query.sort]} LIMIT ${query.limit} OFFSET ${query.offset}) AS ids,
      (SELECT count(*)::int FROM matching) AS total,
      EXISTS (SELECT 1 FROM "Product" WHERE "companyId" = ${companyId}::uuid) AS "storeHasProducts"`;
}

/** Prices, stock levels and SKU of the products of one page, over their active variants; no photo and no purchase price. */
export function summariesSql(companyId: string, ids: readonly string[], lowStockThreshold: number): Prisma.Sql {
  return Prisma.sql`SELECT p.id::text AS id, p.name, p.currency,
      count(v.id)::int AS "variantCount",
      (count(v.id) FILTER (WHERE v.status = 'active'))::int AS "activeCount",
      (count(v.id) FILTER (WHERE v.status = 'active' AND coalesce(s.quantity, 0) = 0))::int AS "soldOut",
      (count(v.id) FILTER (WHERE v.status = 'active' AND coalesce(s.quantity, 0) BETWEEN 1 AND ${lowStockThreshold}))::int AS low,
      (min(v."salePrice") FILTER (WHERE v.status = 'active'))::text AS "minPrice",
      coalesce((count(DISTINCT v."salePrice") FILTER (WHERE v.status = 'active')) > 1, false) AS "hasDifferentPrices",
      (coalesce(sum(s.quantity) FILTER (WHERE v.status = 'active'), 0))::text AS "totalStock",
      max(v.sku) FILTER (WHERE v.status = 'active') AS "activeSku",
      max(v.sku) AS "allSku"
    FROM "Product" p
    JOIN "ProductVariant" v ON v."companyId" = p."companyId" AND v."productId" = p.id
    LEFT JOIN "ProductStock" s ON s."companyId" = v."companyId" AND s."variantId" = v.id
    WHERE p."companyId" = ${companyId}::uuid AND p.id = ANY(${[...ids]}::uuid[])
    GROUP BY p.id`;
}

/** At most `matchingVariantCap` variants per product that meet every variant filter, in saved order, with the count of all that do. */
export function matchingVariantsSql(companyId: string, ids: readonly string[], query: ProductSearchQuery): Prisma.Sql {
  const conditions = [Prisma.sql`v."companyId" = ${companyId}::uuid`, Prisma.sql`v."productId" = ANY(${[...ids]}::uuid[])`, Prisma.sql`v.status = 'active'`, ...variantConditions(query)];
  return Prisma.sql`SELECT m."productId"::text AS "productId", m.id::text AS id, m.sku, m."salePrice"::text AS "salePrice", m.stock::text AS stock, m."values", m.total
    FROM (
      SELECT g.*, row_number() OVER (PARTITION BY g."productId" ORDER BY g.keys, g.id) AS position,
        (count(*) OVER (PARTITION BY g."productId"))::int AS total
      FROM (
        SELECT v.id, v."productId", v.sku, v."salePrice", s.quantity AS stock,
          coalesce(array_agg(ov.name ORDER BY o.position) FILTER (WHERE ov.id IS NOT NULL), '{}') AS "values",
          coalesce(array_agg(ov.position ORDER BY o.position) FILTER (WHERE ov.id IS NOT NULL), '{}') AS keys
        FROM "ProductVariant" v
        JOIN "ProductStock" s ON s."companyId" = v."companyId" AND s."variantId" = v.id
        LEFT JOIN "ProductVariantOptionValue" l ON l."companyId" = v."companyId" AND l."variantId" = v.id
        LEFT JOIN "ProductOption" o ON o."companyId" = l."companyId" AND o."productId" = l."productId" AND o.id = l."optionId"
        LEFT JOIN "ProductOptionValue" ov ON ov."companyId" = l."companyId" AND ov."optionId" = l."optionId" AND ov.id = l."valueId"
        WHERE ${and(conditions)}
        GROUP BY v.id, v."productId", v.sku, v."salePrice", s.quantity
      ) g
    ) m
    WHERE m.position <= ${query.matchingVariantCap}
    ORDER BY m."productId", m.position`;
}

/** The variant and product that own a SKU, through the unique expression index. `normalizedSku` is already `lower(btrim(sku))`. */
export function skuOwnerSql(companyId: string, normalizedSku: string): Prisma.Sql {
  return Prisma.sql`SELECT id::text AS "variantId", "productId"::text AS "productId" FROM "ProductVariant"
    WHERE "companyId" = ${companyId}::uuid AND sku IS NOT NULL AND lower(btrim(sku)) = ${normalizedSku}`;
}

export async function readVocabulary(): Promise<Result<readonly VocabularyRow[], AssistantReadError>> {
  return read("vocabulary", vocabularySql(getCompanyId()), vocabularyRowSchema);
}

const money = (amount: string, currency: Money["currency"]): Money => ({ amount: Number(amount), currency });
const skuSummary = (count: number, sku: string | null): SkuSummary => count === 1 ? { kind: "single", sku } : { kind: "several" };

function toActive(row: z.infer<typeof summaryRowSchema>): ActiveSummary {
  if (row.activeCount === 0 || row.minPrice === null) return { kind: "none", sku: skuSummary(row.variantCount, row.allSku) };
  return { kind: "some", count: row.activeCount, minSalePrice: money(row.minPrice, row.currency as Money["currency"]), hasDifferentPrices: row.hasDifferentPrices,
    totalStock: row.totalStock, soldOut: row.soldOut, low: row.low, onlyLevel: row.activeCount === 1 ? stockLevelOf(row.totalStock) : null, sku: skuSummary(row.activeCount, row.activeSku) };
}

function toVariant(row: z.infer<typeof matchingVariantRowSchema>, currency: Money["currency"]): SearchedVariant {
  return { id: row.id as VariantId, values: row.values, sku: row.sku, salePrice: money(row.salePrice, currency), stock: row.stock, level: stockLevelOf(row.stock) };
}

export async function searchPage(query: ProductSearchQuery): Promise<Result<ProductSearchPage, AssistantReadError>> {
  const companyId = getCompanyId();
  const page = await read("page", pageSql(companyId, query), pageRowSchema);
  if (!page.success) return page;
  const { ids, total, storeHasProducts } = page.data[0] ?? { ids: [], total: 0, storeHasProducts: false };
  const pageNumber = Math.floor(query.offset / query.limit) + 1;
  if (!ids.length) return ok({ items: [], page: pageNumber, total, storeHasProducts });
  const summaries = await read("summaries", summariesSql(companyId, ids, query.lowStockThreshold), summaryRowSchema);
  if (!summaries.success) return summaries;
  const matching = hasVariantFilters(query) ? await read("matching_variants", matchingVariantsSql(companyId, ids, query), matchingVariantRowSchema) : null;
  if (matching && !matching.success) return matching;
  const summaryOf = new Map(summaries.data.map((row) => [row.id, row] as const));
  const items: SearchedProduct[] = [];
  for (const id of ids) {
    const row = summaryOf.get(id);
    if (!row) return invalid("summaries", "a page product has no variants");
    const currency = row.currency as Money["currency"];
    const variants = matching?.data.filter((variant) => variant.productId === id) ?? [];
    items.push({ id: id as ProductId, name: row.name, currency, variantCount: row.variantCount, inactiveCount: row.variantCount - row.activeCount, active: toActive(row),
      matching: matching ? { variants: variants.map((variant) => toVariant(variant, currency)), total: variants[0]?.total ?? 0 } : null });
  }
  return ok({ items, page: pageNumber, total, storeHasProducts });
}

export async function findSkuOwner(normalizedSku: string): Promise<Result<Readonly<{ variantId: VariantId; productId: ProductId }> | null, AssistantReadError>> {
  const rows = await read("sku_owner", skuOwnerSql(getCompanyId(), normalizedSku), skuOwnerRowSchema);
  if (!rows.success) return rows;
  const owner = rows.data[0];
  return ok(owner ? { variantId: owner.variantId as VariantId, productId: owner.productId as ProductId } : null);
}
