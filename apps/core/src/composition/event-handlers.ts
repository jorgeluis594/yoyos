import { err } from "@shared/functional";
import { restoreCancelledOrderStock, restoreProductStock } from "@core/src/features/products";
import { parseOrderCancelled } from "@core/src/features/orders/infrastructure/event-payloads";
import { findOrderForUpdate, saveStockRestoration } from "@core/src/features/orders/infrastructure/order-repository";
import { getCompanyId, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type {
  AnyEventSubscription, EventBusError, EventHandler, EventName, EventSubscriber,
  EventSubscription, HandlerPolicy, Unsubscribe,
} from "@core/src/shared/events/application/contracts";
import type { AppEvents } from "@core/src/shared/events/application/app-events";

const defaultPolicy: HandlerPolicy = {
  retries: 4, retryDelaySeconds: 5, exponentialBackoff: true, concurrency: 1,
};

export function defineEventHandler<Events extends object, Name extends EventName<Events>>(
  name: Name,
  handler: EventHandler<Events, Name>,
  options: {
    id: string;
    parsePayload: (input: unknown) => ReturnType<EventSubscription<Events, Name>["parsePayload"]>;
    policy?: Partial<HandlerPolicy>;
  },
): EventSubscription<Events, Name> {
  return { id: options.id, name, handler, parsePayload: options.parsePayload,
    policy: { ...defaultPolicy, ...options.policy } };
}

/** Feature exports are added here when their first event is introduced. */
export const restoreCancelledStock = defineEventHandler<AppEvents, "order_cancelled">("order_cancelled",
  (payload) => withTenantIsolation(payload.companyId, () => restoreCancelledOrderStock(payload, {
    transaction: async (companyId, work) => {
      if (getCompanyId() !== companyId) throw new Error("Restoration company differs from context");
      try { return await withinTransaction(work); }
      catch (cause) {
        if (!isPersistenceFailure(cause)) throw cause;
        return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to commit stock restoration" });
      }
    },
    findOrderForUpdate, restoreProductStock, saveStockRestoration,
  })), { id: "restore-cancelled-order-stock", parsePayload: parseOrderCancelled });
export const eventHandlers: AnyEventSubscription<AppEvents>[] = [restoreCancelledStock];

export function subscribeToEvent<Events extends object, Name extends EventName<Events>>(
  subscriber: EventSubscriber<Events>,
  definition: EventSubscription<Events, Name>,
) {
  return subscriber.subscribe(definition);
}

/** Registers each local worker once, including concurrent calls, with rollback on failure. */
export function bootstrapEventHandlers<Events extends object>(
  subscriber: EventSubscriber<Events>,
  definitions: readonly AnyEventSubscription<Events>[],
) {
  let bootstrapped: Promise<Result<Unsubscribe, EventBusError>> | undefined;
  const cleanups: Unsubscribe[] = [];
  const cleanup: Unsubscribe = async () => {
    const results = await Promise.all(cleanups.splice(0).map(unsubscribe => unsubscribe()));
    bootstrapped = undefined;
    return results.find(result => !result.success) ?? ok(undefined);
  };
  return async (): Promise<Result<Unsubscribe, EventBusError>> => {
    if (!bootstrapped) {
      bootstrapped = (async () => {
        for (const definition of definitions) {
          const registered = await subscribeToEvent(subscriber, definition);
          if (!registered.success) {
            await cleanup();
            return registered;
          }
          cleanups.push(registered.data);
        }
        return ok(cleanup);
      })();
    }
    const result = await bootstrapped;
    if (!result.success) bootstrapped = undefined;
    return result;
  };
}
