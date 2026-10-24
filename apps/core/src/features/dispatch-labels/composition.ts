import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { CreateDispatchLabelsRequest } from "@shared/contracts/dispatch-labels";
import { log } from "@core/src/shared/infrastructure/logger";
import { orders } from "@core/src/features/orders";
import type { OrderId, CompanyId } from "@core/src/features/orders";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import { dispatchSender } from "@core/src/features/dispatch-sender";
import { createDispatchLabels, type CreateDispatchLabelsError } from "@core/src/features/dispatch-labels/application/create-dispatch-labels";
import { createLabelPdf } from "@core/src/features/dispatch-labels/infrastructure/label-pdf";

const invalidStored = { code: "INVALID_STORED_DATA" as const, message: "Invalid stored data" };
const failure = (error: { code: string; message: string }): CreateDispatchLabelsError =>
  error.code === "PERSISTENCE_UNAVAILABLE" ? { code: "PERSISTENCE_UNAVAILABLE", message: error.message } : invalidStored;

/** Both reads need the company context (withTenantIsolation), which the API middleware opens. Never logs customer data. */
export const dispatchLabels = {
  create: async (companyId: string, request: Required<CreateDispatchLabelsRequest>) => {
    const result = await createDispatchLabels(request, {
      loadOrders: async (ids): Promise<Result<readonly OrderAggregateResponse[], CreateDispatchLabelsError>> => {
        const found = await orders.getAggregatesByIds(ids as OrderId[], companyId as CompanyId);
        if (!found.success) return err(failure(found.error));
        try {
          return ok(found.data.map(toOrderAggregateJson));
        } catch (cause) {
          log.error({ event: "dispatch_labels_order_invalid", errorCode: "INVALID_STORED_DATA", err: cause }, "dispatch_labels_order_invalid");
          return err(invalidStored);
        }
      },
      loadSender: async () => {
        const sender = await dispatchSender.get(companyId);
        return sender.success ? ok(sender.data.effective) : err(failure(sender.error));
      },
      createPdf: createLabelPdf,
    });
    if (!result.success) log.error({ event: "dispatch_labels_failed", errorCode: result.error.code, size: request.size, requested: request.orderIds.length }, "dispatch_labels_failed");
    else log.info({ event: "dispatch_labels_created", size: request.size, requested: request.orderIds.length, printed: result.data.printed.length,
      excluded: result.data.excluded.length, notFound: result.data.notFound.length }, "dispatch_labels_created");
    return result;
  },
};
