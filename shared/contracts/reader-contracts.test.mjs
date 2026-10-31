import assert from "node:assert/strict";
import { test } from "node:test";
import { orderRevisionSchema, orderRevisionsSchema } from "./order-revisions.ts";
import { editOrderItemsErrorSchema, editOrderItemsRequestSchema, editOrderItemsResponseSchema, orderLineSchema } from "./order-items-edit.ts";
import { confirmOrderReviewRequestSchema, confirmOrderReviewResponseSchema, orderReviewErrorSchema, orderReviewResponseSchema } from "./order-review.ts";
import { undoMessageErrorSchema, undoMessageResponseSchema } from "./order-message-undo.ts";
import { recordLinkActionRequestSchema } from "./order-link-actions.ts";
import { openQuestionsRequestSchema, openQuestionsResponseSchema } from "./message-questions.ts";
import { orderAggregateSchema, orderAggregateSummarySchema } from "./orders.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const revision = "A".repeat(43);
const at = "2026-10-31T12:00:00.000Z";
const money = (amount) => ({ amount, currency: "PEN" });
const line = { itemId: id(1), variantId: id(2), productName: "Polera", variantAttributes: { Talla: "M" }, sku: null, quantity: 2, unitPrice: money(35), mentionedPrice: null, position: 0 };
const change = { id: id(10), messageId: id(11), position: 0, seq: 3, kind: "quantity_changed", before: { ...line, quantity: 1 }, after: line,
  decision: { kind: "doubtful", reason: { kind: "quantity_set", quantity: 2 } }, verdict: null, createdAt: at };
const loaded = { changesThrough: 3, changeIds: [id(10)], points: [{ pendingId: id(20), since: at }], itemsRevision: revision };
const review = {
  version: 1,
  status: { openForMessages: true, toReview: true, doubtfulCount: 1, pointCount: 1, entry: "link", hasPreviousReview: false },
  doubtful: [{ change, quote: "dos" }],
  points: [{ pendingId: id(20), since: at, kind: "variant_missing", product: "Polera", quantity: 1, missing: ["Talla"], doubt: { kind: "inherited", from: { kind: "caption_unread" } },
    acknowledged: false, question: "¿En qué talla la quieres?" }],
  products: [{ itemId: id(1), changedSinceLastReview: true }],
  removedSinceLastReview: [line],
  messageRows: [{ messageId: id(11), at, changes: [change], undo: { kind: "refused", reason: "later_change" } }, { messageId: id(12), at, changes: [], undo: { kind: "available" } }],
  moreRows: 0,
  loaded,
};

test("the items edit schemas keep the limits of the web edit and add the version", () => {
  assert.ok(orderRevisionSchema.safeParse(revision).success);
  assert.equal(orderRevisionSchema.safeParse("short").success, false);
  assert.ok(orderRevisionsSchema.safeParse({ items: revision, customer: revision, delivery: revision }).success);
  assert.ok(orderLineSchema.safeParse({ variantId: id(2), quantity: 9999 }).success);
  for (const quantity of [0, 10000, 1.5]) assert.equal(orderLineSchema.safeParse({ variantId: id(2), quantity }).success, false);
  const request = { version: 1, base: revision, lines: [{ variantId: id(2), quantity: 2 }] };
  assert.ok(editOrderItemsRequestSchema.safeParse(request).success);
  assert.equal(editOrderItemsRequestSchema.safeParse({ ...request, version: 2 }).success, false);
  assert.equal(editOrderItemsRequestSchema.safeParse({ ...request, lines: [] }).success, false);
  assert.equal(editOrderItemsRequestSchema.safeParse({ ...request, lines: Array.from({ length: 101 }, (_, n) => ({ variantId: id(n), quantity: 1 })) }).success, false);
  assert.equal(editOrderItemsRequestSchema.safeParse({ ...request, extra: 1 }).success, false);
});

test("the items edit errors name the refusals and carry the variant only when it is missing", () => {
  for (const code of ["ORDER_CHANGED", "DELIVERY_LOCKED", "ORDER_CANCELLED", "INVALID_INPUT"]) assert.ok(editOrderItemsErrorSchema.safeParse({ code, error: "x" }).success, code);
  assert.ok(editOrderItemsErrorSchema.safeParse({ code: "VARIANT_NOT_FOUND", error: "x", variantId: id(2) }).success);
  assert.equal(editOrderItemsErrorSchema.safeParse({ code: "VARIANT_NOT_FOUND", error: "x" }).success, false);
  assert.equal(editOrderItemsErrorSchema.safeParse({ code: "LAST_ITEM", error: "x" }).success, false);
  assert.equal(editOrderItemsResponseSchema.shape.applied.safeParse(["customer"]).success, false);
});

test("the review response round-trips the projection of 6.5 with structured reasons", () => {
  assert.deepEqual(orderReviewResponseSchema.parse(JSON.parse(JSON.stringify(review))), review);
});

test("the review response rejects unknown reasons, undo refusals, entries and extra fields", () => {
  const bad = (patch) => orderReviewResponseSchema.safeParse({ ...review, ...patch }).success;
  assert.equal(bad({ status: { ...review.status, entry: "mail" } }), false);
  assert.equal(bad({ moreRows: -1 }), false);
  assert.equal(bad({ loaded: { ...loaded, changesThrough: -1 } }), false);
  assert.equal(bad({ loaded: { ...loaded, changesThrough: 1.5 } }), false);
  assert.equal(bad({ doubtful: [{ change: { ...change, decision: { kind: "doubtful", reason: { kind: "gut_feeling" } } }, quote: null }] }), false);
  assert.equal(bad({ messageRows: [{ messageId: id(11), at, changes: [], undo: { kind: "refused", reason: "bad_mood" } }] }), false);
  assert.equal(bad({ trace: "texto" }), false);
});

