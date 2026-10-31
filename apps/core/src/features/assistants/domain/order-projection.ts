/**
 * The masked view of an order that agents receive. This file is the only code that reads the buyer, the recipient and the destination of an order:
 * the output types have no field that can hold a full phone, a street, a delivery reference or an identity document.
 */

type Money = Readonly<{ amount: number; currency: string }>;
type Place = Readonly<{ district: string; province: string; department: string }>;
type Contact = Readonly<{ name: string | null; phone: string | null }>;

export type ProjectablePayment =
  | Readonly<{ status: "reported"; data: Readonly<{ reportedAt: Date }> }>
  | Readonly<{ status: "confirmed"; amount: Money; method: "digital_wallet" | "bank_transfer"; data: Readonly<{ confirmedAt: Date; evidence: Readonly<{ kind: "manual" | "buyer_report" }> }> }>
  | Readonly<{ status: "voided"; amount: Money; method: "digital_wallet" | "bank_transfer"; data: Readonly<{ voidedAt: Date }> }>
  | Readonly<{ status: "rejected"; data: Readonly<{ rejectedAt: Date; reason: string | null }> }>;

export type ProjectableDelivery =
  | Readonly<{ method: "home"; recipient: Readonly<{ name: string; phone: string }>; destination: Place }>
  | Readonly<{ method: "agency"; recipient: Readonly<{ name: string; phone: string }>; destination: Place;
      courier: Readonly<{ name: string }>; agency: Readonly<{ name: string; address: string; location: Place }> }>
  | Readonly<{ method: "store"; recipient: Readonly<{ name: string; phone: string }>; pickupPoint: Readonly<{ name: string; address: string }> }>;

export type ProjectableOrder = Readonly<{
  number: number; id: string; createdAt: Date; scheduledDispatchDate: string | null; shippedAt: Date | null; deliveredAt: Date | null;
  completedAt: Date | null; cancelled: boolean; fromCatalog: boolean; chatId?: string | null;
  buyer: Contact | null;
  items: readonly Readonly<{ variantId: string; productName: string; variantAttributes: Readonly<Record<string, string>>; quantity: number;
    unitPrice: Money; subtotal: Money; mentionedPrice?: Readonly<{ amount: Money; units: number }> | null }>[];
  payments: readonly ProjectablePayment[];
  delivery: ProjectableDelivery | null;
  deliveryStatus: "pending" | "shipped" | "delivered";
  itemsTotal: Money; deliveryCharge: Money; total: Money;
}>;

export type ProjectableReadiness =
  | Readonly<{ kind: "ready"; operation: "ship" | "deliver" }>
  | Readonly<{ kind: "blocked"; operation: "ship" | "deliver"; reason:
      | Readonly<{ code: "SHIP_PAYMENT_REQUIRED" | "PAYMENT_REQUIRED"; pendingReport: boolean }>
      | Readonly<{ code: "STOCK_WAITING"; variantIds: readonly string[] }>
      | Readonly<{ code: "STOCK_DEDUCTING" | "STOCK_NOT_DEDUCTED" }> }>
  | Readonly<{ kind: "delivery_unassigned" }>;

export type Display = Readonly<{ money: (money: Money) => string; date: (date: Date) => string; dateTime: (date: Date) => string; day: (day: string) => string }>;
export type ReadinessLine = Readonly<{ listo: boolean; texto: string }>;
export type ProjectionContext = Readonly<{
  display: Display;
  link: (orderId: string) => string;
  /** The sentence for a readiness; `shortItems` are the names of the short items and `owed` the formatted balance. */
  readinessText: (readiness: ProjectableReadiness, shortItems: readonly string[], owed: string | null) => string;
}>;

export type OrderSource = "Desde el catálogo" | "WhatsApp" | "Venta manual";
export type Modality = "A domicilio" | "Agencia" | "Recojo en tienda" | "Por definir";

export type AssistantOrderSummary = Readonly<{
  numero: string; creado: string; cliente: string; origen: OrderSource; total: string; recibido: string;
  estado_pago: "Pagado" | "Pago pendiente"; por_cobrar?: string; pago_por_revisar?: true; estado?: "Cancelado" | "Completado";
  estado_entrega: "Pendiente" | "Despachada" | "Entregada"; modalidad: Modality; courier?: string; despacho_programado?: string; enlace: string;
}>;

