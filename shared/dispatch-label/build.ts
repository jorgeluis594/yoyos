import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { DispatchLabel, DispatchLabelDocument, DispatchLabelExclusion, DispatchLabelMissingField, DispatchLabelSender } from "@shared/dispatch-label/types";

type Field = readonly [DispatchLabelMissingField, string | null | undefined];
type Delivery = NonNullable<OrderAggregateResponse["delivery"]>;
export type ClassifiedDispatchLabel = Readonly<{ label: DispatchLabel }> | Readonly<{ exclusion: DispatchLabelExclusion }>;
export type OrderDispatchLabel =
  | Readonly<{ status: "ready"; label: DispatchLabel }>
  | Readonly<{ status: "excluded"; exclusion: DispatchLabelExclusion }>;

const missing = (fields: readonly Field[]) => fields.filter(([, value]) => !value?.trim()).map(([name]) => name);

function documentOf(identity: { kind: "absent" } | { kind: "document"; documentType: DispatchLabelDocument["type"]; document: string }): DispatchLabelDocument | null {
  return identity.kind === "document" ? { type: identity.documentType, number: identity.document } : null;
}

function buildLabel(order: OrderAggregateResponse, delivery: Exclude<Delivery, { method: "store" }>, sender: DispatchLabelSender): ClassifiedDispatchLabel {
  const { recipient } = delivery;
  const document = documentOf(recipient.identity);
  const common = [["recipientName", recipient.name], ["recipientPhone", recipient.phone]] as const;
  const base = { sender, orderNumber: order.number, scheduledDate: order.scheduledDispatchDate };
  const exclude = (fields: readonly DispatchLabelMissingField[]): ClassifiedDispatchLabel | null =>
    fields.length ? { exclusion: { code: "MISSING_DATA", fields: fields as [DispatchLabelMissingField, ...DispatchLabelMissingField[]] } } : null;

  if (delivery.method === "home") {
    const { address, district, province, department, instructions } = delivery.destination;
    const incomplete = exclude(missing([...common, ["address", address], ["department", department], ["province", province], ["district", district]]));
    return incomplete ?? { label: { ...base, method: "home", courier: null, recipient: { name: recipient.name, phone: recipient.phone, document },
      destination: { address, location: { department, province, district }, reference: instructions } } };
  }
  const { agency, courier } = delivery;
  const { department, province, district } = agency.location;
  const incomplete = exclude([...missing(common), ...(document ? [] : ["recipientDocument" as const]),
    ...missing([["courier", courier.name], ["agency", agency.name], ["address", agency.address], ["department", department], ["province", province], ["district", district]])]);
  return incomplete ?? (document ? { label: { ...base, method: "agency", courier: courier.name, recipient: { name: recipient.name, phone: recipient.phone, document },
    destination: { agencyName: agency.name, address: agency.address, location: { department, province, district } } } } : { exclusion: { code: "MISSING_DATA", fields: ["recipientDocument"] } });
}

/** Ready (with its label) or excluded with the reason, before any fit check. */
export function classifyDispatchLabel(order: OrderAggregateResponse, sender: DispatchLabelSender): ClassifiedDispatchLabel {
  if (order.cancelled || order.status === "cancelled") return { exclusion: { code: "CANCELLED" } };
  if (!order.delivery) return { exclusion: { code: "DELIVERY_NOT_ASSIGNED" } };
  if (order.delivery.method === "store") return { exclusion: { code: "METHOD_NOT_APPLICABLE" } };
  return buildLabel(order, order.delivery, sender);
}

/** Per-order outcome: classification plus the fit check (`fits` comes from the platform measurement). */
export function prepareOrderDispatchLabel(order: OrderAggregateResponse, sender: DispatchLabelSender, fits: (label: DispatchLabel) => boolean): OrderDispatchLabel {
  const classified = classifyDispatchLabel(order, sender);
  if ("exclusion" in classified) return { status: "excluded", exclusion: classified.exclusion };
  return fits(classified.label) ? { status: "ready", label: classified.label } : { status: "excluded", exclusion: { code: "LABEL_CONTENT_OVERFLOW" } };
}
