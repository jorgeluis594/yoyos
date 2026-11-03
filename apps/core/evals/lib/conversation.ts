import { isEventStep, type ConversationStep, type EventStep, type MessageStep } from "@core/evals/cases/schema";
import type { CaseRecord } from "@core/evals/lib/case-record";

/**
 * Runs the steps of a conversation in order on one simulated clock. The clock is what the production use cases read (`clock` of
 * `applyChatMessage` and of the payment, cancellation and product use cases), so a payment reported, then `advance_days 8`, then a
 * message happens eight days later for the use case as well as for the chat's data.
 */

const minuteMs = 60_000;
const dayMs = 24 * 60 * minuteMs;

export class SimulatedClock {
  private time: number;

  constructor(start: Date = new Date()) {
    this.time = start.getTime();
  }

  /** The current simulated time; use cases get this function as their `clock`. */
  readonly now = (): Date => new Date(this.time);

  advanceMinutes(minutes: number): void {
    this.time += minutes * minuteMs;
  }

  advanceDays(days: number): void {
    this.time += days * dayMs;
  }
}

/** What a conversation needs from the production path; the unit tests give fakes, `lib/production.ts` the real use cases. */
export type ConversationDriver<Result> = Readonly<{
  /** `number` is the message's position among the messages, from 1. */
  message: (step: MessageStep, number: number, clock: SimulatedClock) => Promise<Result>;
  event: (step: EventStep, clock: SimulatedClock) => Promise<void>;
}>;

export type StepResult<Result> = Readonly<{ step: MessageStep; number: number; at: Date; result: Result }>;

/**
 * What an event step that threw becomes. A conversation stops at its first failed step (an event that cannot act, such as a payment reported with
 * no order, leaves the chat in a state the case did not design for, so later messages would not test what they mean to): the messages before it
 * stay applied, the ones after are never sent and are recorded as failed (lib/run-case.ts). `message` is the original error's.
 */
export class ConversationEventError extends Error {
  constructor(readonly step: EventStep, /** Among the event steps of the conversation, from 1. */ readonly eventNumber: number,
    /** How many messages were applied before the event. */ readonly after: number, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ConversationEventError";
  }
}

/**
 * Each step happens a minute after the previous one, so messages keep their order; `advance_days` adds its days on top. A throwing event step
 * ends the run with a `ConversationEventError`; a throwing message step ends it with that error as it is.
 */
export async function runConversationSteps<Result>(steps: readonly ConversationStep[], driver: ConversationDriver<Result>,
  clock: SimulatedClock = new SimulatedClock()): Promise<readonly StepResult<Result>[]> {
  const results: StepResult<Result>[] = [];
  let number = 0;
  let events = 0;
  for (const step of steps) {
    clock.advanceMinutes(1);
    if (isEventStep(step)) {
      events += 1;
      if (step.event === "advance_days") clock.advanceDays(step.days);
      else await driver.event(step, clock).catch((cause: unknown) => { throw new ConversationEventError(step, events, number, cause); });
      continue;
    }
    number += 1;
    const at = clock.now();
    results.push({ step, number, at, result: await driver.message(step, number, clock) });
  }
  return results;
}

export type StepFailureKind = "own" | "carried";

/** Where a conversation record sits among its steps: message `n` is at `n`, an event after `k` messages between `k` and `k + 1`. */
const positionOf = (record: CaseRecord): number => record.event ? record.event.after + 0.5 : record.step ?? 0;

/**
 * The failed steps of the conversation records, each with its kind: **carried** when an earlier step (message or failed event) of the same
 * conversation and the same repeat already failed, **own** otherwise. Computed from the stored records alone (`conversationId`, `step` or
 * `event.after`, `repeat`, `passed`), whatever their order, so saved runs can be read the same way. Records outside conversations are ignored.
 */
export function stepFailuresOf(records: readonly CaseRecord[]): readonly Readonly<{ record: CaseRecord; kind: StepFailureKind }>[] {
  const groups = new Map<string, CaseRecord[]>();
  for (const record of records) {
    if (record.conversationId === null) continue;
    const key = `${record.repeat}\u0000${record.conversationId}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.values()].flatMap((steps) => {
    const failures = [...steps].sort((a, b) => positionOf(a) - positionOf(b)).filter(({ passed }) => !passed);
    return failures.map((record, index) => ({ record, kind: index === 0 ? "own" as const : "carried" as const }));
  });
}