export type AssistantPayment = Readonly<{
  estado: "Confirmado" | "Por revisar" | "Rechazado" | "Anulado"; fecha: string; monto?: string; metodo?: "Billetera digital" | "Transferencia bancaria";
  con_comprobante?: true; motivo?: string;
}>;
export type AssistantItem = Readonly<{
  producto: string; combinacion?: string; cantidad: number; precio_unitario: string; subtotal: string; precio_mencionado?: string;
}>;
export type AssistantDelivery = Readonly<{
  modalidad: Modality; destino: string; courier?: string; destinatario?: string; telefono?: string; punto_de_recojo?: string;
}>;
export type AssistantOrder = AssistantOrderSummary & Readonly<{
  despachado?: string; entregado?: string; productos: readonly AssistantItem[]; total_productos: string; entrega_cobrada?: string;
  sobrepago?: string; pagos: readonly AssistantPayment[]; entrega: AssistantDelivery; stock?: "Esperando stock" | "Descontando stock";
  preparacion?: ReadinessLine;
}>;
export type DispatchStockState = Readonly<{ stockDue: Readonly<{ kind: "waiting" | "deducting" }> | null }>;

/** Unicode NFKC (fullwidth digits become ASCII), every Unicode space as a plain space, format and control characters (zero-width spaces, bidi marks) removed. */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").replace(/[\s\p{Z}]/gu, " ").replace(/[\p{Cf}\p{Cc}]/gu, "").replace(/ +/g, " ").trim();
}

const digitsOf = (text: string) => normalizeText(text).replace(/[^\p{Nd}]/gu, "");
// A run of digits, allowing spaces, dots, hyphens, slashes, parentheses and plus signs between them, with the brackets or plus sign that open or close it.
const digitRun = /[+(]*\p{Nd}(?:[\s.\-/()+]*\p{Nd})*\)*/gu;
const maskedRun = "•••";

/** `"termina en 789"`; `null` when the phone has fewer than three digits. */
export function maskPhone(phone: string | null): string | null {
  const digits = phone === null ? "" : digitsOf(phone);
  return digits.length < 3 ? null : `termina en ${digits.slice(-3)}`;
}

/** Every run of six or more digits (separators ignored) becomes «•••» plus its last three digits, so a name never carries a complete phone. Normalizes first. */
export function maskDigitRuns(text: string): string {
  return normalizeText(text).replace(digitRun, (run) => {
    const digits = run.replace(/[^\p{Nd}]/gu, "");
    return digits.length >= 6 ? `${maskedRun}${digits.slice(-3)}` : run;
  });
}

/** A name that, once its long digit runs are masked, has no letters left: a chat contact saved with its number as name counts as no name. */
export function isPhoneLikeName(name: string): boolean {
  const masked = maskDigitRuns(name);
  return masked.includes(maskedRun) && !/\p{L}/u.test(masked);
}

/** The name to show: normalized and with phone numbers masked; `null` when nothing usable is left (empty or phone-like). */
export function displayName(name: string | null): string | null {
  if (name === null || isPhoneLikeName(name)) return null;
  const masked = maskDigitRuns(name);
  return masked === "" ? null : masked;
}

/** The buyer's name; else «Cliente que termina en 427»; else «Público general». */
export function customerLabel(buyer: Contact | null): string {
  if (buyer === null) return "Público general";
  const name = displayName(buyer.name);
  if (name !== null) return name;
  const masked = maskPhone(buyer.phone) ?? (buyer.name !== null && isPhoneLikeName(buyer.name) ? maskPhone(buyer.name) : null);
  return masked === null ? "Público general" : `Cliente que ${masked}`;
}

export function recipientLabel(recipient: Contact): string {
  return displayName(recipient.name) ?? customerLabel({ name: null, phone: recipient.phone });
}

const place = ({ district, province, department }: Place) => `${district}, ${province}, ${department}`;

/** District, province and department for a home delivery; the agency's own address for an agency; never the street, the reference or a document. */
export function destinationLabel(delivery: ProjectableDelivery | null): string {
  if (delivery === null) return "Entrega por definir";
  switch (delivery.method) {
    case "home": return place(delivery.destination);
    case "agency": return `${delivery.courier.name} · ${delivery.agency.name}, ${delivery.agency.address}, ${place(delivery.agency.location)}`;
    case "store": return `Recojo en tienda · ${delivery.pickupPoint.name}, ${delivery.pickupPoint.address}`;
  }
}

const modalityOf = (delivery: ProjectableDelivery | null): Modality =>
  delivery === null ? "Por definir" : delivery.method === "home" ? "A domicilio" : delivery.method === "agency" ? "Agencia" : "Recojo en tienda";

/** Item names and rejection reasons are shortened to these lengths, so an order of sixty lines stays inside the 24 KB budget of a tool response. */
export const maxProductName = 100;
export const maxCombination = 50;
export const maxRejectionReason = 100;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const combinationOf = (attributes: Readonly<Record<string, string>>): string | undefined => {
  const values = Object.values(attributes).filter((value) => value.trim() !== "");
  return values.length === 0 ? undefined : clip(values.join(" · "), maxCombination);
};

