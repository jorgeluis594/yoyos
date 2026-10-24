import { expect, test } from "vitest";
import { listOrderAggregatesResponseSchema, orderListLoaderSchema } from "@shared/contracts/orders";
import { buildPendingOrder } from "@core/src/features/orders/domain/order-state-machine";
import type { DeliverySnapshot, OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { toOrderAggregateListJson, toOrderListDispatchFields } from "@core/src/features/orders/presentation/order-json";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const district = (name: string) => ({ country: "PE", districtCode: "150122", district: name, province: "LIMA METROPOLITANA", department: "LIMA" }) as const;
const recipient = { name: "Ana", phone: "999", identity: { kind: "absent" } } as const;
const documented = { ...recipient, identity: { kind: "document", documentType: "passport", document: "001" } } as const;
const pricing = { quotationId: id(11), rateId: id(12), optionId: id(13), settingsVersion: 1 };
const recordedBy = { kind: "buyer" } as const;

const snapshots = {
  home: { method: "home", recipient, destination: { ...district("MIRAFLORES"), address: "Av. Test 123", instructions: null }, pricing, recordedBy },
  agency: { method: "agency", recipient: documented, destination: district("SURCO"), pricing, courier: { id: id(14), name: "Olva" },
    agency: { id: id(15), name: "Sede", address: "Jr. Sede 1", location: district("LA VICTORIA") }, recordedBy },
  store: { method: "store", recipient, pickupPoint: { name: "Tienda", address: "Calle 1", instructions: null }, settingsVersion: 1, recordedBy },
} as unknown as Record<string, DeliverySnapshot>;

function order(delivery: DeliverySnapshot | null, cancelled = false): OrderAggregate {
  const built = buildPendingOrder({ number: 1001 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId,
    sellerId: "seller" as UserId, customer: { kind: "general_public" }, createdAt: new Date("2026-09-28T12:00:00Z"),
    items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Producto", variantAttributes: {}, sku: null, quantity: 1,
      unitPrice: { amount: 10, currency: "PEN" } }] });
  if (!built.success) throw new Error(built.error.message);
  return { ...built.data, delivery, cancelled };
}

test.each([
  ["home delivery uses the destination district", snapshots.home, false, { deliveryMethod: "home", district: "MIRAFLORES" }],
  ["agency delivery uses the agency branch district, not the buyer's destination", snapshots.agency, false, { deliveryMethod: "agency", district: "LA VICTORIA" }],
  ["store pickup has no district", snapshots.store, false, { deliveryMethod: "pickup", district: null }],
  ["an order without delivery has no method nor district", null, false, { deliveryMethod: "none", district: null }],
  ["a cancelled order keeps its stored snapshot", snapshots.home, true, { deliveryMethod: "home", district: "MIRAFLORES" }],
  ["a cancelled order without delivery stays none", null, true, { deliveryMethod: "none", district: null }],
] as const)("%s", (_name, delivery, cancelled, expected) => {
  expect(toOrderListDispatchFields(order(delivery, cancelled))).toEqual(expected);
});

test("the mobile list JSON never carries the web-only dispatch fields", () => {
  const page = { items: [order(snapshots.agency), order(snapshots.home)], page: 1, pageSize: 20 as const, total: 2 };
  const json = toOrderAggregateListJson(page);
  expect(json.items.every((item) => !("deliveryMethod" in item) && !("district" in item))).toBe(true);
  expect(listOrderAggregatesResponseSchema.safeParse({ ...json, items: json.items.map((item) => ({ ...item, deliveryMethod: "home" })) }).success).toBe(false);
  expect(listOrderAggregatesResponseSchema.safeParse({ ...json, items: json.items.map((item) => ({ ...item, district: "X" })) }).success).toBe(false);
});

test("the web loader item schema requires the dispatch fields", () => {
  const json = toOrderAggregateListJson({ items: [order(snapshots.home)], page: 1, pageSize: 20, total: 1 });
  const item = { ...json.items[0], itemCount: 1, balanceDue: { amount: 10, currency: "PEN" } };
  const parse = (extra: object) => orderListLoaderSchema.safeParse({ list: { ...json, items: [{ ...item, ...extra }] }, filters: { page: 1, customer: "all" }, base: "/orders" });
  expect(parse({ deliveryMethod: "home", district: "MIRAFLORES" }).success).toBe(true);
  expect(parse({ deliveryMethod: "none", district: null }).success).toBe(true);
  expect(parse({}).success).toBe(false);
  expect(parse({ deliveryMethod: "store", district: null }).success).toBe(false);
});
