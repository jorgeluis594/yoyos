import { describe, expect, test } from "vitest";
import { agreementOf, decideChange, isHighCertainty, riskOf, type CheckedAction, type DecisionGuards } from "@core/src/features/orders/domain/reader/decide";
import type { CertaintySignals, DoubtReason } from "@core/src/features/orders/domain/reader/decision";
import type { ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { RequestRef } from "@core/src/features/orders/domain/reader/refs";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const sure: CertaintySignals = { quotesComplete: true, targetNamed: "named", variantChangeVerb: "not_applicable", candidates: "single" };
const variantId = "00000000-0000-4000-8000-000000000011" as VariantId;
const productId = "00000000-0000-4000-8000-000000000021" as ProductId;
const guards: DecisionGuards = { captionUnread: false };
const quantitySet: DoubtReason = { kind: "quantity_set", quantity: 3 as PositiveInteger };
const add: ResolvedChatAction = { kind: "add", item: { variantId, productName: "Polo", variantAttributes: {}, sku: null, unitPrice: { amount: 35, currency: "PEN" } },
  quantity: 1 as PositiveInteger, mentionedPrice: null, identification: { method: "text", productId, confidence: null } };
const setQuantity: ResolvedChatAction = { kind: "set_quantity", target: { kind: "variant", variantId }, quantity: 3 };
const changeVariant: ResolvedChatAction = { kind: "change_variant", target: { kind: "variant", variantId }, to: { kind: "missing", productId }, mentionedPrice: null };
const checked = (action: ResolvedChatAction, signals: CertaintySignals = sure, doubt: DoubtReason | null = quantitySet): CheckedAction =>
  ({ request: "R1" as RequestRef, action, signals, doubt, urgent: { problem: "not_clear", question: null } });
const decide = (item: CheckedAction, agreement: "agree" | "disagree" | "not_run", g = guards) => decideChange(item, riskOf(item.action, item.signals), agreement, g);

describe("riskOf", () => {
  test.each<[string, ResolvedChatAction, CertaintySignals, "low" | "high"]>([
    ["adding a named product", add, sure, "low"],
    ["removing an item", { kind: "remove", target: { kind: "variant", variantId }, amount: "all" }, sure, "high"],
    ["setting an item's quantity", setQuantity, sure, "high"],
    ["lowering an item", { kind: "lower_quantity", target: { kind: "variant", variantId }, quantity: 1 as PositiveInteger }, sure, "high"],
    ["changing a variant", changeVariant, sure, "high"],
    ["adding by reference", add, { ...sure, targetNamed: "context" }, "high"],
    ["increasing an unnamed item", { kind: "increase_quantity", target: { kind: "unnamed" }, quantity: 1 as PositiveInteger }, { ...sure, targetNamed: "context" }, "high"],
    ["increasing a named item", { kind: "increase_quantity", target: { kind: "variant", variantId }, quantity: 1 as PositiveInteger }, sure, "low"],
    ["noting a mentioned price", { kind: "set_mentioned_price", target: { kind: "variant", variantId }, price: null }, sure, "low"],
    ["changing a pending's quantity", { kind: "change_pending_quantity", pendingId: "p" as never, mode: "set", quantity: 3, otherwise: add }, sure, "low"],
    ["saying listo", { kind: "ready" }, sure, "low"],
    ["setting the item the photo just sent left", { kind: "set_photo_item_quantity", orderId: "o" as never, variantId, expectedQuantity: 1 as PositiveInteger, quantity: 3, otherwise: add }, { ...sure, targetNamed: "photo_just_sent_set" }, "high"],
  ])("rates %s %s", (_title, action, signals, risk) => {
    expect(riskOf(action, signals)).toBe(risk);
  });
});

describe("agreementOf", () => {
  const same = { ...add };
  test("computes agreement from resolved actions whichever stages had a confirming configuration", () => {
    expect(agreementOf(add, same)).toBe("agree");
    expect(agreementOf(add, null)).toBe("not_run");
    expect(agreementOf(add, { ...add, quantity: 2 as PositiveInteger })).toBe("disagree");
    expect(agreementOf(setQuantity, { ...setQuantity, quantity: 4 })).toBe("disagree");
    expect(agreementOf(setQuantity, { kind: "remove", target: { kind: "variant", variantId }, amount: "all" })).toBe("disagree");
    expect(agreementOf(changeVariant, { ...changeVariant, target: { kind: "variant", variantId: "x" as VariantId } })).toBe("disagree");
  });
});

describe("decideChange", () => {
  test("applies a high-certainty low-risk add without a mark", () => {
    expect(decide(checked(add), "not_run")).toEqual({ kind: "applied" });
  });

  test("applies a high-certainty high-risk change only when the confirming reading agrees", () => {
    expect(decide(checked(setQuantity), "agree")).toEqual({ kind: "applied" });
    expect(decide(checked(setQuantity), "disagree")).toEqual({ kind: "doubtful", reason: quantitySet });
    expect(decide(checked(setQuantity), "not_run")).toEqual({ kind: "doubtful", reason: quantitySet });
  });

  test("never rates high a target taken from context, even with two agreeing readings", () => {
    const fromContext = checked(setQuantity, { ...sure, targetNamed: "context" });
    expect(isHighCertainty(fromContext.signals)).toBe(false);
    expect(decide(fromContext, "agree")).toEqual({ kind: "doubtful", reason: quantitySet });
  });

  test("rates a variant change high only with a change verb, a named item and a single candidate", () => {
    const withVerb = { ...sure, variantChangeVerb: "present" } as const;
    expect(isHighCertainty(withVerb)).toBe(true);
    expect(isHighCertainty({ ...withVerb, variantChangeVerb: "absent" })).toBe(false);
    expect(isHighCertainty({ ...withVerb, targetNamed: "context" })).toBe(false);
    expect(isHighCertainty({ ...withVerb, candidates: "several" })).toBe(false);
    expect(isHighCertainty({ ...withVerb, quotesComplete: false })).toBe(false);
  });

  test("rates set wording on the photo just sent high while what the photo left is unchanged", () => {
    const set = checked({ kind: "set_photo_item_quantity", orderId: "o" as never, variantId, expectedQuantity: 1 as PositiveInteger, quantity: 3, otherwise: add }, { ...sure, targetNamed: "photo_just_sent_set" });
    expect(isHighCertainty(set.signals)).toBe(true);
    expect(decide(set, "agree")).toEqual({ kind: "applied" });
    expect(decide(set, "not_run")).toEqual({ kind: "doubtful", reason: quantitySet });
  });

  test("rates add wording after the photo just sent at best doubtful", () => {
    const addWording = checked({ kind: "increase_quantity", target: { kind: "unnamed" }, quantity: 2 as PositiveInteger }, { ...sure, targetNamed: "context" }, { kind: "added_by_reference", quantity: 2 as PositiveInteger, quote: null });
    expect(decide(addWording, "agree")).toEqual({ kind: "doubtful", reason: { kind: "added_by_reference", quantity: 2, quote: null } });
  });

  test("turns a change with no single best reading into the urgent problem with its question", () => {
    const question = { language: "es", kind: "which_product", products: ["Polo", "Gorra"] } as const;
    const noBest = { ...checked(setQuantity, { ...sure, targetNamed: "context" }, null), urgent: { problem: "unclear_item", question } } as CheckedAction;
    expect(decide(noBest, "agree")).toEqual({ kind: "urgent", problem: "unclear_item", question });
  });

  test("marks the item added from a photo whose caption could not be read", () => {
    expect(decide(checked(add), "not_run", { captionUnread: true })).toEqual({ kind: "doubtful", reason: { kind: "caption_unread" } });
  });

  test("decides a payment request as urgent with the open order", () => {
    const payment: ResolvedChatAction = { kind: "report", outcome: { kind: "payment_requested", order: { kind: "none" }, productIds: [], unnamed: 0 } };
    expect(decide(checked(payment), "not_run")).toEqual({ kind: "urgent", problem: "payment_requested", question: null });
  });

  test("decides a report of no intent as silent and a pending creation as a pending", () => {
    expect(decide(checked({ kind: "report", outcome: { kind: "no_intent" } }), "not_run")).toEqual({ kind: "silent" });
    const draft: ResolvedChatAction = { kind: "draft_pending", draft: { subject: { kind: "variant", productId }, known: {}, quantity: 1, price: null, problem: "variant_missing", identification: null } };
    expect(decide(checked(draft), "not_run")).toEqual({ kind: "pending" });
  });

  test("applies a doubtful pending quantity change to the pending with its reason", () => {
    const grow = checked({ kind: "change_pending_quantity", pendingId: "p" as never, mode: "increase", quantity: 2, otherwise: add }, { ...sure, targetNamed: "context" });
    expect(decide(grow, "not_run")).toEqual({ kind: "doubtful", reason: quantitySet });
  });

  test("decides the same signals to the same decision", () => {
    const first = decide(checked(setQuantity), "agree");
    for (let run = 0; run < 3; run++) expect(decide(checked(setQuantity), "agree")).toEqual(first);
  });
});
