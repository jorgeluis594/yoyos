import type { Result } from "@shared/result";

export type EventName<Events extends object> = Extract<keyof Events, string>;
export type EventPayload<Events extends object, Name extends EventName<Events>> =
  Events[Name] & Readonly<{ companyId: string }>;

export type EventMetadata = Readonly<{ eventId: string; occurredAt: string }>;
export type EventBusError = Readonly<{
  code: "INVALID_EVENT" | "EVENT_BUS_UNAVAILABLE" | "INVALID_SUBSCRIPTION";
  message: string;
}>;
export type EventHandlerError = Readonly<{ code: string; message: string; retryable: boolean }>;
export type EventHandlerContext = Readonly<{ signal: AbortSignal; attempt: number }>;
export type EventHandler<Events extends object, Name extends EventName<Events>> = (
  payload: EventPayload<Events, Name>,
  metadata: EventMetadata,
  context: EventHandlerContext,
) => Promise<Result<void, EventHandlerError>>;
export type HandlerPolicy = Readonly<{
  retries: number;
  retryDelaySeconds: number;
  exponentialBackoff: boolean;
  concurrency: number;
}>;
export type EventSubscription<Events extends object, Name extends EventName<Events>> = Readonly<{
  id: string;
  name: Name;
  handler: EventHandler<Events, Name>;
  policy: HandlerPolicy;
  parsePayload: (input: unknown) => Result<EventPayload<Events, Name>, EventBusError>;
}>;
export type AnyEventSubscription<Events extends object> = {
  [Name in EventName<Events>]: EventSubscription<Events, Name>;
}[EventName<Events>];
export type Unsubscribe = () => Promise<Result<void, EventBusError>>;
export interface EventPublisher<Events extends object> {
  publish<Name extends EventName<Events>>(
    name: Name,
    payload: EventPayload<Events, Name>,
    metadata: EventMetadata,
  ): Promise<Result<void, EventBusError>>;
}
export interface EventSubscriber<Events extends object> {
  subscribe<Name extends EventName<Events>>(
    subscription: EventSubscription<Events, Name>,
  ): Promise<Result<Unsubscribe, EventBusError>>;
}
export interface EventBusProvider<Events extends object> extends EventPublisher<Events>, EventSubscriber<Events> {}
