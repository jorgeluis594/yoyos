import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { prepareOrderDispatchLabel, type DispatchLabelOrder } from "@shared/dispatch-label/build";
import { layoutDispatchLabel, type DispatchLabelGeometry, type DispatchLabelLayout, type MeasureText } from "@shared/dispatch-label/layout";
import type { DispatchLabelExclusion, DispatchLabelSender, DispatchLabelSize } from "@shared/dispatch-label/types";

export type LabelPdfError = Readonly<{ code: "PDF_RENDER_FAILED"; message: string }>;
/** Port implemented by the PDF adapter: measures and draws with the same font, so the fit check matches the output. */
export type LabelPdf = Readonly<{
  geometry: DispatchLabelGeometry;
  /** Width in points of the text in the PDF font. */
  measure: MeasureText;
  render: (layouts: readonly DispatchLabelLayout[]) => Promise<Result<Buffer, LabelPdfError>>;
}>;

type OrderRef = Readonly<{ orderId: string; orderNumber: number }>;
/** Same shape as the response contract, with the shared (readonly) exclusion type. */
export type DispatchLabelsOutcome = Readonly<{ pdf: string | null; size: DispatchLabelSize; printed: readonly OrderRef[];
  excluded: readonly (OrderRef & Readonly<{ exclusion: DispatchLabelExclusion }>)[]; notFound: readonly string[] }>;

export type CreateDispatchLabelsError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA" | "PDF_RENDER_FAILED"; message: string }>;

export type CreateDispatchLabelsDependencies = Readonly<{
  /** The company's orders among these ids, in one query; unknown ids are simply absent. */
  loadOrders: (orderIds: readonly string[]) => Promise<Result<readonly DispatchLabelOrder[], CreateDispatchLabelsError>>;
  /** The effective sender of the company, read live. */
  loadSender: () => Promise<Result<DispatchLabelSender, CreateDispatchLabelsError>>;
  createPdf: (size: DispatchLabelSize) => LabelPdf;
}>;

/** Read-only: classifies every order with the shared module, lays the ready ones out with the PDF font's real measure and renders one PDF. */
export async function createDispatchLabels(
  request: Readonly<{ orderIds: readonly string[]; size: DispatchLabelSize }>, deps: CreateDispatchLabelsDependencies,
): Promise<Result<DispatchLabelsOutcome, CreateDispatchLabelsError>> {
  const [orders, sender] = await Promise.all([deps.loadOrders(request.orderIds), deps.loadSender()]);
  if (!orders.success) return orders;
  if (!sender.success) return sender;
  const byId = new Map(orders.data.map((order) => [order.id, order]));
  const pdf = deps.createPdf(request.size);
  const layouts: DispatchLabelLayout[] = [];
  const response: { printed: OrderRef[]; excluded: DispatchLabelsOutcome["excluded"][number][]; notFound: string[] } = { printed: [], excluded: [], notFound: [] };
  for (const orderId of request.orderIds) {
    const order = byId.get(orderId);
    if (!order) { response.notFound.push(orderId); continue; }
    let layout: DispatchLabelLayout | null = null;
    const prepared = prepareOrderDispatchLabel(order, sender.data, (label) => {
      const laidOut = layoutDispatchLabel(label, pdf.geometry, pdf.measure);
      if (laidOut.success) layout = laidOut.data;
      return laidOut.success;
    });
    // A ready label without a layout never fit, so it is excluded: every order ends in exactly one list.
    if (prepared.status === "ready" && layout) { layouts.push(layout); response.printed.push({ orderId, orderNumber: order.number }); }
    else response.excluded.push({ orderId, orderNumber: order.number, exclusion: prepared.status === "excluded" ? prepared.exclusion : { code: "LABEL_CONTENT_OVERFLOW" } });
  }
  if (!layouts.length) return ok({ pdf: null, size: request.size, ...response });
  const rendered = await pdf.render(layouts);
  return rendered.success ? ok({ pdf: rendered.data.toString("base64"), size: request.size, ...response }) : err(rendered.error);
}
