import { describe, expect, test } from "vitest";
import type { ChatOrderCatalogItem, ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import { decideChanges } from "@core/src/features/orders/domain/reader/decide-changes";
import type { CheckedAction } from "@core/src/features/orders/domain/reader/decide";
import type { CertaintySignals, DoubtReason } from "@core/src/features/orders/domain/reader/decision";
import type { RequestRef } from "@core/src/features/orders/domain/reader/refs";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const sure: CertaintySignals = { quotesComplete: true, targetNamed: "named", variantChangeVerb: "not_applicable", candidates: "single" };
const loose: CertaintySignals = { ...sure, targetNamed: "context" };
const variantL = "00000000-0000-4000-8000-0000000000a1" as VariantId;
const variantM = "00000000-0000-4000-8000-0000000000a2" as VariantId;
const productId = "00000000-0000-4000-8000-000000000021" as ProductId;
const item = (variantId: VariantId): ChatOrderCatalogItem => ({ variantId, productName: "Polera gris", variantAttributes: {}, sku: null, unitPrice: { amount: 35, currency: "PEN" } });
const add = (variantId: VariantId): ResolvedChatAction => ({ kind: "add", item: item(variantId), quantity: 1 as PositiveInteger, mentionedPrice: null, identification: { method: "text", productId, confidence: null } });
const changeVariant: ResolvedChatAction = { kind: "change_variant", target: { kind: "variant", variantId: variantL }, to: { kind: "resolved", item: item(variantM) }, mentionedPrice: null };
const doubt: DoubtReason = { kind: "variant_changed", attribute: "Talla", from: "L", to: "M" };
const question: SuggestedQuestion = { language: "es", kind: "which_product", products: ["Polera gris", "Polera negra"] };
const checked = (action: ResolvedChatAction, signals: CertaintySignals = sure, over: Partial<CheckedAction> = {}, request = "R1"): CheckedAction =>
  ({ request: request as RequestRef, action, signals, doubt: null, urgent: null, blocked: null, ...over });
const guards = { captionUnread: false };

describe("decideChanges", () => {
  test("applies a high-certainty low-risk add as it is", () => {
    const result = decideChanges([checked(add(variantL))], null, guards);

    expect(result.decided.map(({ decision }) => decision.kind)).toEqual(["applied"]);
    expect(result.actions).toEqual([add(variantL)]);
    expect(result.doubtful.size).toBe(0);
  });

  test("applies a doubtful variant change and records its doubt on both variants it touches", () => {
    const result = decideChanges([checked(changeVariant, loose, { doubt })], null, guards);

    expect(result.decided[0]!.decision).toEqual({ kind: "doubtful", reason: doubt });
    expect(result.actions).toEqual([changeVariant]);
    expect([...result.doubtful.keys()].sort()).toEqual([variantL, variantM]);
    expect(result.doubtful.get(variantM)).toEqual({ kind: "doubtful", reason: doubt });
  });

  test("applies a high-certainty high-risk change only when the confirming chain agrees", () => {
    const change = checked(changeVariant);

    expect(decideChanges([change], [checked(changeVariant)], guards).decided[0]!.decision.kind).toBe("applied");
    expect(decideChanges([{ ...change, doubt }], [checked(add(variantM))], guards).decided[0]!).toMatchObject({ agreement: "disagree", decision: { kind: "doubtful" } });
    expect(decideChanges([{ ...change, doubt }], null, guards).decided[0]!).toMatchObject({ agreement: "not_run", decision: { kind: "doubtful" } });
  });

  test("turns an action without a single best reading into a reader_doubt report with its question", () => {
    const result = decideChanges([checked(changeVariant, loose, { urgent: { problem: "reader_doubt", question } })], null, guards);

    expect(result.decided[0]!.decision).toEqual({ kind: "urgent", problem: "reader_doubt", question });
    expect(result.actions).toEqual([{ kind: "report", outcome: { kind: "reader_doubt", orderId: null } }]);
    expect(result.questions).toEqual([question]);
  });

  test("keeps the report a check already produced and collects its question once", () => {
    const report: ResolvedChatAction = { kind: "report", outcome: { kind: "variant_only" } };
    const result = decideChanges([checked(report, loose, { urgent: { problem: "variant_only", question } })], null, guards);

    expect(result.actions).toEqual([report]);
    expect(result.questions).toEqual([question]);
  });

  test("decides the same checked actions the same way every time", () => {
    const run = () => decideChanges([checked(add(variantL)), checked(changeVariant, loose, { doubt }, "R2")], null, guards);

    expect(run()).toEqual(run());
  });

  test("marks an add whose caption could not be read as doubtful", () => {
    const result = decideChanges([checked(add(variantL))], null, { captionUnread: true });

    expect(result.decided[0]!.decision).toEqual({ kind: "doubtful", reason: { kind: "caption_unread" } });
    expect(result.doubtful.get(variantL)).toEqual({ kind: "doubtful", reason: { kind: "caption_unread" } });
  });

  describe("a quantity on a pending", () => {
    const pendingId = "00000000-0000-4000-8000-0000000000b1" as ChatPendingId;
    const set3: ResolvedChatAction = { kind: "change_pending_quantity", pendingId, mode: "set", quantity: 3, price: null, otherwise: { kind: "report", outcome: { kind: "no_intent" } } };
    const add3: ResolvedChatAction = { ...set3, mode: "increase" };
    const quantityDoubt: DoubtReason = { kind: "quantity_set", quantity: 3 as PositiveInteger };

    test("stays silent when the confirming reading says the same or did not run", () => {
      expect(decideChanges([checked(set3, sure, { doubt: quantityDoubt })], null, guards).decided[0]!.decision).toEqual({ kind: "pending" });
      expect(decideChanges([checked(set3, sure, { doubt: quantityDoubt })], [checked(set3)], guards).decided[0]!.decision).toEqual({ kind: "pending" });
    });

    test("becomes «Con duda» on the pending when the confirming reading reads another mode, and the pending keeps the doubt", () => {
      const result = decideChanges([checked(add3, sure, { doubt: quantityDoubt })], [checked(set3)], guards);

      expect(result.decided[0]!.decision).toEqual({ kind: "doubtful", reason: quantityDoubt });
      expect(result.pendingDoubts.get(pendingId)).toEqual({ kind: "doubtful", reason: quantityDoubt });
    });

    test("becomes «Con duda» when the confirming reading has no action for the request", () => {
      expect(decideChanges([checked(set3, sure, { doubt: quantityDoubt })], [], guards).decided[0]!.decision).toEqual({ kind: "doubtful", reason: quantityDoubt });
    });

    test("compares the quantity of an answer with a number, and ignores an answer with none", () => {
      const answer = (quantity: number | null): ResolvedChatAction => ({ kind: "advance_pending", request: { pendingId, mode: "assign", product: null, productId: "00000000-0000-4000-8000-000000000021" as ProductId,
        identification: { method: "text", productId: "00000000-0000-4000-8000-000000000021" as ProductId, confidence: null }, values: [], quantity, price: null }, otherwise: { kind: "report", outcome: { kind: "no_intent" } } } as unknown as ResolvedChatAction);
      expect(decideChanges([checked(answer(2), sure, { doubt: quantityDoubt })], [checked(answer(3))], guards).decided[0]!.decision.kind).toBe("doubtful");
      expect(decideChanges([checked(answer(2), sure, { doubt: quantityDoubt })], [checked(answer(2))], guards).decided[0]!.decision.kind).toBe("pending");
      expect(decideChanges([checked(answer(null))], [checked(answer(3))], guards).decided[0]!.decision.kind).toBe("pending");
    });
  });
});
