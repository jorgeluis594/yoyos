import { randomUUID } from "node:crypto";
import { z } from "zod";
import { err } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { AppError, Result } from "@shared/result";
import { afterTransactionCommit, getCompanyId, withinReadSnapshot, withinTransaction, withTenantIsolation, type TransactionOptions } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";
import { findOrderedVariantIds } from "@core/src/features/products/infrastructure/ordered-variants";
import { createProduct, type CreateDependencies, type CreateError, type CreateInput } from "@core/src/features/products/application/create";
import { getProduct, type GetDependencies } from "@core/src/features/products/application/get";
import { saveProduct, type SaveProductDependencies, type SaveProductError, type SaveProductInput } from "@core/src/features/products/application/save-product";
import { listProducts, type ListInput } from "@core/src/features/products/application/list";
import { findImage, listImages, publishProductImageChanged, resolveImage } from "@core/src/features/products/composition";
import { applyStructureChange, findForeignOptionIds, findSkuOwners, insertProduct, lockProduct, productExists, productRepository } from "@core/src/features/products/infrastructure/repository";
import { transactionFailureStage } from "@core/src/shared/infrastructure/persistence-error";
import type { ProductId } from "@core/src/features/products/domain/product";

type Env = Readonly<Record<string, string | undefined>>;

const envSchema = z.object({ PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000) });
const MAX_WAIT_MS = 2_000;

/** Parsed at startup: an invalid value fails the process; an empty one counts as unset. */
export function productWriteTransactionOptions(env: Env): TransactionOptions {
  const { PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS: timeout } = envSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  // Both PostgreSQL limits stay below the Prisma timer, which cannot stop a statement already running on the server.
  return { timeout, maxWait: MAX_WAIT_MS, lockTimeoutMs: Math.min(3_000, Math.floor(timeout * 0.3)), statementTimeoutMs: Math.min(8_000, Math.floor(timeout * 0.8)) };
}

const writeOptions = productWriteTransactionOptions(process.env);

type PersistenceFailure = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/**
 * Runs the work in the editing transaction. A Prisma timeout or a lock conflict is the only thing it turns into a result:
 * `PERSISTENCE_UNAVAILABLE`, logged once as `product_save_failed`. Anything else is not ours to hide.
 * The editing adapters rethrow those two failures instead of answering with a result, so they reach this boundary with their own stage.
 */
export async function productTransaction<T, E extends AppError>(companyId: string, work: () => Promise<Result<T, E>>, context: Readonly<{ productId?: string }> = {}): Promise<Result<T, E | PersistenceFailure>> {
  const started = performance.now();
  try {
    return await withTenantIsolation(companyId, () => withinTransaction(work, writeOptions));
  } catch (error) {
    const stage = transactionFailureStage(error);
    if (!stage) throw error;
    log.error({ event: "product_save_failed", companyId, productId: context.productId, stage, errorCode: "PERSISTENCE_UNAVAILABLE",
      durationMs: Math.round(performance.now() - started), err: error }, "product_save_failed");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to save product" });
  }
}

const rejections: readonly CreateError["code"][] = ["VALIDATION_ERROR", "PRODUCT_ID_CONFLICT", "DUPLICATE_SKU", "DUPLICATE_COMBINATION", "ID_CONFLICT", "IMAGE_NOT_FOUND"];

/** The create wiring, exported so integration tests can replace single dependencies (images, ids, clock). */
export function productCreateDependencies(companyId: string, started = performance.now()): CreateDependencies {
  return {
    transaction: (id, work) => productTransaction(id, work),
    productExists, findImage, findSkuOwners, findForeignOptionIds, insertProduct, publishProductImageChanged,
    newId: randomUUID, clock: () => new Date(),
    observe: {
      created: ({ productId, optionCount, variantCount }) => afterTransactionCommit(() => log.info({ event: "product_created", companyId, productId, optionCount, variantCount,
        durationMs: Math.round(performance.now() - started) }, "product_created")),
      rejected: ({ productId, error }) => {
        if (!rejections.includes(error.code)) return;
        const issues = error.code === "VALIDATION_ERROR" ? error.issues : [];
        log.info({ event: "product_save_rejected", companyId, productId, errorCode: error.code, reasons: [...new Set(issues.map((issue) => issue.reason))], issueCount: issues.length }, "product_save_rejected");
      },
    },
  };
}

/** The detail read wiring, exported for the same reason. */
export const productGetDependencies: GetDependencies = { repository: productRepository, findOrderedVariantIds, snapshot: withinReadSnapshot, resolveImage };

const saveRejections: readonly SaveProductError["code"][] = ["VALIDATION_ERROR", "PRODUCT_CHANGED", "DUPLICATE_SKU", "DUPLICATE_COMBINATION", "ID_CONFLICT", "VARIANT_HAS_ORDERS", "IMAGE_NOT_FOUND"];

/** The save wiring, exported so integration tests can replace single dependencies (images, ids, clock). */
export function productSaveDependencies(companyId: string, productId: string, started = performance.now()): SaveProductDependencies {
  return {
    transaction: (id, work) => productTransaction(id, work, { productId }),
    lockProduct, findOrderedVariantIds, findSkuOwners, findForeignOptionIds, findImage, applyStructureChange,
    reload: (id) => getProduct(id, productGetDependencies),
    newId: randomUUID, clock: () => new Date(), publishProductImageChanged,
    observe: {
      saved: (summary) => afterTransactionCommit(() => log.info({ event: "product_saved", companyId, ...summary, durationMs: Math.round(performance.now() - started) }, "product_saved")),
      rejected: ({ productId: id, error }) => {
        if (!saveRejections.includes(error.code)) return;
        const issues = error.code === "VALIDATION_ERROR" ? error.issues : [];
        log.info({ event: "product_save_rejected", companyId, productId: id, errorCode: error.code, reasons: [...new Set(issues.map((issue) => issue.reason))], issueCount: issues.length }, "product_save_rejected");
      },
    },
  };
}

/** Product reads and writes of the current tenant. The orders capability reaches products from here, so the features never import each other. */
export const productEditing = {
  create: (input: CreateInput) => {
    const companyId = getCompanyId();
    return createProduct(input, { companyId: companyId as CompanyId }, productCreateDependencies(companyId));
  },
  get: (id: ProductId) => getProduct(id, productGetDependencies),
  save: (input: SaveProductInput) => {
    const companyId = getCompanyId();
    return saveProduct(input, { companyId: companyId as CompanyId }, productSaveDependencies(companyId, input.productId));
  },
  list: (input: ListInput, options: Readonly<{ includeImages?: boolean }> = {}) =>
    listProducts(input, { repository: productRepository, ...(options.includeImages ? { images: listImages } : {}) }),
};
