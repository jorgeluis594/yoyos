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
export type RetryPolicy = Readonly<{
  retries: number;
  retryDelaySeconds: number;
  exponentialBackoff: boolean;
  concurrency: number;
  retryDelayMaxSeconds?: number;
  expireInSeconds?: number;
  heartbeatSeconds?: number;
  deleteAfterSeconds?: number;
}>;
/** Runs once a job ends failed. The provider then deletes the failed source job, which releases its ordering key. */
export type DeadLetterPolicy<Payload> = Readonly<{
  id: string;
  handler: (payload: Payload, metadata: EventMetadata, context: EventHandlerContext) => Promise<Result<void, EventHandlerError>>;
  policy: RetryPolicy;
}>;
/**
 * `orderingKey` runs jobs with the same key one at a time, in publication order, and a failed job holds its key
 * until its dead-letter handler succeeds, so it requires `deadLetter`. `groupKey` and `groupConcurrency` bound
 * how many jobs of one group run at once across workers.
 */
export type HandlerPolicy<Payload = never> = RetryPolicy & Readonly<{
  orderingKey?: (payload: Payload) => string;
  groupKey?: (payload: Payload) => string;
  groupConcurrency?: number;
  deadLetter?: DeadLetterPolicy<Payload>;
}>;
export type EventSubscription<Events extends object, Name extends EventName<Events>> = Readonly<{
  id: string;
  name: Name;
  handler: EventHandler<Events, Name>;
  policy: HandlerPolicy<EventPayload<Events, Name>>;
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
export interface BlockedKeysReader {
  /** Ordering keys held by a failed job of the handler's queue. A queue that does not exist yet has none. */
  listBlockedKeys(handlerId: string): Promise<Result<readonly string[], EventBusError>>;
}
export type ScheduledJobHandler = (context: EventHandlerContext) => Promise<Result<void, EventHandlerError>>;
export type ScheduleOptions = Readonly<{ tz: string }>;
export interface JobScheduler {
  schedule(name: string, cron: string, handler: ScheduledJobHandler, options: ScheduleOptions): Promise<Result<Unsubscribe, EventBusError>>;
}
