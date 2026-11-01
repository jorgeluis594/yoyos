import { describe, expect, test } from "vitest";
import { catalog, pendingOf, productId, variantOf, type ProductKey } from "@core/src/features/orders/domain/chat-reading-fixtures";
import type { OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ChatPending } from "@core/src/features/orders/domain/chat-pendings";
import { checkRequests, checkShownPhoto, type CheckItem, type CheckSnapshot, type CheckedAction } from "@core/src/features/orders/domain/reader/check-requests";
import { agreementOf, decideChange, riskOfChecked } from "@core/src/features/orders/domain/reader/decide";
import type { ContextMessageRef, ExtractedRequest, ItemRef, PendingRef, ProductResolution, Quote, RequestRef } from "@core/src/features/orders/domain/reader/readings";
import type { VerifiedRequest } from "@core/src/features/orders/domain/reader/quotes";
import { lostRequests } from "@core/src/features/orders/domain/reader/silent-guards";

const say = (text: string): Quote => ({ source: "current", text });
const item = (ref: string, key: ProductKey, attributes: Record<string, string>, quantity = 1): CheckItem => {
  const variant = variantOf(key, attributes);
  return { ref: ref as ItemRef, variantId: variant.variantId, productId: productId(key), productName: variant.productName, variantAttributes: variant.variantAttributes, quantity, unitPrice: variant.unitPrice };
};
const snapshot = (over: Partial<CheckSnapshot> = {}): CheckSnapshot => ({ messageKind: "text", language: "es", products: Object.values(catalog), items: [], pendings: [], order: "open",
  photoJustSent: null, lastPhoto: { kind: "none" }, contextProducts: new Map(), ...over });
const request = (over: Partial<ExtractedRequest>): VerifiedRequest => ({ complete: true,
  request: { request: "R1" as RequestRef, kind: "add", target: { kind: "none" }, values: [], quantity: null, price: null, changeVerb: null, ...over } });
const quantity = (value: number, mode: "add" | "set" | "decrease") => ({ value, mode, quote: say("x") });
const value = (text: string) => ({ attributeWords: null, valueWords: say(text) });
const chosen = (key: ProductKey, values: { attribute: string; value: string }[] = []): ProductResolution =>
  ({ request: "R1" as RequestRef, kind: "chosen", productId: productId(key), values: values.map((entry) => ({ ...entry, quote: say(entry.value) })) });
const pendingRef = (n: number, pending: ChatPending) => ({ ref: `Q${n}` as PendingRef, pending });
const only = (checked: readonly CheckedAction[]): CheckedAction => {
  expect(checked).toHaveLength(1);
  return checked[0]!;
};
const decision = (checked: CheckedAction, agreement: "agree" | "disagree" | "not_run" = "not_run", captionUnread = false) =>
  decideChange(checked, riskOfChecked(checked), agreement, { captionUnread });

describe("checkRequests: items", () => {
  const polera = item("I1", "polera", { Talla: "L" });

  test("marks «la quiero en M» on the only fitting item as doubtful with the variant reason", () => {
    const checked = only(checkRequests([request({ kind: "change_variant", target: { kind: "context", basis: "only_item", ref: "I1" as ItemRef }, values: [value("M")] })], [], snapshot({ items: [polera] })));
    expect(checked.action).toMatchObject({ kind: "change_variant", to: { kind: "resolved", item: { variantId: variantOf("polera", { Talla: "M" }).variantId } } });
    expect(checked.signals).toMatchObject({ targetNamed: "context", variantChangeVerb: "absent", candidates: "single" });
    expect(decision(checked, "agree")).toEqual({ kind: "doubtful", reason: { kind: "variant_changed", attribute: "Talla", from: "L", to: "M" } });
  });

  test("keeps a variant-only text off an item the last photo is not about and makes it urgent with the which-product question", () => {
    const text = request({ kind: "change_variant", target: { kind: "context", basis: "only_item", ref: "I1" as ItemRef }, values: [value("M")] });
    for (const lastPhoto of [{ kind: "not_identified" }, { kind: "product", productId: productId("polo"), added: false }] as const) {
      const checked = only(checkRequests([text], [], snapshot({ items: [polera], lastPhoto })));
      expect(checked.action).toEqual({ kind: "report", outcome: { kind: "variant_only" } });
      expect(decision(checked, "agree")).toEqual({ kind: "urgent", problem: "variant_only", question: { language: "es", kind: "which_product_for_value", value: "M", products: ["Polera con capucha"] } });
    }
    const aboutIt = only(checkRequests([text], [], snapshot({ items: [polera], lastPhoto: { kind: "product", productId: productId("polera"), added: true } })));
    expect(aboutIt.action.kind).toBe("change_variant");
  });

  test("asks which item the value is for when several items fit a variant-only text", () => {
    const checked = only(checkRequests([request({ kind: "change_variant", target: { kind: "none" }, values: [value("M")] })], [], snapshot({ items: [polera, item("I2", "polo", { Talla: "L", Color: "Negro" })] })));
    expect(decision(checked)).toEqual({ kind: "urgent", problem: "variant_only", question: { language: "es", kind: "variant_for_which", attribute: "Talla", value: "M", products: ["Polera con capucha", "Polo básico"] } });
  });

  test("rates a variant change high only with a change verb, a named item and a single candidate", () => {
    const named = request({ kind: "change_variant", target: { kind: "item", ref: "I1" as ItemRef, named: say("la polera") }, values: [value("M")], changeVerb: say("cámbiala") });
    const checked = only(checkRequests([named], [chosen("polera")], snapshot({ items: [polera] })));
    expect(checked.signals).toEqual({ quotesComplete: true, targetNamed: "named", variantChangeVerb: "present", candidates: "single" });
    expect(decision(checked, "agree")).toEqual({ kind: "applied" });
    expect(decision(checked, "not_run").kind).toBe("doubtful");
  });

  test("turns a variant the product does not sell into the urgent unavailable problem with its question", () => {
    const checked = only(checkRequests([request({ kind: "change_variant", target: { kind: "item", ref: "I1" as ItemRef, named: say("la polera") }, values: [value("XL")], changeVerb: say("cámbiala") })], [], snapshot({ items: [polera] })));
    expect(decision(checked, "agree")).toEqual({ kind: "urgent", problem: "variant_not_available", question: { language: "es", kind: "variant_unavailable", product: "Polera con capucha", asked: "XL", attribute: "Talla", values: ["M", "L"] } });
  });

  test("turns «otro igual» with one product in context into a doubtful add and with two into urgent", () => {
    const polo = item("I1", "polo", { Talla: "M", Color: "Negro" });
    const target = { kind: "context", basis: "mentioned_product", ref: "M1" as ContextMessageRef } as const;
    const again = request({ kind: "add", target, quantity: quantity(1, "add") });
    const one = only(checkRequests([again], [], snapshot({ items: [polo], contextProducts: new Map([["M1" as ContextMessageRef, [productId("polo")]]]) })));
    expect(one.action).toMatchObject({ kind: "increase_quantity", target: { kind: "variant", variantId: polo.variantId } });
    expect(decision(one, "agree")).toEqual({ kind: "doubtful", reason: { kind: "added_by_reference", quantity: 1, quote: null } });
    const two = only(checkRequests([again], [], snapshot({ items: [polo], contextProducts: new Map([["M1" as ContextMessageRef, [productId("polo"), productId("gorra")]]]) })));
    expect(decision(two, "agree")).toEqual({ kind: "urgent", problem: "unnamed_add", question: { language: "es", kind: "another_of_which" } });
  });

  test("turns «quítalo» on the only item into a doubtful removal and with two items into urgent", () => {
    const remove = request({ kind: "remove", target: { kind: "context", basis: "only_item", ref: "I1" as ItemRef } });
    const checked = only(checkRequests([remove], [], snapshot({ items: [polera] })));
    expect(decision(checked, "agree")).toEqual({ kind: "doubtful", reason: { kind: "removed", product: "Polera con capucha" } });
    const gorra = item("I2", "gorra", { Color: "Rojo" });
    const unnamed = only(checkRequests([request({ kind: "remove", target: { kind: "none" } })], [], snapshot({ items: [polera, gorra] })));
    expect(decision(unnamed, "agree")).toEqual({ kind: "urgent", problem: "unclear_item", question: { language: "es", kind: "which_item_to_remove", products: ["Polera con capucha", "Gorra trucker"] } });
  });

  test("lowers a named item with the quantity doubt as the reason when only context names it", () => {
    const set = request({ kind: "change_quantity", target: { kind: "context", basis: "only_item", ref: "I1" as ItemRef }, quantity: quantity(3, "set") });
    const checked = only(checkRequests([set], [], snapshot({ items: [polera] })));
    expect(checked.action).toEqual({ kind: "set_quantity", target: { kind: "variant", variantId: polera.variantId }, quantity: 3 });
    expect(decision(checked, "agree")).toEqual({ kind: "doubtful", reason: { kind: "quantity_set", quantity: 3 } });
  });

  test("blocks an item change when the chat has no open order", () => {
    const checked = only(checkRequests([request({ kind: "remove", target: { kind: "none" } })], [], snapshot({ order: "closed" })));
    expect(decision(checked)).toEqual({ kind: "urgent", problem: "order_closed", question: null });
    expect(decision(only(checkRequests([request({ kind: "remove", target: { kind: "none" } })], [], snapshot({ order: "none" }))))).toEqual({ kind: "urgent", problem: "no_open_order", question: null });
  });
});

