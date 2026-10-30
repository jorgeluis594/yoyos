import { describe, expect, test } from "vitest";
import { productNameKey } from "@core/src/features/products/domain/product-name-key";
import type { OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import { checkReaderAnswer, fixedShownAnswer, type ReaderAction, type ReaderItem } from "@core/src/features/orders/domain/chat-reading";
import { catalog, createChat, doubtfulPendingOf, id, pendingOf, productId, reader, stated, variantOf, type ProductKey } from "@core/src/features/orders/domain/chat-reading-fixtures";

const { add, say } = reader;
const noProduct = (kind: "not_in_catalog" | "unnamed"): ReaderAction => ({ kind: "add", product: { kind }, attributes: [], quantity: null, price: null });
const item = (ref: string): ReaderItem => ({ kind: "ref", ref });
const problems = (kinds: readonly string[]) => kinds.filter((kind) => !kind.startsWith("pending_"));

describe("checkReaderAnswer: adds and variants", () => {
  test("adds the only sellable variant when the reader names the product without values", () => {
    const chat = createChat();
    expect(chat.say(say(add({ product: "snapback" }))).kinds).toEqual(["added"]);
    expect(chat.items()).toEqual(["Gorra snapback · Azul · ×1"]);
  });

  test("fills the only sellable value of an attribute after a partial answer", () => {
    const chat = createChat();
    chat.say(say(add({ product: "oversize", attributes: { Talla: "M" } })));
    expect(chat.items()).toEqual(["Polo oversize · M · Verde · ×1"]);
  });

  test("matches the reader's value «negro» to the catalog value «Negro» ignoring case and accents", () => {
    const chat = createChat();
    chat.say(say(add({ product: "polo", attributes: { talla: "m", COLOR: "negro" } }), add({ product: "gorra", attributes: { Color: "ROJÓ" } })));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1", "Gorra trucker · Rojo · ×1"]);
  });

  test("treats a value outside the product's sellable values as a variant that does not exist", () => {
    const chat = createChat();
    const said = chat.say(say(add({ product: "polo", attributes: { Color: "Rojo" } })));
    expect(said.kinds).toEqual(["pending_created", "variant_not_available"]);
    expect(chat.items()).toEqual([]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {}']);
  });

  test("reports variant not available and keeps the other known values for an attribute name the product does not have", () => {
    const chat = createChat();
    const said = chat.say(say(add({ product: "polo", attributes: { Talla: "M", Material: "algodón" } })));
    expect(said.kinds).toEqual(["pending_created", "variant_not_available"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {"Talla":"M"}']);
  });

  test("stores only catalog attribute names and values in a pending's known values", () => {
    const chat = createChat();
    chat.say(say(add({ product: "polo", attributes: { talla: "m", Estilo: "oversize" } })));
    expect(chat.pendings.pendings[0]?.known).toEqual({ Talla: "M" });
  });

  test("drafts a variant pending with the known size when the color still varies", () => {
    const chat = createChat();
    expect(chat.say(say(add({ product: "polo", attributes: { Talla: "L" }, quantity: 2 }))).kinds).toEqual(["pending_created", "variant_missing"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×2 {"Talla":"L"}']);
  });

  test("drafts a doubtful-product pending of at most four candidates when the reader answers one of several", () => {
    const chat = createChat();
    const said = chat.say(say(reader.oneOf(["polo", "oversize", "premium", "gorra", "polera"])));
    expect(said.kinds).toEqual(["pending_created", "not_clear"]);
    const subject = chat.pendings.pendings[0]?.subject;
    expect(subject).toEqual({ kind: "product", candidates: (["polo", "oversize", "premium", "gorra"] as ProductKey[]).map(productId) });
  });

  test("drafts two pendings for two adds of the same product in one message without a pending", () => {
    const chat = createChat();
    chat.say(say(add({ product: "polo", attributes: { Talla: "M" } }), add({ product: "polo", attributes: { Talla: "L" } })));
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {"Talla":"M"}', 'Polo básico ×1 {"Talla":"L"}']);
  });

  test("reports not identified when the reader says the product is not in the catalog", () => {
    const chat = createChat();
    expect(chat.say(say(noProduct("not_in_catalog"))).outcomes).toEqual([{ kind: "not_identified", source: "text", identification: null, silent: false }]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("reports an unnamed add and never drafts or completes a pending for «otro igual»", () => {
    const chat = createChat({ pendings: [pendingOf("polo")] });
    expect(chat.say(say(noProduct("unnamed"))).kinds).toEqual(["unnamed_add"]);
    expect(chat.pendings.pendings).toEqual([pendingOf("polo")]);
  });

  test("reports a generic invalid action for a product reference it was not given", () => {
    const chat = createChat();
    const unknown: ReaderAction = { kind: "add", product: { kind: "ref", ref: "P99" }, attributes: [], quantity: null, price: null };
    expect(chat.say(say(unknown)).outcomes).toEqual([{ kind: "invalid_action", orderId: null, reason: "unknown_reference" }]);
    expect(chat.say(say(reader.decline(4))).outcomes).toEqual([{ kind: "invalid_action", orderId: null, reason: "unknown_reference" }]);
  });

  test.each([1.5, -1, 0])("reports a generic invalid action for the add quantity %s", (quantity) => {
    const chat = createChat();
    expect(chat.say(say(add({ product: "snapback", quantity }))).outcomes).toEqual([{ kind: "invalid_action", orderId: null, reason: "quantity_not_whole" }]);
    expect(chat.items()).toEqual([]);
  });

  test("reports product not available for an add of a deactivated product", () => {
    const chat = createChat({ unsellable: ["gorra"] });
    expect(chat.say(say(add({ product: "gorra", attributes: { Color: "Rojo" } }))).outcomes).toEqual([{ kind: "product_not_available", productId: productId("gorra") }]);
  });

  test("reports above-99 and drafts no pending for «150 polos»", () => {
    const chat = createChat();
    expect(chat.say(say(add({ product: "polo", quantity: 150 }))).kinds).toEqual(["quantity_above_limit"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("keeps a number that is part of the product name out of the quantity when the reader gives quantity 1", () => {
    const chat = createChat();
    chat.say(say(add({ product: "medias", quantity: 1 })));
    expect(chat.items()).toEqual(["Medias deportivas pack x3 · ×1"]);
  });
});

describe("checkReaderAnswer: items", () => {
  const withGorraAndPolo = () => createChat({ items: [["gorra", { Color: "Negro" }, 1], ["polo", { Talla: "M", Color: "Negro" }, 1]] });

  test("reads «set to 0» as a removal", () => {
    const chat = withGorraAndPolo();
    expect(chat.say(say({ kind: "change_quantity", target: item("I1"), mode: "set", quantity: 0 })).kinds).toEqual(["removed"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
  });

  test("lets removal and quantity change of an item whose product was deactivated through", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1], ["polo", { Talla: "M", Color: "Negro" }, 1]], unsellable: ["gorra"] });
    expect(chat.say(say({ kind: "change_quantity", target: item("I1"), mode: "set", quantity: 2 })).kinds).toEqual(["quantity_changed"]);
    expect(chat.say(say({ kind: "remove", item: item("I1"), amount: "all" })).kinds).toEqual(["removed"]);
  });

  test("keeps the item's other attributes when a variant change names only the size", () => {
    const chat = createChat({ items: [["polo", { Talla: "M", Color: "Negro" }, 1]] });
    chat.say(say({ kind: "change_variant", item: item("I1"), attributes: [{ name: "Talla", value: "L" }], price: null }));
    expect(chat.items()).toEqual(["Polo básico · L · Negro · ×1"]);
  });

  test("reports an unclear item for an item ref not in the order and for an unnamed item with two items", () => {
    const chat = withGorraAndPolo();
    expect(chat.say(say({ kind: "remove", item: item("I9"), amount: "all" })).kinds).toEqual(["unclear_item"]);
    expect(chat.say(say({ kind: "remove", item: { kind: "not_in_order" }, amount: "all" })).kinds).toEqual(["unclear_item"]);
    expect(chat.say(say({ kind: "remove", item: { kind: "unnamed" }, amount: "all" })).kinds).toEqual(["unclear_item"]);
    expect(chat.items()).toHaveLength(2);
  });

  test("reports a negative or fractional set quantity as invalid", () => {
    const chat = withGorraAndPolo();
    expect(chat.say(say({ kind: "change_quantity", target: item("I1"), mode: "set", quantity: -2 })).outcomes).toEqual([{ kind: "invalid_action", orderId: chat.order?.id, reason: "quantity_not_whole" }]);
    expect(chat.say(say({ kind: "change_quantity", target: item("I1"), mode: "increase", quantity: 1.5 })).outcomes).toEqual([{ kind: "invalid_action", orderId: chat.order?.id, reason: "quantity_not_whole" }]);
  });
});

describe("checkReaderAnswer: the answer as a whole", () => {
  const tenAdds = (count: number) => Array.from({ length: count }, () => add({ product: "medias" }));

  test("applies the first ten actions and reports too many actions when the reader says the message asked for more", () => {
    const chat = createChat();
    const [first, ...rest] = tenAdds(10);
    const said = chat.say({ kind: "actions", actions: [first!, ...rest], moreActions: true });
    expect(chat.items()).toEqual(["Medias deportivas pack x3 · ×10"]);
    expect(said.outcomes.at(-1)).toEqual({ kind: "invalid_action", orderId: null, reason: "too_many_actions" });
  });

  test("applies the first ten of thirty parsed actions and reports too many actions", () => {
    const chat = createChat();
    const [first, ...rest] = tenAdds(30);
    const said = chat.say({ kind: "actions", actions: [first!, ...rest], moreActions: false });
    expect(chat.items()).toEqual(["Medias deportivas pack x3 · ×10"]);
    expect(said.outcomes.filter((outcome) => outcome.kind === "invalid_action")).toHaveLength(1);
  });

  test("reports reader doubt for a text and changes nothing", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]] });
    expect(chat.say({ kind: "doubt" }).outcomes).toEqual([{ kind: "reader_doubt", orderId: chat.order?.id }]);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1"]);
  });

  test("carries the open order's id in reader doubt, request not allowed and invalid action, and null without an order", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]] });
    const orderId = chat.order?.id;
    expect(orderId).toBeDefined();
    expect(chat.say({ kind: "doubt" }).outcomes).toEqual([{ kind: "reader_doubt", orderId }]);
    expect(chat.say(say({ kind: "not_allowed" })).outcomes).toEqual([{ kind: "request_not_allowed", orderId }]);
    expect(chat.say(say({ kind: "malformed" })).outcomes).toEqual([{ kind: "invalid_action", orderId, reason: "malformed" }]);
    expect(createChat().say({ kind: "doubt" }).outcomes).toEqual([{ kind: "reader_doubt", orderId: null }]);
  });

  test("reports request not allowed for a cancel request", () => {
    expect(createChat().say(say({ kind: "not_allowed" })).outcomes).toEqual([{ kind: "request_not_allowed", orderId: null }]);
  });

  test("reports a generic invalid action for a malformed action and applies the others", () => {
    const chat = createChat();
    const said = chat.say(say(add({ product: "snapback" }), { kind: "malformed" }));
    expect(said.outcomes.map((outcome) => outcome.kind)).toEqual(["added", "invalid_action"]);
    expect(chat.items()).toEqual(["Gorra snapback · Azul · ×1"]);
  });

  test("reports no intent for the reader's no_intent and for declining the shown product alone", () => {
    expect(createChat().say({ kind: "no_intent" }).kinds).toEqual(["no_intent"]);
    expect(createChat().say(say({ kind: "decline_shown" }), { shown: [["polo"]] }).kinds).toEqual(["no_intent"]);
  });
});

