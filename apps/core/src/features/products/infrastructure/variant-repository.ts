import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma } from "@core/src/shared/infrastructure/persistance";
import type { ChangeVariantCombinationError } from "@core/src/features/products/application/change-variant-combination";
import type { ChangeVariantStatusError } from "@core/src/features/products/application/change-variant-status";
import type { DeleteVariantError } from "@core/src/features/products/application/delete-variant";
import type { ProductReadError } from "@core/src/features/products/application/repository";
import type { UpdateVariantError, VariantFieldChanges } from "@core/src/features/products/application/update-variant";
import type { ProductId, VariantId, VariantStatus } from "@core/src/features/products/domain/product";
import type { CombinationPlan, VariantDeletionPlan } from "@core/src/features/products/domain/variant-rules";

const decimal = (amount: number) => new Prisma.Decimal(amount.toString());

function violatedIndex(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return undefined;
  const adapter = error.meta?.driverAdapterError as { cause?: { constraint?: { index?: string } } } | undefined;
  return adapter?.cause?.constraint?.index;
}

const isDuplicateSku = (error: unknown) => violatedIndex(error) === "ProductVariant_companyId_sku_normalized_key";
const isDuplicateCombination = (error: unknown) => violatedIndex(error) === "ProductVariant_companyId_productId_combinationKey_key";
/** A raw statement reports the violated constraint in its message instead of `meta.driverAdapterError`. */
const isDuplicateValueId = (error: unknown) => violatedIndex(error) === "ProductOptionValue_pkey" || (error instanceof Error && /ProductOptionValue_pkey/.test(`${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`));
const isForeignKeyViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
const isMissingRow = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

/**
 * `SELECT … FOR UPDATE` on the product row, so two actions on one product serialize. `false` when it does not exist for this company.
 * Call it inside the editing transaction.
 */