describe("checkRequests: adds and prices", () => {
  test("keeps a mentioned price in the order's currency on the added item", () => {
    const price = { amount: 55, currency: "order", basis: "unit", quote: say("de 55") } as const;
    const checked = only(checkRequests([request({ target: { kind: "named", words: say("polo") }, values: [value("L"), value("blanco")], price })],
      [chosen("polo", [{ attribute: "Talla", value: "L" }, { attribute: "Color", value: "Blanco" }])], snapshot()));
    expect(checked.action).toMatchObject({ kind: "add", quantity: 1, mentionedPrice: { amount: { amount: 55, currency: "PEN" }, units: 1 } });
    expect(decision(checked)).toEqual({ kind: "applied" });
  });

  test("ignores a price in another currency without blocking the add", () => {
    const price = { amount: 55, currency: "other", basis: "unit", quote: say("55") } as const;
    const checked = only(checkRequests([request({ target: { kind: "named", words: say("gorra") }, values: [value("rojo")], price })], [chosen("gorra", [{ attribute: "Color", value: "Rojo" }])], snapshot()));
    expect(checked.action).toMatchObject({ kind: "add", mentionedPrice: null });
  });

  test("makes a product without its variant a pending and between two products a doubtful pending", () => {
    const missing = only(checkRequests([request({ target: { kind: "named", words: say("polo") } })], [chosen("polo")], snapshot()));
    expect(decision(missing)).toEqual({ kind: "pending" });
    expect(missing.urgent).toMatchObject({ problem: "variant_missing", question: { kind: "which_variant", product: "Polo básico", attribute: "Talla", values: ["M", "L"] } });
    const between = only(checkRequests([request({ target: { kind: "named", words: say("polo") } })],
      [{ request: "R1" as RequestRef, kind: "between", productIds: [productId("polo"), productId("oversize")] }], snapshot()));
    expect(between.action).toMatchObject({ kind: "draft_pending", draft: { subject: { kind: "product" } } });
    expect(between.signals.candidates).toBe("several");
    expect(between.urgent).toMatchObject({ problem: "not_clear", question: { kind: "which_product", products: ["Polo básico", "Polo oversize"] } });
  });

  test("reports a named product the resolution did not find as not identified", () => {
    const checked = only(checkRequests([request({ target: { kind: "named", words: say("zapatos") } })], [{ request: "R1" as RequestRef, kind: "none" }], snapshot()));
    expect(checked.action).toMatchObject({ kind: "report", outcome: { kind: "not_identified", source: "text" } });
  });

  test("adds every product a photo in the same message shows, named by the photo", () => {
    const shown = Object.values(catalog).map((product) => (product.productId === productId("gorra") ? { ...product, shown: true, shownVariantId: variantOf("gorra", { Color: "Rojo" }).variantId } : product));
    const checked = only(checkRequests([request({ target: { kind: "photo_same_message" } })], [], snapshot({ messageKind: "photo_product", products: shown })));
    expect(checked.signals.targetNamed).toBe("photo_same_message");
    expect(checked.action).toMatchObject({ kind: "add", item: { variantId: variantOf("gorra", { Color: "Rojo" }).variantId } });
  });

  test("lets a caption naming another product complete that product's pending and keeps reporting it when there is none", () => {
    const shown = Object.values(catalog).map((product) => (product.productId === productId("gorra") ? { ...product, shown: true, shownVariantId: variantOf("gorra", { Color: "Rojo" }).variantId } : product));
    const naming = request({ target: { kind: "named", words: say("la polera") }, values: [value("M")] });
    const resolution = chosen("polera", [{ attribute: "Talla", value: "M" }]);
    const without = only(checkRequests([naming], [resolution], snapshot({ messageKind: "photo_product", products: shown })));
    expect(without.action).toEqual({ kind: "report", outcome: { kind: "invalid_action", orderId: null, reason: "not_the_shown_product" } });
    const completes = only(checkRequests([naming], [resolution], snapshot({ messageKind: "photo_product", products: shown, pendings: [pendingRef(1, pendingOf("polera"))] })));
    expect(completes.action.kind).toBe("advance_pending");
    expect(completes.action).toMatchObject({ otherwise: { kind: "report", outcome: { kind: "invalid_action", reason: "not_the_shown_product" } } });
  });

  test("applies a quantity of a photo message to the shown product, not to an order line of another product", () => {
    const shown = Object.values(catalog).map((product) => (product.productId === productId("gorra") ? { ...product, shown: true, shownVariantId: variantOf("gorra", { Color: "Rojo" }).variantId } : product));
    const total = request({ kind: "change_quantity", target: { kind: "item", ref: "I1" as ItemRef, named: null }, quantity: quantity(3, "set") });
    const checked = only(checkRequests([total], [], snapshot({ messageKind: "photo_product", products: shown, items: [item("I1", "polera", { Talla: "L" })] })));
    expect(checked.action).toMatchObject({ kind: "add", quantity: 3, item: { variantId: variantOf("gorra", { Color: "Rojo" }).variantId } });
    const ofSameProduct = only(checkRequests([total], [], snapshot({ messageKind: "photo_product", products: shown, items: [item("I1", "gorra", { Color: "Rojo" })] })));
    expect(ofSameProduct.action.kind).toBe("set_quantity");
  });

  test("adds the shown product only when no request speaks about it", () => {
    const shown = Object.values(catalog).map((product) => (product.productId === productId("gorra") ? { ...product, shown: true, shownVariantId: variantOf("gorra", { Color: "Rojo" }).variantId } : product));
    const photo = snapshot({ messageKind: "photo_product", products: shown });
    expect(checkShownPhoto(photo, [request({ kind: "payment_request" }), request({ kind: "ready" })], []).map((entry) => entry.action.kind)).toEqual(["add"]);
    expect(checkShownPhoto(photo, [request({ kind: "payment_request" }), request({ kind: "decline", target: { kind: "photo_same_message" } })], [])).toEqual([]);
    expect(checkShownPhoto(snapshot({ products: shown }), [], [])).toEqual([]);
  });

  test("still adds the shown product when a remove, a decline or a named quantity points at another line or pending", () => {
    const shown = Object.values(catalog).map((product) => (product.productId === productId("gorra") ? { ...product, shown: true, shownVariantId: variantOf("gorra", { Color: "Rojo" }).variantId } : product));
    const photo = snapshot({ messageKind: "photo_product", products: shown, items: [item("I1", "polera", { Talla: "L" })], pendings: [pendingRef(1, pendingOf("polera"))] });
    const removeOther = request({ kind: "remove", target: { kind: "item", ref: "I1" as ItemRef, named: say("la polera") } });
    const declineOther = request({ kind: "decline", target: { kind: "pending", ref: "Q1" as PendingRef, named: null } });
    const namedOther = request({ kind: "change_quantity", target: { kind: "named", words: say("la polera") }, quantity: quantity(2, "set") });
    const resolutions = [chosen("polera", [])];
    for (const other of [removeOther, declineOther, namedOther]) expect(checkShownPhoto(photo, [other], resolutions).map((entry) => entry.action.kind)).toEqual(["add"]);
    const removeShown = request({ kind: "remove", target: { kind: "named", words: say("la gorra") } });
    expect(checkShownPhoto(photo, [removeShown], [chosen("gorra", [])])).toEqual([]);
  });

  test("retargets a quantity aimed at another product to the single line of the shown product instead of adding to it", () => {
    const shown = Object.values(catalog).map((product) => (product.productId === productId("gorra") ? { ...product, shown: true, shownVariantId: variantOf("gorra", { Color: "Rojo" }).variantId } : product));
    const total = request({ kind: "change_quantity", target: { kind: "item", ref: "I1" as ItemRef, named: null }, quantity: quantity(3, "set") });
    const items = [item("I1", "polera", { Talla: "L" }), item("I2", "gorra", { Color: "Rojo" })];
    const checked = only(checkRequests([total], [], snapshot({ messageKind: "photo_product", products: shown, items })));
    expect(checked.action).toMatchObject({ kind: "set_quantity", quantity: 3 });
    expect(checkShownPhoto(snapshot({ messageKind: "photo_product", products: shown, items }), [total], [])).toEqual([]);
  });

  test("answers a request a photo that is not a product made with the image-with-request problem once", () => {
    const checked = checkRequests([request({ target: { kind: "named", words: say("polo") } }), request({ kind: "remove", target: { kind: "none" } })], [], snapshot({ messageKind: "photo_not_product" }));
    expect(checked.map((entry) => entry.action)).toEqual([{ kind: "report", outcome: { kind: "image_with_request" } }]);
  });
});

