import { describe, expect, test } from "vitest";
import { editOrderRequestSchema, editOrderResultSchema, orderRevisionSchema } from "@core/src/features/orders/presentation/order-edit-schemas";

const revision = "A".repeat(43);
const variantId = "00000000-0000-4000-8000-000000000101";
const lines = [{ variantId, quantity: 2 }];
const recipient = { name: "Ana", phone: "999", identity: { kind: "absent" as const } };

describe("edit order request", () => {
  test("accepts a request with only the items part", () => {
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", items: { base: revision, lines } }).success).toBe(true);
  });

  test("rejects a request without any part", () => {
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes" }).success).toBe(false);
  });

  test("rejects an unknown operation and unknown keys", () => {
    expect(editOrderRequestSchema.safeParse({ operation: "other", items: { base: revision, lines } }).success).toBe(false);
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", payments: [], items: { base: revision, lines } }).success).toBe(false);
  });

  test("rejects a quantity of 0 or above 9999", () => {
    for (const quantity of [0, 10000, 1.5]) {
      expect(editOrderRequestSchema.safeParse({ operation: "save_changes", items: { base: revision, lines: [{ variantId, quantity }] } }).success).toBe(false);
    }
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", items: { base: revision, lines: [{ variantId, quantity: 9999 }] } }).success).toBe(true);
  });

  test("rejects an empty list of lines and more than 100 lines", () => {
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", items: { base: revision, lines: [] } }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, index) => ({ variantId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, quantity: 1 }));
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", items: { base: revision, lines: many } }).success).toBe(false);
  });

  test("rejects a revision that is not a 43-character token", () => {
    expect(orderRevisionSchema.safeParse("short").success).toBe(false);
    expect(orderRevisionSchema.safeParse(`${"A".repeat(42)}=`).success).toBe(false);
  });

  test("accepts a customer set to null and rejects an invalid phone", () => {
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", customer: { base: revision, value: null } }).success).toBe(true);
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", customer: { base: revision, value: { name: "Ana", phone: "999" } } }).success).toBe(false);
  });

  test("rejects an agency amendment without identity document", () => {
    const amendment = { method: "agency", recipient };
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", delivery: { base: revision, change: { kind: "amend", amendment } } }).success).toBe(false);
    const documented = { method: "agency", recipient: { ...recipient, identity: { kind: "document", documentType: "national_id", document: "12345678" } } };
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", delivery: { base: revision, change: { kind: "amend", amendment: documented } } }).success).toBe(true);
  });

  test("turns an empty reference into null", () => {
    const amendment = { method: "home", recipient, address: " Av. Lima 123 ", instructions: "" };
    const parsed = editOrderRequestSchema.safeParse({ operation: "save_changes", delivery: { base: revision, change: { kind: "amend", amendment } } });
    expect(parsed).toMatchObject({ success: true, data: { delivery: { change: { amendment: { address: "Av. Lima 123", instructions: null } } } } });
  });

  test("rejects an amendment with a blank address", () => {
    const amendment = { method: "home", recipient, address: "  ", instructions: null };
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", delivery: { base: revision, change: { kind: "amend", amendment } } }).success).toBe(false);
  });

  test("accepts a replace change that carries the expected price", () => {
    const selection = { method: "store", recipient };
    const change = { kind: "replace", selection, expectedPrice: { amount: 0, currency: "PEN" } };
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", delivery: { base: revision, change } }).success).toBe(true);
    expect(editOrderRequestSchema.safeParse({ operation: "save_changes", delivery: { base: revision, change: { kind: "replace", selection } } }).success).toBe(false);
  });
});

describe("edit order result", () => {
  test("requires revisions, a nullable line catalog and the applied parts", () => {
    expect(editOrderResultSchema.shape.applied.safeParse(["items", "customer"]).success).toBe(true);
    expect(editOrderResultSchema.shape.applied.safeParse(["payments"]).success).toBe(false);
    expect(editOrderResultSchema.shape.lineCatalog.safeParse(null).success).toBe(true);
    expect(editOrderResultSchema.shape.lineCatalog.safeParse({ [variantId]: { stock: 3 } }).success).toBe(true);
    expect(editOrderResultSchema.shape.lineCatalog.safeParse({ [variantId]: { stock: -1 } }).success).toBe(false);
    expect(editOrderResultSchema.shape.revisions.safeParse({ items: revision, customer: revision, delivery: revision }).success).toBe(true);
    expect(editOrderResultSchema.shape.revisions.safeParse({ items: revision, customer: revision }).success).toBe(false);
  });
});
