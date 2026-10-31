import { Prisma } from "@prisma/client";

/** `%text%` with the LIKE wildcards of the phrase escaped. */
const likePattern = (text: string): string => `%${text.trim().replace(/[\\%_]/g, "\\$&")}%`;

/**
 * The text match of the product search, shared by every assistant read that takes `texto`: partial, ignoring case and accents, on the product name
 * or any variant SKU (active or not). The product table is aliased `p`.
 */
export function productMatchesText(text: string): Prisma.Sql {
  const pattern = likePattern(text);
  return Prisma.sql`(unaccent(lower(p.name)) LIKE unaccent(lower(${pattern}))
      OR EXISTS (SELECT 1 FROM "ProductVariant" sv WHERE sv."companyId" = p."companyId" AND sv."productId" = p.id
        AND unaccent(lower(sv.sku)) LIKE unaccent(lower(${pattern}))))`;
}