describe("checkRequests: the photo just sent", () => {
  const gorraPending = pendingOf("gorra");
  const left = { kind: "pending", pendingId: gorraPending.id } as const;
  const set = request({ kind: "change_quantity", target: { kind: "photo_just_sent" }, quantity: quantity(3, "set") });
  const grow = request({ kind: "change_quantity", target: { kind: "photo_just_sent" }, quantity: quantity(2, "add") });

  test("rates set wording on the photo just sent high while what the photo left is unchanged", () => {
    const checked = only(checkRequests([set], [], snapshot({ pendings: [pendingRef(1, gorraPending)], photoJustSent: left })));
    expect(checked.action).toMatchObject({ kind: "change_pending_quantity", pendingId: gorraPending.id, mode: "set", quantity: 3 });
    expect(checked.signals.targetNamed).toBe("photo_just_sent_set");
    expect(decision(checked)).toEqual({ kind: "pending" });
    const onItem = item("I1", "gorra", { Color: "Rojo" });
    const photoItem = { kind: "item", orderId: "00000000-0000-4000-8000-000000000001" as OrderId, variantId: onItem.variantId, quantity: 1 as PositiveInteger } as const;
    const checkedItem = only(checkRequests([request({ kind: "change_quantity", target: { kind: "photo_just_sent" }, quantity: quantity(3, "set") })], [], snapshot({ items: [onItem], photoJustSent: photoItem })));
    expect(checkedItem.action).toMatchObject({ kind: "set_photo_item_quantity", variantId: onItem.variantId, expectedQuantity: 1, quantity: 3 });
    expect(decision(checkedItem, "agree")).toEqual({ kind: "applied" });
    expect(decision(checkedItem, "not_run")).toEqual({ kind: "doubtful", reason: { kind: "quantity_set", quantity: 3 } });
  });

  test("rates add wording after the photo just sent at best doubtful", () => {
    const checked = only(checkRequests([grow], [], snapshot({ pendings: [pendingRef(1, gorraPending)], photoJustSent: left })));
    expect(checked.action).toMatchObject({ kind: "change_pending_quantity", mode: "increase", quantity: 2 });
    expect(decision(checked, "agree")).toEqual({ kind: "doubtful", reason: { kind: "quantity_set", quantity: 3 } });
  });

  test("falls back to the context target when a read text came between the photo and the quantity", () => {
    const onItem = item("I1", "gorra", { Color: "Rojo" });
    const checked = only(checkRequests([set], [], snapshot({ items: [onItem], photoJustSent: null })));
    expect(checked.action).toMatchObject({ kind: "set_quantity", quantity: 3 });
    expect(decision(checked, "agree")).toEqual({ kind: "doubtful", reason: { kind: "quantity_set", quantity: 3 } });
    expect(decision(only(checkRequests([set], [], snapshot({ photoJustSent: null }))))).toMatchObject({ kind: "urgent", problem: "unnamed_add" });
  });

  test("leaves the pending ×3 «Con duda» when a buyer text came between the photo and «pásame 3»", () => {
    const checked = only(checkRequests([set], [], snapshot({ pendings: [pendingRef(1, gorraPending)], photoJustSent: null })));
    expect(checked.action).toMatchObject({ kind: "change_pending_quantity", pendingId: gorraPending.id, mode: "set", quantity: 3 });
    expect(checked.signals.targetNamed).toBe("context");
    for (const agreement of ["agree", "not_run"] as const) expect(decision(checked, agreement)).toEqual({ kind: "doubtful", reason: { kind: "quantity_set", quantity: 3 } });
  });

  test("leaves the pending ×3 «Con duda» on «pásame 3» with no open order (AC 5)", () => {
    const checked = only(checkRequests([set], [], snapshot({ pendings: [pendingRef(1, gorraPending)], photoJustSent: null, order: "none" })));
    expect(checked.action).toMatchObject({ kind: "change_pending_quantity", pendingId: gorraPending.id, mode: "set", quantity: 3 });
    expect(checked.blocked).toBeNull();
    expect(decision(checked, "agree")).toEqual({ kind: "doubtful", reason: { kind: "quantity_set", quantity: 3 } });
  });

  test("grows the single pending «Con duda» on «uno más de esa» when the photo just sent is gone", () => {
    const again = request({ kind: "add", target: { kind: "photo_just_sent" }, quantity: quantity(1, "add") });
    const checked = only(checkRequests([again], [], snapshot({ pendings: [pendingRef(1, gorraPending)], photoJustSent: null, order: "none" })));
    expect(checked.action).toMatchObject({ kind: "change_pending_quantity", pendingId: gorraPending.id, mode: "increase", quantity: 1 });
    expect(decision(checked, "agree")).toEqual({ kind: "doubtful", reason: { kind: "quantity_set", quantity: gorraPending.quantity + 1 } });
  });

  test("grows the pending «Con duda» on «otro igual» right after the photo just sent, without a quantity", () => {
    const again = request({ kind: "add", target: { kind: "photo_just_sent" } });
    const checked = only(checkRequests([again], [], snapshot({ pendings: [pendingRef(1, gorraPending)], photoJustSent: left })));
    expect(checked.action).toMatchObject({ kind: "change_pending_quantity", pendingId: gorraPending.id, mode: "increase", quantity: 1 });
    expect(decision(checked, "agree")).toEqual({ kind: "doubtful", reason: { kind: "quantity_set", quantity: gorraPending.quantity + 1 } });
  });
});

