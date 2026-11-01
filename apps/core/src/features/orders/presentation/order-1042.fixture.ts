import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { initialDraft, type LoadedOrder } from "@core/src/features/orders/presentation/order-view-state";

/** Order #1042 of the product draft as the detail loader serves it: three lines, a S/ 150.00 Yape payment, a home delivery chosen by the seller. */
export const orderId = "00000000-0000-4000-8000-000000001042";
export const companyId = "00000000-0000-4000-8000-0000000000c1";
export const trajeM = "00000000-0000-4000-8000-0000000000a1";
export const trajeL = "00000000-0000-4000-8000-0000000000a2";
export const deadpoolM = "00000000-0000-4000-8000-0000000000b1";
export const rateId = "00000000-0000-4000-8000-0000000000e1";
const revision = (letter: string) => letter.repeat(43);
export const revisions = { items: revision("A"), customer: revision("B"), delivery: revision("C") };
export const pen = (amount: number) => ({ amount, currency: "PEN" as const });

const item = (id: string, variantId: string, name: string, size: string, price: number, quantity = 1) => ({
  id, variantId, productName: name, variantAttributes: { Talla: size }, sku: null, quantity, unitPrice: pen(price), subtotal: pen(price * quantity), mentionedPrice: null,
});
export const recipient = { name: "Jorge Gonzalez", phone: "+51977909427", identity: { kind: "absent" as const } };
export const homeDelivery = {
  method: "home" as const, recipient,
  destination: { address: "Av. Lima 123", district: "Miraflores", instructions: "Puerta azul", country: "PE" as const, districtCode: "150122", province: "Lima", department: "Lima" },
  pricing: { quotationId: "00000000-0000-4000-8000-0000000000f1", rateId, optionId: "00000000-0000-4000-8000-0000000000f2", settingsVersion: 1 },
  recordedBy: { kind: "seller" as const, userId: "user-1" },
};
export const yape = {
  id: "00000000-0000-4000-8000-0000000000d1", orderId, status: "confirmed" as const, amount: pen(150), method: "digital_wallet" as const, walletProvider: "yape" as const,
  data: { confirmedAt: "2026-10-30T09:20:00.000Z", confirmedBy: { kind: "seller" as const, userId: "user-1" }, evidence: { kind: "manual" as const } },
};

export function order1042(patch: Partial<OrderAggregateResponse> = {}): OrderAggregateResponse {
  return {
    checkoutEnabledAt: null, checkoutConfirmedAt: null, number: 1042, id: orderId, companyId, sellerId: "user-1", buyer: { contactId: null, name: "Jorge Gonzalez", phone: "+51977909427" },
    source: "manual", createdAt: "2026-10-30T09:10:00.000Z", scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelledAt: null, stockDeductedAt: null, status: "active",
    paymentStatus: "pending", paidAmount: pen(150), balanceDue: pen(148), overpaidAmount: pen(0), cancelled: false, delivery: homeDelivery, deliveryStatus: "pending",
    stockDeducted: false, stockDue: null,
    items: [item("00000000-0000-4000-8000-000000000001", trajeM, "Traje de Príncipe Azul", "M", 89), item("00000000-0000-4000-8000-000000000002", trajeL, "Traje de Príncipe Azul", "L", 89),
      item("00000000-0000-4000-8000-000000000003", deadpoolM, "Disfraz de Deadpool", "M", 120)],
    payments: [yape], itemsTotal: pen(298), deliveryCost: pen(0), deliveryCharge: pen(0), total: pen(298), revisions: { items: "A".repeat(43) }, ...patch,
  };
}

export const lineCatalog = { [trajeM]: { stock: 5 }, [trajeL]: { stock: 2 }, [deadpoolM]: { stock: 4 } };
export const loadedOrder = (patch: Partial<LoadedOrder> = {}): LoadedOrder => ({ order: order1042(), revisions, lineCatalog, ...patch });
export const savedState = (patch: Partial<LoadedOrder> = {}) => initialDraft({ kind: "saved", ...loadedOrder(patch) });
