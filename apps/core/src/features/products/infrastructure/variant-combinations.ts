import { Prisma } from "@prisma/client";
import { getCompanyId, prisma } from "@core/src/shared/infrastructure/persistance";

export type VariantAttributes = ReadonlyMap<string, Readonly<Record<string, string>>>;

type Row = Readonly<{ variantId: string; optionName: string; valueName: string }>;

function toAttributes(rows: readonly Row[]): VariantAttributes {
  const byVariant = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const attributes = byVariant.get(row.variantId) ?? {};
    attributes[row.optionName] = row.valueName;
    byVariant.set(row.variantId, attributes);
  }
  return byVariant;
}

const select = Prisma.sql`SELECT l."variantId" AS "variantId", o.name AS "optionName", v.name AS "valueName"
  FROM "ProductVariantOptionValue" l
  JOIN "ProductOption" o ON o."companyId" = l."companyId" AND o."productId" = l."productId" AND o.id = l."optionId"
  JOIN "ProductOptionValue" v ON v."companyId" = l."companyId" AND v."optionId" = l."optionId" AND v.id = l."valueId"`;
const order = Prisma.sql`ORDER BY l."variantId", o.position`;

/** Option name to value name per variant, keys in saved option order. Variants without options are absent. One query, whatever the variant count. */
export async function loadAttributesOfVariants(variantIds: readonly string[]): Promise<VariantAttributes> {
  if (!variantIds.length) return new Map();
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`${select}
    WHERE l."companyId" = ${getCompanyId()}::uuid AND l."variantId" = ANY(${[...variantIds]}::uuid[]) ${order}`);
  return toAttributes(rows);
}

/** Same composition for the variants of a few products, joined on ProductVariant so the query takes one id per product. */
export async function loadAttributesOfProducts(productIds: readonly string[], onlyActive: boolean): Promise<VariantAttributes> {
  if (!productIds.length) return new Map();
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`${select}
    JOIN "ProductVariant" pv ON pv."companyId" = l."companyId" AND pv."productId" = l."productId" AND pv.id = l."variantId"
    WHERE l."companyId" = ${getCompanyId()}::uuid AND l."productId" = ANY(${[...productIds]}::uuid[])
      ${onlyActive ? Prisma.sql`AND pv.status = 'active'` : Prisma.empty} ${order}`);
  return toAttributes(rows);
}