describe("checkReaderAnswer: photos", () => {
  test("completes another product's pending from a product photo's caption that names it", () => {
    const chat = createChat({ pendings: [pendingOf("polo")] });
    const said = chat.say(say(add({ product: "gorra", attributes: { Color: "Negro" } }), reader.complete(1, { Talla: "M", Color: "Blanco" })), { shown: [["gorra", { Color: "Negro" }]] });
    expect(problems(said.kinds)).toEqual(["added", "added"]);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1", "Polo básico · M · Blanco · ×1"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("treats an add of a pending's product in a photo caption as completing that pending", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { known: { Talla: "M" } })] });
    chat.say(say(add({ product: "gorra", attributes: { Color: "Negro" } }), add({ product: "polo", attributes: { Color: "Blanco" } })), { shown: [["gorra", { Color: "Negro" }]] });
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1", "Polo básico · M · Blanco · ×1"]);
  });

  test("rejects an add of another product without a pending in a product-photo caption with a generic invalid action", () => {
    const chat = createChat();
    const said = chat.say(say(add({ product: "gorra", attributes: { Color: "Negro" } }), add({ product: "polo", attributes: { Talla: "M" } })), { shown: [["gorra", { Color: "Negro" }]] });
    expect(said.outcomes.map((outcome) => outcome.kind)).toEqual(["added", "invalid_action"]);
    expect(said.outcomes[1]).toEqual({ kind: "invalid_action", orderId: null, reason: "not_the_shown_product" });
    expect(chat.say(say(noProduct("not_in_catalog")), { shown: [["gorra", { Color: "Negro" }]] }).outcomes).toEqual([{ kind: "invalid_action", orderId: chat.order?.id, reason: "not_the_shown_product" }]);
  });

  test("turns every change in a non-product photo caption into one image-with-request report", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]] });
    const said = chat.say(say(add({ product: "polo", attributes: { Talla: "M" } }), { kind: "remove", item: item("I1"), amount: "all" }, reader.ready), { kind: "photo_not_product" });
    expect(said.kinds).toEqual(["image_with_request", "ready"]);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1"]);
  });

  test("adds the shown product and reports caption not applied when the reader doubts a single-variant photo caption", () => {
    const chat = createChat();
    const said = chat.say({ kind: "doubt" }, { shown: [["snapback", { Color: "Azul" }]] });
    expect(said.kinds).toEqual(["added", "caption_not_applied"]);
    expect(said.outcomes[1]).toEqual({ kind: "caption_not_applied", productId: productId("snapback"), orderId: chat.order?.id });
  });

  test("drafts the shown product's pending and no caption-not-applied when the doubted photo has variants", () => {
    const chat = createChat();
    expect(chat.say({ kind: "doubt" }, { shown: [["polo"]] }).kinds).toEqual(["pending_created", "variant_missing"]);
  });

  test("reports variant missing when a doubted caption's photo silently replaces the product's existing pending", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    const said = chat.say({ kind: "doubt" }, { shown: [["polo"]] });
    expect(said.kinds).toEqual(["pending_updated", "variant_missing"]);
    expect(chat.pendings.pendings[0]?.quantity).toBe(2);
  });

  test("reports caption not applied when a doubted caption's photo completes the product's pending through its QR", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    const said = chat.say({ kind: "doubt" }, { shown: [["polo", { Talla: "M", Color: "Negro" }]] });
    expect(said.kinds).toEqual(["pending_completed", "added", "caption_not_applied"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×2"]);
  });

  test("treats a caption over the length limit as a doubted caption without calling the reader", () => {
    const context = createChat().context({ shown: [["snapback", { Color: "Azul" }]] });
    expect(checkReaderAnswer(fixedShownAnswer(context), context, { captionDoubt: true })).toEqual(checkReaderAnswer({ kind: "doubt" }, context, { captionDoubt: false }));
  });

  test("keeps the QR label's color when the caption names another size", () => {
    const chat = createChat();
    chat.say(say(add({ product: "polo", attributes: { Talla: "L" } })), { shown: [["polo", { Talla: "M", Color: "Negro" }]] });
    expect(chat.items()).toEqual(["Polo básico · L · Negro · ×1"]);
  });
});

