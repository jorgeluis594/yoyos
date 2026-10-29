import { describe, expect, test } from "vitest";
import { checkReaderAnswer, fixedShownAnswer, type ReaderAction, type ReaderItem } from "@core/src/features/orders/domain/chat-reading";
import { catalog, createChat, doubtfulPendingOf, pendingOf, productId, reader, stated, type ProductKey } from "@core/src/features/orders/domain/chat-reading-fixtures";

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
    expect(chat.say(say({ kind: "change_quantity", item: item("I1"), mode: "set", quantity: 0 })).kinds).toEqual(["removed"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
  });

  test("lets removal and quantity change of an item whose product was deactivated through", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1], ["polo", { Talla: "M", Color: "Negro" }, 1]], unsellable: ["gorra"] });
    expect(chat.say(say({ kind: "change_quantity", item: item("I1"), mode: "set", quantity: 2 })).kinds).toEqual(["quantity_changed"]);
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
    expect(chat.say(say({ kind: "change_quantity", item: item("I1"), mode: "set", quantity: -2 })).outcomes).toEqual([{ kind: "invalid_action", orderId: chat.order?.id, reason: "quantity_not_whole" }]);
    expect(chat.say(say({ kind: "change_quantity", item: item("I1"), mode: "increase", quantity: 1.5 })).outcomes).toEqual([{ kind: "invalid_action", orderId: chat.order?.id, reason: "quantity_not_whole" }]);
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
    expect(chat.say(say({ kind: "malformed" })).outcomes).toEqual([{ kind: "invalid_action", orderId, reason: "unknown_reference" }]);
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
