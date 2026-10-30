import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { isOrderId } from "@core/src/features/orders/domain/order";
import { readCancellationOrder, verifyCancellation, cancellationMessage, type CancelOrderActionError, type CancellationClientResult, type CancellationUiState } from "@core/src/features/orders/presentation/cancellation-client";
import { cancelOrderResponseSchema, type CancelOrderResponse } from "@shared/contracts/orders";
import { orderFulfillmentBlock } from "@shared/orders-fulfillment";
import type { PaymentDecisionResult } from "@core/src/features/orders/presentation/payment-decision-form";
import { StockDueNotice } from "@core/src/features/orders/presentation/stock-due-notice";
import { fulfillmentReason } from "@core/src/features/orders/presentation/stock-due";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { type OrderLink } from "@core/app/components/order-link-card";
import { catalogPublicationAnchor } from "@core/app/components/store-appearance-editor-actions";
import { z } from "zod";
import { log, bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { useTranslation } from "react-i18next";
import { randomUUID } from "node:crypto";
import { companyPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { Form, useActionData, data, isRouteErrorResponse, useFetchers, useNavigation, useLoaderData, useRevalidator, useSubmit, type ClientActionFunctionArgs, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { privateUserContext } from "@core/app/private-user-context";
import { deliverySettings, toDeliverySettingsResponse } from "@core/src/features/delivery-settings";
import { parseRatedDeliverySelection, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import { orders } from "@core/src/features/orders/composition";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import { orderDetailLoaderSchema, orderAggregateSchema, registerPaymentSchema } from "@shared/contracts/orders";
import { parseOrderRevision } from "@core/src/features/orders/domain/order-revisions";
import { parseOrderLineQuantity, type DeliveryEdit, type OrderLineRequest } from "@core/src/features/orders/domain/order-edit";
import { parseBuyer } from "@core/src/features/orders/domain/checkout";
import type { EditOrderInput } from "@core/src/features/orders/application/edit-order";
import { editOrderRequestSchema, editOrderResultSchema, orderLineCatalogSchema, orderRevisionsSchema, type EditOrderRequest } from "@core/src/features/orders/presentation/order-edit-schemas";
import type { OrderId, PaymentId, CompanyId, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { lostResponse, lostResponseStatus } from "@core/app/routes/lost-response";
import { OrderView, type ViewNotice } from "@core/src/features/orders/presentation/order-view";
import { clearSaleSaved, readSaleSaved } from "@core/src/features/orders/presentation/new-sale-outcome";
import { saveChangesOutcome, type SaveChangesResult } from "@core/src/features/orders/presentation/save-changes-outcome";
import { buildEditRequest, discardChanges, initialDraft, inDoubtOutcome, invalidFields, refreshFromLoader, reloadAll, resetProducts, unsavedParts, type LoadedOrder, type OrderViewState } from "@core/src/features/orders/presentation/order-view-state";
import { useUnsavedChangesGuard } from "@core/src/features/orders/presentation/use-unsaved-changes-guard";
import { resolvePublicImages } from "@core/src/shared/images";
import { Button } from "@core/app/components/ui/button";
import { ErrorState } from "@core/app/components/ui/error-state";
import { DispatchLabelPrintDialog } from "@core/src/features/dispatch-labels/presentation/dispatch-label-print-dialog";

/** The stock of the lines, for the warnings: unknown (`null`) when the read fails or throws, because it never fails the page or the save. */
async function lineCatalogOf(order: OrderAggregate, entryPoint: "detail_loader" | "save_result") {
  try { return orderLineCatalogSchema.parse(await orders.lineCatalog(order, entryPoint)); }
  catch (cause) {
    log.warn({ event: "order_line_catalog_unavailable", orderId: order.id, entryPoint, errorCode: "INTERNAL_ERROR", variantCount: order.items.length, err: cause }, "order_line_catalog_unavailable");
    return null;
  }
}

async function receiptUrlsOf(order: OrderAggregate) {
  const receiptIds = new Map<string, string>();
  for (const payment of order.payments) {
    const imageId = payment.status === "reported" ? payment.data.receiptImageId : payment.status === "rejected" ? payment.data.report.receiptImageId
      : payment.data.evidence.kind === "buyer_report" ? payment.data.evidence.report.receiptImageId : null;
    if (imageId) receiptIds.set(payment.id, imageId);
  }
  const images = await resolvePublicImages([...receiptIds.values()]);
  const urls = new Map(images.success ? images.data.images.map((image) => [image.id, image.url]) : []);
  const receiptUrls: Record<string, string> = {};
  for (const [paymentId, imageId] of receiptIds) {
    const url = urls.get(imageId);
    if (url) receiptUrls[paymentId] = url;
  }
  return receiptUrls;
}

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const result = await orders.getAggregate((params.orderId ?? "") as OrderId,
    { companyId: access.company.id, userId: access.user.id });
  if (!result.success) throw new Response(result.error.message, { status: result.error.code === "ORDER_NOT_FOUND" ? 404 : result.error.code === "INVALID_ORDER" ? 400 : 503 });
  const order = result.data;
  const pathname = new URL(request.url).pathname;
  const appearancePath = `${companyPath(pathname, access.company.country, "/settings/store-appearance")}#${catalogPublicationAnchor}`;
  // The aggregate comes first: the line catalog needs its variants. The rest reads in parallel.
  const [described, receiptUrls, settings, link, lineCatalog] = await Promise.all([
    orders.describeStockDue([order]), receiptUrlsOf(order), deliverySettings.get({ companyId: access.company.id, userId: access.user.id }),
    orderLink(order, access.company.id, appearancePath), lineCatalogOf(order, "detail_loader"),
  ]);
  if (!described.success) throw new Response(described.error.message, { status: 503 });
  return { ...orderDetailLoaderSchema.parse({ order: toOrderAggregateJson(order, described.data.get(order.id) ?? null), base: companyPath(pathname, access.company.country, "/orders"),
    manualPaymentId: randomUUID(), receiptUrls }),
    revisions: orderRevisionsSchema.parse(orders.revisions(order)), lineCatalog,
    settings: settings.success ? toDeliverySettingsResponse(settings.data) : null,
    settingsPath: companyPath(pathname, access.company.country, "/settings/delivery"),
    link };
}

/** The link is built here from the company's current subdomain, so the page needs no request of its own to show it. A cancelled order has none. */
async function orderLink(order: OrderAggregate, companyId: CompanyId, appearancePath: string): Promise<OrderLink> {
  if (order.cancelled || !order.checkoutEnabledAt) return { kind: "unavailable" };
  const url = await orders.checkoutUrl(companyId, order.id);
  if (url.success) return { kind: "ready", url: url.data };
  if (url.error.code === "SUBDOMAIN_REQUIRED") return { kind: "subdomain_required", appearancePath };
  log.error({ event: "order_checkout_link_unavailable", companyId, orderNumber: order.number, errorCode: url.error.code }, "Unable to build the order link");
  return { kind: "unavailable" };
}

type SaveChangesFailure = Readonly<{ operation: "save_changes"; code: string; parts?: readonly string[]; variantId?: string; currentPrice?: unknown }>;
const refused = (code: string, extra: object = {}) => ({ operation: "save_changes" as const, code, ...extra });

/** The request's brands: quantities, revisions, the buyer and the delivery selection. A malformed value is an invalid request, never a thrown error. */
function editInputOf(orderId: OrderId, body: EditOrderRequest): EditOrderInput | null {
  const input: { -readonly [K in keyof EditOrderInput]: EditOrderInput[K] } = { orderId };
  if (body.items) {
    const base = parseOrderRevision(body.items.base);
    const lines: OrderLineRequest[] = [];
    for (const line of body.items.lines) {
      const quantity = parseOrderLineQuantity(line.quantity);
      if (!quantity.success) return null;
      lines.push({ variantId: line.variantId as VariantId, quantity: quantity.data });
    }
    const [first, ...rest] = lines;
    if (!base.success || !first) return null;
    input.items = { base: base.data, lines: [first, ...rest] };
  }
  if (body.customer) {
    const base = parseOrderRevision(body.customer.base);
    const value = body.customer.value === null ? null : parseBuyer(body.customer.value);
    if (!base.success || (value !== null && !value.success)) return null;
    input.customer = { base: base.data, value: value === null ? null : value.success ? value.data : null };
  }
  if (body.delivery) {
    const base = parseOrderRevision(body.delivery.base);
    if (!base.success) return null;
    const { change } = body.delivery;
    if (change.kind === "amend") input.delivery = { base: base.data, change: { kind: "amend", amendment: change.amendment } satisfies DeliveryEdit };
    else {
      const selection = parseRatedDeliverySelection(change.selection);
      if (!selection.success) return null;
      input.delivery = { base: base.data, change: { kind: "replace", selection: selection.data, expectedPrice: change.expectedPrice } };
    }
  }
  return input;
}

/** **Guardar cambios**: the final state of the parts the seller edited, applied by core under the order lock. Known refusals are data, like every other operation of this route. */
async function saveChangesAction({ params, request, context }: ActionFunctionArgs) {
  const id = z.uuid().safeParse(params.orderId);
  let raw: unknown;
  try { raw = await request.json(); } catch { return refused("INVALID_INPUT"); }
  const parsed = editOrderRequestSchema.safeParse(raw);
  if (!id.success || !parsed.success) return refused("INVALID_INPUT");
  const input = editInputOf(id.data as OrderId, parsed.data);
  if (!input) return refused("INVALID_INPUT");
  const access = context.get(privateUserContext);
  try {
    const result = await orders.edit(input, { companyId: access.company.id as CompanyId, userId: access.user.id as UserId });
    if (!result.success) {
      const error = result.error;
      return refused(error.code, { ...(error.code === "ORDER_CHANGED" ? { parts: error.parts } : {}), ...(error.code === "VARIANT_NOT_FOUND" ? { variantId: error.variantId } : {}),
        ...(error.code === "TOTAL_CHANGED" && "currentPrice" in error ? { currentPrice: error.currentPrice } : {}) } satisfies Omit<SaveChangesFailure, "operation" | "code">);
    }
    // After the commit and outside the lock, so the stock warnings reflect the new stock; an unreadable stock never turns a saved order into an error.
    const lineCatalog = await lineCatalogOf(result.data.order, "save_result");
    return { operation: "save_changes" as const, ...editOrderResultSchema.parse({ order: toOrderAggregateJson(result.data.order, result.data.stockDue), revisions: orders.revisions(result.data.order),
      lineCatalog, applied: result.data.applied }) };
  } catch (cause) {
    log.error({ event: "order_edit_request_failed", operation: "edit_order", entryPoint: "web_action", orderId: id.data, userId: access.user.id, errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle order edit request");
    return refused("PERSISTENCE_UNAVAILABLE");
  }
}

/** A decision on a payment that somebody else already reviewed reads «Este pago ya fue revisado.» in every client. */
function paymentErrorCode(code: string) {
  return code === "PAYMENT_CONFLICT" || code === "INVALID_TRANSITION" ? "ALREADY_REVIEWED" : code;
}

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });

export type CancelOrderActionResult = Readonly<{ operation: "cancel"; result: Result<CancelOrderResponse, CancelOrderActionError> }>;

export async function clientAction({ request, params, serverAction }: ClientActionFunctionArgs) {
  if (request.headers.get("content-type")?.includes("application/json")) {
    // A lost answer is resolved by the view, which compares the order it re-reads with what it sent; 503 keeps the router from revalidating loaders that would fail too.
    try { return await serverAction<typeof action>(); }
    catch (cause) {
      const lost = lostResponse(cause);
      if (!lost) throw cause;
      return data({ operation: "save_changes" as const, lost }, { status: lostResponseStatus });
    }
  }
  const operation = (await request.clone().formData()).get("operation");
  if (operation === "confirm" || operation === "reject" || operation === "void") {
    // A lost response leaves the decision unknown: the card reloads and the seller repeats it, which never records a second payment.
    try { return await serverAction<typeof action>(); }
    catch (cause) {
      if (cause instanceof Response || isRouteErrorResponse(cause)) throw cause;
      return { url: null, success: false, error: "NO_RESPONSE" } as const;
    }
  }
  if (operation !== "cancel" && operation !== "check-cancellation") return serverAction<typeof action>();
  const id = params.orderId ?? "";
  if (operation === "check-cancellation") return verifyCancellation(id, { code: "INTERNAL_ERROR", message: "Check current state before retrying" });
  let response: Awaited<ReturnType<typeof serverAction<typeof action>>>;
  try { response = await serverAction<typeof action>(); }
  catch (cause) {
    if (cause instanceof Response || isRouteErrorResponse(cause)) throw cause;
    return verifyCancellation(id, { code: "INTERNAL_ERROR", message: "Cancellation response was lost" });
  }
  if (!("operation" in response) || response.operation !== "cancel") return response;
  const result = response.result;
  if (result.success) {
    const refreshed = await readCancellationOrder(id);
    return { operation: "cancellation", orderId: id, outcome: { kind: "confirmed", order: refreshed.success && refreshed.data.cancelled ? refreshed.data : result.data,
      refreshFailed: !refreshed.success || !refreshed.data.cancelled } } satisfies CancellationClientResult;
  }
  if (["INVALID_TRANSITION", "PERSISTENCE_UNAVAILABLE", "INTERNAL_ERROR"].includes(result.error.code)) return verifyCancellation(id, result.error);
  return { operation: "cancellation", orderId: id, outcome: { kind: "failed", error: result.error } } satisfies CancellationClientResult;
}

const revalidatedRefusals = ["ITEMS_LOCKED", "DELIVERY_LOCKED", "ORDER_CANCELLED"];

export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: { actionResult: unknown; defaultShouldRevalidate: boolean }) {
  // The save's own answer is the new state; only the refusals that mean the order moved on reload it.
  if (actionResult && typeof actionResult === "object" && "operation" in actionResult && actionResult.operation === "save_changes")
    return "code" in actionResult && typeof actionResult.code === "string" && revalidatedRefusals.includes(actionResult.code);
  // A tap that meets short stock means the screen was stale: the order reloads to show the notice and the disabled buttons.
  if (actionResult && typeof actionResult === "object" && "operation" in actionResult && (actionResult.operation === "ship" || actionResult.operation === "deliver")
    && "error" in actionResult && actionResult.error === "INSUFFICIENT_STOCK") return true;
  // Cancellation already reads the detail once; retain confirmed/uncertain evidence if that read fails.
  return actionResult && typeof actionResult === "object" && "operation" in actionResult && actionResult.operation === "cancellation"
    ? false : defaultShouldRevalidate;
}

export async function action({ params, context, request }: ActionFunctionArgs) {
  if (request.headers.get("content-type")?.includes("application/json")) return saveChangesAction({ params, context, request } as ActionFunctionArgs);
  const access = context.get(privateUserContext);
  const id = z.uuid().safeParse(params.orderId);
  const fields = await request.formData();
  const operation = fields.get("operation");
  if (operation === "cancel") {
    const orderId = params.orderId ?? "";
    if (!isOrderId(orderId)) return { operation: "cancel", result: err({ code: "INVALID_INPUT", message: "Invalid order ID" }) } satisfies CancelOrderActionResult;
    try {
      const result = await orders.cancel(orderId, { companyId: access.company.id, userId: access.user.id });
      return { operation: "cancel", result: result.success ? ok(cancelOrderResponseSchema.parse(toOrderAggregateJson(result.data, null))) : result } satisfies CancelOrderActionResult;
    } catch (cause) {
      log.error({ event: "order_cancellation_request_failed", orderId, err: cause }, "Unable to cancel order");
      return { operation: "cancel", result: err({ code: "INTERNAL_ERROR", message: "Cancellation could not be confirmed" }) } satisfies CancelOrderActionResult;
    }
  }
  if (!id.success || ([...fields].length !== 0 && operation !== "confirm" && operation !== "void" && operation !== "reject" && operation !== "ship" && operation !== "deliver")) {
    bindRequestOperation({ outcome: "invalid_input" });
    return data({ url: null, success: false, error: true }, { status: 422, headers: headers() });
  }
  if (operation === "ship" || operation === "deliver") {
    try {
      const result = await orders[operation](id.data as OrderId, { companyId: access.company.id, userId: access.user.id });
      return { operation, url: null, success: result.success, error: result.success ? false : result.error.code } as const;
    } catch (cause) {
      log.error({ event: "order_fulfillment_request_failed", operation, orderId: id.data, err: cause }, "Unable to fulfill order");
      return { operation, url: null, success: false, error: "INTERNAL_ERROR" } as const;
    }
  }
  if ([...fields].length !== 0) {
    const paymentId = z.uuid().safeParse(fields.get("paymentId"));
    if (!paymentId.success) return { url: null, success: false, error: "INVALID_INPUT" };
    const seller = { companyId: access.company.id, userId: access.user.id };
    if (operation === "void") {
      const result = await orders.voidPayment({ orderId: id.data as OrderId, paymentId: paymentId.data as PaymentId }, seller);
      return result.success ? { url: null, success: true, error: false } : { url: null, success: false, error: paymentErrorCode(result.error.code) };
    }
    try {
      if (operation === "reject") {
        const reason = z.string().max(1000).nullable().safeParse(fields.get("reason"));
        if (!reason.success) return { url: null, success: false, error: "INVALID_INPUT" };
        const result = await orders.rejectPayment({ orderId: id.data as OrderId, paymentId: paymentId.data as PaymentId, reason: reason.data }, seller);
        if (!result.success) return { url: null, success: false, error: paymentErrorCode(result.error.code) };
        const described = await orders.describeStockDue([result.data.order]);
        if (!described.success) return { url: null, success: false, error: paymentErrorCode(described.error.code) };
        return { url: null, success: true, error: false, order: orderAggregateSchema.parse(toOrderAggregateJson(result.data.order, described.data.get(result.data.order.id) ?? null)) };
      }
      const parsed = registerPaymentSchema.safeParse({ paymentId: paymentId.data, source: fields.get("source"),
        amount: { amount: Number(fields.get("amount")), currency: fields.get("currency") }, method: fields.get("method"), walletProvider: fields.get("walletProvider") ?? undefined,
        deductStockIfPartial: fields.get("deductStockIfPartial") === "on" });
      if (!parsed.success) return { url: null, success: false, error: "INVALID_INPUT" };
      const result = await orders.registerPayment({ ...parsed.data, orderId: id.data as OrderId,
        paymentId: parsed.data.paymentId as PaymentId }, seller);
      if (!result.success) return { url: null, success: false, error: paymentErrorCode(result.error.code) };
      return { url: null, success: true, error: false, recorded: true, order: orderAggregateSchema.parse(toOrderAggregateJson(result.data.order, result.data.stockDue)) };
    } catch (cause) {
      log.error({ event: "order_payment_request_failed", operation, orderId: id.data, userId: access.user.id, errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle payment decision");
      return { url: null, success: false, error: "INTERNAL_ERROR" };
    }
  }
  bindRequestOperation({ outcome: "invalid_input" });
  return data({ url: null, success: false, error: true }, { status: 422, headers: headers() });
}

type Loaded = ReturnType<typeof useLoaderData<typeof loader>>;
const loadedOf = ({ order, revisions, lineCatalog }: Loaded): LoadedOrder => ({ order, revisions, lineCatalog });
const isSaveResult = (value: unknown): value is SaveChangesResult => typeof value === "object" && value !== null && "operation" in value && value.operation === "save_changes";
type Doubt = "checking" | "failed" | null;
type OnLoad = "refresh" | "resetProducts" | "reloadAll";

export default function OrderDetail() {
  const loaded = useLoaderData<typeof loader>();
  return <OrderDetailView key={loaded.order.id} loaded={loaded} />;
}

function OrderDetailView({ loaded }: Readonly<{ loaded: Loaded }>) {
  const { t, i18n } = useTranslation();
  const { base, manualPaymentId, receiptUrls, settings, settingsPath, link } = loaded;
  const rawAction = useActionData<typeof clientAction>();
  const submit = useSubmit();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const [state, setState] = useState<OrderViewState>(() => initialDraft({ kind: "saved", ...loadedOf(loaded) }));
  const [notice, setNotice] = useState<ViewNotice | null>(() => readSaleSaved(loaded.order.id) ? { kind: "success", text: t("orderView.status.saved") } : null);
  const [headingFocus, setHeadingFocus] = useState(() => readSaleSaved(loaded.order.id) ? 1 : 0);
  const [attempts, setAttempts] = useState(0);
  const [unavailableVariantId, setUnavailableVariantId] = useState<string | null>(null);
  const [doubt, setDoubt] = useState<Doubt>(null);
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const [onLoad, setOnLoad] = useState<OnLoad>("refresh");
  const [seenLoaded, setSeenLoaded] = useState(loaded);
  const [seenAction, setSeenAction] = useState(rawAction);
  const [printOpen, setPrintOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const money = (amount: { amount: number; currency: string }) => formatCurrency(amount.amount, amount.currency, i18n.language);
  const order = state.loaded?.order ?? loaded.order;
  const saveContext = { t, formatMoney: money };

  // The sale this view came from announces itself once; the mark is not read again.
  useEffect(() => { clearSaleSaved(loaded.order.id); }, [loaded.order.id]);

  // Both the action's answer and a revalidation can arrive in the same render, the answer first: a refusal that asks for a reset says how the loader's data is taken.
  if (rawAction !== seenAction || seenLoaded !== loaded) {
    let next = state;
    let mode = onLoad;
    if (rawAction !== seenAction) {
      setSeenAction(rawAction);
      if (isSaveResult(rawAction)) {
        const outcome = saveChangesOutcome(state, rawAction, saveContext);
        next = outcome.state;
        setNotice(outcome.notice);
        setUnavailableVariantId(outcome.unavailableVariantId);
        setDoubt(outcome.check ? "checking" : null);
        if (outcome.focusHeading) setHeadingFocus(headingFocus + 1);
        if (outcome.bumpCatalog) setCatalogEpoch(catalogEpoch + 1);
        if (outcome.resetProducts) mode = "resetProducts";
        if ("applied" in rawAction) setAttempts(0);
      }
    }
    // A new loader answer (a payment action, a fulfillment, a reload the seller asked for) moves only what has no unsaved edits, unless the seller chose otherwise.
    if (seenLoaded !== loaded) {
      const fresh = loadedOf(loaded);
      setSeenLoaded(loaded);
      next = mode === "reloadAll" ? reloadAll(next, fresh) : mode === "resetProducts" ? resetProducts(next, fresh) : refreshFromLoader(next, fresh);
      mode = "refresh";
      setCatalogEpoch(catalogEpoch + 1);
    }
    setOnLoad(mode);
    if (next !== state) setState(next);
  }

  // A lost answer is resolved by reading the order and comparing it with what was sent.
  // It is compared with what was sent: edits typed while the check runs must not turn «applied» into «changed».
  const latest = useRef(state);
  const sent = useRef<OrderViewState | null>(null);
  useEffect(() => { latest.current = state; });
  const orderId = loaded.order.id;
  useEffect(() => {
    if (doubt !== "checking") return;
    let current = true;
    void readCancellationOrder(orderId).then((found) => {
      if (!current) return;
      const pinned = sent.current ?? latest.current;
      if (!found.success || pinned.base === null) { setDoubt("failed"); return; }
      const outcome = inDoubtOutcome(found.data, pinned.draft, pinned.base);
      setDoubt(null);
      if (outcome === "applied") {
        setNotice({ kind: "success", text: t("orderView.status.changesSaved") });
        setHeadingFocus((count) => count + 1);
        void revalidator.revalidate();
      } else setNotice(outcome === "changed" ? { kind: "conflict" } : null);
    });
    return () => { current = false; };
  }, [doubt, orderId, revalidator, t]);

  const unsaved = unsavedParts(state).length > 0;
  const guard = useUnsavedChangesGuard({ dirty: unsaved, inDoubt: doubt !== null });
  const saving = navigation.state !== "idle" && navigation.formData === undefined && navigation.json !== undefined;
  const cancellation = rawAction && "operation" in rawAction && rawAction.operation === "cancellation" && rawAction.orderId === order.id ? rawAction : undefined;
  const actionData = rawAction && "operation" in rawAction && (rawAction.operation === "cancel" || rawAction.operation === "cancellation" || rawAction.operation === "save_changes") ? undefined : rawAction;
  const fulfillment = actionData && "operation" in actionData && (actionData.operation === "ship" || actionData.operation === "deliver") ? actionData : undefined;
  const voidResult = useMemo<PaymentDecisionResult | undefined>(() => actionData && !("operation" in actionData) ? { success: actionData.success, error: actionData.error === false ? false : String(actionData.error) } : undefined, [actionData]);
  const cancellationState: CancellationUiState = navigation.state !== "idle" && navigation.formData?.get("operation") === "cancel"
    ? { kind: "submitting", orderId: order.id }
    : navigation.state !== "idle" && navigation.formData?.get("operation") === "check-cancellation" ? { kind: "verifying", orderId: order.id }
    : cancellation?.outcome.kind === "uncertain" ? { kind: "uncertain", orderId: order.id, cause: cancellation.outcome.cause }
    : cancellation?.outcome.kind === "failed" ? { kind: "failed", error: cancellation.outcome.error } : { kind: "idle" };
  const busy = navigation.state !== "idle" || fetchers.some(fetcher => fetcher.state !== "idle");
  const needsCheck = cancellationState.kind === "uncertain" || (cancellation?.outcome.kind === "failed" && cancellation.outcome.refreshFailed);
  const blocked = busy || !!needsCheck || doubt !== null;
  const date = (value: string) => new Intl.DateTimeFormat(i18n.language === "pt" ? "pt-BR" : "es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }).format(new Date(value));

  // A confirmed cancellation answers with the cancelled order: every part loads it, and the edits (blocked while there were any) are gone.
  const cancelledOrder = cancellation?.outcome.kind === "confirmed" ? cancellation.outcome.order : cancellation?.outcome.kind === "failed" ? cancellation.outcome.order : undefined;
  // A failed one that found the order moved on (shipped meanwhile) answers the order it read: the parts without edits take it.
  if (cancelledOrder && state.loaded && state.loaded.order !== cancelledOrder) {
    const fresh = { order: cancelledOrder, revisions: state.loaded.revisions, lineCatalog: cancelledOrder.cancelled ? null : state.loaded.lineCatalog };
    setState(cancelledOrder.cancelled ? reloadAll(state, fresh) : refreshFromLoader(state, fresh));
  }

  function edit(next: OrderViewState) {
    setState(next);
    setNotice((current) => current?.kind === "success" ? null : current);
  }

  function send(next: OrderViewState) {
    const request = buildEditRequest(next);
    if (!request.success) return;
    setNotice(null);
    setUnavailableVariantId(null);
    sent.current = next;
    submit(request.data, { method: "post", encType: "application/json" });
  }

  function save() {
    // A refusal of the previous attempt does not stay next to a new one.
    if (invalidFields(state).length > 0) { setNotice(null); setAttempts((count) => count + 1); return; }
    send(state);
  }

  function saveOnlyCustomer() {
    if (!state.loaded) return;
    const next = refreshFromLoader(discardChanges(state, ["items", "delivery"]), state.loaded);
    setState(next);
    send(next);
  }

  function discard() {
    setState(discardChanges(state));
    setAttempts(0);
    setNotice(null);
    setUnavailableVariantId(null);
  }

  function reload() {
    setOnLoad("reloadAll");
    setNotice(null);
    setAttempts(0);
    setUnavailableVariantId(null);
    void revalidator.revalidate();
  }

  const underHeader = <div className="flex flex-col gap-4">
    {!order.cancelled && <StockDueNotice order={order} />}
    {!order.cancelled && order.status === "active" && order.deliveryStatus === "pending" && <div className="flex flex-col gap-1 self-start">
      <Button type="button" variant="destructive" aria-disabled={unsaved || blocked || undefined} aria-describedby={unsaved ? "cancel-unsaved-note" : undefined}
        onClick={() => { if (!unsaved && !blocked) setCancelOpen(true); }}>{t("orderCancellation.cancel")}</Button>
      {unsaved && <p id="cancel-unsaved-note" className="text-sm text-muted-foreground">{t("orderView.status.saveFirst")}</p>}
    </div>}
    <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("orderCancellation.confirm")}</DialogTitle><DialogDescription>{t("orderCancellation.effects")}</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>{t("orderCancellation.keep")}</Button>
          <Form method="post" onSubmit={event => { if (blocked) event.preventDefault(); else setCancelOpen(false); }}>
            <input type="hidden" name="operation" value="cancel" /><Button type="submit" variant="destructive" disabled={blocked}>{t("orderCancellation.cancel")}</Button>
          </Form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <DispatchLabelPrintDialog open={printOpen} onOpenChange={setPrintOpen} orderIds={[order.id]} orderNumber={order.number} />
    {!order.cancelled && (cancellationState.kind === "submitting" || cancellationState.kind === "verifying") && <Alert><AlertDescription>{t(`orderCancellation.${cancellationState.kind}`)}</AlertDescription></Alert>}
    {!order.cancelled && cancellationState.kind === "failed" && <Alert variant="destructive"><AlertDescription>{t(`orderCancellation.${cancellationMessage[cancellationState.error.code]}`)}</AlertDescription></Alert>}
    {!order.cancelled && needsCheck && <div className="flex flex-col gap-3"><Alert variant="destructive"><AlertDescription>{t(cancellationState.kind === "uncertain" ? "orderCancellation.uncertain" : "orderCancellation.stateRefreshFailed")}</AlertDescription></Alert><Form method="post"><input type="hidden" name="operation" value="check-cancellation" /><Button type="submit" disabled={busy}>{t("orderCancellation.check")}</Button></Form></div>}
    {cancellation?.outcome.kind === "confirmed" && cancellation.outcome.refreshFailed && <Alert variant="destructive"><AlertDescription>{t("orderCancellation.refreshFailed")}</AlertDescription></Alert>}
    {order.cancelled && <Alert><AlertDescription>{t("orderCancellation.saved")}</AlertDescription></Alert>}
  </div>;

  const fulfillmentSlot = !order.cancelled && <div className="flex flex-col gap-3">
    {(["ship", "deliver"] as const).map(operation => {
      const block = orderFulfillmentBlock(order, operation);
      const reason = block && fulfillmentReason(block, operation, order, i18n.language);
      const waiting = unsaved || blocked;
      const note = unsaved ? t("orderView.status.saveFirst") : reason ? t(reason.key, { items: reason.items }) : null;
      return <Form key={operation} method="post" className="flex flex-col gap-1" onSubmit={event => { if (reason || waiting) event.preventDefault(); }}>
        <input type="hidden" name="operation" value={operation} />
        <Button type="submit" variant="outline" aria-disabled={!!reason || waiting || undefined} aria-describedby={note ? `fulfillment-${operation}-reason` : undefined}>{t(`orderFulfillment.${operation}`)}</Button>
        {note && <p id={`fulfillment-${operation}-reason`} className="text-sm text-muted-foreground">{note}</p>}
      </Form>;
    })}
    {fulfillment?.error && <Alert variant="destructive"><AlertDescription>{t(`orderFulfillment.${fulfillment.operation === "ship" && fulfillment.error === "PAYMENT_REQUIRED" ? "SHIP_PAYMENT_REQUIRED" : fulfillment.error}`, { defaultValue: t("orderFulfillment.saveError") })}</AlertDescription></Alert>}
    {fulfillment?.success && <Alert variant="success"><AlertDescription>{t(`orderFulfillment.${fulfillment.operation}Saved`)}</AlertDescription></Alert>}
  </div>;

  return <OrderView state={state} onStateChange={edit} settings={settings}
    links={{ sales: base, deliverySettings: settingsPath, createProduct: base.replace(/\/orders$/, "/products") + "/new" }}
    catalogEpoch={catalogEpoch} guard={guard} saving={saving} notice={doubt ? { kind: "doubt", checking: doubt === "checking" } : notice} attempts={attempts} headingFocus={headingFocus}
    unavailableVariantId={unavailableVariantId} coverRequired={false} format={{ amount: money, date }}
    newPaymentId={() => crypto.randomUUID()} onSave={save} onCheckAgain={() => setDoubt("checking")}
    saved={{ link, receiptUrls, manualPaymentId, voidResult, actionBusy: blocked && !saving && doubt === null, underHeader, fulfillment: fulfillmentSlot,
      onPrint: () => setPrintOpen(true), onDiscardChanges: discard, onReload: reload, onSaveCustomerOnly: saveOnlyCustomer }} />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <ErrorState title={missing ? t("orders.missing") : t("orders.loadError")} description={missing ? t("orders.missingHint") : t("common.retry")} action={<Button asChild variant="outline"><a href="../">{t("orders.view")}</a></Button>} />;
}
