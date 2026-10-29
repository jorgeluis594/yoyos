import { isEventStep, type ConversationStep, type EventStep, type MessageStep } from "@core/evals/cases/schema";

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

/** Each step happens a minute after the previous one, so messages keep their order; `advance_days` adds its days on top. */
export async function runConversationSteps<Result>(steps: readonly ConversationStep[], driver: ConversationDriver<Result>,
  clock: SimulatedClock = new SimulatedClock()): Promise<readonly StepResult<Result>[]> {
  const results: StepResult<Result>[] = [];
  let number = 0;
  for (const step of steps) {
    clock.advanceMinutes(1);
    if (isEventStep(step)) {
      if (step.event === "advance_days") clock.advanceDays(step.days);
      else await driver.event(step, clock);
      continue;
    }
    number += 1;
    const at = clock.now();
    results.push({ step, number, at, result: await driver.message(step, number, clock) });
  }
  return results;
}
