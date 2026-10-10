import { log } from "@core/src/shared/infrastructure/logger";
import { Prisma, type Product as DbProduct, type ProductVariant as DbVariant, type ProductStock as DbStock } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { isCurrency } from "@shared/money";
import { getCompanyId, prisma, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import type { Criteria, ProductRepository } from "@core/src/features/products/application/repository";
import type { ImageId, Product, ProductId, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import { summarizeProduct } from "@core/src/features/products/domain/rules";

type DbAggregate = DbProduct & { variants: (DbVariant & { stock: DbStock | null })[] };

function mapProduct(row: DbAggregate): Product {
  if (!isCurrency(row.currency)) throw new Error("Stored product has invalid currency");
  const currency = row.currency;
  if (!row.variants.length) throw new Error("Stored product has no variants");
  const variants = row.variants.map((variant): ProductVariant => {
    if (!variant.stock) throw new Error("Stored variant has no stock");
    if (variant.stock.quantity > BigInt(Number.MAX_SAFE_INTEGER) || variant.stock.quantity < 0n) throw new Error("Stored stock is outside the supported range");
    const attributes = variant.attributes;
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes) || Object.values(attributes).some((value) => typeof value !== "string")) throw new Error("Stored variant has invalid attributes");
    return {
      id: variant.id as VariantId, productId: row.id as ProductId,
      attributes: { ...attributes } as Record<string, string>,
      ...(variant.sku === null ? {} : { sku: variant.sku }),
      salePrice: { amount: variant.salePrice.toNumber(), currency },
      ...(variant.purchasePrice === null ? {} : { purchasePrice: { amount: variant.purchasePrice.toNumber(), currency } }),
      qrCode: variant.qrCode, status: variant.status as "active",
      stock: { variantId: variant.stock.variantId as VariantId, quantity: Number(variant.stock.quantity) },
    };
  }) as [ProductVariant, ...ProductVariant[]];
  return {
    id: row.id as ProductId, name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.imageId === null ? {} : { imageId: row.imageId as ImageId }),
    currency, qrCode: row.qrCode, status: row.status as "active",
    createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt), variants,
  };
}

function isDuplicateSku(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const adapter = error.meta?.driverAdapterError as { cause?: { constraint?: { index?: string } } } | undefined;
  return adapter?.cause?.constraint?.index === "ProductVariant_companyId_sku_normalized_key";
}

function isDuplicateProductId(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const adapter = error.meta?.driverAdapterError as { cause?: { constraint?: { index?: string } } } | undefined;
  const constraint = adapter?.cause?.constraint?.index;
  return constraint === "Product_pkey" || constraint === "Product_id_key";
}

// ICU Spanish collation: case- and accent-insensitive at the primary level, with ñ after n.
const nameOrder = Prisma.sql`name COLLATE "es-x-icu" ASC, id ASC`;
const recentOrder = Prisma.sql`"createdAt" DESC, id ASC`;

function listOrder(sort: Criteria["sort"]): Prisma.Sql {
  return sort === "name" ? nameOrder : recentOrder;
}