describe("checkReaderAnswer: several pendings", () => {
  test("reports a variant fitting several pendings with their product ids", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { n: 1 }), pendingOf("polera", { n: 2 })] });
    expect(chat.say(say({ kind: "variant_for_pendings", pendings: ["Q1", "Q2"] })).outcomes).toEqual([
      { kind: "variant_for_several_pendings", productIds: [productId("polo"), productId("polera")], unnamed: 0 }]);
    const twoPolos = createChat({ pendings: [pendingOf("polo", { n: 1 }), pendingOf("polo", { n: 2 })] });
    expect(twoPolos.say(say(add({ product: "polo", attributes: { Color: "Negro" } }))).outcomes).toEqual([{ kind: "variant_for_several_pendings", productIds: [productId("polo")], unnamed: 0 }]);
    expect(twoPolos.pendings.pendings).toHaveLength(2);
  });

  test("resolves a doubtful pending to a listed product the reader names even when it is not one of its candidates", () => {
    const chat = createChat({ pendings: [doubtfulPendingOf(["polo", "oversize"])] });
    chat.say(say(reader.complete(1, { Talla: "M" }, null, "polera")));
    expect(chat.items()).toEqual(["Polera con capucha · M · ×1"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("advances the variant pending instead of drafting a doubtful pending that would include its product", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { n: 1 }), pendingOf("oversize", { n: 2 })] });
    const said = chat.say(say(reader.oneOf(["polo", "oversize"], { Talla: "M" })));
    expect(said.kinds).toEqual(["pending_updated"]);
    expect(chat.pendings.pendings).toHaveLength(2);
    expect(chat.pendings.pendings[0]?.known).toEqual({ Talla: "M" });
  });

  test("drafts a variant pending of the other product when one candidate already has its pending", () => {
    const chat = createChat({ pendings: [pendingOf("polo")] });
    const said = chat.say(say(reader.oneOf(["polo", "gorra"])));
    expect(said.kinds).toEqual(["pending_created", "variant_missing"]);
    expect(chat.pendings.pendings[1]?.subject).toEqual({ kind: "variant", productId: productId("gorra") });
  });

  test("keeps the catalog as the only source of a doubtful pending's values", () => {
    const chat = createChat();
    chat.say(say(reader.oneOf(["polo", "oversize"], { Talla: "m", Color: "Negro" })));
    expect(chat.pendings.pendings[0]?.known).toEqual({ Talla: "M" });
    expect(catalog.polo.attributes[0]?.name).toBe("Talla");
  });
});

