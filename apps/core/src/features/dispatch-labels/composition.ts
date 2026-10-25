import { err, ok } from "@shared/functional";
import type { z } from "zod";
import type { createDispatchLabelsRequestSchema, DispatchLabelSize } from "@shared/contracts/dispatch-labels";
import { log } from "@core/src/shared/infrastructure/logger";
import { getOrderAggregateResponsesByIds } from "@core/src/features/orders";
import { dispatchSender } from "@core/src/features/dispatch-sender";
import { createDispatchLabels, type CreateDispatchLabelsError, type LabelPdf } from "@core/src/features/dispatch-labels/application/create-dispatch-labels";
import { createLabelPdf } from "@core/src/features/dispatch-labels/infrastructure/label-pdf";

const invalidStored = { code: "INVALID_STORED_DATA" as const, message: "Invalid stored data" };
const failure = (error: { code: string; message: string }): CreateDispatchLabelsError =>
  error.code === "PERSISTENCE_UNAVAILABLE" ? { code: "PERSISTENCE_UNAVAILABLE", message: error.message } : invalidStored;

/** Both reads need the company context (withTenantIsolation), which the API middleware opens. Never logs customer data. */
export const dispatchLabels = {
  create: async (companyId: string, request: z.output<typeof createDispatchLabelsRequestSchema>, createPdf: (size: DispatchLabelSize) => LabelPdf = createLabelPdf) => {
    const result = await createDispatchLabels(request, {
      loadOrders: async (ids) => {
        const found = await getOrderAggregateResponsesByIds(ids, companyId);
        return found.success ? found : err(failure(found.error));
      },
      loadSender: async () => {
        const sender = await dispatchSender.get(companyId);
        return sender.success ? ok(sender.data.effective) : err(failure(sender.error));
      },
      createPdf,
    });
    if (!result.success) log.error({ event: "dispatch_labels_failed", errorCode: result.error.code, size: request.size, requested: request.orderIds.length }, "dispatch_labels_failed");
    else log.info({ event: "dispatch_labels_created", size: request.size, requested: request.orderIds.length, printed: result.data.printed.length,
      excluded: result.data.excluded.length, notFound: result.data.notFound.length }, "dispatch_labels_created");
    return result;
  },
};
