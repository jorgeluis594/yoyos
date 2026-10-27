import type { CompanyId } from "@shared/identity";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { afterTransactionCommit, getCompanyId, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";
import { findOrderedVariantIds } from "@core/src/features/orders/composition";
import { changeVariantCombination, type ChangeVariantCombinationInput } from "@core/src/features/products/application/change-variant-combination";
import { changeVariantStatus, type ChangeVariantStatusInput } from "@core/src/features/products/application/change-variant-status";
import { deleteVariant, type DeleteVariantInput } from "@core/src/features/products/application/delete-variant";
import { updateVariant, type UpdateVariantInput } from "@core/src/features/products/application/update-variant";
import type { VariantActionDependencies, VariantActionName } from "@core/src/features/products/application/variant-action";
import { findForeignOptionIds, findSkuOwners, productRepository } from "@core/src/features/products/infrastructure/repository";
import { transactionFailureStage } from "@core/src/shared/infrastructure/persistence-error";
import { applyCombinationChange, applyVariantDeletion, lockProduct, setVariantStatus, updateVariantFields, type VariantActionContext } from "@core/src/features/products/infrastructure/variant-repository";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import { productEditing, productWriteTransactionOptions } from "@core/src/composition/product-editing";

const writeOptions = productWriteTransactionOptions(process.env);

type Ids = Readonly<{ productId: ProductId; variantId: VariantId }>;

/**
 * The editing transaction of a per-variant action. A Prisma timeout or a lock conflict is the only thing it turns into a result:
 * `PERSISTENCE_UNAVAILABLE`, logged once as `product_variant_action_failed`. Anything else is not ours to hide.
 */
async function variantTransaction<T, E extends { code: string; message: string }>(companyId: string, work: () => Promise<Result<T, E>>, ids: Ids, action: VariantActionName, started: number) {
  try {
    return await withTenantIsolation(companyId, () => withinTransaction(work, writeOptions));
  } catch (error) {
    const stage = transactionFailureStage(error);
    if (!stage) throw error;
    log.error({ event: "product_variant_action_failed", companyId, ...ids, action, stage, errorCode: "PERSISTENCE_UNAVAILABLE",
      durationMs: Math.round(performance.now() - started), err: error }, "product_variant_action_failed");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to save variant" });
  }
}

function base<Done extends object>(ids: Ids, action: VariantActionName, started: number, announce: (done: Done, companyId: string, durationMs: number) => void): VariantActionDependencies<Done> {
  const companyId = getCompanyId();
  return {
    transaction: (id, work) => variantTransaction(id, work, ids, action, started),
    lockProduct,
    loadProduct: (id) => productRepository.get(id),
    clock: () => new Date(),
    observe: {
      completed: (done) => afterTransactionCommit(() => announce(done, companyId, Math.round(performance.now() - started))),
      rejected: (event) => log.info({ event: "product_variant_action_rejected", companyId, productId: event.productId, variantId: event.variantId, action: event.action,
        errorCode: event.errorCode, durationMs: Math.round(performance.now() - started) }, "product_variant_action_rejected"),
    },
  };
}

const access = () => ({ companyId: getCompanyId() as CompanyId });
const context = (ids: Ids, action: VariantActionName, started: number): VariantActionContext => ({ ...ids, action, started });

/** Every action answers with the product read again, so `hasOrders` and the order of options and variants are never stale. */
async function withDetail(written: Result<ProductId, { code: string; message: string }>) {
  if (!written.success) return written;
  const detail = await productEditing.get(written.data);
  if (!detail.success) return detail;
  if (!detail.data) return err({ code: "PRODUCT_NOT_FOUND" as const, message: "Product does not exist" });
  return ok(detail.data);
}

/** Per-variant actions of the current tenant (§5.3 to §5.6). The routes call them; each answers the refreshed product detail. */
export const productVariantActions = {
  update: (input: UpdateVariantInput) => {
    const started = performance.now();
    const ids = { productId: input.productId, variantId: input.variantId };
    return updateVariant(input, access(), {
      ...base(ids, "update", started, (done, companyId, durationMs) => log.info({ event: "product_variant_updated", companyId, ...ids, fields: done.fields, durationMs }, "product_variant_updated")),
      findSkuOwners,
      updateVariantFields: (variantId, changes) => updateVariantFields(variantId, changes, context(ids, "update", started)),
    }).then(withDetail);
  },
  changeCombination: (input: ChangeVariantCombinationInput) => {
    const started = performance.now();
    const ids = { productId: input.productId, variantId: input.variantId };
    return changeVariantCombination(input, access(), {
      ...base(ids, "change_combination", started, (done, companyId, durationMs) => log.info({ event: "product_variant_combination_changed", companyId, ...ids,
        createdValue: done.createdValue, removedValues: done.removedValues, durationMs }, "product_variant_combination_changed")),
      findForeignOptionIds,
      applyCombinationChange: (productId, plan, updatedAt) => applyCombinationChange(productId, plan, updatedAt, context(ids, "change_combination", started)),
    }).then(withDetail);
  },
  changeStatus: (input: ChangeVariantStatusInput) => {
    const started = performance.now();
    const ids = { productId: input.productId, variantId: input.variantId };
    return changeVariantStatus(input, access(), {
      ...base(ids, "change_status", started, (done, companyId, durationMs) => log.info({ event: "product_variant_status_changed", companyId, ...ids,
        status: done.status, activeVariantCount: done.activeVariantCount, durationMs }, "product_variant_status_changed")),
      setVariantStatus: (variantId, status) => setVariantStatus(variantId, status, context(ids, "change_status", started)),
    }).then(withDetail);
  },
  delete: (input: DeleteVariantInput) => {
    const started = performance.now();
    const ids = { productId: input.productId, variantId: input.variantId };
    return deleteVariant(input, access(), {
      ...base(ids, "delete", started, (done, companyId, durationMs) => log.info({ event: "product_variant_deleted", companyId, ...ids,
        removedValues: done.removedValues, removedOptions: done.removedOptions, durationMs }, "product_variant_deleted")),
      findOrderedVariantIds,
      applyVariantDeletion: (productId, plan, updatedAt) => applyVariantDeletion(productId, plan, updatedAt, context(ids, "delete", started)),
    }).then(withDetail);
  },
};