describe("price", () => {
  test("judges the stated price with the resolved variant's catalog price", () => {
    const chat = createChat();
    chat.say(say(add({ product: "snapback", quantity: 2, price: stated("70") })));
    expect(chat.order?.items[0]?.mentionedPrice).toEqual({ amount: { amount: 70, currency: "PEN" }, units: 2 });
  });
});

const M_NEGRO = { Talla: "M", Color: "Negro" } as const;
const outcomeOf = (said: { outcomes: readonly { kind: string }[] }, kind: string) => said.outcomes.find((outcome) => outcome.kind === kind);

describe("checkReaderAnswer: photo captions", () => {
  test("a product photo whose caption the reader reads as no intent adds the shown single-variant product like a photo without caption", () => {
    const chat = createChat();
    expect(chat.say({ kind: "no_intent" }, { shown: [["snapback"]] }).kinds).toEqual(["added"]);
    expect(chat.items()).toEqual(["Gorra snapback · Azul · ×1"]);
  });

  test("a product photo whose caption the reader reads as no intent leaves the shown product pending with variant missing when it has several variants", () => {
    const chat = createChat();
    expect(chat.say({ kind: "no_intent" }, { shown: [["polo"]] }).kinds).toEqual(["pending_created", "variant_missing"]);
    expect(chat.order).toBeNull();
  });

  test("a no-intent caption on a photo of a product already pending replaces that pending without a notice", () => {
    const chat = createChat({ pendings: [pendingOf("polo")] });
    expect(chat.say({ kind: "no_intent" }, { shown: [["polo"]] }).kinds).toEqual(["pending_updated"]);
    expect(chat.pendings.pendings).toHaveLength(1);
  });

  test("a no-intent answer on a text or a photo without a shown product is still no intent", () => {
    expect(createChat().say({ kind: "no_intent" }).kinds).toEqual(["no_intent"]);
    expect(createChat().say({ kind: "no_intent" }, { kind: "photo_product" }).kinds).toEqual(["no_intent"]);
  });

  test("a photo whose caption only asks to pay still adds the shown product and reports the payment request", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 1]] });
    const said = chat.say(say(reader.payment), { shown: [["snapback"]] });
    expect(said.kinds).toEqual(["added", "payment_requested"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1", "Gorra snapback · Azul · ×1"]);
  });

  test("a photo whose caption only carries an instruction to the system still adds the shown product and reports a request not allowed", () => {
    const chat = createChat();
    expect(chat.say(say(reader.notAllowed), { shown: [["snapback"]] }).kinds).toEqual(["added", "request_not_allowed"]);
  });

  test("a photo whose caption is listo and a payment request still adds the shown product and reports the payment request", () => {
    const chat = createChat();
    const said = chat.say(say(reader.ready, reader.payment), { shown: [["snapback"]] });
    expect(said.kinds).toEqual(expect.arrayContaining(["added", "payment_requested", "ready"]));
    expect(chat.items()).toEqual(["Gorra snapback · Azul · ×1"]);
  });

  test("a declining caption still keeps the shown product out", () => {
    const chat = createChat();
    expect(chat.say(say({ kind: "decline_shown" }), { shown: [["snapback"]] }).kinds).toEqual(["no_intent"]);
    expect(chat.order).toBeNull();
  });

  test("an unnamed set in a product photo's caption gives the shown product that quantity and leaves the only item of the order unchanged", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]] });
    const said = chat.say(say(reader.change("unnamed", "set", 3)), { shown: [["polo"]] });
    expect(said.kinds).toEqual(["pending_created", "variant_missing"]);
    expect(chat.pendingLines()).toEqual(["Polo básico ×3 {}"]);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1"]);
  });

  test("an unnamed set in the caption of a single-variant product photo adds that product with the quantity", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]] });
    expect(chat.say(say(reader.change("unnamed", "set", 3)), { shown: [["snapback"]] }).kinds).toEqual(["added"]);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1", "Gorra snapback · Azul · ×3"]);
  });

  test("an unnamed increase in a product photo's caption still adds the shown product and reports an unnamed add", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]] });
    const said = chat.say(say(reader.change("unnamed", "increase", 1)), { shown: [["snapback"]] });
    expect(said.kinds).toEqual(["added", "unnamed_add"]);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1", "Gorra snapback · Azul · ×1"]);
  });

  test("an unnamed set beside an add of the shown product in a photo caption reports an unnamed add", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]] });
    const said = chat.say(say(add({ product: "snapback" }), reader.change("unnamed", "set", 3)), { shown: [["snapback"]] });
    expect(said.kinds).toEqual(["added", "unnamed_add"]);
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1", "Gorra snapback · Azul · ×1"]);
  });
});

