import type { Money } from "@shared/money";
import type { BuyerPaymentView } from "@shared/contracts/orders";
import type { CheckoutDeliveryOptions, PublicCheckoutResponse } from "@shared/contracts/order-checkout";
import type { PreviewPaymentMethod } from "@core/src/features/store-appearance/application/store-appearance";

export type PreviewState = "review" | "payment";

const pen = (amount: number) => ({ amount, currency: "PEN" } as const);
export const previewOrderId = "00000000-0000-4000-8000-000000000000";

/** Sample methods shown, and labelled as such, when the company has not configured its own. */
export const samplePaymentMethods: readonly PreviewPaymentMethod[] = [
  { method: "digital_wallet", provider: "Billetera de ejemplo", holder: "Titular de ejemplo", imageUrl: "/checkout-preview/sample-qr.svg" },
  { method: "bank_transfer", bank: "Banco de ejemplo", holder: "Titular de ejemplo", accountNumber: "000-0000000-0-00", cci: "00000000000000000000", imageUrl: null },
];

/** A catalog card as the preview draws it; the same fields the buyer catalog list carries. */
export type SampleCatalogCard = Readonly<{
  id: string; name: string; imageUrl: string | null; price: Readonly<{ kind: "single" | "from"; amount: Money }>; soldOut: boolean;
}>;

/** Shown, and labelled as such, when the company has no visible products or they cannot be read. */
export const sampleCatalogCards: readonly SampleCatalogCard[] = [
  { id: "sample-1", name: "Producto de ejemplo", imageUrl: "/checkout-preview/sample-product.svg", price: { kind: "single", amount: pen(49) }, soldOut: false },
  { id: "sample-2", name: "Otro producto de ejemplo", imageUrl: null, price: { kind: "from", amount: pen(20) }, soldOut: false },
  { id: "sample-3", name: "Tercer producto de ejemplo", imageUrl: null, price: { kind: "single", amount: pen(35) }, soldOut: false },
];

export const previewDeliveryOptions: CheckoutDeliveryOptions = {
  home: { enabled: false }, agency: { enabled: false, covered: false },
  store: { enabled: true, pickupPoint: { name: "Tienda de ejemplo", address: "Av. Ejemplo 123, Lima", instructions: null } },
};

export function previewCheckout(companyName: string, state: PreviewState): PublicCheckoutResponse {
  const pending = state === "review";
  return {
    companyName, number: 1001, buyer: { name: "Ana Pérez", phone: "+51987654321" },
    items: [
      { productName: "Producto de ejemplo", variantAttributes: { Talla: "M" }, sku: null, imageUrl: "/checkout-preview/sample-product.svg", quantity: 2, unitPrice: pen(49), subtotal: pen(98) },
      { productName: "Otro producto de ejemplo", variantAttributes: {}, sku: null, imageUrl: null, quantity: 1, unitPrice: pen(20), subtotal: pen(20) },
    ],
    itemsTotal: pen(118), deliveryCharge: pen(pending ? 0 : 10), total: pen(pending ? 118 : 128), delivery: null,
    state: pending ? { kind: "pending" } : { kind: "confirmed", confirmedAt: "2026-01-01T12:00:00.000Z" },
  };
}

export function previewPaymentView(methods: readonly PreviewPaymentMethod[]): BuyerPaymentView {
  return {
    orderId: previewOrderId, total: pen(128), deliveryCharge: pen(10), availability: "available",
    paidAmount: pen(0), balanceDue: pen(128), paymentStatus: "pending", settings: [...methods], payments: [], rejectedReport: null,
  };
}