describe("checkRequests: targets that are a pending", () => {
  const polera = item("I1", "polera", { Talla: "L" });
  const gorraPending = pendingOf("gorra");
  const target = { kind: "pending", ref: "Q1" as PendingRef, named: say("la gorra") } as const;
  const state = snapshot({ items: [polera], pendings: [pendingRef(1, gorraPending)] });

  test("changes the quantity of the pending, never of the only item of the order", () => {
    const checked = only(checkRequests([request({ kind: "change_quantity", target, quantity: quantity(2, "set") })], [chosen("gorra")], state));
    expect(checked.action).toMatchObject({ kind: "change_pending_quantity", pendingId: gorraPending.id, mode: "set", quantity: 2 });
    expect(decision(checked, "agree")).toEqual({ kind: "pending" });
    expect(decision(only(checkRequests([request({ kind: "change_quantity", target: { ...target, named: null }, quantity: quantity(2, "set") })], [], state)), "agree"))
      .toEqual({ kind: "doubtful", reason: { kind: "quantity_set", quantity: 2 } });
  });

  test("declines the pending on a remove, never removes the only item of the order", () => {
    const checked = only(checkRequests([request({ kind: "remove", target })], [], state));
    expect(checked.action).toEqual({ kind: "decline_pending", pendingId: gorraPending.id });
  });

  test("lowers the pending by a decrease quantity instead of declining all of it", () => {
    const three = pendingOf("gorra", { quantity: 3 });
    const withThree = snapshot({ items: [polera], pendings: [pendingRef(1, three)] });
    const checked = only(checkRequests([request({ kind: "remove", target, quantity: quantity(1, "decrease") })], [chosen("gorra")], withThree));
    expect(checked.action).toMatchObject({ kind: "change_pending_quantity", pendingId: three.id, mode: "decrease", quantity: 1 });
    expect(decision(checked, "agree")).toEqual({ kind: "pending" });
    const fraction = only(checkRequests([request({ kind: "remove", target, quantity: quantity(1.5, "decrease") })], [], withThree));
    expect(decision(fraction, "agree")).toMatchObject({ kind: "urgent", problem: "invalid_action" });
  });

  test("rates a context-only remove of a pending as context", () => {
    const checked = only(checkRequests([request({ kind: "remove", target: { ...target, named: null } })], [], state));
    expect(checked.action).toEqual({ kind: "decline_pending", pendingId: gorraPending.id });
    expect(checked.signals.targetNamed).toBe("context");
  });

  test("changes and declines a pending when the chat has no open order", () => {
    const noOrder = snapshot({ pendings: [pendingRef(1, gorraPending)], order: "none" });
    const set = only(checkRequests([request({ kind: "change_quantity", target, quantity: quantity(2, "set") })], [chosen("gorra")], noOrder));
    expect(set.action).toMatchObject({ kind: "change_pending_quantity", pendingId: gorraPending.id, mode: "set", quantity: 2 });
    expect(set.blocked).toBeNull();
    expect(decision(set, "agree")).toEqual({ kind: "pending" });
    const remove = only(checkRequests([request({ kind: "remove", target })], [], noOrder));
    expect(remove.action).toEqual({ kind: "decline_pending", pendingId: gorraPending.id });
    expect(remove.blocked).toBeNull();
    const lower = only(checkRequests([request({ kind: "remove", target, quantity: quantity(1, "decrease") })], [], noOrder));
    expect(lower.action).toMatchObject({ kind: "change_pending_quantity", mode: "decrease" });
    expect(lower.blocked).toBeNull();
  });

  test("still blocks a price or a variant change on a pending when there is no open order", () => {
    const noOrder = snapshot({ pendings: [pendingRef(1, gorraPending)], order: "none" });
    for (const kind of ["mention_price", "change_variant"] as const) expect(only(checkRequests([request({ kind, target })], [], noOrder)).blocked).toBe("no_open_order");
  });

  test("never points another item change at the only item when the target is a pending", () => {
    const checked = only(checkRequests([request({ kind: "change_variant", target, values: [value("M")] })], [], state));
    expect(checked.action.kind).not.toBe("change_variant");
    expect(decision(checked, "agree").kind).toBe("urgent");
  });

  test("makes a named item the order does not hold urgent whatever the agreement", () => {
    const checked = only(checkRequests([request({ kind: "remove", target: { kind: "named", words: say("la gorra") } })], [chosen("gorra")], snapshot({ items: [polera] })));
    expect(checked.action).toMatchObject({ kind: "change_unfound_item" });
    for (const agreement of ["agree", "not_run"] as const) expect(decision(checked, agreement)).toEqual({ kind: "urgent", problem: "unclear_item", question: null });
  });
});

describe("checkRequests: pendings and other kinds", () => {
  test("completes a pending with the values of the message", () => {
    const pending = pendingOf("gorra", { quantity: 3 });
    const checked = only(checkRequests([request({ kind: "complete_pending", target: { kind: "pending", ref: "Q1" as PendingRef, named: null }, values: [value("rojo")] })], [], snapshot({ pendings: [pendingRef(1, pending)] })));
    expect(checked.action).toMatchObject({ kind: "advance_pending", request: { pendingId: pending.id, values: [{ name: "Color", value: "Rojo" }] } });
    expect(decision(checked)).toEqual({ kind: "pending" });
  });

  test("assigns one unit to each of two requests that complete the same pending", () => {
    const pending = pendingOf("polo", { quantity: 2 });
    const target = { kind: "pending", ref: "Q1" as PendingRef, named: null } as const;
    const checked = checkRequests([request({ kind: "complete_pending", target, values: [value("negro"), value("M")] }),
      { ...request({ kind: "complete_pending", target, values: [value("blanco"), value("L")] }), request: { ...request({}).request, request: "R2" as RequestRef, kind: "complete_pending", target, values: [value("blanco"), value("L")] } }], [], snapshot({ pendings: [pendingRef(1, pending)] }));
    expect(checked.map((entry) => (entry.action.kind === "advance_pending" ? entry.action.request.quantity : null))).toEqual([1, 1]);
  });

  test("decides a payment request as urgent with the open order", () => {
    const checked = only(checkRequests([request({ kind: "payment_request" })], [], snapshot()));
    expect(checked.action).toEqual({ kind: "report", outcome: { kind: "payment_requested", order: { kind: "none" }, productIds: [], unnamed: 0 } });
    expect(decision(checked)).toEqual({ kind: "urgent", problem: "payment_requested", question: null });
  });

  test("decides listo, a decline and an embedded instruction", () => {
    expect(only(checkRequests([request({ kind: "ready" })], [], snapshot())).action).toEqual({ kind: "ready" });
    const pending = pendingOf("gorra");
    expect(only(checkRequests([request({ kind: "decline", target: { kind: "pending", ref: "Q1" as PendingRef, named: null } })], [], snapshot({ pendings: [pendingRef(1, pending)] }))).action)
      .toEqual({ kind: "decline_pending", pendingId: pending.id });
    expect(decision(only(checkRequests([request({ kind: "not_allowed" })], [], snapshot())))).toEqual({ kind: "urgent", problem: "request_not_allowed", question: null });
  });

  test("notes a mentioned price on a named item", () => {
    const polera = item("I1", "polera", { Talla: "L" });
    const price = { amount: 70, currency: "order", basis: "unit", quote: say("70") } as const;
    const checked = only(checkRequests([request({ kind: "mention_price", target: { kind: "item", ref: "I1" as ItemRef, named: say("la polera") }, price })], [chosen("polera")], snapshot({ items: [polera] })));
    expect(checked.action).toMatchObject({ kind: "set_mentioned_price", price: { amount: { amount: 70 }, units: 1 } });
    expect(decision(checked)).toEqual({ kind: "applied" });
  });

  test("notes a mentioned price on a context-only item «Con duda» with its own reason", () => {
    const polera = item("I1", "polera", { Talla: "L" });
    const price = { amount: 70, currency: "order", basis: "unit", quote: say("70") } as const;
    const checked = only(checkRequests([request({ kind: "mention_price", target: { kind: "context", basis: "only_item", ref: "I1" as ItemRef }, price })], [], snapshot({ items: [polera] })));
    expect(decision(checked, "agree")).toEqual({ kind: "doubtful", reason: { kind: "price_noted", amount: 70, units: 1 } });
  });

  test("carries the signals of a request whose quotes were dropped as incomplete", () => {
    const checked = only(checkRequests([{ ...request({ target: { kind: "named", words: say("gorra") }, values: [value("rojo")] }), complete: false }], [chosen("gorra", [{ attribute: "Color", value: "Rojo" }])], snapshot()));
    expect(checked.signals.quotesComplete).toBe(false);
    expect(decision(checked, "agree")).toEqual({ kind: "doubtful", reason: { kind: "added_by_reference", quantity: 1, quote: null } });
  });

  test("agrees only when the confirming chain resolves the same action", () => {
    const first = only(checkRequests([request({ target: { kind: "named", words: say("gorra") }, values: [value("rojo")] })], [chosen("gorra", [{ attribute: "Color", value: "Rojo" }])], snapshot()));
    const other = only(checkRequests([request({ target: { kind: "named", words: say("gorra") }, values: [value("negro")] })], [chosen("gorra", [{ attribute: "Color", value: "Negro" }])], snapshot()));
    expect(agreementOf(first.action, first.action)).toBe("agree");
    expect(agreementOf(first.action, other.action)).toBe("disagree");
  });
});

