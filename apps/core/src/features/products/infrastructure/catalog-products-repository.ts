import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { currencies } from "@shared/money";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, withinReadSnapshot } from "@core/src/shared/infrastructure/persistance";
import { loadAttributesOfProducts, type VariantAttributes } from "@core/src/features/products/infrastructure/variant-combinations";
import type { CatalogProductRepository } from "@core/src/features/products/application/catalog-products";
import type { StoredCatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";

const variantSchema = z.object({ id: z.string().transform((value) => value as VariantId), attributes: z.record(z.string(), z.string()),
  salePrice: z.number().nonnegative(), stock: z.number().int().nonnegative() });
const storedSchema = z.object({
  id: z.string().transform((value) => value as ProductId), name: z.string(), description: z.string().nullable(),
  imageId: z.string().transform((value) => value as ImageId).nullable(), currency: z.enum(currencies),
  variants: z.tuple([variantSchema], variantSchema),
});

const sellable = { status: "active", variants: { some: { status: "active" } } } as const;
const include = { variants: { where: { status: "active" }, include: { stock: true }, orderBy: { id: "asc" } } } as const;
type Row = Prisma.ProductGetPayload<{ include: typeof include }>;

function parseRow(row: Row, attributes: VariantAttributes): StoredCatalogProduct | null {
  const parsed = storedSchema.safeParse({ ...row, variants: row.variants.map((variant) => ({ id: variant.id, attributes: attributes.get(variant.id) ?? {},
    salePrice: variant.salePrice.toNumber(), stock: variant.stock && variant.stock.quantity <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(variant.stock.quantity) : null })) });
  return parsed.success ? parsed.data : null;
}

const unavailable = (operation: string, cause: unknown) => {
  log.error({ event: "unable_to_read_catalog", companyId: getCompanyId(), operation, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
  return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
};
const invalid = (operation: string) => {
  log.error({ event: "unable_to_read_catalog", companyId: getCompanyId(), operation, errorCode: "INVALID_STORED_DATA" }, "unable_to_read_catalog");
  return err({ code: "INVALID_STORED_DATA" as const, message: "Stored catalog data is invalid" });
};

export const catalogProductRepository: CatalogProductRepository = {
  async list({ currency, search, offset, limit }) {
    const companyId = getCompanyId();
    const pattern = search === null ? null : `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    let rows: Row[];
    let hasMore: boolean;
    try {
      const ids = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT p.id FROM "Product" p
        WHERE p."companyId" = ${companyId}::uuid AND p.status = 'active' AND p.currency = ${currency}
          AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p.id AND v."companyId" = p."companyId" AND v.status = 'active')
          ${pattern === null ? Prisma.empty : Prisma.sql`AND unaccent(lower(p.name)) LIKE unaccent(lower(${pattern}))`}
        ORDER BY p."createdAt" DESC, p.id ASC LIMIT ${limit + 1} OFFSET ${offset}`);
      hasMore = ids.length > limit;
      const pageIds = ids.slice(0, limit).map(({ id }) => id);
      const found = await prisma.product.findMany({ where: { id: { in: pageIds }, ...sellable }, include });
      const byId = new Map(found.map((row) => [row.id, row]));
      rows = pageIds.flatMap((id) => byId.get(id) ?? []);
    } catch (cause) {
      return unavailable("list_catalog_products", cause);
    }
    const parsed = rows.map((row) => parseRow(row, new Map())).filter((row) => row !== null);
    if (parsed.length !== rows.length) return invalid("list_catalog_products");
    return ok({ rows: parsed, hasMore });
  },
  async find(id, currency) {
    let row: Row | null;
    let attributes: VariantAttributes;
    try {
      ({ row, attributes } = await withinReadSnapshot(async () => {
        const row = await prisma.product.findFirst({ where: { id, currency, ...sellable }, include });
        return { row, attributes: row ? await loadAttributesOfProducts([row.id], true) : new Map<string, Record<string, string>>() };
      }));
    } catch (cause) {
      return unavailable("find_catalog_product", cause);
    }
    if (!row) return ok(null);
    const parsed = parseRow(row, attributes);
    return parsed ? ok(parsed) : invalid("find_catalog_product");
  },
};