/** «Camisa (M · Azul)», the name the owner sees for a variant. */
export const itemLabel = (item: Readonly<{ productName: string; variantAttributes: Readonly<Record<string, string>> }>): string => {
  const combination = combinationOf(item.variantAttributes);
  const name = clip(item.productName, maxProductName);
  return combination === undefined ? name : `${name} (${combination})`;
};

/** The labels of the given variants once each: two lines of the same variant, or two variants with one label, name it a single time. */
export function shortItemNames(order: Pick<ProjectableOrder, "items">, variantIds: readonly string[]): readonly string[] {
  const labels = variantIds.flatMap((variantId) => {
    const item = order.items.find((candidate) => candidate.variantId === variantId);
    return item === undefined ? [] : [itemLabel(item)];
  });
  return [...new Set(labels)];
}

const cents = (money: Money) => Math.round(money.amount * 100);
const moneyOfCents = (value: number, currency: string): Money => ({ amount: value / 100, currency });

function paymentFigures(order: ProjectableOrder) {
  const received = order.payments.reduce((sum, payment) => (payment.status === "confirmed" ? sum + cents(payment.amount) : sum), 0);
  const balance = cents(order.total) - received;
  return { received, balance, paid: balance <= 0 };
}

const sourceOf = (order: ProjectableOrder): OrderSource => (order.fromCatalog ? "Desde el catálogo" : order.chatId ? "WhatsApp" : "Venta manual");
const deliveryStateWord = { pending: "Pendiente", shipped: "Despachada", delivered: "Entregada" } as const;
const courierOf = (delivery: ProjectableDelivery | null) => (delivery?.method === "agency" ? delivery.courier.name : undefined);

export function toAssistantOrderSummary(order: ProjectableOrder, context: ProjectionContext): AssistantOrderSummary {
  const { display } = context;
  const { received, balance, paid } = paymentFigures(order);
  const owes = !order.cancelled && !paid;
  const courier = courierOf(order.delivery);
  return {
    numero: `#${order.number}`, creado: display.date(order.createdAt), cliente: customerLabel(order.buyer), origen: sourceOf(order),
    total: display.money(order.total), recibido: display.money(moneyOfCents(received, order.total.currency)),
    estado_pago: paid ? "Pagado" : "Pago pendiente",
    ...(owes ? { por_cobrar: display.money(moneyOfCents(balance, order.total.currency)) } : {}),
    ...(!order.cancelled && order.payments.some((payment) => payment.status === "reported") ? { pago_por_revisar: true as const } : {}),
    ...(order.cancelled ? { estado: "Cancelado" as const } : order.completedAt ? { estado: "Completado" as const } : {}),
    estado_entrega: deliveryStateWord[order.deliveryStatus], modalidad: modalityOf(order.delivery),
    ...(courier ? { courier } : {}),
    ...(order.scheduledDispatchDate ? { despacho_programado: display.day(order.scheduledDispatchDate) } : {}),
    enlace: context.link(order.id),
  };
}

const methodWord = { digital_wallet: "Billetera digital", bank_transfer: "Transferencia bancaria" } as const;

function toAssistantPayment(payment: ProjectablePayment, display: Display): AssistantPayment {
  switch (payment.status) {
    case "confirmed": return { estado: "Confirmado", fecha: display.dateTime(payment.data.confirmedAt), monto: display.money(payment.amount), metodo: methodWord[payment.method],
      ...(payment.data.evidence.kind === "buyer_report" ? { con_comprobante: true as const } : {}) };
    case "reported": return { estado: "Por revisar", fecha: display.dateTime(payment.data.reportedAt), con_comprobante: true };
    case "rejected": return { estado: "Rechazado", fecha: display.dateTime(payment.data.rejectedAt), con_comprobante: true, ...(payment.data.reason ? { motivo: clip(maskDigitRuns(payment.data.reason), maxRejectionReason) } : {}) };
    case "voided": return { estado: "Anulado", fecha: display.dateTime(payment.data.voidedAt), monto: display.money(payment.amount), metodo: methodWord[payment.method] };
  }
}

function toAssistantDelivery(delivery: ProjectableDelivery | null): AssistantDelivery {
  if (delivery === null) return { modalidad: "Por definir", destino: destinationLabel(null) };
  const phone = maskPhone(delivery.recipient.phone);
  return {
    modalidad: modalityOf(delivery), destino: destinationLabel(delivery), destinatario: recipientLabel(delivery.recipient), ...(phone ? { telefono: phone } : {}),
    ...(delivery.method === "agency" ? { courier: delivery.courier.name } : {}), ...(delivery.method === "store" ? { punto_de_recojo: delivery.pickupPoint.name } : {}),
  };
}

