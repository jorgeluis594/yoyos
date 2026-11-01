import { describe, expect, test } from "vitest";
import type { ChatMessageOutcomes, ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import { openQuestionsOf, type OpenQuestionFacts } from "@core/src/features/orders/domain/open-questions";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";
import type { OrderId } from "@core/src/features/orders/domain/order";

const readAt = new Date("2026-10-31T15:00:00.000Z");
const before = new Date("2026-10-31T14:00:00.000Z");
const after = new Date("2026-10-31T16:00:00.000Z");
const pendingId = "11111111-1111-4111-8111-111111111111" as ChatPendingId;
const newPendingId = "22222222-2222-4222-8222-222222222222" as ChatPendingId;
const orderId = "33333333-3333-4333-8333-333333333333" as OrderId;
const question: SuggestedQuestion = { language: "es", kind: "which_variant", product: "Polo básico", attribute: "Talla", values: ["S", "M", "L"] };

const facts = (overrides: Partial<OpenQuestionFacts> = {}): OpenQuestionFacts => ({
  readAt, alivePendingIds: new Set(), lastRequestAt: null, orders: new Map([[orderId, { open: true, sellerActedAt: null }]]), ...overrides,
});
const withQuestion: ChatMessageOutcomes = [{ kind: "unclear_item", orderId, namedItem: true, namedProductId: null }, { kind: "questions", questions: [question] }];

describe("openQuestionsOf", () => {
  test("a message without questions has none", () => {
    expect(openQuestionsOf([{ kind: "no_intent" }], facts())).toEqual([]);
  });

  test("a question with a pending stays while any pending the message named is alive", () => {
    const outcomes: ChatMessageOutcomes = [{ kind: "pending_split", pendingId, newPendingId }, { kind: "questions", questions: [question] }];
    expect(openQuestionsOf(outcomes, facts({ alivePendingIds: new Set([newPendingId]) }))).toEqual([question]);
    expect(openQuestionsOf(outcomes, facts({ alivePendingIds: new Set() }))).toEqual([]);
  });

  test("a question with a pending ignores the request, edit and order rules", () => {
    const outcomes: ChatMessageOutcomes = [{ kind: "pending_created", pendingId }, { kind: "reader_doubt", orderId }, { kind: "questions", questions: [question] }];
    const closed = facts({ alivePendingIds: new Set([pendingId]), lastRequestAt: after, orders: new Map([[orderId, { open: false, sellerActedAt: after }]]) });
    expect(openQuestionsOf(outcomes, closed)).toEqual([question]);
  });

  test("a question without pending stays open while nothing later happened", () => {
    expect(openQuestionsOf(withQuestion, facts({ lastRequestAt: readAt }))).toEqual([question]);
    expect(openQuestionsOf(withQuestion, facts({ lastRequestAt: before, orders: new Map([[orderId, { open: true, sellerActedAt: readAt }]]) }))).toEqual([question]);
  });

  test("a question without pending leaves after a later message read with order intent", () => {
    expect(openQuestionsOf(withQuestion, facts({ lastRequestAt: after }))).toEqual([]);
  });

  test("a question without pending leaves after the seller acted on the order or the order stopped being open", () => {
    expect(openQuestionsOf(withQuestion, facts({ orders: new Map([[orderId, { open: true, sellerActedAt: after }]]) }))).toEqual([]);
    expect(openQuestionsOf(withQuestion, facts({ orders: new Map([[orderId, { open: false, sellerActedAt: null }]]) }))).toEqual([]);
    expect(openQuestionsOf(withQuestion, facts({ orders: new Map() }))).toEqual([]);
  });

  test("a question without pending and without an order only follows the request rule", () => {
    const outcomes: ChatMessageOutcomes = [{ kind: "not_identified", source: "photo", identification: null, silent: false }, { kind: "questions", questions: [question] }];
    expect(openQuestionsOf(outcomes, facts({ orders: new Map() }))).toEqual([question]);
    expect(openQuestionsOf(outcomes, facts({ orders: new Map(), lastRequestAt: after }))).toEqual([]);
  });

  test("the order a new order replaced does not close the question", () => {
    const previousOrderId = "44444444-4444-4444-8444-444444444444" as OrderId;
    const outcomes: ChatMessageOutcomes = [{ kind: "new_order_after_closed", orderId, previousOrderId }, { kind: "questions", questions: [question] }];
    expect(openQuestionsOf(outcomes, facts({ orders: new Map([[orderId, { open: true, sellerActedAt: null }], [previousOrderId, { open: false, sellerActedAt: after }]]) }))).toEqual([question]);
  });

  test("a message shows at most three questions", () => {
    const many = Array.from({ length: 5 }, (_, index) => ({ ...question, product: `Producto ${index}` }));
    expect(openQuestionsOf([{ kind: "questions", questions: many }], facts())).toEqual(many.slice(0, 3));
  });
});
