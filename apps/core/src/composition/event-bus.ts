import { randomUUID } from "node:crypto";
import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type {
  EventBusError, EventName, EventPayload, EventPublisher,
} from "@core/src/shared/events/application/contracts";

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
