import { describe, expect, test } from "vitest";
import type { ProductId } from "@core/src/features/products/domain/product";
import { contextMessage, extractionInput, intent, item, pending, readingInput } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction-test-support";
import { renderExtractionInput } from "@core/src/features/orders/infrastructure/reader/stages/extraction/render-extraction-input";

const intents = [intent(1, "add", "quiero dos"), intent(2, "ready", "listo")];
const render = (input = readingInput(), maxChars?: number) => renderExtractionInput(extractionInput(input, intents), maxChars);

describe("extraction input rendering", () => {
  test("names a pending's product with what is known and, per open attribute, the sellable values", () => {
    const rendered = render(readingInput({ pendings: [pending(1, { productNames: ["Polera con capucha"], known: { Talla: "M" }, missing: [{ name: "Color", values: ["Gris", "Negro"] }] })] }));

    expect(rendered).toContain("Q1: Polera con capucha · known: Talla M · missing: Color (Gris, Negro) · quantity 1");
  });

  test("lists the requests with their kind and quote, then the context, and ends with the buyer's message", () => {
    const text = render(readingInput({
      current: { messageId: "m" as never, kind: "text", text: "quiero dos y listo" },
      context: [contextMessage(1, { text: "hola" }), contextMessage(2, { direction: "outgoing", text: "¿cuál?", masked: true })],
      items: [item(1, { productName: "Polo básico", variantAttributes: { Talla: "M", Color: "Negro" }, quantity: 3 as never })],
      pendings: [pending(1, { known: { Talla: "L" }, doubtful: true, productIds: ["a", "b"] as ProductId[] })],
    }));

    expect(text).toContain("R1 (add): «quiero dos»");
    expect(text).toContain("R2 (ready): «listo»");
    expect(text).toContain("M1 (buyer, text): hola");
    expect(text).toContain("M2 (seller, text): ¿cuál?");
    expect(text).toContain("I1: Polo básico · Talla M · Color Negro · quantity 3");
    expect(text).toContain("Q1: a choice between 2 products · known: Talla L · quantity 1 · in doubt");
    expect(text.endsWith("Buyer's message:\nquiero dos y listo")).toBe(true);
    expect(text).not.toContain("product-1");
  });

  test("states the photo facts that decide the photo targets", () => {
    expect(render(readingInput({ current: { messageId: "m" as never, kind: "image", text: "lo quiero" }, photo: { productId: "p" as ProductId } }))).toContain("caption of a photo");
    expect(render(readingInput({ photoMemory: { left: { kind: "pending", pendingId: "x" as never } } }))).toContain("previous message was a photo that left a pending");
    expect(render(readingInput({ photoMemory: { left: null } }))).toContain("left nothing");
    expect(render(readingInput())).toContain("text message");
  });

  test("states the currency of the shop's prices when it is known", () => {
    expect(render(readingInput({ currency: "PEN" }))).toContain("Prices of this shop are in PEN.");
    expect(render(readingInput())).not.toContain("Prices of this shop");
  });

  test("cuts a long quote of a request", () => {
    const text = renderExtractionInput(extractionInput(readingInput(), [intent(1, "add", "x".repeat(900))]));

    expect(text).toContain("R1 (add): «" + "x".repeat(200) + "»");
    expect(text).not.toContain("x".repeat(201));
  });

  const long = (length: number, character = "a") => character.repeat(length);
  const limits = (character: string) => readingInput({
    current: { messageId: "m" as never, kind: "text", text: long(2000, character) },
    context: Array.from({ length: 12 }, (_, index) => contextMessage(index + 1, { text: long(500, character) })),
    items: Array.from({ length: 40 }, (_, index) => item(index + 1, { productName: long(200, character), variantAttributes: { [long(30, character)]: long(30, character), [long(29, character) + "b"]: long(30, character), [long(29, character) + "c"]: long(30, character) } })),
    pendings: Array.from({ length: 10 }, (_, index) => pending(index + 1, { known: { Talla: "M" }, productIds: ["a", "b", "c", "d"] as ProductId[] })),
  });

  test("never passes the stage budget on the real rendered text at every limit", () => {
    for (const maxChars of [3000, 8000, 24_000]) expect(render(limits("語"), maxChars).length).toBeLessThanOrEqual(maxChars);
    expect(render(limits("a")).length).toBeLessThanOrEqual(24_000);
  });

  test("drops the oldest context messages first, then fills items newest first and pendings", () => {
    const base = readingInput({ context: [contextMessage(1, { text: "primero" + long(900) }), contextMessage(2, { text: "segundo" + long(900) })],
      items: [item(1), item(2)], pendings: [pending(1)] });
    const full = render(base);

    const withoutOldest = render(base, full.length - 200);
    expect(withoutOldest).not.toContain("primero");
    expect(withoutOldest).toContain("segundo");

    const tight = render({ ...base, items: Array.from({ length: 40 }, (_, index) => item(index + 1, { productName: long(150) })) }, 3000);
    expect(tight.length).toBeLessThanOrEqual(3000);
    expect(tight).not.toContain("primero");
    expect(tight).toContain("I40:");
    expect(tight).not.toContain("I1:");
  });
});
