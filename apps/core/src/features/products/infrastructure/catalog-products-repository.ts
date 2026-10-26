import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { currencies } from "@shared/money";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, withinReadSnapshot } from "@core/src/shared/infrastructure/persistance";
import { loadAttributesOfProducts, type VariantAttributes } from "@core/src/features/products/infrastructure/variant-combinations";
import type { CatalogProductRepository } from "@core/src/features/products/application/catalog-products";
import type { StoredCatalogCard, StoredCatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";

const variantSchema = z.object({ id: z.string().transform((value) => value as VariantId), attributes: z.record(z.string(), z.string()),
  salePrice: z.number().nonnegative(), stock: z.number().int().nonnegative() });
const storedSchema = z.object({
  id: z.string().transform((value) => value as ProductId), name: z.string(), description: z.string().nullable(),
  imageId: z.string().transform((value) => value as ImageId).nullable(), currency: z.enum(currencies),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  variants: z.tuple([variantSchema], variantSchema),
});
const cardSchema = z.object({
  id: z.string().transform((value) => value as ProductId), name: z.string(),
  imageId: z.string().transform((value) => value as ImageId).nullable(), currency: z.enum(currencies),
  minPrice: z.number().nonnegative(), maxPrice: z.number().nonnegative(), soldOut: z.boolean(),
});
type CardRow = Readonly<{ id: string; name: string; imageId: string | null; currency: string; minPrice: Prisma.Decimal; maxPrice: Prisma.Decimal; soldOut: boolean }>;

const sellable = { status: "active", variants: { some: { status: "active" } } } as const;
const include = { variants: { where: { status: "active" }, include: { stock: true }, orderBy: { id: "asc" } } } as const;
type Row = Prisma.ProductGetPayload<{ include: typeof include }>;
type Option = Prisma.ProductOptionGetPayload<{ include: { values: true } }>;

function parseRow(row: Row, attributes: VariantAttributes, options: readonly Option[]): StoredCatalogProduct | null {
  const parsed = storedSchema.safeParse({ ...row, options: options.map(({ name, values }) => ({ name, values: values.map((value) => value.name) })), variants: row.variants.map((variant) => ({ id: variant.id, attributes: attributes.get(variant.id) ?? {},
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
    let rows: CardRow[];
    try {
      // Price and stock come from SQL aggregates over active variants, so the cost does not grow with the variants per product.
      rows = await prisma.$queryRaw<CardRow[]>(Prisma.sql`SELECT p.id, p.name, p."imageId", p.currency,
          a."minPrice", a."maxPrice", COALESCE(a."inStock", false) = false AS "soldOut"
        FROM "Product" p
        JOIN LATERAL (SELECT min(v."salePrice") FILTER (WHERE v.status = 'active') AS "minPrice",
            max(v."salePrice") FILTER (WHERE v.status = 'active') AS "maxPrice",
            bool_or(s.quantity > 0) FILTER (WHERE v.status = 'active') AS "inStock"
          FROM "ProductVariant" v LEFT JOIN "ProductStock" s ON s."companyId" = v."companyId" AND s."variantId" = v.id
          WHERE v."companyId" = p."companyId" AND v."productId" = p.id) a ON a."minPrice" IS NOT NULL
        WHERE p."companyId" = ${companyId}::uuid AND p.status = 'active' AND p.currency = ${currency}
          ${pattern === null ? Prisma.empty : Prisma.sql`AND unaccent(lower(p.name)) LIKE unaccent(lower(${pattern}))`}
        ORDER BY p."createdAt" DESC, p.id ASC LIMIT ${limit + 1} OFFSET ${offset}`);
    } catch (cause) {
      return unavailable("list_catalog_products", cause);
    }
    const parsed = rows.slice(0, limit).map((row) => cardSchema.safeParse({ ...row, minPrice: new Prisma.Decimal(row.minPrice).toNumber(), maxPrice: new Prisma.Decimal(row.maxPrice).toNumber() }));
    const cards: StoredCatalogCard[] = parsed.flatMap((result) => result.success ? [result.data] : []);
    if (cards.length !== parsed.length) return invalid("list_catalog_products");
    return ok({ rows: cards, hasMore: rows.length > limit });
  },
  async find(id, currency) {
    let row: Row | null;
    let attributes: VariantAttributes;
    let options: Option[];
    try {
      ({ row, attributes, options } = await withinReadSnapshot(async () => {
        const row = await prisma.product.findFirst({ where: { id, currency, ...sellable }, include });
        if (!row) return { row, attributes: new Map<string, Record<string, string>>(), options: [] };
        const options = await prisma.productOption.findMany({ where: { productId: row.id }, orderBy: { position: "asc" },
          include: { values: { orderBy: { position: "asc" } } } });
        return { row, attributes: await loadAttributesOfProducts([row.id], true), options };
      }));
    } catch (cause) {
      return unavailable("find_catalog_product", cause);
    }
    if (!row) return ok(null);
    const parsed = parseRow(row, attributes, options);
    return parsed ? ok(parsed) : invalid("find_catalog_product");
  },
};
