import { describe, expect, test } from "vitest";
import { evalCase, type ConversationCase, type EventStep, type MessageStep } from "@core/evals/cases/schema";
import { ConversationEventError, SimulatedClock, runConversationSteps, stepFailuresOf } from "@core/evals/lib/conversation";
import { messageRecord } from "@core/evals/lib/record-fixture";
import { splitOfCase } from "@core/evals/cases/split";

const message = (text: string): MessageStep => ({ input: { text }, expected: { notice: null } });

test("runs event steps with the conversation's simulated clock", async () => {
  const start = new Date("2026-10-01T10:00:00Z");
  const log: { what: string; at: Date }[] = [];
  const driver = {
    message: async (step: MessageStep, number: number, clock: SimulatedClock) => { log.push({ what: `message ${number} ${step.input.text}`, at: clock.now() }); return number; },
    event: async (step: EventStep, clock: SimulatedClock) => { log.push({ what: step.event, at: clock.now() }); },
  };

  const results = await runConversationSteps([message("quiero la gorra"), { event: "report_payment" }, { event: "advance_days", days: 8 }, { event: "void_payment" }, message("hola de nuevo")],
    driver, new SimulatedClock(start));

  expect(log.map(({ what }) => what)).toEqual(["message 1 quiero la gorra", "report_payment", "void_payment", "message 2 hola de nuevo"]);
  const days = (from: number, to: number) => (log[to]!.at.getTime() - log[from]!.at.getTime()) / 86_400_000;
  expect(days(1, 2)).toBeGreaterThan(8);
  expect(days(1, 2)).toBeLessThan(8.01);
  expect(days(0, 3)).toBeGreaterThan(8);
  expect(results.map(({ number, result }) => [number, result])).toEqual([[1, 1], [2, 2]]);
});

const conversation = (steps: unknown[]) => ({ id: "conv-1", pass: "conversation", kind: "photo-then-size", tags: [], steps });

test("parses a conversation with events and rejects one with five messages", () => {
  const parsed = evalCase.parse(conversation([
    { input: { photo: { shows: "gorra-trucker" } }, expected: { notice: "variant_missing", outcomes: ["pending_created"] } },
    { event: "advance_days", days: 8 },
    { event: "deactivate_product", product: "gorra-trucker" },
    { event: "confirm_payment", partial: true },
    { input: { text: "negro" }, expected: { notice: null, order: [{ product: "gorra-trucker", variant: { Color: "Negro" }, quantity: 1 }] }, expectsRepeatNotice: true },
  ])) as ConversationCase;

  expect(parsed.steps).toHaveLength(5);
  expect(splitOfCase(parsed)).toBe(splitOfCase({ id: "conv-1" }));

  const five = Array.from({ length: 5 }, (_, index) => ({ input: { text: `m${index}` }, expected: { notice: null } }));
  expect(() => evalCase.parse(conversation(five))).toThrow(/2 to 4 messages/);
  expect(() => evalCase.parse(conversation([five[0]]))).toThrow();
  expect(() => evalCase.parse(conversation([five[0], five[1], { event: "unknown" }]))).toThrow();
  expect(() => evalCase.parse(conversation([five[0], { input: { text: "x" }, expected: { outcomes: [] } }]))).toThrow();
});

test("an event that throws stops the conversation with an error that names the event and the messages before it", async () => {
  const driver = {
    message: async (_step: MessageStep, number: number) => number,
    event: async (step: EventStep) => { if (step.event === "report_payment") throw new Error("The conversation has no order for report_payment"); },
  };

  const failure = await runConversationSteps([message("a"), { event: "advance_days", days: 1 }, { event: "cancel_order" }, { event: "report_payment" }, message("b")], driver).catch((cause: unknown) => cause);

  expect(failure).toBeInstanceOf(ConversationEventError);
  expect(failure).toMatchObject({ message: "The conversation has no order for report_payment", step: { event: "report_payment" }, eventNumber: 3, after: 1 });
});

describe("stepFailuresOf", () => {
  const step = (conversationId: string, number: number, passed: boolean, repeat = 0) =>
    messageRecord({ caseId: `${conversationId}#${number}`, pass: "conversation", conversationId, step: number, passed, repeat });
  const kinds = (records: ReturnType<typeof step>[]) => stepFailuresOf(records).map(({ record, kind }) => `${record.caseId}/${record.repeat} ${kind}`);

  test("a failed step is carried when an earlier step of the same conversation and repeat failed, else own", () => {
    expect(kinds([step("c", 1, true), step("c", 2, false), step("c", 3, false), step("d", 1, false), step("d", 2, true), step("d", 3, false), step("c", 1, true, 1), step("c", 2, true, 1), step("c", 3, false, 1)]))
      .toEqual(["c#2/0 own", "c#3/0 carried", "d#1/0 own", "d#3/0 carried", "c#3/1 own"]);
  });

  test("does not depend on the order of the records, and a failed event sits between its messages", () => {
    const event = messageRecord({ caseId: "c#event1", pass: "conversation", conversationId: "c", step: null, passed: false, event: { name: "report_payment", after: 1 } });

    expect(kinds([step("c", 2, false), event, step("c", 1, true)])).toEqual(["c#event1/0 own", "c#2/0 carried"]);
    expect(kinds([step("c", 2, false), event, step("c", 1, false)])).toEqual(["c#1/0 own", "c#event1/0 carried", "c#2/0 carried"]);
  });

  test("ignores records outside conversations", () => {
    expect(kinds([messageRecord({ passed: false })])).toEqual([]);
  });
});
