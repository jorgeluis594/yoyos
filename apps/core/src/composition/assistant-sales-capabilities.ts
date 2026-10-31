import { err } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { orders } from "@core/src/features/orders";
import { log } from "@core/src/shared/infrastructure/logger";
import { createReadSlots } from "@core/src/composition/assistant-read-slots";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { ToolRunError } from "@core/src/features/assistants/application/answer-tool-call";
import { salesReadFailureMessage, tooManyOrdersMessage } from "@core/src/features/assistants/presentation/tools/sales-texts";

export type SalesOperation = "summary" | "best_sellers" | "unsold";
export type SalesStepName = "storefront" | "figures" | "sold_variants" | "descriptions" | "stocked" | "item_dates";
/** `period`: the cost grows with the days read (summary figures, sold variants). `catalog`: it grows with the catalog (storefront, descriptions, stocked products, item dates). */
export type SalesBound = "period" | "catalog";
/** Wraps one read of the call so the guard knows which one was running when the snapshot failed. */
export type SalesStep = <R>(name: SalesStepName, bound: SalesBound, read: () => Promise<R>) => Promise<R>;

/** A period read longer than this many days is told to be shortened when it times out; a shorter one would fail the same way. */
export const tooManyOrdersAfterDays = 31;

const toolOf: Readonly<Record<SalesOperation, string>> = { summary: "resumen_de_ventas", best_sellers: "lo_mas_vendido", unsold: "productos_sin_ventas" };
const snapshotCodes = ["STATEMENT_TIMEOUT", "TRANSACTION_TIMEOUT", "PERSISTENCE_UNAVAILABLE"];

export type SalesReadPorts = Readonly<{
  snapshot: <T, E extends AppError>(work: () => Promise<Result<T, E>>) => Promise<Result<T, E | Readonly<{ code: string; message: string }>>>;
  slots: number;                                // sales reads in flight at once, per process
  slotWaitMs: number;                           // how long a call waits for a slot before answering the reading-failure text
}>;

const failure = (message: string): ToolRunError => ({ code: "FAILURE", message });

/**
 * The guard every sales tool runs its reads through: takes a sales slot, runs `work` in one budgeted snapshot and turns any failure into the text
 * the owner gets. It alone knows the operation, the days read, the step and the answer, so it logs `sales_read_failed` once, with no input or amount.
 */
export function createSalesReadGuard(ports: SalesReadPorts) {
  const slots = createReadSlots(ports.slots, ports.slotWaitMs);

  return async function salesRead<T, E extends AppError>(
    operation: SalesOperation, access: AssistantAccess, periodDays: number, work: (step: SalesStep) => Promise<Result<T, E>>,
  ): Promise<Result<T, ToolRunError>> {
    const slot = await slots.acquire();
    if (!slot) {
      log.warn({ event: "assistant_sales_reads_busy", companyId: access.companyId, connectionId: access.connectionId, tool: toolOf[operation], waitedMs: ports.slotWaitMs }, "assistant_sales_reads_busy");
      return err(failure(salesReadFailureMessage));
    }
    const started = performance.now();
    let running: Readonly<{ name: SalesStepName; bound: SalesBound }> | undefined;
    const step: SalesStep = (name, bound, read) => { running = { name, bound }; return read(); };
    try {
      const read = await ports.snapshot(() => work(step));
      if (read.success) return read;
      if (!snapshotCodes.includes(read.error.code ?? "")) {
        log.error({ event: "assistant_tool_failed", companyId: access.companyId, connectionId: access.connectionId, tool: toolOf[operation], errorCode: read.error.code }, "assistant_tool_failed");
        return err(failure(salesReadFailureMessage));
      }
      // Only a statement timeout in a step whose cost grows with a period of more than 31 days means the period itself is too heavy.
      const tooMany = read.error.code === "STATEMENT_TIMEOUT" && running?.bound === "period" && periodDays > tooManyOrdersAfterDays;
      log.error({
        event: "sales_read_failed", companyId: access.companyId, operation, step: running?.name, errorCode: read.error.code, periodDays,
        answer: tooMany ? "too_many_orders" : "read_failure", durationMs: Math.round(performance.now() - started),
      }, "sales_read_failed");
      return err(failure(tooMany ? tooManyOrdersMessage : salesReadFailureMessage));
    } finally {
      slot.release();
    }
  };
}

/** The sales slots are shared by every store of the process and separate from the product slots. */
export const salesRead = createSalesReadGuard({ snapshot: (work) => orders.readSalesForAssistant(work), slots: 2, slotWaitMs: 2000 });
