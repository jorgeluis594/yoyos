import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type {
  BlockedKeysReader, EventBusError, EventBusProvider, EventHandlerContext, EventMetadata, EventName,
  EventPayload, EventSubscription, JobScheduler, ScheduledJobHandler, ScheduleOptions, Unsubscribe,
} from "@core/src/shared/events/application/contracts";

type Registered = {
  name: string;
  deliver: (payload: unknown, metadata: EventMetadata) => Promise<Result<void, EventBusError>>;
};

export type ScheduledRegistration = Readonly<{ name: string; cron: string; handler: ScheduledJobHandler } & ScheduleOptions>;

/**
 * Application-test adapter. Delivery is awaited and each handler runs independently; schedules are only recorded.
 * Ordering, groups, expiry and retention are ignored. A handler with a dead-letter handler is attempted without delay
 * up to its retries, and a retryable failure of its last attempt (or a permanent one) calls the dead-letter handler.
 */
export function createInMemoryEventBus<Events extends object>(): EventBusProvider<Events> & JobScheduler & BlockedKeysReader
  & Readonly<{ scheduled: () => readonly ScheduledRegistration[] }> {
  const subscriptions = new Map<string, Registered>();
  const scheduled = new Map<string, ScheduledRegistration>();
  return {
    scheduled: () => [...scheduled.values()],
    listBlockedKeys: async () => ok([]),
    async schedule(name, cron, handler, options) {
      if (!name || scheduled.has(name)) return err({ code: "INVALID_SUBSCRIPTION", message: "Scheduled job name must be unique and nonempty" });
      const registration = { name, cron, handler, ...options };
      scheduled.set(name, registration);
      return ok(async () => {
        if (scheduled.get(name) === registration) scheduled.delete(name);
        return ok(undefined);
      });
    },
    async subscribe<Name extends EventName<Events>>(
      subscription: EventSubscription<Events, Name>,
    ): Promise<Result<Unsubscribe, EventBusError>> {
      if (!subscription.id || subscriptions.has(subscription.id)) {
        return err({ code: "INVALID_SUBSCRIPTION", message: "Handler ID must be unique and nonempty" });
      }
      const registered: Registered = {
        name: subscription.name,
        async deliver(input, metadata) {
          const parsed = subscription.parsePayload(input);
          if (!parsed.success) return parsed;
          const attempts = subscription.policy.deadLetter ? subscription.policy.retries + 1 : 1;
          let failure: EventBusError & { retryable: boolean } = { code: "EVENT_BUS_UNAVAILABLE", message: "Handler failed", retryable: false };
          for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const context: EventHandlerContext = { signal: new AbortController().signal, attempt };
            try {
              const result = await subscription.handler(parsed.data, metadata, context);
              if (result.success) return ok(undefined);
              failure = { code: "EVENT_BUS_UNAVAILABLE", message: result.error.message, retryable: result.error.retryable };
            } catch (cause) {
              failure = { code: "EVENT_BUS_UNAVAILABLE", message: cause instanceof Error ? cause.message : "Handler failed", retryable: true };
            }
            if (!failure.retryable) break;
          }
          await subscription.policy.deadLetter?.handler(parsed.data, metadata, { signal: new AbortController().signal, attempt: 1 })
            .catch(() => undefined);
          return err({ code: failure.code, message: failure.message });
        },
      };
      subscriptions.set(subscription.id, registered);
      return ok(async () => {
        if (subscriptions.get(subscription.id) === registered) subscriptions.delete(subscription.id);
        return ok(undefined);
      });
    },
    async publish<Name extends EventName<Events>>(
      name: Name, payload: EventPayload<Events, Name>, metadata: EventMetadata,
    ): Promise<Result<void, EventBusError>> {
      const results = await Promise.all([...subscriptions.values()]
        .filter(subscription => subscription.name === name)
        .map(subscription => subscription.deliver(payload, metadata)));
      return results.find(result => !result.success) ?? ok(undefined);
    },
  };
}