export async function lockProduct(id: ProductId): Promise<Result<boolean, ProductReadError>> {
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "Product" WHERE "companyId" = ${getCompanyId()}::uuid AND id = ${id}::uuid FOR UPDATE`);
    return ok(rows.length > 0);
  } catch (error) {
    // Timeouts and lock conflicts are not ours to hide: the transaction boundary maps and logs them once.
    if (isTransactionFailure(error)) throw error;
    log.error({ event: "product_variant_action_failed", companyId: getCompanyId(), productId: id, stage: "lock", errorCode: "PERSISTENCE_UNAVAILABLE", err: error }, "product_variant_action_failed");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to lock product" });
  }
}

function isTransactionFailure(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return code === "P2028" || code === "P2034" || /40P01|55P03|deadlock detected|lock timeout/i.test(error instanceof Error ? error.message : "");
}

/** What the adapters need to log a technical failure once. Never names, SKUs or prices. */
export type VariantActionContext = Readonly<{ productId: ProductId; variantId: VariantId; action: string; started: number }>;

/**
 * The write adapters share one failure rule: business constraints become typed errors, timeouts and lock conflicts reach the
 * transaction boundary, and anything else is logged as `product_variant_action_failed` and answered as unavailable.
 */
function failure<E extends { code: string; message: string }>(error: unknown, context: VariantActionContext, translate: (error: unknown) => E | undefined): Result<never, E | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>> {
  const translated = translate(error);
  if (translated) return err(translated);
  if (isTransactionFailure(error)) throw error;
  log.error({ event: "product_variant_action_failed", companyId: getCompanyId(), productId: context.productId, variantId: context.variantId, action: context.action,
    stage: "write", errorCode: "PERSISTENCE_UNAVAILABLE", durationMs: Math.round(performance.now() - context.started), err: error }, "product_variant_action_failed");
  return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save variant" });
}

export async function updateVariantFields(variantId: VariantId, changes: VariantFieldChanges, context: VariantActionContext): Promise<Result<void, UpdateVariantError>> {
  try {
    await prisma.productVariant.update({ where: { id: variantId }, data: {
      ...(changes.sku === undefined ? {} : { sku: changes.sku }),
      ...(changes.salePrice === undefined ? {} : { salePrice: decimal(changes.salePrice.amount) }),
      ...(changes.purchasePrice === undefined ? {} : { purchasePrice: changes.purchasePrice === null ? null : decimal(changes.purchasePrice.amount) }),
    } });
    return ok(undefined);
  } catch (error) {
    return failure<UpdateVariantError>(error, context, (cause) => isDuplicateSku(cause) ? { code: "DUPLICATE_SKU", message: "SKU is already used" }
      : isMissingRow(cause) ? { code: "VARIANT_NOT_FOUND", message: "Variant does not exist" } : undefined);
  }
}

export async function setVariantStatus(variantId: VariantId, status: VariantStatus, context: VariantActionContext): Promise<Result<void, ChangeVariantStatusError>> {
  try {
    await prisma.productVariant.update({ where: { id: variantId }, data: { status } });
    return ok(undefined);
  } catch (error) {
    return failure<ChangeVariantStatusError>(error, context, (cause) => isMissingRow(cause) ? { code: "VARIANT_NOT_FOUND", message: "Variant does not exist" } : undefined);
  }
}

const bumpStructure = (productId: ProductId, updatedAt: Date) =>
  prisma.product.update({ where: { id: productId }, data: { structureVersion: { increment: 1 }, updatedAt } });

/**
 * At most five statements: the new value with its position, the variant's links (one UPDATE … FROM (VALUES …)), the variant's key,
 * the emptied values in one deleteMany, and the structure version.
 */
export async function applyCombinationChange(productId: ProductId, plan: CombinationPlan, updatedAt: Date, context: VariantActionContext): Promise<Result<void, ChangeVariantCombinationError>> {
  try {
    if (plan.newValue) {
      // The position comes from the same statement, so values removed earlier leave no gap or tie.
      await prisma.$executeRaw(Prisma.sql`INSERT INTO "ProductOptionValue" (id, "optionId", "productId", name, position)
        SELECT ${plan.newValue.id}::uuid, ${plan.newValue.optionId}::uuid, ${productId}::uuid, ${plan.newValue.name}, coalesce(max(position) + 1, 0)
        FROM "ProductOptionValue" WHERE "companyId" = ${getCompanyId()}::uuid AND "optionId" = ${plan.newValue.optionId}::uuid`);
    }
    if (plan.changedLinks.length) {
      const values = Prisma.join(plan.changedLinks.map((link) => Prisma.sql`(${link.optionId}::uuid, ${link.valueId}::uuid)`));
      await prisma.$executeRaw(Prisma.sql`UPDATE "ProductVariantOptionValue" AS l SET "valueId" = v."valueId"
        FROM (VALUES ${values}) AS v("optionId", "valueId")
        WHERE l."companyId" = ${getCompanyId()}::uuid AND l."variantId" = ${plan.variantId}::uuid AND l."optionId" = v."optionId"`);
    }
    await prisma.productVariant.update({ where: { id: plan.variantId }, data: { combinationKey: plan.combinationKey } });
    if (plan.deleteValueIds.length) await prisma.productOptionValue.deleteMany({ where: { id: { in: [...plan.deleteValueIds] } } });
    if (plan.deleteOptionIds.length) await prisma.productOption.deleteMany({ where: { id: { in: [...plan.deleteOptionIds] } } });
    await bumpStructure(productId, updatedAt);
    return ok(undefined);
  } catch (error) {
    return failure<ChangeVariantCombinationError>(error, context, (cause) => isDuplicateCombination(cause) ? { code: "DUPLICATE_COMBINATION", message: "Combination is already used" }
      : isDuplicateValueId(cause) ? { code: "ID_CONFLICT", message: "Identifier is already used" } : undefined);
  }
}

/** Stock and variant first (the links cascade), then the emptied values and options, then the structure version. A foreign key from an order answers `VARIANT_HAS_ORDERS`. */
export async function applyVariantDeletion(productId: ProductId, plan: VariantDeletionPlan, updatedAt: Date, context: VariantActionContext): Promise<Result<void, DeleteVariantError>> {
  try {
    await prisma.productStock.deleteMany({ where: { variantId: plan.variantId } });
    await prisma.productVariant.deleteMany({ where: { id: plan.variantId } });
    if (plan.deleteValueIds.length) await prisma.productOptionValue.deleteMany({ where: { id: { in: [...plan.deleteValueIds] } } });
    if (plan.deleteOptionIds.length) await prisma.productOption.deleteMany({ where: { id: { in: [...plan.deleteOptionIds] } } });
    await bumpStructure(productId, updatedAt);
    return ok(undefined);
  } catch (error) {
    return failure<DeleteVariantError>(error, context, (cause) => isForeignKeyViolation(cause) ? { code: "VARIANT_HAS_ORDERS", message: "Variant has orders" } : undefined);
  }
}
