import { describe, expect, test } from "vitest";
import { applyChatActions, type ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import { catalog, id, limits, pendingOf, productId, t0, variantOf, type ProductKey } from "@core/src/features/orders/domain/chat-reading-fixtures";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import { checkRequests, type CheckItem, type CheckSnapshot } from "@core/src/features/orders/domain/reader/check-requests";
import { decideChange, riskOf } from "@core/src/features/orders/domain/reader/decide";
import { problemKinds, type ChangeDecision } from "@core/src/features/orders/domain/reader/decision";
import type { VerifiedRequest } from "@core/src/features/orders/domain/reader/quotes";
import type { ContextMessageRef, ExtractedRequest, ItemRef, PendingRef, ProductResolution, Quote, RequestRef } from "@core/src/features/orders/domain/reader/readings";

/** «Every current outcome under the new decisions» of the product document, one row per outcome. */
const say = (text: string): Quote => ({ source: "current", text });
const item = (key: ProductKey, attributes: Record<string, string>, quantity = 1): CheckItem => {
  const variant = variantOf(key, attributes);
  return { ref: "I1" as ItemRef, variantId: variant.variantId, productId: productId(key), productName: variant.productName, variantAttributes: variant.variantAttributes, quantity, unitPrice: variant.unitPrice };
};
const snapshot = (over: Partial<CheckSnapshot> = {}): CheckSnapshot => ({ messageKind: "text", language: "es", products: Object.values(catalog), items: [], pendings: [], order: "open",
  photoJustSent: null, lastPhoto: { kind: "none" }, contextProducts: new Map(), ...over });
const request = (over: Partial<ExtractedRequest>): VerifiedRequest => ({ complete: true,
  request: { request: "R1" as RequestRef, kind: "add", target: { kind: "none" }, values: [], quantity: null, price: null, changeVerb: null, ...over } });
const chosen = (key: ProductKey, values: { attribute: string; value: string }[] = []): ProductResolution =>
  ({ request: "R1" as RequestRef, kind: "chosen", productId: productId(key), values: values.map((entry) => ({ ...entry, quote: say(entry.value) })) });
const value = (text: string) => ({ attributeWords: null, valueWords: say(text) });
const named = (words: string) => ({ kind: "named", words: say(words) }) as const;
const onlyItem = { kind: "context", basis: "only_item", ref: "I1" as ItemRef } as const;
const polera = item("polera", { Talla: "L" });
const polo = item("polo", { Talla: "L", Color: "Negro" });

type Row = Readonly<{ outcome: string; requests: readonly VerifiedRequest[]; resolutions?: readonly ProductResolution[]; state?: Partial<CheckSnapshot>;
  agreement?: "agree" | "not_run"; expected: Partial<ChangeDecision> & Pick<ChangeDecision, "kind"> }>;

const rows: readonly Row[] = [
  { outcome: "added", requests: [request({ target: named("gorra"), values: [value("rojo")] })], resolutions: [chosen("gorra", [{ attribute: "Color", value: "Rojo" }])], expected: { kind: "applied" } },
  { outcome: "quantity changed (named item, two readings)", requests: [request({ kind: "change_quantity", target: { kind: "item", ref: "I1" as ItemRef, named: say("polera") }, quantity: { value: 3, mode: "set", quote: say("3") } })],
    state: { items: [polera] }, agreement: "agree", expected: { kind: "applied" } },
  { outcome: "quantity changed (from context)", requests: [request({ kind: "change_quantity", target: onlyItem, quantity: { value: 3, mode: "set", quote: say("3") } })],
    state: { items: [polera] }, agreement: "agree", expected: { kind: "doubtful" } },
  { outcome: "removed (named)", requests: [request({ kind: "remove", target: { kind: "item", ref: "I1" as ItemRef, named: say("polera") } })], state: { items: [polera, item("gorra", { Color: "Rojo" })] }, agreement: "agree", expected: { kind: "applied" } },
  { outcome: "variant changed (verb, named item)", requests: [request({ kind: "change_variant", target: { kind: "item", ref: "I1" as ItemRef, named: say("polera") }, values: [value("M")], changeVerb: say("cámbiala") })],
    state: { items: [polera] }, agreement: "agree", expected: { kind: "applied" } },
  { outcome: "mentioned price set", requests: [request({ kind: "mention_price", target: { kind: "item", ref: "I1" as ItemRef, named: say("polera") }, price: { amount: 70, currency: "order", basis: "unit", quote: say("70") } })],
    state: { items: [polera] }, expected: { kind: "applied" } },
  { outcome: "pending created, updated, completed, split", requests: [request({ kind: "complete_pending", target: { kind: "pending", ref: "Q1" as PendingRef, named: null }, values: [value("rojo")] })],
    state: { pendings: [{ ref: "Q1" as PendingRef, pending: pendingOf("gorra") }] }, expected: { kind: "pending" } },
  { outcome: "no_intent", requests: [request({ kind: "decline" })], expected: { kind: "silent" } },
  { outcome: "ready", requests: [request({ kind: "ready" })], expected: { kind: "applied" } },
  { outcome: "only_item_kept (last item removed by name)", requests: [request({ kind: "remove", target: { kind: "item", ref: "I1" as ItemRef, named: say("polera") } })], state: { items: [polera] }, agreement: "agree", expected: { kind: "applied" } },
  { outcome: "new_order_after_closed (an add needs no open order)", requests: [request({ target: named("gorra"), values: [value("rojo")] })], resolutions: [chosen("gorra", [{ attribute: "Color", value: "Rojo" }])],
    state: { order: "closed" }, expected: { kind: "applied" } },
  { outcome: "variant_missing", requests: [request({ target: named("polo") })], resolutions: [chosen("polo")], expected: { kind: "pending" } },
  { outcome: "not_clear", requests: [request({ target: named("polo") })], resolutions: [{ request: "R1" as RequestRef, kind: "between", productIds: [productId("polo"), productId("oversize")] }], expected: { kind: "pending" } },
  { outcome: "variant_not_available (added product)", requests: [request({ target: named("oversize"), values: [value("XXL")] })], resolutions: [chosen("oversize", [{ attribute: "Talla", value: "XXL" }])], expected: { kind: "pending" } },
  { outcome: "variant_not_available (item change)", requests: [request({ kind: "change_variant", target: { kind: "item", ref: "I1" as ItemRef, named: say("polera") }, values: [value("XL")], changeVerb: say("cámbiala") })],
    state: { items: [polera] }, agreement: "agree", expected: { kind: "urgent", problem: "variant_not_available" } },
  { outcome: "variant_for_several_pendings", requests: [request({ target: named("polo"), values: [value("M")] })], resolutions: [chosen("polo", [{ attribute: "Talla", value: "M" }])],
    state: { pendings: [{ ref: "Q1" as PendingRef, pending: pendingOf("polo", { n: 1 }) }, { ref: "Q2" as PendingRef, pending: pendingOf("polo", { n: 2 }) }] }, expected: { kind: "urgent", problem: "variant_for_several_pendings" } },
  { outcome: "variant_only, one item it fits", requests: [request({ kind: "change_variant", target: onlyItem, values: [value("M")] })], state: { items: [polera] }, agreement: "agree", expected: { kind: "doubtful" } },
  { outcome: "variant_only, several items", requests: [request({ kind: "change_variant", values: [value("M")] })], state: { items: [polera, polo] }, expected: { kind: "urgent", problem: "variant_only" } },
  { outcome: "variant_only, the photo guard not passed", requests: [request({ kind: "change_variant", target: onlyItem, values: [value("M")] })], state: { items: [polera], lastPhoto: { kind: "not_identified" } }, expected: { kind: "urgent", problem: "variant_only" } },
  { outcome: "unnamed_add, a single product in context", requests: [request({ target: { kind: "context", basis: "mentioned_product", ref: "M1" as ContextMessageRef }, quantity: { value: 1, mode: "add", quote: say("otro") } })],
    state: { items: [polo], contextProducts: new Map([["M1" as ContextMessageRef, [productId("polo")]]]) }, agreement: "agree", expected: { kind: "doubtful" } },
  { outcome: "unnamed_add, otherwise", requests: [request({ target: { kind: "none" } })], expected: { kind: "urgent", problem: "unnamed_add" } },
  { outcome: "quantity for the photo just sent, set wording on its pending", requests: [request({ kind: "change_quantity", target: { kind: "photo_just_sent" }, quantity: { value: 3, mode: "set", quote: say("3") } })],
    state: { pendings: [{ ref: "Q1" as PendingRef, pending: pendingOf("gorra") }], photoJustSent: { kind: "pending", pendingId: pendingOf("gorra").id } }, expected: { kind: "pending" } },
  { outcome: "quantity for the photo just sent, add wording", requests: [request({ kind: "change_quantity", target: { kind: "photo_just_sent" }, quantity: { value: 2, mode: "add", quote: say("2 más") } })],
    state: { pendings: [{ ref: "Q1" as PendingRef, pending: pendingOf("gorra") }], photoJustSent: { kind: "pending", pendingId: pendingOf("gorra").id } }, agreement: "agree", expected: { kind: "doubtful" } },
  { outcome: "variant_only, completing the pending it fits", requests: [request({ kind: "complete_pending", target: { kind: "pending", ref: "Q1" as PendingRef, named: null }, values: [value("L")] })],
    state: { pendings: [{ ref: "Q1" as PendingRef, pending: pendingOf("polera") }] }, expected: { kind: "pending" } },
  { outcome: "variant_only, a value the item's product does not sell", requests: [request({ kind: "change_variant", target: onlyItem, values: [value("XL")] })], state: { items: [polera] }, agreement: "agree",
    expected: { kind: "urgent", problem: "variant_not_available" } },
  { outcome: "quantity for the photo just sent, set wording on the item the photo left", requests: [request({ kind: "change_quantity", target: { kind: "photo_just_sent" }, quantity: { value: 3, mode: "set", quote: say("3") } })],
    state: { items: [polera], photoJustSent: { kind: "item", orderId: id(1) as OrderId, variantId: polera.variantId, quantity: 1 as PositiveInteger } }, agreement: "agree", expected: { kind: "applied" } },
  { outcome: "invalid_action, quantity below zero", requests: [request({ kind: "change_quantity", target: onlyItem, quantity: { value: -1, mode: "set", quote: say("-1") } })], state: { items: [polera] }, expected: { kind: "urgent", problem: "invalid_action" } },
  { outcome: "invalid_action, not the shown product", requests: [request({ target: named("gorra") })], resolutions: [chosen("gorra")], state: { messageKind: "photo_product" }, expected: { kind: "urgent", problem: "invalid_action" } },
  { outcome: "unclear_item, a named item the order does not hold", requests: [request({ kind: "remove", target: named("gorra") })], resolutions: [chosen("gorra")], state: { items: [polera] }, agreement: "agree",
    expected: { kind: "urgent", problem: "unclear_item" } },
  { outcome: "unclear_item, a single best reading", requests: [request({ kind: "remove", target: onlyItem })], state: { items: [polera] }, agreement: "agree", expected: { kind: "doubtful" } },
  { outcome: "unclear_item, two items", requests: [request({ kind: "remove" })], state: { items: [polera, item("gorra", { Color: "Rojo" })] }, expected: { kind: "urgent", problem: "unclear_item" } },
  { outcome: "not_identified", requests: [request({ target: named("zapatos") })], resolutions: [{ request: "R1" as RequestRef, kind: "none" }], expected: { kind: "urgent", problem: "not_identified" } },
  { outcome: "product_not_available", requests: [request({ target: named("gorra") })], resolutions: [chosen("gorra")],
    state: { products: Object.values(catalog).map((product) => (product.productId === productId("gorra") ? { ...product, sellable: false } : product)) }, expected: { kind: "urgent", problem: "product_not_available" } },
  { outcome: "payment request", requests: [request({ kind: "payment_request" })], expected: { kind: "urgent", problem: "payment_requested" } },
  { outcome: "request_not_allowed", requests: [request({ kind: "not_allowed" })], expected: { kind: "urgent", problem: "request_not_allowed" } },
  { outcome: "order_closed", requests: [request({ kind: "remove" })], state: { order: "closed" }, expected: { kind: "urgent", problem: "order_closed" } },
  { outcome: "no_open_order", requests: [request({ kind: "remove" })], state: { order: "none" }, expected: { kind: "urgent", problem: "no_open_order" } },
  { outcome: "image_with_request", requests: [request({ target: named("polo") })], state: { messageKind: "photo_not_product" }, expected: { kind: "urgent", problem: "image_with_request" } },
  { outcome: "invalid_action, quantity not whole", requests: [request({ kind: "change_quantity", target: onlyItem, quantity: { value: 1.5, mode: "set", quote: say("1.5") } })], state: { items: [polera] }, expected: { kind: "urgent", problem: "invalid_action" } },
];

describe("every current outcome under the new decisions", () => {
  test.each(rows)("decides $outcome", ({ requests, resolutions = [], state = {}, agreement = "not_run", expected }) => {
    const checked = checkRequests(requests, resolutions, snapshot(state));
    expect(checked.length).toBeGreaterThan(0);
    const decisions = checked.map((entry) => decideChange(entry, riskOf(entry.action, entry.signals), agreement, { captionUnread: false }));
    expect(decisions[0]).toMatchObject(expected);
  });

  test("decides caption_not_applied as a doubtful mark on the added item, with no notice", () => {
    const [entry] = checkRequests([request({ target: named("gorra"), values: [value("rojo")] })], [chosen("gorra", [{ attribute: "Color", value: "Rojo" }])], snapshot());
    expect(decideChange(entry!, "low", "not_run", { captionUnread: true })).toEqual({ kind: "doubtful", reason: { kind: "caption_unread" } });
  });

  test("decides not_identified as silent while the catalog is not ready", () => {
    const entry = { request: "R1" as RequestRef, action: { kind: "report", outcome: { kind: "not_identified", source: "text", identification: null, silent: true } } satisfies ResolvedChatAction,
      signals: { quotesComplete: true, targetNamed: "named", variantChangeVerb: "not_applicable", candidates: "single" } as const, doubt: null, urgent: null, blocked: null };
    expect(decideChange(entry, "low", "not_run", { captionUnread: false })).toEqual({ kind: "silent" });
  });

  test("decides reader_doubt as urgent", () => {
    const entry = { request: "R1" as RequestRef, action: { kind: "report", outcome: { kind: "reader_doubt", orderId: null } } satisfies ResolvedChatAction,
      signals: { quotesComplete: true, targetNamed: "named", variantChangeVerb: "not_applicable", candidates: "single" } as const, doubt: null, urgent: null, blocked: null };
    expect(decideChange(entry, "low", "not_run", { captionUnread: false })).toEqual({ kind: "urgent", problem: "reader_doubt", question: null });
  });

  describe("outcomes the order domain produces while applying", () => {
    const ids = { newOrderId: () => id(900) as OrderId, newItemId: () => id(901) as OrderItemId, newPendingId: () => id(902) as ChatPendingId };
    const seed = { number: 1023 as OrderNumber, companyId: id(2) as CompanyId, sellerId: "seller" as UserId, chatId: id(50) as ChatId, contactId: id(60) as ContactId, messageId: id(70) as ChatMessageId };
    const none = { kind: "none" } as const;

    test("names quantity_above_limit and ready_with_pendings as urgent problems", () => {
      const variant = variantOf("gorra", { Color: "Rojo" });
      const add: ResolvedChatAction = { kind: "add", item: { ...variant, sku: null }, quantity: 5 as PositiveInteger, mentionedPrice: null, identification: { method: "text", productId: productId("gorra"), confidence: null } };
      const above = applyChatActions(none, { pendings: [], readyRemembered: false }, [add], ids, t0, { maxItemQuantity: 2 as PositiveInteger }, seed);
      expect(above.success && above.data.outcomes.map((outcome) => outcome.kind)).toEqual(["quantity_above_limit"]);
      const waiting = applyChatActions(none, { pendings: [pendingOf("gorra")], readyRemembered: false }, [{ kind: "ready" }], ids, t0, limits, seed);
      expect(waiting.success && waiting.data.outcomes.map((outcome) => outcome.kind)).toEqual(["ready_with_pendings"]);
      expect(problemKinds).toEqual(expect.arrayContaining(["quantity_above_limit", "ready_with_pendings"]));
    });
  });
});
