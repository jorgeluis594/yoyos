import { randomUUID } from "node:crypto";
import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type {
  EventBusError, EventName, EventPayload, EventPublisher,
} from "@core/src/shared/events/application/contracts";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import { eventHandlers } from "@core/src/composition/event-handlers";
import { createPgBossProvider } from "@core/src/shared/events/infrastructure/pg-boss-provider";

export function createPublishEvent<Events extends object>(
  publisher?: EventPublisher<Events>,
  generateId: () => string = randomUUID,
  now: () => Date = () => new Date(),
): <Name extends EventName<Events>>(
  name: Name,
  payload: EventPayload<Events, Name>,
) => Promise<Result<void, EventBusError>> {
  return (name, payload) => publisher
    ? publisher.publish(name, payload, { eventId: generateId(), occurredAt: now().toISOString() })
    : Promise.resolve(err({ code: "EVENT_BUS_UNAVAILABLE", message: "Event bus is not configured" }));
}

export function createEventBusRuntime(consume = false) {
  const provider = createPgBossProvider<AppEvents>({
    connectionString: process.env.EVENT_BUS_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
    subscriptions: eventHandlers,
    consume,
  });
  return { provider, publishEvent: createPublishEvent<AppEvents>(provider) };
}
