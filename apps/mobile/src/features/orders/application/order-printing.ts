import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { AppError, Result } from "@shared/result";
import type { DispatchLabel, DispatchLabelDocument, DispatchLabelExclusion, DispatchLabelMissingField, DispatchLabelPreparation } from "@mobile/features/orders/domain/dispatch-label";

export type PrepareDispatchLabelsDependencies<ReadError extends AppError> = Readonly<{
  /** Existing order detail endpoint; a failure is a read error, never missing data. */
  readOrder: (orderId: string) => Promise<Result<OrderAggregateResponse, ReadError>>;
  /** Business name of the current session. */
  sender: string;
  /** True when the label content fits the roll (provided by the renderer). */
  fits: (label: DispatchLabel) => boolean;
}>;

const readConcurrency = 4;
type Field = readonly [DispatchLabelMissingField, string | null | undefined];
type Delivery = NonNullable<OrderAggregateResponse["delivery"]>;
type Prepared = Readonly<{ label: DispatchLabel }> | Readonly<{ exclusion: DispatchLabelExclusion }>;

const missing = (fields: readonly Field[]) => fields.filter(([, value]) => !value?.trim()).map(([name]) => name);

function documentOf(identity: { kind: "absent" } | { kind: "document"; documentType: DispatchLabelDocument["type"]; document: string }): DispatchLabelDocument | null {
  return identity.kind === "document" ? { type: identity.documentType, number: identity.document } : null;
}

function buildLabel(order: OrderAggregateResponse, delivery: Exclude<Delivery, { method: "store" }>, sender: string): Prepared {
  const { recipient } = delivery;
  const document = documentOf(recipient.identity);
  const common = [["recipientName", recipient.name], ["recipientPhone", recipient.phone]] as const;
  const base = { sender, scheduledDate: order.scheduledDispatchDate };
  const exclude = (fields: readonly DispatchLabelMissingField[]): Prepared | null =>
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

function classify(order: OrderAggregateResponse, sender: string): Prepared {
  if (order.cancelled || order.status === "cancelled") return { exclusion: { code: "CANCELLED" } };
  if (!order.delivery) return { exclusion: { code: "DELIVERY_NOT_ASSIGNED" } };
  if (order.delivery.method === "store") return { exclusion: { code: "METHOD_NOT_APPLICABLE" } };
  return buildLabel(order, order.delivery, sender);
}

export async function prepareDispatchLabels<ReadError extends AppError>(
  orderIds: readonly string[], deps: PrepareDispatchLabelsDependencies<ReadError>,
): Promise<DispatchLabelPreparation<ReadError>[]> {
  const prepareOne = async (orderId: string): Promise<DispatchLabelPreparation<ReadError>> => {
    const read = await deps.readOrder(orderId);
    if (!read.success) return { status: "read-error", orderId, error: read.error };
    const prepared = classify(read.data, deps.sender);
    if ("exclusion" in prepared) return { status: "excluded", orderId, exclusion: prepared.exclusion };
    return deps.fits(prepared.label) ? { status: "ready", orderId, label: prepared.label }
      : { status: "excluded", orderId, exclusion: { code: "LABEL_CONTENT_OVERFLOW" } };
  };
  const results: DispatchLabelPreparation<ReadError>[] = new Array(orderIds.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < orderIds.length; index = next++) results[index] = await prepareOne(orderIds[index]);
  };
  await Promise.all(Array.from({ length: Math.min(readConcurrency, orderIds.length) }, worker));
  return results;
}