function listPredicates(criteria: Criteria): Prisma.Sql[] {
  const companyId = getCompanyId();
  const predicates = [Prisma.sql`p."companyId" = ${companyId}::uuid`];
  const search = criteria.search?.replace(/[\\%_]/g, "\\$&");
  // UNION instead of OR so each branch can use its own trigram index.
  if (search) predicates.push(Prisma.sql`p.id IN (SELECT n.id FROM "Product" n
    WHERE n."companyId" = ${companyId}::uuid AND n.name ILIKE ${`%${search}%`}
    UNION SELECT v."productId" FROM "ProductVariant" v
    WHERE v."companyId" = ${companyId}::uuid AND v.sku ILIKE ${`%${search}%`})`);
  if (criteria.stock === "in_stock") predicates.push(Prisma.sql`EXISTS (SELECT 1 FROM "ProductVariant" v
    JOIN "ProductStock" s ON s."variantId" = v.id AND s."companyId" = v."companyId"
    WHERE v."productId" = p.id AND v."companyId" = p."companyId" AND s.quantity > 0)`);
  if (criteria.stock === "sold_out") predicates.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "ProductVariant" v
    LEFT JOIN "ProductStock" s ON s."variantId" = v.id AND s."companyId" = v."companyId"
    WHERE v."productId" = p.id AND v."companyId" = p."companyId" AND s.quantity IS DISTINCT FROM 0)`);
  return predicates;
}

export const productRepository: ProductRepository = {
  async create(product) {
    try {
      return await withinTransaction(async () => {
        await prisma.product.create({ data: {
          id: product.id, name: product.name, description: product.description,
          imageId: product.imageId, currency: product.currency, qrCode: product.qrCode,
          status: product.status, createdAt: product.createdAt, updatedAt: product.updatedAt,
        } });
        for (const variant of product.variants) {
          await prisma.productVariant.create({ data: {
            id: variant.id, productId: variant.productId, attributes: variant.attributes as Prisma.InputJsonObject,
            sku: variant.sku, salePrice: new Prisma.Decimal(variant.salePrice.amount.toString()),
            purchasePrice: variant.purchasePrice === undefined ? null : new Prisma.Decimal(variant.purchasePrice.amount.toString()),
            qrCode: variant.qrCode, status: variant.status,
          } });
          await prisma.productStock.create({ data: { variantId: variant.stock.variantId, quantity: BigInt(variant.stock.quantity) } });
        }
        return ok(product.id);
      });
    } catch (error) {
      if (isDuplicateSku(error)) return err({ code: "DUPLICATE_SKU", message: "SKU is already used" });
      if (isDuplicateProductId(error)) return err({ code: "PRODUCT_ID_CONFLICT", message: "Product ID is already used" });
      log.error({ event: "product_create_persistence_failed", err: error }, "product_create_persistence_failed");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to create product" });
    }
  },
  async update(id, changes) {
    try {
      return await withinTransaction(async () => {
        await prisma.product.update({
          where: { id },
          data: {
            ...(changes.product.name === undefined ? {} : { name: changes.product.name }),
            ...(changes.product.description === undefined ? {} : { description: changes.product.description }),
            ...(changes.product.imageId === undefined ? {} : { imageId: changes.product.imageId }),
            updatedAt: changes.product.updatedAt,
          },
        });
        for (const variant of changes.variants) {
          await prisma.productVariant.update({
            where: { id: variant.id },
            data: {
              ...(variant.sku === undefined ? {} : { sku: variant.sku }),
              ...(variant.salePrice === undefined ? {} : { salePrice: new Prisma.Decimal(variant.salePrice.amount.toString()) }),
              ...(variant.purchasePrice === undefined ? {} : { purchasePrice: variant.purchasePrice === null ? null : new Prisma.Decimal(variant.purchasePrice.amount.toString()) }),
            },
          });
        }
        return ok(id);
      });
    } catch (error) {
      if (isDuplicateSku(error)) return err({ code: "DUPLICATE_SKU", message: "SKU is already used" });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return err({ code: "PRODUCT_NOT_FOUND", message: "Product does not exist" });
      log.error({ event: "product_update_persistence_failed", err: error }, "product_update_persistence_failed");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to update product" });
    }
  },
  async get(id) {
    let row: DbAggregate | null;
    try {
      row = await prisma.product.findUnique({ where: { id }, include: { variants: { include: { stock: true }, orderBy: { id: "asc" } } } });
    } catch (error) {
      log.error({ event: "product_read_persistence_failed", err: error }, "product_read_persistence_failed");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read product" });
    }
    if (!row) return ok(null);
    try {
      return ok(mapProduct(row));
    } catch {
      return err({ code: "INVALID_STORED_DATA", message: "Stored product data is invalid" });
    }
  },
  async list(criteria) {
    try {
      const [page] = await prisma.$queryRaw<{ ids: string[]; total: number }[]>(Prisma.sql`
        WITH matching AS (SELECT p.id, p.name, p."createdAt" FROM "Product" p
          WHERE ${Prisma.join(listPredicates(criteria), " AND ")})
        SELECT ARRAY(SELECT id FROM matching ORDER BY ${listOrder(criteria.sort)}
          LIMIT ${criteria.pageSize} OFFSET ${(criteria.page - 1) * criteria.pageSize}) AS ids,
          (SELECT count(*)::int FROM matching) AS total`);
      const found = await prisma.product.findMany({ where: { id: { in: page.ids } }, include: { variants: { include: { stock: true } } } });
      const byId = new Map(found.map((row) => [row.id, row]));
      const rows = page.ids.flatMap((id) => byId.get(id) ?? []);
      try {
        return ok({ page: criteria.page, pageSize: criteria.pageSize, total: page.total, items: rows.map((row) => summarizeProduct(mapProduct(row))) });
      } catch {
        return err({ code: "INVALID_STORED_DATA", message: "Stored product data is invalid" });
      }
    } catch (error) {
      log.error({ event: "product_list_persistence_failed", err: error }, "product_list_persistence_failed");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to list products" });
    }
  },
};