test("the confirm request carries the idempotency id, what the review showed and the corrections", () => {
  const request = { version: 1, id: id(30), origin: "link", linkAction: { id: id(31), action: "copy" }, loaded, corrections: [{ itemId: id(1), quantity: 0 }, { itemId: id(3), quantity: 4 }] };
  assert.ok(confirmOrderReviewRequestSchema.safeParse(request).success);
  assert.ok(confirmOrderReviewRequestSchema.safeParse({ ...request, linkAction: null, corrections: [] }).success);
  assert.equal(confirmOrderReviewRequestSchema.safeParse({ ...request, id: "not-a-uuid" }).success, false);
  assert.equal(confirmOrderReviewRequestSchema.safeParse({ ...request, origin: "mail" }).success, false);
  assert.equal(confirmOrderReviewRequestSchema.safeParse({ ...request, corrections: [{ itemId: id(1), quantity: -1 }] }).success, false);
  assert.equal(confirmOrderReviewRequestSchema.safeParse({ ...request, corrections: [{ itemId: id(1), quantity: 10000 }] }).success, false);
  assert.equal(confirmOrderReviewRequestSchema.safeParse({ ...request, loaded: { ...loaded, changesThrough: undefined } }).success, false);
  assert.equal(confirmOrderReviewRequestSchema.safeParse({ ...request, corrections: [{ itemId: id(1), quantity: 1 }, { itemId: id(1), quantity: 2 }] }).success, false);
  assert.equal(confirmOrderReviewRequestSchema.safeParse({ ...request, corrections: Array.from({ length: 101 }, (_, n) => ({ itemId: id(n), quantity: 1 })) }).success, false);
  assert.equal(confirmOrderReviewRequestSchema.safeParse({ ...request, loaded: { ...loaded, changeIds: Array.from({ length: 501 }, (_, n) => id(n)) } }).success, false);
  assert.equal(confirmOrderReviewRequestSchema.safeParse({ ...request, loaded: { ...loaded, points: Array.from({ length: 11 }, () => loaded.points[0]) } }).success, false);
});

test("the confirm response lists what changed meanwhile and the review errors name their codes", () => {
  assert.equal(confirmOrderReviewResponseSchema.safeParse({}).success, false);
  assert.ok(orderReviewErrorSchema.safeParse({ code: "REVIEW_OUTDATED", error: "x", affectedItemIds: [id(1)], newPoints: 1 }).success);
  assert.equal(orderReviewErrorSchema.safeParse({ code: "REVIEW_OUTDATED", error: "x" }).success, false);
  for (const code of ["ORDER_CHANGED", "DELIVERY_LOCKED", "ORDER_CANCELLED", "LAST_ITEM", "INVALID_INPUT"]) assert.ok(orderReviewErrorSchema.safeParse({ code, error: "x" }).success, code);
  assert.ok(orderReviewErrorSchema.safeParse({ code: "VARIANT_NOT_FOUND", error: "x", variantId: id(2) }).success);
  assert.equal(orderReviewErrorSchema.safeParse({ code: "TEAPOT", error: "x" }).success, false);
});

test("undo, link action and open question contracts", () => {
  assert.equal(undoMessageResponseSchema.safeParse({}).success, false);
  assert.ok(undoMessageResponseSchema.shape.review.safeParse(review).success);
  for (const reason of ["later_change", "would_empty", "not_sold", "order_moved_on"]) assert.ok(undoMessageErrorSchema.safeParse({ code: "UNDO_REFUSED", error: "x", reason }).success, reason);
  assert.equal(undoMessageErrorSchema.safeParse({ code: "UNDO_REFUSED", error: "x", reason: "mood" }).success, false);
  assert.ok(recordLinkActionRequestSchema.safeParse({ version: 1, id: id(40), action: "share" }).success);
  assert.equal(recordLinkActionRequestSchema.safeParse({ version: 1, id: id(40), action: "print" }).success, false);
  assert.ok(openQuestionsRequestSchema.safeParse({ version: 1, messageIds: [id(1)] }).success);
  assert.equal(openQuestionsRequestSchema.safeParse({ version: 1, messageIds: [] }).success, false);
  assert.equal(openQuestionsRequestSchema.safeParse({ version: 1, messageIds: Array.from({ length: 101 }, (_, n) => id(n)) }).success, false);
  const questions = { version: 1, messages: [{ messageId: id(1), points: [{ id: id(2), text: "¿Qué talla?", about: "Polera" }] }] };
  assert.deepEqual(openQuestionsResponseSchema.parse(questions), questions);
  assert.equal(openQuestionsResponseSchema.safeParse({ ...questions, messages: [{ messageId: id(1), points: [{ id: id(2), text: "", about: "Polera" }] }] }).success, false);
});

test("the order projections accept the new fields and stay compatible without them", () => {
  assert.ok("revisions" in orderAggregateSchema.shape);
  assert.ok(orderAggregateSchema.shape.revisions.safeParse(undefined).success);
  assert.ok(orderAggregateSchema.shape.revisions.safeParse({ items: revision }).success);
  assert.equal(orderAggregateSchema.shape.revisions.safeParse({ items: "short" }).success, false);
  assert.ok(orderAggregateSummarySchema.shape.toReview.safeParse(true).success);
  assert.ok(orderAggregateSummarySchema.shape.toReview.safeParse(undefined).success);
  assert.equal(orderAggregateSummarySchema.shape.toReview.safeParse("yes").success, false);
});
