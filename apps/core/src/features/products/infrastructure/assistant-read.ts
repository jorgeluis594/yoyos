import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId } from "@core/src/shared/infrastructure/persistance";
import { budgetedSnapshot, type ReadBudget } from "@core/src/shared/infrastructure/budgeted-snapshot";
import type { AssistantReadError, AssistantSnapshot } from "@core/src/features/products/application/assistant-read";

export type { AssistantReadError, AssistantSnapshot };

/** `maxStatements × statementTimeoutMs + maxWait` must stay within `timeout`, so the statement limit always fires before the Prisma timer. */
export const assistantReadBudget = { maxWait: 1000, timeout: 5000, statementTimeoutMs: 350, maxStatements: 11 } as const satisfies ReadBudget;

export type AssistantReadOperation = "search" | "detail";

/** The shared snapshot with the product budget; a thrown timeout becomes a result and is logged once as `product_search_failed`. */
export function assistantSnapshot(operation: AssistantReadOperation): AssistantSnapshot {
  return budgetedSnapshot(assistantReadBudget, (failure, cause, durationMs) => {
    log.error({ event: "product_search_failed", companyId: getCompanyId(), operation, errorCode: failure.code, durationMs, err: cause }, "product_search_failed");
  });
}
