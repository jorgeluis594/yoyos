import { expect, test } from "vitest";
import { evalCase, type ConversationCase, type EventStep, type MessageStep } from "@core/evals/cases/schema";
import { SimulatedClock, runConversationSteps } from "@core/evals/lib/conversation";
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
    { input: { text: "negro" }, expected: { notice: null, order: [{ product: "gorra-trucker", variant: { Color: "Negro" }, quantity: 1 }] }, expectsRepeatNotice: true },
  ])) as ConversationCase;

  expect(parsed.steps).toHaveLength(4);
  expect(splitOfCase(parsed)).toBe(splitOfCase({ id: "conv-1" }));

  const five = Array.from({ length: 5 }, (_, index) => ({ input: { text: `m${index}` }, expected: { notice: null } }));
  expect(() => evalCase.parse(conversation(five))).toThrow(/2 to 4 messages/);
  expect(() => evalCase.parse(conversation([five[0]]))).toThrow();
  expect(() => evalCase.parse(conversation([five[0], five[1], { event: "unknown" }]))).toThrow();
  expect(() => evalCase.parse(conversation([five[0], { input: { text: "x" }, expected: { outcomes: [] } }]))).toThrow();
});
