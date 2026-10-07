import { z } from "zod";
import { currencies } from "@shared/money";
import { add, multiply, type Money } from "@shared/money";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { normalizeDecimalInput } from "@mobile/shared/decimal-input";

export type OrderDraftItem = Readonly<{
  variantId: string;
  productName: string;
  variantAttributes: Readonly<Record<string, string>>;
  sku: string | null;
  shownUnitPrice: Money;
  shownStock: number;
  quantity: number;
}>;

type DraftCustomer = Readonly<{ kind: "general_public" }> | Readonly<{ kind: "contact"; contactId: string; name: string | null; phone: string }>;

export type DraftPayment = Readonly<{ paymentId: string; amount: string; method: "digital_wallet" | "bank_transfer"; deductStockIfPartial: boolean }>;
export type DraftDelivery = Readonly<{ method: "store" | "home" | "agency"; name: string; phone: string;
  documentType: "absent" | "national_id" | "passport" | "foreign_id"; document: string;
  courierId: string; agency: string; address: string; district: string; instructions: string; charge: boolean }>;
type DraftOptions = Readonly<{ payments?: readonly DraftPayment[]; delivery?: DraftDelivery; deliverImmediately?: boolean }>;
const identity = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("absent") }),
  z.strictObject({ kind: z.literal("document"), documentType: z.enum(["national_id", "passport", "foreign_id"]), document: z.string().trim().min(1) })]);
const recipient = z.strictObject({ name: z.string().trim().min(1), phone: z.string().trim().min(1), identity });
const deliverySelection = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("store"), recipient }),
  z.strictObject({ method: z.literal("home"), recipient, destination: z.strictObject({ address: z.string().trim().min(1).max(500), district: z.string().trim().min(1).max(120), instructions: z.string().trim().min(1).max(1000).nullable() }) }),
  z.strictObject({ method: z.literal("agency"), recipient: recipient.extend({ identity: identity.options[1] }), courierId: z.uuid(), agency: z.string().trim().min(1).max(500) }),
]);
const submissionSchema = z.strictObject({ id: z.uuid(), contactId: z.uuid().nullable(),
  items: z.array(z.strictObject({ variantId: z.uuid(), quantity: z.number().int().positive().safe() })).min(1),
  payments: z.array(z.strictObject({ paymentId: z.uuid(), amount: z.strictObject({ amount: z.number().finite().positive().refine(value => /^\d+(?:\.\d{1,2})?$/.test(String(value))), currency: z.enum(currencies) }),
    method: z.enum(["digital_wallet", "bank_transfer"]), deductStockIfPartial: z.boolean() })).optional(),
  delivery: z.strictObject({ delivery: deliverySelection, chargeDeliveryToCustomer: z.boolean() }).optional(),
  deliverImmediately: z.boolean().optional(),
});
export type OrderSubmission = z.infer<typeof submissionSchema>;
export function prepareDelivery(value: DraftDelivery) {
  const identity = value.documentType === "absent" ? { kind: "absent" } : { kind: "document", documentType: value.documentType, document: value.document };
  const recipient = { name: value.name, phone: value.phone, identity };
  const delivery = value.method === "agency" ? { method: value.method, recipient, courierId: value.courierId, agency: value.agency }
    : value.method === "home" ? { method: value.method, recipient, destination: { address: value.address, district: value.district, instructions: value.instructions.trim() || null } }
      : { method: value.method, recipient };
  const parsed = deliverySelection.safeParse(delivery);
  return parsed.success ? ok({ delivery: parsed.data, chargeDeliveryToCustomer: value.charge }) : invalid();
}

export type OrderDraft = DraftOptions & (
  | Readonly<{ kind: "empty"; customer: DraftCustomer; items: readonly [] }>
  | Readonly<{ kind: "items"; id: string; customer: DraftCustomer;
      items: readonly [OrderDraftItem, ...OrderDraftItem[]] }>);

export type CartError = Readonly<{ code: "INVALID_CART"; message: string }>;
const invalid = () => err<CartError>({ code: "INVALID_CART", message: "Invalid order selection" });

export const emptyOrderDraft = (): OrderDraft => ({ kind: "empty", customer: { kind: "general_public" }, items: [] });

export function prepareOrder(draft: OrderDraft): Result<{ request: OrderSubmission; shownTotal: Money }, CartError> {
  if (draft.kind === "empty" || new Set(draft.items.map((item) => item.variantId)).size !== draft.items.length) return invalid();
  let total: Money | null = null;
  for (const item of draft.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.shownStock) ||
      item.shownStock < 0 || item.shownUnitPrice.amount <= 0) return invalid();
    const subtotal = multiply(item.shownUnitPrice)(item.quantity);
    if (!subtotal.success) return invalid();
    if (total) {
      const sum = add(subtotal.data)(total);
      if (!sum.success) return invalid();
      total = sum.data;
    } else total = subtotal.data;
  }
  const delivery = draft.delivery ? prepareDelivery(draft.delivery) : null;
  if (delivery && !delivery.success) return delivery;
  if (new Set(draft.payments?.map(payment => payment.paymentId)).size !== (draft.payments?.length ?? 0)) return invalid();
  const parsed = submissionSchema.safeParse({ id: draft.id,
    ...(draft.payments ? { payments: draft.payments.map(payment => ({ ...payment, amount: { amount: Number(normalizeDecimalInput(payment.amount)), currency: total?.currency } })) } : {}),
    ...(delivery?.success ? { delivery: delivery.data } : {}),
    ...(draft.deliverImmediately !== undefined ? { deliverImmediately: draft.deliverImmediately } : {}),
    contactId: draft.customer.kind === "contact" ? draft.customer.contactId : null,
    items: draft.items.map(({ variantId, quantity }) => ({ variantId, quantity })) });
  return parsed.success && total ? ok({ request: parsed.data, shownTotal: total }) : invalid();
}

export function addDraftItem(draft: OrderDraft, item: OrderDraftItem, newId: () => string): Result<OrderDraft, CartError> {
  if (draft.items.some((current) => current.variantId === item.variantId)) return invalid();
  const next: OrderDraft = draft.kind === "empty"
    ? { ...draft, kind: "items", id: newId(), items: [item] }
    : { ...draft, items: [...draft.items, item] };
  return prepareOrder({ ...next, payments: undefined, delivery: undefined, deliverImmediately: undefined }).success ? ok(next) : invalid();
}

export function changeDraftQuantity(draft: OrderDraft, variantId: string, quantity: number): Result<OrderDraft, CartError> {
  if (draft.kind === "empty" || !draft.items.some((item) => item.variantId === variantId)) return invalid();
  const items = draft.items.map((item) => item.variantId === variantId ? { ...item, quantity } : item);
  const [first, ...rest] = items;
  const next: OrderDraft = { ...draft, items: [first, ...rest] };
  return prepareOrder({ ...next, payments: undefined, delivery: undefined, deliverImmediately: undefined }).success ? ok(next) : invalid();
}

export function removeDraftItem(draft: OrderDraft, variantId: string): OrderDraft {
  if (draft.kind === "empty") return draft;
  const items = draft.items.filter((item) => item.variantId !== variantId);
  const [first, ...rest] = items;
  return first ? { ...draft, items: [first, ...rest] } : { ...draft, kind: "empty", items: [] };
}

export function setDraftCustomer(draft: OrderDraft, customer: OrderDraft["customer"]): OrderDraft {
  return { ...draft, customer };
}