describe("checkReaderAnswer: payment requests and malformed actions", () => {
  test("a payment request becomes a payment_requested report and changes nothing", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 1]] });
    const said = chat.say(say(reader.payment));
    expect(said.kinds).toEqual(["payment_requested"]);
    expect(outcomeOf(said, "payment_requested")).toMatchObject({ order: { kind: "open" }, productIds: [], unnamed: 0 });
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
  });

  test("an add and a not_allowed in one answer apply the add and report the request", () => {
    const chat = createChat();
    expect(chat.say(say(add({ product: "snapback" }), reader.notAllowed)).kinds).toEqual(["added", "request_not_allowed"]);
  });

  test("a malformed action reports invalid_action malformed and the rest of the answer applies", () => {
    const chat = createChat();
    const said = chat.say(say(add({ product: "snapback" }), { kind: "malformed" }));
    expect(said.kinds).toEqual(["added", "invalid_action"]);
    expect(outcomeOf(said, "invalid_action")).toMatchObject({ reason: "malformed" });
  });
});

describe("checkReaderAnswer: quantity changes", () => {
  test("a quantity change on a pending reference resolves to a pending quantity change", () => {
    const pending = pendingOf("polo");
    const chat = createChat({ pendings: [pending] });
    const [action] = checkReaderAnswer(say(reader.change("Q1", "decrease", 1)), chat.context(), { captionDoubt: false });
    expect(action).toMatchObject({ kind: "change_pending_quantity", pendingId: pending.id, mode: "decrease", quantity: 1, otherwise: { kind: "report", outcome: { kind: "unclear_item" } } });
  });

  test("an unknown pending reference in a quantity change reports invalid_action unknown_reference", () => {
    const chat = createChat({ pendings: [pendingOf("polo")] });
    expect(outcomeOf(chat.say(say(reader.change("Q9", "set", 3))), "invalid_action")).toMatchObject({ reason: "unknown_reference" });
  });

  test("a quantity change that is not whole reports invalid_action quantity_not_whole", () => {
    const chat = createChat({ pendings: [pendingOf("polo")], items: [["gorra", { Color: "Negro" }, 2]] });
    expect(outcomeOf(chat.say(say(reader.change("Q1", "set", 2.5))), "invalid_action")).toMatchObject({ reason: "quantity_not_whole" });
    expect(outcomeOf(chat.say(say(reader.change("I1", "decrease", 0))), "invalid_action")).toMatchObject({ reason: "quantity_not_whole" });
  });

  test("a named decrease on an item resolves to a lower_quantity", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 3]] });
    const [action] = checkReaderAnswer(say(reader.change("I1", "decrease", 1)), chat.context(), { captionDoubt: false });
    expect(action).toMatchObject({ kind: "lower_quantity", target: { kind: "variant" }, quantity: 1 });
  });

  test("an unnamed decrease with no photo just sent lowers the only item", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 3]] });
    expect(chat.say(say(reader.change("unnamed", "decrease", 1))).kinds).toEqual(["quantity_lowered"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×2"]);
  });

  test("an unnamed set with no photo just sent changes the only item as before", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 1]] });
    expect(chat.say(say(reader.change("unnamed", "set", 3))).kinds).toEqual(["quantity_changed"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×3"]);
  });
});

