import { log } from "@core/src/shared/infrastructure/logger";
import { Prisma, type Product as DbProduct, type ProductVariant as DbVariant, type ProductStock as DbStock, type ProductOption as DbOption, type ProductOptionValue as DbValue, type ProductVariantOptionValue as DbLink } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { isCurrency } from "@shared/money";
import { getCompanyId, prisma, withinReadSnapshot, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import type { Criteria, ProductReadError, ProductRepository } from "@core/src/features/products/application/repository";
import type { ImageId, OptionId, OptionText, OptionValueId, Product, ProductId, ProductOption, ProductOptionValue, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import { combinationKey, sortVariants } from "@core/src/features/products/domain/product-structure";
import { summarizeProduct } from "@core/src/features/products/domain/rules";

type Rows = Readonly<{
  products: DbProduct[];
  variants: (DbVariant & { stock: DbStock | null })[];
  links: DbLink[];
  options: DbOption[];
  values: DbValue[];
}>;

class InvalidStoredProductError extends Error {
  constructor(readonly productId: string, readonly stage: string, readonly reason: string) { super(`Stored product is invalid: ${reason}`); }
}

const optionName = z.string().min(1).max(30);
const storedStatus = z.enum(["active", "inactive"]);
const storedOption = z.strictObject({ id: z.string(), name: optionName, position: z.number().int().nonnegative() });
const storedValue = z.strictObject({ id: z.string(), optionId: z.string(), name: optionName, position: z.number().int().nonnegative() });
const storedLink = z.strictObject({ variantId: z.string(), optionId: z.string(), valueId: z.string() });

/** One batched query per table, whatever the number of products and variants; call it inside one read snapshot. */
async function loadRows(ids: readonly string[]): Promise<Rows> {
  const products = await prisma.product.findMany({ where: { id: { in: [...ids] } } });
  const variants = await prisma.productVariant.findMany({ where: { productId: { in: [...ids] } }, include: { stock: true } });
  const links = variants.length ? await prisma.productVariantOptionValue.findMany({ where: { variantId: { in: variants.map((variant) => variant.id) } } }) : [];
  const options = await prisma.productOption.findMany({ where: { productId: { in: [...ids] } }, orderBy: { position: "asc" } });
  const values = options.length ? await prisma.productOptionValue.findMany({ where: { optionId: { in: options.map((option) => option.id) } }, orderBy: { position: "asc" } }) : [];
  return { products, variants, links, options, values };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...groups.get(key(item)) ?? [], item]);
  return groups;
}

function mapProducts(rows: Rows): Product[] {
  const variantsOf = groupBy(rows.variants, (variant) => variant.productId);
  const optionsOf = groupBy(rows.options, (option) => option.productId);
  const valuesOf = groupBy(rows.values, (value) => value.optionId);
  const linksOf = groupBy(rows.links, (link) => link.variantId);
  return rows.products.map((row) => mapProduct(row, variantsOf.get(row.id) ?? [], optionsOf.get(row.id) ?? [], valuesOf, linksOf));
}