function toAssistantItem(item: ProjectableOrder["items"][number], display: Display): AssistantItem {
  const combination = combinationOf(item.variantAttributes);
  const mentioned = item.mentionedPrice;
  const differs = mentioned && Math.round(item.unitPrice.amount * 100) * mentioned.units !== cents(mentioned.amount);
  return {
    producto: clip(item.productName, maxProductName), ...(combination ? { combinacion: combination } : {}), cantidad: item.quantity,
    precio_unitario: display.money(item.unitPrice), subtotal: display.money(item.subtotal),
    ...(mentioned && differs ? { precio_mencionado: `${display.money(mentioned.amount)} por ${mentioned.units}` } : {}),
  };
}

/** The readiness line of an order: the sentence and whether the order can be dispatched now. */
export function toReadinessLine(order: ProjectableOrder, readiness: ProjectableReadiness, context: ProjectionContext): ReadinessLine {
  const { balance } = paymentFigures(order);
  const short = readiness.kind === "blocked" && readiness.reason.code === "STOCK_WAITING" ? shortItemNames(order, readiness.reason.variantIds) : [];
  const owed = balance > 0 ? context.display.money(moneyOfCents(balance, order.total.currency)) : null;
  return { listo: readiness.kind === "ready", texto: context.readinessText(readiness, short, owed) };
}

/** `readiness` is `null` for an order that is not waiting for dispatch (cancelled, shipped, delivered). */
export function toAssistantOrder(order: ProjectableOrder, state: DispatchStockState, readiness: ProjectableReadiness | null, context: ProjectionContext): AssistantOrder {
  const { display } = context;
  const { balance } = paymentFigures(order);
  const delivery = order.deliveryCharge.amount > 0 ? display.money(order.deliveryCharge) : undefined;
  return {
    ...toAssistantOrderSummary(order, context),
    ...(order.shippedAt ? { despachado: display.dateTime(order.shippedAt) } : {}),
    ...(order.deliveredAt ? { entregado: display.dateTime(order.deliveredAt) } : {}),
    productos: order.items.map((item) => toAssistantItem(item, display)), total_productos: display.money(order.itemsTotal),
    ...(delivery ? { entrega_cobrada: delivery } : {}),
    ...(balance < 0 ? { sobrepago: display.money(moneyOfCents(-balance, order.total.currency)) } : {}),
    pagos: order.payments.map((payment) => toAssistantPayment(payment, display)),
    entrega: toAssistantDelivery(order.delivery),
    ...(state.stockDue?.kind === "waiting" ? { stock: "Esperando stock" as const } : state.stockDue?.kind === "deducting" ? { stock: "Descontando stock" as const } : {}),
    ...(readiness && !order.cancelled ? { preparacion: toReadinessLine(order, readiness, context) } : {}),
  };
}

export type DispatchGroupWord = "Atrasados" | "Para hoy";
export type AssistantDispatchEntry = Readonly<{
  grupo: DispatchGroupWord; numero: string; cliente: string; modalidad: Modality; courier?: string; punto_de_recojo?: string; destino: string;
  despacho_programado: string; estado_pago: "Pagado" | "Pago pendiente"; por_cobrar?: string; pago_por_revisar?: true; preparacion: ReadinessLine; enlace: string;
}>;

/** One order of the dispatch queue: who, how, where (district for a home delivery), payment, readiness. */
export function toAssistantDispatchEntry(order: ProjectableOrder, group: "overdue" | "today", readiness: ProjectableReadiness, context: ProjectionContext): AssistantDispatchEntry {
  const summary = toAssistantOrderSummary(order, context);
  const delivery = toAssistantDelivery(order.delivery);
  return {
    grupo: group === "overdue" ? "Atrasados" : "Para hoy", numero: summary.numero, cliente: summary.cliente, modalidad: summary.modalidad,
    ...(delivery.courier ? { courier: delivery.courier } : {}), ...(delivery.punto_de_recojo ? { punto_de_recojo: delivery.punto_de_recojo } : {}),
    destino: delivery.destino, despacho_programado: summary.despacho_programado ?? "", estado_pago: summary.estado_pago,
    ...(summary.por_cobrar ? { por_cobrar: summary.por_cobrar } : {}), ...(summary.pago_por_revisar ? { pago_por_revisar: true as const } : {}),
    preparacion: toReadinessLine(order, readiness, context), enlace: summary.enlace,
  };
}