describe("checkReaderAnswer: the photo just sent", () => {
  const afterPhotoOfPolo = () => {
    const pending = pendingOf("polo");
    return { pending, chat: createChat({ pendings: [pending] }), left: { kind: "pending", pendingId: pending.id } as const };
  };

  test("an unnamed set of 0 in a product photo's caption keeps the shown add at ×1 and reports the quantity", () => {
    const chat = createChat();
    const said = chat.say(say(reader.change("unnamed", "set", 0)), { shown: [["snapback"]] });
    expect(said.kinds).toEqual(["added", "invalid_action"]);
    expect(said.outcomes[1]).toMatchObject({ kind: "invalid_action", reason: "quantity_not_whole" });
    expect(chat.items()).toEqual(["Gorra snapback · Azul · ×1"]);
  });

  test("an unnamed set in a text with no photo marker and no listed item is an unnamed add", () => {
    const chat = createChat();
    expect(chat.say(say(reader.change("unnamed", "set", 3))).kinds).toEqual(["unnamed_add"]);
    expect(chat.order).toBeNull();
  });

  test("a price stated with the quantity of the photo just sent is kept on the pending", () => {
    const { chat, left } = afterPhotoOfPolo();
    expect(chat.say(say(reader.complete(1, undefined, 3, null, stated("90"))), { photoJustSent: left }).kinds).toEqual(["pending_updated"]);
    expect(chat.pendings.pendings[0]).toMatchObject({ quantity: 3, price: { amount: { amount: 90 }, forQuantity: 3 } });
  });

  test("an unnamed set right after a photo that left a pending sets that pending", () => {
    const { chat, left } = afterPhotoOfPolo();
    expect(chat.say(say(reader.change("unnamed", "set", 3)), { photoJustSent: left }).kinds).toEqual(["pending_updated"]);
    expect(chat.pendingLines()).toEqual(["Polo básico ×3 {}"]);
  });

  test("an unnamed set right after a photo that grew an item sets that item even when the order has another single item", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 1], ["snapback", {}, 2]] });
    const left = { kind: "item", orderId: id(1) as OrderId, variantId: variantOf("snapback").variantId, quantity: 2 as PositiveInteger } as const;
    expect(chat.say(say(reader.change("unnamed", "set", 3)), { photoJustSent: left }).kinds).toEqual(["quantity_changed"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1", "Gorra snapback · Azul · ×3"]);
  });

  test("an unnamed set right after a photo that grew an item past the listed items sets that item", () => {
    const chat = createChat({ items: [["polo", M_NEGRO, 1], ["snapback", {}, 2]] });
    const left = { kind: "item", orderId: id(1) as OrderId, variantId: variantOf("snapback").variantId, quantity: 2 as PositiveInteger } as const;
    const context = { ...chat.context({ photoJustSent: left }), items: [] };
    const [action] = checkReaderAnswer(say(reader.change("unnamed", "set", 3)), context, { captionDoubt: false });
    expect(action).toMatchObject({ kind: "set_marked_item_quantity", orderId: id(1), variantId: left.variantId, expectedQuantity: 2, quantity: 3, otherwise: { kind: "report", outcome: { kind: "unnamed_add" } } });
  });

  test("an unnamed increase right after a photo is an unnamed add", () => {
    const { chat, left } = afterPhotoOfPolo();
    expect(chat.say(say(reader.change("unnamed", "increase", 2)), { photoJustSent: left }).kinds).toEqual(["unnamed_add"]);
    expect(chat.pendingLines()).toEqual(["Polo básico ×1 {}"]);
  });

  test("an unnamed add of a product right after a photo is an unnamed add", () => {
    const { chat, left } = afterPhotoOfPolo();
    const unnamedAdd: ReaderAction = { kind: "add", product: { kind: "unnamed" }, attributes: [], quantity: 2, price: null };
    expect(chat.say(say(unnamedAdd), { photoJustSent: left }).kinds).toEqual(["unnamed_add"]);
    expect(chat.pendingLines()).toEqual(["Polo básico ×1 {}"]);
  });

  test("a quantity-only pending completion on the photo's pending sets it", () => {
    const { chat, left } = afterPhotoOfPolo();
    expect(chat.say(say(reader.complete(1, undefined, 3)), { photoJustSent: left }).kinds).toEqual(["pending_updated"]);
    expect(chat.pendingLines()).toEqual(["Polo básico ×3 {}"]);
  });

  test("a quantity-only pending completion with no photo just sent is an unnamed add", () => {
    const { chat } = afterPhotoOfPolo();
    expect(chat.say(say(reader.complete(1, undefined, 3))).kinds).toEqual(["unnamed_add"]);
    expect(chat.pendingLines()).toEqual(["Polo básico ×1 {}"]);
  });

  test("a pending completion with values right after a photo completes the pending with the stated quantity", () => {
    const { chat, left } = afterPhotoOfPolo();
    expect(chat.say(say(reader.complete(1, M_NEGRO, 3)), { photoJustSent: left }).kinds).toEqual(["pending_completed", "added"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×3"]);
  });

  test("a photo context never resolves an unnamed set onto a marker, even if one is supplied", () => {
    const gorra = pendingOf("gorra");
    const chat = createChat({ pendings: [gorra] });
    const said = chat.say(say(reader.change("unnamed", "set", 3)), { shown: [["polo"]], photoJustSent: { kind: "pending", pendingId: gorra.id } });
    expect(said.kinds).toEqual(["pending_created", "variant_missing"]);
    expect(chat.pendingLines()).toEqual(["Gorra trucker ×1 {}", "Polo básico ×3 {}"]);
  });

  test("a marker on a context that is not a text is ignored for a quantity-only completion too", () => {
    const { chat, left } = afterPhotoOfPolo();
    const said = chat.say(say(reader.complete(1, undefined, 3)), { kind: "photo_not_product", photoJustSent: left });
    expect(said.kinds).toEqual(["image_with_request"]);
    expect(chat.pendingLines()).toEqual(["Polo básico ×1 {}"]);
  });
});

