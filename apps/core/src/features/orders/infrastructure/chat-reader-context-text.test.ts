import { describe, expect, test } from "vitest";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { context, id, pending, productId, readingProduct } from "@core/src/features/orders/infrastructure/chat-reading-fixtures";
import { describeReadingContext } from "@core/src/features/orders/infrastructure/chat-reader-context-text";

describe("describeReadingContext", () => {
  test("describes pendings with their known values and missing attributes", () => {
    const polo = readingProduct(1, "Polo básico", [[{ Talla: "S", Color: "Negro" }, 40], [{ Talla: "M", Color: "Negro" }, 40], [{ Talla: "M", Color: "Blanco" }, 40], [{ Talla: "S", Color: "Blanco" }, 40]]);
    const gorra = readingProduct(2, "Gorra", [[{}, 15]]);
    const text = describeReadingContext(context({
      products: [polo, gorra],
      pendings: [
        { ref: "Q1", photoJustSent: false, pending: pending(1, { known: { Talla: "M" }, quantity: 3 as PositiveInteger, price: { amount: { amount: 35, currency: "PEN" }, per: "unit", forQuantity: 3 as PositiveInteger } }) },
        { ref: "Q2", photoJustSent: false, pending: pending(2, { subject: { kind: "product", candidates: [productId(1), productId(2)] } }) },
      ],
    }));
    expect(text).toContain("Q1: Polo básico (P1). Known: Talla M. Missing: Color. Quantity: 3. Stated price: PEN 35.00 per unit");
    expect(text).toContain("Q2: one of Polo básico (P1), Gorra (P2). Quantity: 1.");
    expect(text).not.toContain("Q2: one of Polo básico (P1), Gorra (P2). Known");
  });

  test("describes a product's prices once when every variant shares one, grouped otherwise", () => {
    const same = readingProduct(1, "Polo", [[{ Talla: "S" }, 40], [{ Talla: "M" }, 40]]);
    const different = readingProduct(2, "Casaca", [[{ Talla: "S" }, 100], [{ Talla: "M" }, 120], [{ Talla: "L" }, 120]]);
    const text = describeReadingContext(context({ products: [same, different] }));
    expect(text).toContain("P1 Polo — for sale\n  Talla: S, M\n  Price: PEN 40.00");
    expect(text).toContain("P2 Casaca — for sale\n  Talla: S, M, L\n  Prices in PEN:\n  100.00: Talla S\n  120.00: Talla M; Talla L");
  });

  test("lists the shorter of the sellable and the missing combinations", () => {
    const grid = (skip: string[]): [Record<string, string>, number][] => ["S", "M", "L"].flatMap((Talla) => ["Negro", "Blanco", "Rojo"].map((Color): [Record<string, string>, number] => [{ Talla, Color }, 50]))
      .filter(([{ Talla, Color }]) => !skip.includes(`${Talla} ${Color}`));
    const fewMissing = describeReadingContext(context({ products: [readingProduct(1, "Short", grid(["S Rojo", "L Blanco"]))] }));
    expect(fewMissing).toContain("Not sold: Talla S · Color Rojo; Talla L · Color Blanco");
    expect(fewMissing).not.toContain("Sold combinations");
    const manyMissing = describeReadingContext(context({ products: [readingProduct(1, "Short", grid(["S Blanco", "S Rojo", "M Negro", "M Rojo", "L Negro", "L Blanco"]))] }));
    expect(manyMissing).toContain("Sold combinations: Talla S · Color Negro; Talla M · Color Blanco; Talla L · Color Rojo");
    expect(manyMissing).not.toContain("Not sold");
    const full = describeReadingContext(context({ products: [readingProduct(1, "Short", grid([]))] }));
    expect(full).not.toMatch(/Not sold|Sold combinations/);
  });

  test("lists each combination with its price when prices differ", () => {
    const text = describeReadingContext(context({ products: [readingProduct(1, "Short", [[{ Talla: "S", Color: "Negro" }, 40], [{ Talla: "M", Color: "Negro" }, 45]])] }));
    expect(text).toContain("Prices in PEN:\n  40.00: Talla S · Color Negro\n  45.00: Talla M · Color Negro");
  });

  test("describes a non-sellable product of an order item without its variants", () => {
    const archived = readingProduct(3, "Chompa", [[{ Talla: "M" }, 90]], { sellable: false });
    const text = describeReadingContext(context({
      products: [archived],
      items: [{ ref: "I1", variantId: id(1) as VariantId, productId: productId(3), productName: "Chompa", variantAttributes: { Talla: "M" }, quantity: 2, unitPrice: { amount: 90, currency: "PEN" }, photoJustSent: false }],
    }));
    expect(text).toContain("I1: Chompa (P3) · Talla M · quantity 2 · PEN 90.00 each");
    expect(text).toContain("P3 Chompa — not for sale");
    expect(text).not.toMatch(/Talla: M|PEN 90.00\n/);
  });

  test("names the shown product of a photo and the kind of message", () => {
    const shown = readingProduct(1, "Polo", [[{ Talla: "S" }, 40], [{ Talla: "M" }, 40]], { shown: true, shownVariantId: id(1000 + 101) as VariantId });
    const photo = describeReadingContext(context({ kind: "photo_product", text: "dos", products: [shown] }));
    expect(photo).toContain("The photo shows P1 Polo, variant Talla M.");
    expect(photo).toContain("Message kind: caption of a product photo");
    expect(describeReadingContext(context({ kind: "photo_not_product", text: "precio?" }))).toContain("The photo shows no catalog product");
  });

  test("never writes ids, phones or order numbers and puts the buyer's text last", () => {
    const text = describeReadingContext(context({ text: "quiero 2", products: [readingProduct(1, "Polo", [[{}, 40]])],
      items: [{ ref: "I1", variantId: id(7) as VariantId, productId: productId(1), productName: "Polo", variantAttributes: {}, quantity: 1, unitPrice: { amount: 40, currency: "PEN" }, photoJustSent: false }] }));
    expect(text).not.toMatch(/0000-4000|#\d/);
    expect(text.endsWith("Buyer's message:\nquiero 2")).toBe(true);
  });
});
