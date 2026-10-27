import { log } from "@core/src/shared/infrastructure/logger";
import { Prisma, type Product as DbProduct, type ProductVariant as DbVariant, type ProductStock as DbStock, type ProductOption as DbOption, type ProductOptionValue as DbValue, type ProductVariantOptionValue as DbLink } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { isCurrency } from "@shared/money";
import { getCompanyId, prisma, withLockedForUpdate, withinReadSnapshot } from "@core/src/shared/infrastructure/persistance";
import type { ProductSummary } from "@core/src/features/products/application/list";
import type { CreateError } from "@core/src/features/products/application/create";
import type { SaveProductError } from "@core/src/features/products/application/save-product";
import type { Criteria, ProductReadError, ProductRepository } from "@core/src/features/products/application/repository";
import type { ImageId, OptionId, OptionText, OptionValueId, Product, ProductId, ProductOption, ProductOptionValue, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import { combinationKey, sortVariants, type ProductStructureChange } from "@core/src/features/products/domain/product-structure";

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

/** Prisma timeouts and PostgreSQL lock conflicts are the transaction's to report: the editing writes rethrow them instead of answering with a result. */
export function transactionFailureStage(error: unknown): "transaction_timeout" | "lock_conflict" | undefined {
  const text = (value: unknown) => {
    let meta = "";
    try { meta = JSON.stringify((value as { meta?: unknown } | null)?.meta ?? {}); } catch { /* circular driver detail: the message is enough */ }
    return `${value instanceof Error ? value.message : ""} ${meta}`;
  };
  const code = (value: unknown) => typeof value === "object" && value !== null && "code" in value && typeof value.code === "string" ? value.code : undefined;
  const causes = [error, error instanceof Error ? error.cause : undefined];
  if (causes.some((item) => code(item) === "P2028")) return "transaction_timeout";
  if (causes.some((item) => code(item) === "P2034" || /40P01|55P03|deadlock detected|lock timeout/i.test(text(item)))) return "lock_conflict";
  if (causes.some((item) => /57014|statement timeout/i.test(text(item)))) return "transaction_timeout";
  return undefined;
}

async function readProducts(ids: readonly string[], inTransaction = false): Promise<Result<Product[], ProductReadError>> {
  let rows: Rows;
  try {
    rows = await withinReadSnapshot(() => loadRows(ids));
  } catch (error) {
    if (inTransaction && transactionFailureStage(error)) throw error;
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

function violatedIndex(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return undefined;
  const adapter = error.meta?.driverAdapterError as { cause?: { constraint?: { index?: string } } } | undefined;
  return adapter?.cause?.constraint?.index;
}

const isDuplicateSku = (error: unknown) => violatedIndex(error) === "ProductVariant_companyId_sku_normalized_key";
const isDuplicateProductId = (error: unknown) => ["Product_pkey", "Product_id_key"].includes(violatedIndex(error) ?? "");
const isDuplicateOptionId = (error: unknown) => ["ProductOption_pkey", "ProductOptionValue_pkey"].includes(violatedIndex(error) ?? "");
const isDuplicateCombination = (error: unknown) => violatedIndex(error) === "ProductVariant_companyId_productId_combinationKey_key";

const unavailable = (message: string) => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message });

/**
 * Bulk insert of the whole aggregate: at most six statements, whatever the number of variants.
 * Call it inside the editing transaction; a returned error makes that transaction roll back.
 */
export async function insertProduct(product: Product): Promise<Result<ProductId, CreateError>> {
  const started = performance.now();
  const decimal = (amount: number) => new Prisma.Decimal(amount.toString());
  try {
    await prisma.product.create({ data: {
      id: product.id, name: product.name, description: product.description, imageId: product.imageId, currency: product.currency,
      qrCode: product.qrCode, status: product.status, createdAt: product.createdAt, updatedAt: product.updatedAt, structureVersion: product.structureVersion,
    } });
    if (product.options.length) {
      await prisma.productOption.createMany({ data: product.options.map((option, position) => ({ id: option.id, productId: product.id, name: option.name, position })) });
      await prisma.productOptionValue.createMany({ data: product.options.flatMap((option) => option.values.map((value, position) => ({
        id: value.id, optionId: option.id, productId: product.id, name: value.name, position }))) });
    }
    await prisma.productVariant.createMany({ data: product.variants.map((variant) => ({
      id: variant.id, productId: variant.productId, combinationKey: combinationKey(variant.combination), sku: variant.sku,
      salePrice: decimal(variant.salePrice.amount), purchasePrice: variant.purchasePrice === undefined ? null : decimal(variant.purchasePrice.amount),
      qrCode: variant.qrCode, status: variant.status })) });
    await prisma.productStock.createMany({ data: product.variants.map((variant) => ({ variantId: variant.stock.variantId, quantity: BigInt(variant.stock.quantity) })) });
    const links = product.variants.flatMap((variant) => Object.entries(variant.combination).map(([optionId, valueId]) => ({
      productId: product.id, variantId: variant.id, optionId, valueId })));
    if (links.length) await prisma.productVariantOptionValue.createMany({ data: links });
    return ok(product.id);
  } catch (error) {
    if (isDuplicateSku(error)) return err({ code: "DUPLICATE_SKU", message: "SKU is already used" });
    if (isDuplicateProductId(error)) return err({ code: "PRODUCT_ID_CONFLICT", message: "Product ID is already used" });
    if (isDuplicateOptionId(error)) return err({ code: "ID_CONFLICT", message: "Identifier is already used" });
    if (isDuplicateCombination(error)) return err({ code: "DUPLICATE_COMBINATION", message: "Combination is already used" });
    if (transactionFailureStage(error)) throw error;
    return unavailableCreate(error, product, started);
  }
}

function unavailableCreate(error: unknown, product: Product, started: number): Result<ProductId, CreateError> {
  log.error({ event: "product_save_failed", companyId: getCompanyId(), productId: product.id, stage: "insert", errorCode: "PERSISTENCE_UNAVAILABLE",
    durationMs: Math.round(performance.now() - started), err: error }, "product_save_failed");
  return unavailable("Unable to create product");
}

export async function productExists(id: ProductId): Promise<Result<boolean, ProductReadError>> {
  try {
    return ok(!!await prisma.product.findFirst({ where: { id }, select: { id: true } }));
  } catch (error) {
    log.error({ event: "product_exists_persistence_failed", err: error }, "product_exists_persistence_failed");
    return unavailable("Unable to read product");
  }
}

/** Variants that already use any of the SKUs, matched like the unique index: ignoring case and surrounding spaces. */
export async function findSkuOwners(normalizedSkus: readonly string[]): Promise<Result<ReadonlyMap<string, VariantId>, ProductReadError>> {
  if (!normalizedSkus.length) return ok(new Map());
  try {
    const rows = await prisma.$queryRaw<{ id: string; sku: string }[]>(Prisma.sql`SELECT id, lower(btrim(sku)) AS sku FROM "ProductVariant"
      WHERE "companyId" = ${getCompanyId()}::uuid AND sku IS NOT NULL AND lower(btrim(sku)) = ANY(${[...normalizedSkus]}::text[])`);
    return ok(new Map(rows.map((row) => [row.sku, row.id as VariantId] as const)));
  } catch (error) {
    if (transactionFailureStage(error)) throw error;
    log.error({ event: "product_sku_lookup_persistence_failed", err: error }, "product_sku_lookup_persistence_failed");
    return unavailable("Unable to check SKUs");
  }
}

/** Which of these ids already name an option or a value, so a new product cannot reuse them. */
export async function findForeignOptionIds(ids: readonly string[]): Promise<Result<ReadonlySet<string>, ProductReadError>> {
  if (!ids.length) return ok(new Set());
  try {
    const companyId = getCompanyId();
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id::text AS id FROM "ProductOption" WHERE "companyId" = ${companyId}::uuid AND id = ANY(${[...ids]}::uuid[])
      UNION ALL SELECT id::text FROM "ProductOptionValue" WHERE "companyId" = ${companyId}::uuid AND id = ANY(${[...ids]}::uuid[])`);
    return ok(new Set(rows.map((row) => row.id)));
  } catch (error) {
    if (transactionFailureStage(error)) throw error;
    log.error({ event: "product_option_ids_persistence_failed", err: error }, "product_option_ids_persistence_failed");
    return unavailable("Unable to check identifiers");
  }
}

/** Locks the Product row and loads the aggregate. Call it first inside the editing transaction. */
export async function lockProduct(id: ProductId): Promise<Result<Product | null, ProductReadError>> {
  try {
    return await withLockedForUpdate<{ id: string }, Result<Product | null, ProductReadError>>(getCompanyId(),
      Prisma.sql`SELECT id FROM "Product" WHERE id = ${id}::uuid AND "companyId" = ${getCompanyId()}::uuid`,
      async (row) => {
        if (!row) return ok(null);
        const read = await readProducts([id], true);
        return read.success ? ok(read.data[0] ?? null) : read;
      });
  } catch (error) {
    if (transactionFailureStage(error)) throw error;
    log.error({ event: "product_lock_persistence_failed", err: error }, "product_lock_persistence_failed");
    return unavailable("Unable to read product");
  }
}

const isForeignKeyOfOrders = (error: unknown) => mentions(error, "OrderItem_companyId_variantId_fkey");
const mentions = (error: unknown, name: string) => {
  let meta = "";
  try { meta = JSON.stringify((error as { meta?: unknown } | null)?.meta ?? {}); } catch { /* the message is enough */ }
  return `${error instanceof Error ? error.message : ""} ${meta}`.includes(name);
};

const uuidList = (ids: readonly string[]) => Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
const rowsOf = (rows: readonly Prisma.Sql[]) => Prisma.join(rows.map((row) => Prisma.sql`(${row})`));

/**
 * Applies the plan in the fixed order of the design with one statement per kind of change, whatever the number of variants.
 * Call it inside the editing transaction; a returned error makes that transaction roll back.
 */
export async function applyStructureChange(change: ProductStructureChange): Promise<Result<null, SaveProductError>> {
  const started = performance.now();
  const companyId = getCompanyId();
  const decimal = (amount: number) => new Prisma.Decimal(amount.toString());
  const { productId } = change;
  try {
    // Variants that are deleted or rekeyed are locked in id order, the order in which orders lock them, so the two sides cannot deadlock.
    const touched = [...new Set([...change.deleteVariantIds, ...change.rekeyVariants.map((item) => item.id)])].sort();
    if (touched.length) await prisma.$queryRaw(Prisma.sql`SELECT id FROM "ProductVariant" WHERE "companyId" = ${companyId}::uuid AND id IN (${uuidList(touched)}) ORDER BY id FOR UPDATE`);
    if (change.deleteVariantIds.length) {
      await prisma.productStock.deleteMany({ where: { variantId: { in: [...change.deleteVariantIds] } } });
      await prisma.productVariant.deleteMany({ where: { id: { in: [...change.deleteVariantIds] } } });
    }
    if (change.insertOptions.length) await prisma.productOption.createMany({ data: change.insertOptions.map((option) => ({ id: option.id, productId, name: option.name, position: option.position })) });
    if (change.insertValues.length) await prisma.productOptionValue.createMany({ data: change.insertValues.map((value) => ({ id: value.id, optionId: value.optionId, productId, name: value.name, position: value.position })) });
    if (change.renameOrMoveOptions.length) await prisma.$executeRaw(Prisma.sql`UPDATE "ProductOption" o SET name = v.name, position = v.position
      FROM (VALUES ${rowsOf(change.renameOrMoveOptions.map((item) => Prisma.sql`${item.id}::uuid, ${item.name}::text, ${item.position}::int`))}) AS v(id, name, position)
      WHERE o.id = v.id AND o."companyId" = ${companyId}::uuid`);
    if (change.renameOrMoveValues.length) await prisma.$executeRaw(Prisma.sql`UPDATE "ProductOptionValue" o SET name = v.name, position = v.position
      FROM (VALUES ${rowsOf(change.renameOrMoveValues.map((item) => Prisma.sql`${item.id}::uuid, ${item.name}::text, ${item.position}::int`))}) AS v(id, name, position)
      WHERE o.id = v.id AND o."companyId" = ${companyId}::uuid`);
    if (change.insertLinks.length) await prisma.productVariantOptionValue.createMany({ data: change.insertLinks.map((link) => ({ productId, variantId: link.variantId, optionId: link.optionId, valueId: link.valueId })) });
    if (change.deleteLinksOfOptionIds.length) await prisma.productVariantOptionValue.deleteMany({ where: { optionId: { in: [...change.deleteLinksOfOptionIds] } } });
    if (change.deleteValueIds.length) await prisma.productOptionValue.deleteMany({ where: { id: { in: [...change.deleteValueIds] } } });
    if (change.deleteOptionIds.length) await prisma.productOption.deleteMany({ where: { id: { in: [...change.deleteOptionIds] } } });
    if (change.rekeyVariants.length) await prisma.$executeRaw(Prisma.sql`UPDATE "ProductVariant" p SET "combinationKey" = v.key
      FROM (VALUES ${rowsOf([...change.rekeyVariants].sort((a, b) => a.id < b.id ? -1 : 1).map((item) => Prisma.sql`${item.id}::uuid, ${item.combinationKey}::text`))}) AS v(id, key)
      WHERE p.id = v.id AND p."companyId" = ${companyId}::uuid`);
    // Clearing the changed SKUs first lets two variants swap them: the SKU index is not deferrable.
    const skuChanges = change.variantFieldChanges.filter((item) => item.sku !== undefined);
    if (skuChanges.length) await prisma.$executeRaw(Prisma.sql`UPDATE "ProductVariant" SET sku = NULL WHERE "companyId" = ${companyId}::uuid AND id IN (${uuidList(skuChanges.map((item) => item.id))})`);
    if (change.variantFieldChanges.length) await prisma.$executeRaw(Prisma.sql`UPDATE "ProductVariant" p SET
        sku = CASE WHEN v.set_sku THEN v.sku ELSE p.sku END,
        "salePrice" = CASE WHEN v.set_sale THEN v."salePrice" ELSE p."salePrice" END,
        "purchasePrice" = CASE WHEN v.set_purchase THEN v."purchasePrice" ELSE p."purchasePrice" END
      FROM (VALUES ${rowsOf(change.variantFieldChanges.map((item) => Prisma.sql`${item.id}::uuid, ${item.sku !== undefined}::boolean, ${item.sku ?? null}::text,
        ${item.salePrice !== undefined}::boolean, ${item.salePrice === undefined ? null : decimal(item.salePrice)}::numeric,
        ${item.purchasePrice !== undefined}::boolean, ${item.purchasePrice === undefined || item.purchasePrice === null ? null : decimal(item.purchasePrice)}::numeric`))})
        AS v(id, set_sku, sku, set_sale, "salePrice", set_purchase, "purchasePrice")
      WHERE p.id = v.id AND p."companyId" = ${companyId}::uuid`);
    if (change.insertVariants.length) {
      await prisma.productVariant.createMany({ data: change.insertVariants.map((variant) => ({
        id: variant.id, productId, combinationKey: variant.combinationKey, sku: variant.sku, salePrice: decimal(variant.salePrice),
        purchasePrice: variant.purchasePrice === undefined ? null : decimal(variant.purchasePrice), qrCode: variant.qrCode, status: "active" })) });
      await prisma.productStock.createMany({ data: change.insertVariants.map((variant) => ({ variantId: variant.id, quantity: BigInt(variant.initialStock) })) });
      const links = change.insertVariants.flatMap((variant) => Object.entries(variant.combination).map(([optionId, valueId]) => ({ productId, variantId: variant.id, optionId, valueId })));
      if (links.length) await prisma.productVariantOptionValue.createMany({ data: links });
    }
    if (Object.keys(change.product).length) await prisma.product.update({ where: { id: productId }, data: {
      ...change.product.name === undefined ? {} : { name: change.product.name },
      ...change.product.description === undefined ? {} : { description: change.product.description },
      ...change.product.imageId === undefined ? {} : { imageId: change.product.imageId },
      ...change.product.updatedAt === undefined ? {} : { updatedAt: change.product.updatedAt },
      ...change.product.structureVersion === undefined ? {} : { structureVersion: change.product.structureVersion },
    } });
    return ok(null);
  } catch (error) {
    if (isDuplicateSku(error) || mentions(error, "ProductVariant_companyId_sku_normalized_key")) return err({ code: "DUPLICATE_SKU", message: "SKU is already used" });
    if (isDuplicateCombination(error) || mentions(error, "ProductVariant_companyId_productId_combinationKey_key")) return err({ code: "DUPLICATE_COMBINATION", message: "Combination is already used" });
    if (isDuplicateOptionId(error) || mentions(error, "ProductOption_pkey") || mentions(error, "ProductOptionValue_pkey")) return err({ code: "ID_CONFLICT", message: "Identifier is already used" });
    if (isForeignKeyOfOrders(error)) return err({ code: "VARIANT_HAS_ORDERS", message: "Variant has orders" });
    if (transactionFailureStage(error)) throw error;
    log.error({ event: "product_save_failed", companyId, productId, stage: "apply", errorCode: "PERSISTENCE_UNAVAILABLE",
      durationMs: Math.round(performance.now() - started), err: error }, "product_save_failed");
    return unavailable("Unable to save product");
  }
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
    WHERE v."productId" = p.id AND v."companyId" = p."companyId" AND v.status = 'active' AND s.quantity > 0)`);
  if (criteria.stock === "sold_out") predicates.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "ProductVariant" v
    LEFT JOIN "ProductStock" s ON s."variantId" = v.id AND s."companyId" = v."companyId"
    WHERE v."productId" = p.id AND v."companyId" = p."companyId" AND v.status = 'active' AND s.quantity IS DISTINCT FROM 0)`);
  return predicates;
}

type SummaryRow = Readonly<{ id: string; name: string; imageId: string | null; currency: string; variantCount: number; activeVariantCount: number;
  minPrice: string | null; hasDifferentPrices: boolean; totalStock: string; sku: string | null }>;

/** One grouped query for the page: prices, stock and SKU cover active variants only, and no aggregate is loaded. */
function summarySql(ids: readonly string[]): Prisma.Sql {
  return Prisma.sql`SELECT p.id::text AS id, p.name, p."imageId"::text AS "imageId", p.currency,
      count(v.id)::int AS "variantCount",
      (count(v.id) FILTER (WHERE v.status = 'active'))::int AS "activeVariantCount",
      (min(v."salePrice") FILTER (WHERE v.status = 'active'))::text AS "minPrice",
      (count(DISTINCT v."salePrice") FILTER (WHERE v.status = 'active')) > 1 AS "hasDifferentPrices",
      (coalesce(sum(s.quantity) FILTER (WHERE v.status = 'active'), 0))::text AS "totalStock",
      CASE WHEN count(v.id) = 1 THEN max(v.sku) FILTER (WHERE v.status = 'active') END AS sku
    FROM "Product" p
    JOIN "ProductVariant" v ON v."productId" = p.id AND v."companyId" = p."companyId"
    LEFT JOIN "ProductStock" s ON s."variantId" = v.id AND s."companyId" = v."companyId"
    WHERE p."companyId" = ${getCompanyId()}::uuid AND p.id = ANY(${[...ids]}::uuid[])
    GROUP BY p.id`;
}

function toSummary(row: SummaryRow): ProductSummary {
  if (!isCurrency(row.currency)) throw new Error("Stored currency is invalid");
  const totalStock = Number(row.totalStock);
  if (!Number.isSafeInteger(totalStock)) throw new Error("Stored total stock is outside the supported range");
  return {
    id: row.id as ProductId, name: row.name, variantCount: row.variantCount, activeVariantCount: row.activeVariantCount,
    ...(row.sku === null ? {} : { sku: row.sku }),
    minSalePrice: row.minPrice === null ? null : { amount: Number(row.minPrice), currency: row.currency },
    hasDifferentPrices: row.hasDifferentPrices, totalStock,
    ...(row.imageId === null ? {} : { imageId: row.imageId as ImageId }),
  };
}

export const productRepository: ProductRepository = {
  async get(id) {
    const read = await readProducts([id]);
    return read.success ? ok(read.data[0] ?? null) : read;
  },
  async list(criteria) {
    try {
      return await withinReadSnapshot(async () => {
        const [page] = await prisma.$queryRaw<{ ids: string[]; total: number }[]>(Prisma.sql`
          WITH matching AS (SELECT p.id, p.name, p."createdAt" FROM "Product" p
            WHERE ${Prisma.join(listPredicates(criteria), " AND ")})
          SELECT ARRAY(SELECT id FROM matching ORDER BY ${listOrder(criteria.sort)}
            LIMIT ${criteria.pageSize} OFFSET ${(criteria.page - 1) * criteria.pageSize}) AS ids,
            (SELECT count(*)::int FROM matching) AS total`);
        const rows = page.ids.length ? await prisma.$queryRaw<SummaryRow[]>(summarySql(page.ids)) : [];
        const byId = new Map(rows.map((row) => [row.id, row] as const));
        try {
          return ok({ page: criteria.page, pageSize: criteria.pageSize, total: page.total, items: page.ids.flatMap((id) => byId.get(id) ?? []).map(toSummary) });
        } catch {
          return err({ code: "INVALID_STORED_DATA" as const, message: "Stored product data is invalid" });
        }
      });
    } catch (error) {
      log.error({ event: "product_list_persistence_failed", err: error }, "product_list_persistence_failed");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to list products" });
    }
  },
};
