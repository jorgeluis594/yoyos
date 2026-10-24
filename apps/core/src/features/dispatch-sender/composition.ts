import { log } from "@core/src/shared/infrastructure/logger";
import { getDispatchSender, saveDispatchSender } from "@core/src/features/dispatch-sender/application/dispatch-sender";
import { loadDispatchSender, persistDispatchSender } from "@core/src/features/dispatch-sender/infrastructure/dispatch-sender-repository";

const dependencies = { load: loadDispatchSender, save: persistDispatchSender };

/** Both calls need the company context (withTenantIsolation); inside withinTransaction they join the open transaction. */
export const dispatchSender = {
  /** The configured values and the effective sender { name, phone } of the company, read live. */
  get: (companyId: string) => getDispatchSender(companyId, dependencies),
  save: async (companyId: string, userId: string, value: unknown) => {
    const result = await saveDispatchSender(companyId, value, dependencies);
    if (result.success) log.info({ event: "dispatch_sender_saved", companyId, userId, hasName: result.data.configured.name !== null,
      hasPhone: result.data.configured.phone !== null }, "dispatch_sender_saved");
    return result;
  },
};
