import type { BuyerPaymentView } from "@shared/contracts/orders";
import type { CheckoutDeliveryOptions, PublicCheckoutResponse } from "@shared/contracts/order-checkout";
import type { PreviewPaymentMethod } from "@core/src/features/checkout-appearance/application/checkout-appearance";

export type PreviewState = "review" | "payment";

const pen = (amount: number) => ({ amount, currency: "PEN" } as const);
export const previewOrderId = "00000000-0000-4000-8000-000000000000";

/** Sample methods shown, and labelled as such, when the company has not configured its own. */
export const samplePaymentMethods: readonly PreviewPaymentMethod[] = [
  { method: "digital_wallet", provider: "Billetera de ejemplo", holder: "Titular de ejemplo", imageUrl: null },
  { method: "bank_transfer", bank: "Banco de ejemplo", holder: "Titular de ejemplo", accountNumber: "000-0000000-0-00", cci: "00000000000000000000", imageUrl: null },
];

export const previewDeliveryOptions: CheckoutDeliveryOptions = {
  home: { enabled: false }, agency: { enabled: false },
  store: { enabled: true, pickupPoint: { name: "Tienda de ejemplo", address: "Av. Ejemplo 123, Lima", instructions: null } },
};

export function previewCheckout(companyName: string, state: PreviewState): PublicCheckoutResponse {
  const pending = state === "review";
  return {
    companyName, number: 1001, buyer: { name: "Ana Pérez", phone: "+51987654321" },
    items: [
      { productName: "Producto de ejemplo", variantAttributes: { Talla: "M" }, sku: null, quantity: 2, unitPrice: pen(49), subtotal: pen(98) },
      { productName: "Otro producto de ejemplo", variantAttributes: {}, sku: null, quantity: 1, unitPrice: pen(20), subtotal: pen(20) },
    ],
    itemsTotal: pen(118), deliveryCharge: pen(pending ? 0 : 10), total: pen(pending ? 118 : 128), delivery: null,
    state: pending ? { kind: "pending" } : { kind: "confirmed", confirmedAt: "2026-01-01T12:00:00.000Z" },
  };
}

export function previewPaymentView(methods: readonly PreviewPaymentMethod[]): BuyerPaymentView {
  return {
    orderId: previewOrderId, total: pen(128), deliveryCharge: pen(10), availability: "available",
    paidAmount: pen(0), balanceDue: pen(128), paymentStatus: "pending", settings: [...methods], payments: [],
  };
}