describe("checkRequests: silent-change guards", () => {
  const polo = item("I1", "polo", { Talla: "M", Color: "Negro" });
  const gorra = item("I2", "gorra", { Color: "Rojo" });
  const price = (amount: number) => ({ amount, currency: "order" as const, basis: "unit" as const, quote: say("x") });

  test("takes a name the resolution does not choose for the line as a target from context, so the change stays «Con duda»", () => {
    const set = (named: string) => request({ kind: "change_quantity", target: { kind: "item", ref: "I1" as ItemRef, named: say(named) }, quantity: quantity(3, "set") });
    const pronoun = only(checkRequests([set("esas")], [{ request: "R1" as RequestRef, kind: "none" }], snapshot({ items: [polo] })));
    expect(pronoun.signals.targetNamed).toBe("context");
    expect(decision(pronoun, "agree").kind).toBe("doubtful");
    const named = only(checkRequests([set("los polos")], [chosen("polo")], snapshot({ items: [polo] })));
    expect(named.signals.targetNamed).toBe("named");
    expect(decision(named, "agree")).toEqual({ kind: "applied" });
  });

  test("does the same for the name quoted for a pending", () => {
    const pending = pendingRef(1, pendingOf("polera"));
    const lower = (named: string) => request({ kind: "change_quantity", target: { kind: "pending", ref: "Q1" as PendingRef, named: say(named) }, quantity: quantity(2, "set") });
    expect(only(checkRequests([lower("lo mismo")], [{ request: "R1" as RequestRef, kind: "none" }], snapshot({ order: "none", pendings: [pending] }))).signals.targetNamed).toBe("context");
    expect(only(checkRequests([lower("la polera")], [chosen("polera")], snapshot({ order: "none", pendings: [pending] }))).signals.targetNamed).toBe("named");
  });

  test("counts a name as naming the line by the resolution's choice, whatever words the buyer used", () => {
    const cap = item("I1", "gorra", { Color: "Rojo" });
    const synonym = request({ kind: "remove", target: { kind: "item", ref: "I1" as ItemRef, named: say("el sombrero") } });
    expect(only(checkRequests([synonym], [chosen("gorra")], snapshot({ items: [cap] }))).signals.targetNamed).toBe("named");
    expect(only(checkRequests([synonym], [chosen("polo")], snapshot({ items: [cap] }))).signals.targetNamed).toBe("context");
    expect(only(checkRequests([synonym], [], snapshot({ items: [cap] }))).signals.targetNamed).toBe("context");
  });

  test("counts a resolution between products as naming only when exactly one line of the order fits it", () => {
    const between = (...keys: ProductKey[]): ProductResolution => ({ request: "R1" as RequestRef, kind: "between", productIds: keys.map(productId) });
    const remove = request({ kind: "remove", target: { kind: "item", ref: "I1" as ItemRef, named: say("el rojo") } });
    expect(only(checkRequests([remove], [between("polo", "gorra")], snapshot({ items: [polo, gorra] }))).signals.targetNamed).toBe("context");
    expect(only(checkRequests([remove], [between("polo", "polera")], snapshot({ items: [polo, gorra] }))).signals.targetNamed).toBe("named");
  });

  test("never applies silently an increase of a line the buyer named: «Con duda» unless the confirming reading agrees", () => {
    const added = request({ kind: "add", target: { kind: "item", ref: "I1" as ItemRef, named: say("de la chompa") }, quantity: quantity(2, "add") });
    const byItem = only(checkRequests([added], [chosen("polo")], snapshot({ items: [polo] })));
    expect(byItem.action).toMatchObject({ kind: "increase_quantity" });
    expect(decision(byItem, "not_run").kind).toBe("doubtful");
    const more = request({ kind: "change_quantity", target: { kind: "item", ref: "I1" as ItemRef, named: say("de la chompa") }, quantity: quantity(2, "add") });
    const byQuantity = only(checkRequests([more], [chosen("polo")], snapshot({ items: [polo] })));
    expect(byQuantity.action).toMatchObject({ kind: "increase_quantity" });
    expect(decision(byQuantity, "not_run").kind).toBe("doubtful");
    expect(decision(byQuantity, "disagree").kind).toBe("doubtful");
  });

  test("asks which line only when two or more lines fit the values the request states", () => {
    const large = item("I3", "polo", { Talla: "L", Color: "Negro" });
    const remove = (words: string) => request({ kind: "remove", target: { kind: "item", ref: "I1" as ItemRef, named: null }, values: words ? [value(words)] : [] });
    const lines = snapshot({ items: [polo, gorra, large] });
    expect(decision(only(checkRequests([remove("Rojo")], [], lines)), "agree").kind).toBe("doubtful");
    expect(decision(only(checkRequests([remove("Negro")], [], lines)), "agree")).toMatchObject({ kind: "urgent", problem: "unclear_item" });
    expect(decision(only(checkRequests([remove("")], [], lines)), "agree")).toMatchObject({ kind: "urgent", problem: "unclear_item" });
  });

  test("asks which line when an unnamed reference points into an order with several lines", () => {
    const unnamed = request({ kind: "change_quantity", target: { kind: "item", ref: "I1" as ItemRef, named: null }, quantity: quantity(2, "set") });
    const several = only(checkRequests([unnamed], [], snapshot({ items: [polo, gorra] })));
    expect(decision(several, "agree")).toMatchObject({ kind: "urgent", problem: "unclear_item" });
    const one = only(checkRequests([unnamed], [], snapshot({ items: [polo] })));
    expect(decision(one, "agree").kind).toBe("doubtful");
    const afterPhoto = only(checkRequests([unnamed], [], snapshot({ items: [polo, gorra], lastPhoto: { kind: "product", productId: productId("polo"), added: true } })));
    expect(decision(afterPhoto, "agree").kind).toBe("doubtful");
  });

  test("rates an add of a variant the order already has high: «Con duda» alone and applied only with the confirming reading's agreement", () => {
    const add = request({ kind: "add", target: { kind: "named", words: say("el polo") }, values: [value("M"), value("Negro")], quantity: quantity(2, "add") });
    const resolution = chosen("polo", [{ attribute: "Talla", value: "M" }, { attribute: "Color", value: "Negro" }]);
    const checked = only(checkRequests([add], [resolution], snapshot({ items: [polo] })));
    expect(checked.action.kind).toBe("add");
    expect(decision(checked, "not_run").kind).toBe("doubtful");
    expect(checked.risk).toBe("high");
    const fresh = only(checkRequests([add], [resolution], snapshot({ items: [] })));
    expect(fresh.risk).toBeUndefined();
  });

  test("turns a price with no quantity on a variant the order already has into that line's price, not a second unit", () => {
    const priced = request({ kind: "add", target: { kind: "named", words: say("el polo") }, values: [value("M"), value("Negro")], price: price(1) });
    const resolution = chosen("polo", [{ attribute: "Talla", value: "M" }, { attribute: "Color", value: "Negro" }]);
    const checked = only(checkRequests([priced], [resolution], snapshot({ items: [polo] })));
    expect(checked.action).toMatchObject({ kind: "set_mentioned_price", target: { kind: "variant", variantId: polo.variantId } });
    expect(decision(checked, "not_run").kind).toBe("doubtful");
    expect(decision(checked, "agree")).toEqual({ kind: "applied" });
  });
});

