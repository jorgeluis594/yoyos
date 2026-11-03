import { describe, expect, test } from "vitest";
import { buildCheckSnapshot, type SnapshotInput } from "@core/src/features/orders/application/reader/build-check-snapshot";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import type { ContextMessageRef, ItemRef, ReadingInput } from "@core/src/features/orders/domain/reader/readings";
import type { OrderItemId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

const productId = "00000000-0000-4000-8000-000000000021" as ProductId;
const variantId = "00000000-0000-4000-8000-0000000000a1" as VariantId;
const itemId = (n: number) => `00000000-0000-4000-8000-00000000010${n}` as OrderItemId;
const line = (n: number, quantity: number) => ({ id: itemId(n), variantId, productName: "Polera gris", variantAttributes: { Talla: "L" }, sku: null, quantity: quantity as PositiveInteger,
  unitPrice: { amount: 35, currency: "PEN" as const }, subtotal: { amount: 35, currency: "PEN" as const }, stockDeductedQuantity: 0 });
const target = (quantity: number): ChatOrderTarget => ({ kind: "open", order: { id: "o1", items: [line(1, quantity)] } as unknown as OrderAggregate, productIds: new Map([[variantId, productId]]) });
const reading = { current: { messageId: "m" as never, kind: "text", text: "x" }, context: [], pendings: [], photoMemory: null, photo: null,
  items: [{ ref: "I1" as ItemRef, itemId: itemId(1), productId, variantId, productName: "Polera gris", variantAttributes: { Talla: "L" }, quantity: 1 as PositiveInteger }] } as ReadingInput;
const product = { productId, name: "Polera gris", sellable: true, attributes: [], variants: [] } as unknown as ProductForReading;
const input = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({ kind: "text", language: "es", reading, products: [product], shown: [], target: target(1), alive: [], memory: null, photo: null, ...over });

describe("buildCheckSnapshot", () => {
  test("lists the lines the stages saw by their refs with the locked quantity", () => {
    const snapshot = buildCheckSnapshot(input({ target: target(3) }));

    expect(snapshot.items).toEqual([expect.objectContaining({ ref: "I1", variantId, quantity: 3, productId })]);
    expect(snapshot.order).toBe("open");
  });

  test("drops a line that left the order after the stages read it", () => {
    const snapshot = buildCheckSnapshot(input({ target: { kind: "none" } }));

    expect(snapshot.items).toEqual([]);
    expect(snapshot.order).toBe("none");
  });

  test("marks the product a photo showed and reports a closed order", () => {
    const snapshot = buildCheckSnapshot(input({ shown: [{ productId, preselectedVariantId: variantId, identification: { method: "qr", productId, confidence: null } }], target: { kind: "closed", orderId: "o1" as never, number: 1 as never } }));

    expect(snapshot.products[0]).toMatchObject({ shown: true, shownVariantId: variantId });
    expect(snapshot.order).toBe("closed");
  });

  test("tells what the latest photo of the window did", () => {
    const photo = (outcomes: unknown) => ({ ref: "M1" as ContextMessageRef, outcome: { outcomes, noticeSentAt: null } as never });
    const added = [{ kind: "added", variantId, quantity: 1, identification: { method: "visual", productId, confidence: 0.9 } }];

    expect(buildCheckSnapshot(input({ photo: photo(added) })).lastPhoto).toEqual({ kind: "product", productId, added: true });
    expect(buildCheckSnapshot(input({ photo: photo(added) })).contextProducts.get("M1" as ContextMessageRef)).toEqual([productId]);
    expect(buildCheckSnapshot(input({ photo: photo([{ kind: "not_identified", source: "photo", identification: null, silent: false }]) })).lastPhoto).toEqual({ kind: "not_identified" });
    expect(buildCheckSnapshot(input()).lastPhoto).toEqual({ kind: "none" });
  });
});