function mapProduct(row: DbProduct, variantRows: (DbVariant & { stock: DbStock | null })[], optionRows: DbOption[], valuesOf: Map<string, DbValue[]>, linksOf: Map<string, DbLink[]>): Product {
  const invalid = (stage: string, reason: string) => new InvalidStoredProductError(row.id, stage, reason);
  if (!isCurrency(row.currency)) throw invalid("product", "currency");
  const currency = row.currency;
  if (!variantRows.length) throw invalid("product", "no_variants");
  const options = optionRows.map((option): ProductOption => {
    if (!storedOption.safeParse({ id: option.id, name: option.name, position: option.position }).success) throw invalid("options", "option");
    const values = (valuesOf.get(option.id) ?? []).map((value): ProductOptionValue => {
      if (!storedValue.safeParse({ id: value.id, optionId: value.optionId, name: value.name, position: value.position }).success) throw invalid("options", "value");
      return { id: value.id as OptionValueId, name: value.name as OptionText };
    });
    if (!values.length) throw invalid("options", "option_without_values");
    return { id: option.id as OptionId, name: option.name as OptionText, values: values as unknown as ProductOption["values"] };
  });
  const variants = variantRows.map((variant): ProductVariant => {
    if (!variant.stock) throw invalid("variants", "no_stock");
    if (variant.stock.quantity > BigInt(Number.MAX_SAFE_INTEGER) || variant.stock.quantity < 0n) throw invalid("variants", "stock_range");
    const status = storedStatus.safeParse(variant.status);
    if (!status.success) throw invalid("variants", "status");
    const combination: Record<OptionId, OptionValueId> = {};
    for (const link of linksOf.get(variant.id) ?? []) {
      if (!storedLink.safeParse({ variantId: link.variantId, optionId: link.optionId, valueId: link.valueId }).success) throw invalid("links", "link");
      const option = options.find((candidate) => candidate.id === link.optionId);
      if (!option?.values.some((value) => value.id === link.valueId)) throw invalid("links", "link_to_missing_value");
      combination[link.optionId as OptionId] = link.valueId as OptionValueId;
    }
    if (options.some((option) => combination[option.id] === undefined)) throw invalid("links", "variant_missing_value");
    if (combinationKey(combination) !== variant.combinationKey) throw invalid("links", "combination_key");
    return {
      id: variant.id as VariantId, productId: row.id as ProductId, combination,
      ...(variant.sku === null ? {} : { sku: variant.sku }),
      salePrice: { amount: variant.salePrice.toNumber(), currency },
      ...(variant.purchasePrice === null ? {} : { purchasePrice: { amount: variant.purchasePrice.toNumber(), currency } }),
      qrCode: variant.qrCode, status: status.data,
      stock: { variantId: variant.stock.variantId as VariantId, quantity: Number(variant.stock.quantity) },
    };
  });
  if (!options.length && (variants.length !== 1 || variants[0].status !== "active")) throw invalid("product", "product_without_options");
  const product: Product = {
    id: row.id as ProductId, name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.imageId === null ? {} : { imageId: row.imageId as ImageId }),
    currency, qrCode: row.qrCode, status: row.status as "active",
    createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt), structureVersion: row.structureVersion, options,
    variants: variants as unknown as Product["variants"],
  };
  return { ...product, variants: sortVariants(product) };
}

async function readProducts(ids: readonly string[]): Promise<Result<Product[], ProductReadError>> {
  let rows: Rows;
  try {
    rows = await withinReadSnapshot(() => loadRows(ids));
  } catch (error) {
    log.error({ event: "product_read_persistence_failed", err: error }, "product_read_persistence_failed");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read product" });
  }
  try {
    return ok(mapProducts(rows));
  } catch (error) {
    if (error instanceof InvalidStoredProductError)
      log.error({ event: "invalid_stored_product_data", companyId: getCompanyId(), productId: error.productId, stage: error.stage, reason: error.reason }, "invalid_stored_product_data");
    return err({ code: "INVALID_STORED_DATA", message: "Stored product data is invalid" });
  }
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
    if (product.options.length) throw new Error("Creating products with options arrives with the editor contract");
    try {
      return await withinTransaction(async () => {
        await prisma.product.create({ data: {
          id: product.id, name: product.name, description: product.description,
          imageId: product.imageId, currency: product.currency, qrCode: product.qrCode,
          status: product.status, createdAt: product.createdAt, updatedAt: product.updatedAt, structureVersion: product.structureVersion,
        } });
        for (const variant of product.variants) {
          await prisma.productVariant.create({ data: {
            id: variant.id, productId: variant.productId, combinationKey: combinationKey(variant.combination),
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
    const read = await readProducts([id]);
    return read.success ? ok(read.data[0] ?? null) : read;
  },
  async list(criteria) {
    try {
      const [page] = await prisma.$queryRaw<{ ids: string[]; total: number }[]>(Prisma.sql`
        WITH matching AS (SELECT p.id, p.name, p."createdAt" FROM "Product" p
          WHERE ${Prisma.join(listPredicates(criteria), " AND ")})
        SELECT ARRAY(SELECT id FROM matching ORDER BY ${listOrder(criteria.sort)}
          LIMIT ${criteria.pageSize} OFFSET ${(criteria.page - 1) * criteria.pageSize}) AS ids,
          (SELECT count(*)::int FROM matching) AS total`);
      const read = await readProducts(page.ids);
      if (!read.success) return read;
      const byId = new Map(read.data.map((product) => [product.id as string, product]));
      const found = page.ids.flatMap((id) => byId.get(id) ?? []);
      try {
        return ok({ page: criteria.page, pageSize: criteria.pageSize, total: page.total, items: found.map(summarizeProduct) });
      } catch {
        return err({ code: "INVALID_STORED_DATA", message: "Stored product data is invalid" });
      }
    } catch (error) {
      log.error({ event: "product_list_persistence_failed", err: error }, "product_list_persistence_failed");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to list products" });
    }
  },
};
