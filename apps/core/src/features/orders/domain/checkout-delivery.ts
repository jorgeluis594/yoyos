import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { DeliverySettings } from "@core/src/features/delivery-settings";
import type { CheckoutError } from "@core/src/features/orders/domain/checkout";
import { parseDeliverySelection, type DeliverySelection, type DeliverySnapshot } from "@core/src/features/orders/domain/order-state-machine";

export function checkoutDelivery(input: DeliverySelection, settings: DeliverySettings): Result<DeliverySnapshot, CheckoutError> {
  const parsed = parseDeliverySelection(input);
  if (!parsed.success) return err({ code: "INVALID_DELIVERY", message: "Invalid delivery selection" });
  const value = parsed.data;
  if (!settings[value.method].enabled) return err({ code: "DELIVERY_METHOD_DISABLED", message: "Delivery method is disabled" });
  const recordedBy = { kind: "buyer" as const };
  if (value.method === "home") return ok({ ...value, recordedBy });
  if (value.method === "store") return settings.store.enabled
    ? ok({ ...value, pickupPoint: settings.store.pickupPoint, recordedBy })
    : err({ code: "DELIVERY_METHOD_DISABLED", message: "Pickup is disabled" });
  const courier = settings.couriers.find(item => item.id === value.courierId && item.enabled);
  return courier ? ok({ method: "agency", agency: value.agency, recipient: value.recipient,
    courier: { id: courier.id, name: courier.name }, recordedBy })
    : err({ code: "COURIER_UNAVAILABLE", message: "Courier is unavailable" });
}

export function deliverySelection(snapshot: DeliverySnapshot): DeliverySelection {
  const { recipient } = snapshot;
  if (snapshot.method === "home") return { method: snapshot.method, recipient, destination: snapshot.destination };
  if (snapshot.method === "agency") return { method: snapshot.method, recipient: snapshot.recipient, courierId: snapshot.courier.id, agency: snapshot.agency };
  return { method: "store", recipient };
}

// Explicit fields make this independent of JSON object key order and authorship.
export function sameDelivery(left: DeliverySnapshot, right: DeliverySnapshot): boolean {
  if (left.method !== right.method || left.recipient.name !== right.recipient.name || left.recipient.phone !== right.recipient.phone) return false;
  const a = left.recipient.identity, b = right.recipient.identity;
  if (a.kind !== b.kind || (a.kind === "document" && (b.kind !== "document" || a.documentType !== b.documentType || a.document !== b.document))) return false;
  if (left.method === "home" && right.method === "home") return left.destination.address === right.destination.address && left.destination.district === right.destination.district && left.destination.instructions === right.destination.instructions;
  if (left.method === "agency" && right.method === "agency") return left.courier.id === right.courier.id && left.agency === right.agency;
  return left.method === "store" && right.method === "store" && left.pickupPoint.name === right.pickupPoint.name && left.pickupPoint.address === right.pickupPoint.address && left.pickupPoint.instructions === right.pickupPoint.instructions;
}