describe("checkRequests: named targets against the order and the pendings", () => {
  const polo = item("I1", "polo", { Talla: "M", Color: "Negro" });
  const named = { kind: "named", words: say("el polo") } as const;
  const between = (...keys: ProductKey[]): ProductResolution => ({ request: "R1" as RequestRef, kind: "between", productIds: keys.map(productId) });
  const ref = (name: string) => name as RequestRef;

  test("points a named target that is between products at the one order line among them, and stays unclear with several", () => {
    const remove = request({ kind: "remove", target: named });
    const one = only(checkRequests([remove], [between("polo", "gorra")], snapshot({ items: [polo] })));
    expect(one.action).toEqual({ kind: "remove", target: { kind: "variant", variantId: polo.variantId }, amount: "all" });
    expect(one.signals.targetNamed).toBe("named");
    const gorra = item("I2", "gorra", { Color: "Rojo" });
    const several = only(checkRequests([remove], [between("polo", "gorra")], snapshot({ items: [polo, gorra] })));
    expect(decision(several, "agree")).toMatchObject({ kind: "urgent", problem: "unclear_item" });
    const none = only(checkRequests([remove], [between("polera", "gorra")], snapshot({ items: [polo] })));
    expect(decision(none, "agree")).toMatchObject({ kind: "urgent", problem: "unclear_item" });
  });

  test("adds a between-named product to the one ordered product among them, still marked as read by reference", () => {
    const checked = only(checkRequests([request({ kind: "add", target: named, values: [value("M"), value("negro")], quantity: quantity(1, "add") })], [between("polo", "gorra")], snapshot({ items: [polo] })));
    expect(checked.action.kind).toBe("add");
    expect(decision(checked, "agree")).toMatchObject({ kind: "doubtful", reason: { kind: "added_by_reference" } });
  });

  test("acts on the pending a named target matches for a quantity, a removal and a decline, with no order at all", () => {
    const pending = pendingOf("polera", { quantity: 2 });
    const state = snapshot({ order: "none", pendings: [pendingRef(1, pending)] });
    const set = only(checkRequests([request({ kind: "change_quantity", target: named, quantity: quantity(3, "set") })], [chosen("polera")], state));
    expect(set.action).toMatchObject({ kind: "change_pending_quantity", pendingId: pending.id, mode: "set", quantity: 3 });
    expect(set.signals.targetNamed).toBe("named");
    const remove = only(checkRequests([request({ kind: "remove", target: named })], [between("polera", "polo")], state));
    expect(remove.action).toEqual({ kind: "decline_pending", pendingId: pending.id });
    const decline = only(checkRequests([request({ kind: "decline", target: named })], [chosen("polera")], state));
    expect(decline.action).toEqual({ kind: "decline_pending", pendingId: pending.id });
  });

  test("keeps a named target on the order line when the order has one of the product too, and does not pick between two pendings", () => {
    const pending = pendingOf("polo");
    const line = only(checkRequests([request({ kind: "remove", target: named })], [chosen("polo")], snapshot({ items: [polo], pendings: [pendingRef(1, pending)] })));
    expect(line.action).toMatchObject({ kind: "remove", target: { kind: "variant", variantId: polo.variantId } });
    const two = only(checkRequests([request({ kind: "decline", target: named })], [chosen("polera")], snapshot({ pendings: [pendingRef(1, pendingOf("polera")), pendingRef(2, pendingOf("polera", { n: 2 }))] })));
    expect(two.action).toEqual({ kind: "report", outcome: { kind: "no_intent" } });
  });

  test("adds the quantity of a named product the order does not have", () => {
    const checked = only(checkRequests([request({ kind: "change_quantity", target: { kind: "named", words: say("las gorras") }, quantity: quantity(3, "set") })], [chosen("gorra", [{ attribute: "Color", value: "Rojo" }])], snapshot({ items: [polo] })));
    expect(checked.action).toMatchObject({ kind: "add", quantity: 3 });
    expect(decision(checked, "agree")).toMatchObject({ kind: "doubtful", reason: { kind: "added_by_reference" } });
    const request3 = request({ kind: "change_quantity", target: { kind: "named", words: say("las gorras") }, quantity: quantity(3, "set") });
    const first = only(checkRequests([request3], [chosen("gorra", [{ attribute: "Color", value: "Rojo" }])], snapshot({ items: [] })));
    expect(decision(first, "agree")).toEqual({ kind: "applied" });
    const closed = only(checkRequests([request3], [chosen("gorra")], snapshot({ order: "none" })));
    expect(decision(closed, "agree")).toMatchObject({ kind: "urgent", problem: "no_open_order" });
    const zero = only(checkRequests([request({ kind: "change_quantity", target: named, quantity: quantity(0, "set") })], [chosen("gorra")], snapshot({ items: [polo] })));
    expect(decision(zero, "agree")).toMatchObject({ kind: "urgent", problem: "unclear_item" });
    const lowered = only(checkRequests([request({ kind: "change_quantity", target: named, quantity: quantity(1, "decrease") })], [chosen("gorra")], snapshot({ items: [polo] })));
    expect(decision(lowered, "agree")).toMatchObject({ kind: "urgent", problem: "unclear_item" });
  });

  test("folds a price or quantity request of the message into the add of the same product", () => {
    const price = { amount: 50, currency: "order", basis: "lot", quote: say("por 50") } as const;
    const add = request({ request: ref("R1"), kind: "add", target: { kind: "named", words: say("gorras") }, values: [value("rojo")] });
    const extra = request({ request: ref("R2"), kind: "mention_price", target: { kind: "named", words: say("gorras") }, price, quantity: quantity(3, "add") });
    const resolutions: ProductResolution[] = [chosen("gorra", [{ attribute: "Color", value: "Rojo" }]), { ...chosen("gorra"), request: ref("R2") }];
    const checked = only(checkRequests([add, extra], resolutions, snapshot({ order: "none" })));
    expect(checked.action).toMatchObject({ kind: "add", quantity: 3, mentionedPrice: { amount: { amount: 50 }, units: 3 } });
    expect(checked.absorbed).toEqual(["R2"]);
    expect(lostRequests([], ["R1", "R2"].map(ref), [checked])).toEqual([]);
    const other = request({ request: ref("R2"), kind: "mention_price", target: { kind: "named", words: say("polos") }, price });
    expect(checkRequests([add, other], [resolutions[0]!, { ...chosen("polo"), request: ref("R2") }], snapshot({ order: "none" }))).toHaveLength(2);
  });

  test("does not fold a request into an add when the order has a line or a pending of the product, and never drops its values", () => {
    const gorra = request({ request: ref("R1"), kind: "add", target: { kind: "named", words: say("una gorra roja") }, values: [value("Rojo")], quantity: quantity(1, "add") });
    const negra = request({ request: ref("R2"), kind: "change_quantity", target: { kind: "named", words: say("la negra") }, values: [value("Negro")], quantity: quantity(2, "set") });
    const resolutions: ProductResolution[] = [chosen("gorra", [{ attribute: "Color", value: "Rojo" }]), { ...chosen("gorra", [{ attribute: "Color", value: "Negro" }]), request: ref("R2") }];
    const line = item("I1", "gorra", { Color: "Negro" });
    const withLine = checkRequests([gorra, negra], resolutions, snapshot({ items: [line] }));
    expect(withLine).toHaveLength(2);
    expect(withLine[0]!.action).toMatchObject({ kind: "add", quantity: 1 });
    expect(withLine[1]!.action).toMatchObject({ kind: "set_quantity", target: { variantId: line.variantId }, quantity: 2 });
    const withPending = checkRequests([gorra, negra], resolutions, snapshot({ pendings: [pendingRef(1, pendingOf("gorra"))] }));
    expect(withPending).toHaveLength(2);
    const conflicting = checkRequests([gorra, negra], resolutions, snapshot({ order: "none" }));
    expect(conflicting).toHaveLength(2);
    const price = request({ request: ref("R2"), kind: "mention_price", target: { kind: "named", words: say("la negra") }, price: { amount: 20, currency: "order", basis: "unit", quote: say("a 20") } });
    expect(checkRequests([gorra, price], resolutions, snapshot({ items: [line] }))[1]!.action).toMatchObject({ kind: "set_mentioned_price", target: { variantId: line.variantId } });
  });

  test("never adds a product twice when the message already adds it, and asks instead", () => {
    const add = request({ request: ref("R1"), kind: "add", target: { kind: "named", words: say("una gorra roja") }, values: [value("Rojo")], quantity: quantity(1, "add") });
    const set3 = request({ request: ref("R2"), kind: "change_quantity", target: { kind: "named", words: say("las gorras") }, quantity: quantity(3, "set") });
    const resolutions: ProductResolution[] = [chosen("gorra", [{ attribute: "Color", value: "Rojo" }]), { ...chosen("gorra", [{ attribute: "Color", value: "Rojo" }]), request: ref("R2") }];
    for (const state of [snapshot({ items: [] }), snapshot({ items: [polo] })]) {
      const checked = checkRequests([add, set3], resolutions, state);
      expect(checked.filter((entry) => entry.action.kind === "add")).toHaveLength(1);
      expect(decision(checked[1]!, "agree")).toMatchObject({ kind: "urgent", problem: "unclear_item" });
    }
  });

  test("never adds the product a photo add shows a second time for a named quantity, and asks instead", () => {
    const shown = Object.values(catalog).map((product) => (product.productId === productId("gorra") ? { ...product, shown: true, shownVariantId: variantOf("gorra", { Color: "Rojo" }).variantId } : product));
    const add = request({ request: ref("R1"), kind: "add", target: { kind: "photo_same_message" } });
    const set3 = request({ request: ref("R2"), kind: "change_quantity", target: { kind: "named", words: say("las gorras") }, quantity: quantity(3, "set") });
    const resolutions: ProductResolution[] = [{ ...chosen("gorra", [{ attribute: "Color", value: "Rojo" }]), request: ref("R2") }];
    const checked = checkRequests([add, set3], resolutions, snapshot({ messageKind: "photo_product", products: shown, items: [] }));
    expect(checked.filter((entry) => entry.action.kind === "add")).toHaveLength(1);
    expect(checked.some((entry) => entry.action.kind === "add" && entry.action.quantity === 3)).toBe(false);
    expect(decision(checked[checked.length - 1]!, "agree")).toMatchObject({ kind: "urgent", problem: "unclear_item" });
  });

  test("folds a same-message price or quantity only when exactly one add of the message has that product", () => {
    const rojo = request({ request: ref("R1"), kind: "add", target: { kind: "named", words: say("una gorra roja") }, values: [value("Rojo")] });
    const negra = request({ request: ref("R2"), kind: "add", target: { kind: "named", words: say("una negra") }, values: [value("Negro")] });
    const price = request({ request: ref("R3"), kind: "mention_price", target: { kind: "named", words: say("las gorras") }, price: { amount: 20, currency: "order", basis: "unit", quote: say("a 20 cada una") } });
    const set3 = request({ request: ref("R3"), kind: "change_quantity", target: { kind: "named", words: say("las gorras") }, quantity: quantity(3, "set") });
    const resolutions: ProductResolution[] = [chosen("gorra", [{ attribute: "Color", value: "Rojo" }]), { ...chosen("gorra", [{ attribute: "Color", value: "Negro" }]), request: ref("R2") }, { ...chosen("gorra"), request: ref("R3") }];
    for (const extra of [price, set3]) {
      const checked = checkRequests([rojo, negra, extra], resolutions, snapshot({ order: "none" }));
      expect(checked).toHaveLength(3);
      expect(checked[0]!.action).toMatchObject({ kind: "add", quantity: 1, mentionedPrice: null });
      expect(checked[1]!.action).toMatchObject({ kind: "add", quantity: 1, mentionedPrice: null });
      expect(checked.some((entry) => entry.action.kind === "add" && entry.action.quantity === 3)).toBe(false);
    }
  });

  test("points a name between products at the order line over a pending of the candidates", () => {
    const polo = item("I1", "polo", { Talla: "M", Color: "Negro" });
    const checked = only(checkRequests([request({ kind: "remove", target: { kind: "named", words: say("el polo") } })], [{ request: "R1" as RequestRef, kind: "between", productIds: [productId("polo"), productId("polera")] }],
      snapshot({ items: [polo], pendings: [pendingRef(1, pendingOf("polera"))] })));
    expect(checked.action).toMatchObject({ kind: "remove", target: { variantId: polo.variantId } });
  });

  test("adds the variant a referenced add states when it differs from the line it refers to", () => {
    const line = item("I1", "polo", { Talla: "M", Color: "Blanco" }, 2);
    const checked = only(checkRequests([request({ kind: "add", target: { kind: "item", ref: "I1" as ItemRef, named: null }, values: [value("L"), value("negro")], quantity: quantity(1, "add") })], [], snapshot({ items: [line] })));
    expect(checked.action).toMatchObject({ kind: "add", item: { variantId: variantOf("polo", { Talla: "L", Color: "Negro" }).variantId }, quantity: 1 });
    const same = only(checkRequests([request({ kind: "add", target: { kind: "item", ref: "I1" as ItemRef, named: null }, values: [value("M")], quantity: quantity(1, "add") })], [], snapshot({ items: [line] })));
    expect(same.action).toMatchObject({ kind: "increase_quantity", target: { variantId: line.variantId } });
  });
});