describe("checkReaderAnswer: products with the same name", () => {
  const twinsOf = (notSellableName: string) => {
    const chat = createChat();
    const context = chat.context();
    return { ...context, products: context.products.map((product) => (product.ref === catalog.oversize.ref ? { ...product, name: notSellableName, nameKey: productNameKey(notSellableName), sellable: false } : product)) };
  };
  const choose = (context: ReturnType<typeof twinsOf>) => checkReaderAnswer(say(reader.oneOf(["polo", "oversize"], M_NEGRO)), context, { captionDoubt: false });

  test("a one_of between a sellable product and a not-sellable one with the same name chooses the sellable one", () => {
    expect(choose(twinsOf("Polo básico"))).toMatchObject([{ kind: "add", item: { productName: "Polo básico" } }]);
  });

  test("a one_of between a sellable product and a not-sellable one named the same up to accents and case chooses the sellable one", () => {
    expect(choose(twinsOf("POLO BASICO"))).toMatchObject([{ kind: "add", item: { productName: "Polo básico" } }]);
  });

  test("a one_of between two sellable products or two differently named ones is still a doubt", () => {
    expect(choose(twinsOf("Polo oversize"))[0]).toMatchObject({ kind: "draft_pending" });
    const twoSellable = { ...twinsOf("Polo básico"), products: twinsOf("Polo básico").products.map((product) => ({ ...product, sellable: true })) };
    expect(choose(twoSellable)[0]).toMatchObject({ kind: "draft_pending" });
  });
});

describe("checkReaderAnswer: products not available", () => {
  test("an add of a listed not-sellable product reports product_not_available", () => {
    const chat = createChat({ unsellable: ["gorra"] });
    const said = chat.say(say(add({ product: "gorra", attributes: { Color: "Rojo" } })));
    expect(said.kinds).toEqual(["product_not_available"]);
    expect(chat.order).toBeNull();
  });
});
