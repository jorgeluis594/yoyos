import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type {
  EventBusError, EventBusProvider, EventHandlerContext, EventMetadata, EventName,
  EventPayload, EventSubscription, Unsubscribe,
} from "@core/src/shared/events/application/contracts";

type Registered = {
  name: string;
  deliver: (payload: unknown, metadata: EventMetadata) => Promise<Result<void, EventBusError>>;
};

/** Application-test adapter. Delivery is awaited and each handler runs independently. */
export function createInMemoryEventBus<Events extends object>(): EventBusProvider<Events> {
  const subscriptions = new Map<string, Registered>();
  return {
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
          const context: EventHandlerContext = { signal: new AbortController().signal, attempt: 1 };
          try {
            const result = await subscription.handler(parsed.data, metadata, context);
            return result.success ? ok(undefined) : err({
              code: "EVENT_BUS_UNAVAILABLE", message: result.error.message,
            });
          } catch (cause) {
            return err({ code: "EVENT_BUS_UNAVAILABLE", message: cause instanceof Error ? cause.message : "Handler failed" });
          }
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