describe("checkRequests: the buyer's values mapped by the resolution", () => {
  const pendingTarget = { kind: "pending", ref: "Q1" as PendingRef, named: null } as const;
  const mapped = (key: ProductKey, values: { attribute: string; value: string; word: string }[], unmatched: string[] = []): ProductResolution =>
    ({ request: "R1" as RequestRef, kind: "chosen", productId: productId(key), values: values.map((entry) => ({ attribute: entry.attribute, value: entry.value, quote: say(entry.word) })), unmatched: unmatched.map(say) });

  test("completes a pending with a value the resolution mapped from another form of the word", () => {
    const pending = pendingOf("gorra", { quantity: 1 });
    const checked = only(checkRequests([request({ kind: "complete_pending", target: pendingTarget, values: [value("negra")] })], [mapped("gorra", [{ attribute: "Color", value: "Negro", word: "negra" }])],
      snapshot({ pendings: [pendingRef(1, pending)] })));
    expect(checked.action).toMatchObject({ kind: "advance_pending", request: { values: [{ name: "Color", value: "Negro" }] } });
  });

  test("keeps the buyer's own words for a value the resolution found in no value, so the catalog check rejects it", () => {
    const pending = pendingOf("gorra", { quantity: 1 });
    const checked = only(checkRequests([request({ kind: "complete_pending", target: pendingTarget, values: [value("celeste")] })], [mapped("gorra", [], ["celeste"])],
      snapshot({ pendings: [pendingRef(1, pending)] })));
    expect(checked.action).toMatchObject({ kind: "advance_pending", request: { values: [{ name: "", value: "celeste" }] } });
  });

  test("changes an item's variant with the mapped value", () => {
    const gorra = item("I1", "gorra", { Color: "Rojo" });
    const checked = only(checkRequests([request({ kind: "change_variant", target: { kind: "item", ref: "I1" as ItemRef, named: say("la gorra") }, values: [value("negra")], changeVerb: say("cámbiala") })],
      [mapped("gorra", [{ attribute: "Color", value: "Negro", word: "negra" }])], snapshot({ items: [gorra] })));
    expect(checked.action).toMatchObject({ kind: "change_variant", to: { kind: "resolved", item: { variantId: variantOf("gorra", { Color: "Negro" }).variantId } } });
  });

  test("reports an unmatched value of a named add as not available instead of missing", () => {
    const checked = only(checkRequests([request({ target: { kind: "named", words: say("polera") }, values: [value("XL")] })], [mapped("polera", [], ["XL"])], snapshot()));
    expect(checked.action).toMatchObject({ kind: "draft_pending", draft: { problem: "variant_not_available" } });
    expect(checked.urgent).toMatchObject({ problem: "variant_not_available" });
  });

  test("counts an unmatched word that the chosen product sells letter by letter as matched", () => {
    const pending = pendingOf("gorra", { quantity: 1 });
    const checked = only(checkRequests([request({ kind: "complete_pending", target: pendingTarget, values: [value("rojo")] })], [mapped("gorra", [], ["rojo"])], snapshot({ pendings: [pendingRef(1, pending)] })));
    expect(checked.action).toMatchObject({ kind: "advance_pending", request: { values: [{ name: "Color", value: "Rojo" }] } });
  });

  test("falls back to comparing the buyer's words letter by letter when the resolution did not cover them", () => {
    const pending = pendingOf("gorra", { quantity: 1 });
    const checked = only(checkRequests([request({ kind: "complete_pending", target: pendingTarget, values: [value("rojo")] })], [mapped("gorra", [])], snapshot({ pendings: [pendingRef(1, pending)] })));
    expect(checked.action).toMatchObject({ kind: "advance_pending", request: { values: [{ name: "Color", value: "Rojo" }] } });
  });

  const negroRojo = [{ attribute: "Color", value: "Negro", word: "negra" }, { attribute: "Color", value: "Rojo", word: "roja" }];
  const askedAs = (ref: string, over: Partial<ExtractedRequest>): VerifiedRequest => ({ ...request(over), request: { ...request(over).request, request: ref as RequestRef } });
  const mappedFor = (ref: string, entry: { attribute: string; value: string; word: string }): ProductResolution => ({ ...mapped("gorra", [entry]), request: ref as RequestRef });

  test("applies one request per value on its own when the extraction gave one for each", () => {
    const first = askedAs("R1", { target: { kind: "named", words: say("gorra") }, values: [value("negra")], quantity: quantity(1, "add") });
    const second = askedAs("R2", { target: { kind: "named", words: say("gorra") }, values: [value("roja")], quantity: quantity(1, "add") });
    const checked = checkRequests([first, second], [mappedFor("R1", negroRojo[0]!), mappedFor("R2", negroRojo[1]!)], snapshot());
    expect(checked.map(({ action }) => action)).toEqual([
      expect.objectContaining({ kind: "add", quantity: 1, item: expect.objectContaining({ variantId: variantOf("gorra", { Color: "Negro" }).variantId }) }),
      expect.objectContaining({ kind: "add", quantity: 1, item: expect.objectContaining({ variantId: variantOf("gorra", { Color: "Rojo" }).variantId }) }),
    ]);
  });

  test.each([2, 3])("never applies one request that carries two values of one attribute, whatever its quantity (%i)", (units) => {
    const both = request({ target: { kind: "named", words: say("gorras") }, values: [value("negra"), value("roja")], quantity: quantity(units, "add") });
    const checked = only(checkRequests([both], [mapped("gorra", negroRojo)], snapshot()));
    expect(checked.action).toEqual({ kind: "report", outcome: { kind: "variant_only" } });
    expect(decision(checked, "agree")).toMatchObject({ kind: "urgent", problem: "variant_only" });
  });

  test("never advances an open pending with a request that carries two values of one attribute", () => {
    const pending = pendingOf("gorra", { quantity: 2 });
    const both = request({ target: { kind: "named", words: say("gorras") }, values: [value("negra"), value("roja")], quantity: quantity(2, "add") });
    const checked = checkRequests([both], [mapped("gorra", negroRojo)], snapshot({ pendings: [pendingRef(1, pending)] }));
    expect(checked.map(({ action }) => action)).toEqual([{ kind: "report", outcome: { kind: "variant_only" } }]);
  });

  test("never completes a pending with a request that carries two values of one attribute", () => {
    const pending = pendingOf("gorra", { quantity: 2 });
    const both = request({ kind: "complete_pending", target: pendingTarget, values: [value("negra"), value("roja")] });
    const checked = only(checkRequests([both], [mapped("gorra", negroRojo)], snapshot({ pendings: [pendingRef(1, pending)] })));
    expect(checked.action).toEqual({ kind: "report", outcome: { kind: "variant_only" } });
  });

  test("gives each of two requests for one open pending one unit, not the full quantity", () => {
    const pending = pendingOf("gorra", { quantity: 2 });
    const first = askedAs("R1", { kind: "complete_pending", target: pendingTarget, values: [value("negra")] });
    const second = askedAs("R2", { kind: "complete_pending", target: pendingTarget, values: [value("roja")] });
    const checked = checkRequests([first, second], [mappedFor("R1", negroRojo[0]!), mappedFor("R2", negroRojo[1]!)], snapshot({ pendings: [pendingRef(1, pending)] }));
    expect(checked.map(({ action }) => action)).toEqual([
      expect.objectContaining({ kind: "advance_pending", request: expect.objectContaining({ quantity: 1, values: [{ name: "Color", value: "Negro" }] }) }),
      expect.objectContaining({ kind: "advance_pending", request: expect.objectContaining({ quantity: 1, values: [{ name: "Color", value: "Rojo" }] }) }),
    ]);
  });

  test("does not raise an item's quantity with «otro igual» when the stated value fits no value of the catalog", () => {
    const blanco = item("I1", "polo", { Talla: "M", Color: "Blanco" });
    const another = request({ kind: "add", target: { kind: "item", ref: "I1" as ItemRef, named: null }, values: [value("celeste")], quantity: quantity(1, "add") });
    const checked = only(checkRequests([another], [mapped("polo", [], ["celeste"])], snapshot({ items: [blanco] })));
    expect(checked.action).not.toMatchObject({ kind: "increase_quantity" });
  });

  test("does not raise an item's quantity with «otro igual» when the stated value is another variant", () => {
    const blanco = item("I1", "polo", { Talla: "M", Color: "Blanco" });
    const another = request({ kind: "add", target: { kind: "item", ref: "I1" as ItemRef, named: null }, values: [value("negro"), value("L")], quantity: quantity(1, "add") });
    const checked = only(checkRequests([another], [mapped("polo", [{ attribute: "Color", value: "Negro", word: "negro" }, { attribute: "Talla", value: "L", word: "L" }])], snapshot({ items: [blanco] })));
    expect(checked.action).toMatchObject({ kind: "add", item: { variantId: variantOf("polo", { Talla: "L", Color: "Negro" }).variantId } });
  });
});
