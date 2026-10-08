import { fulfillmentBlock } from "@shared/orders-fulfillment";
import { PaymentFields, type PaymentDraft } from "@core/src/features/orders/presentation/payment-fields";
import { useState } from "react";
import { ArrowLeft, ChevronDown, CircleCheck, CircleX, CreditCard, ExternalLink, Truck } from "lucide-react";
import { Card } from "@core/app/components/ui/card";
import { z } from "zod";
import { checkoutLinkSchema } from "@shared/contracts/order-checkout";
import { log, bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { useTranslation } from "react-i18next";
import { randomUUID } from "node:crypto";
import { companyPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { Form, useActionData, data, isRouteErrorResponse, Link, useFetcher, useNavigation, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { privateUserContext } from "@core/app/private-user-context";
import { deliverySettingsSchema } from "@shared/contracts/delivery-settings";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { deliveryCostContext } from "@core/app/delivery-cost-context";
import { DeliveryForm } from "@core/src/features/orders/presentation/delivery-form";
import { parseDeliverySelection, parseRatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { setConfiguredOrderDelivery } from "@core/src/features/orders/composition";
import { orders } from "@core/src/features/orders/composition";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import { orderDetailLoaderSchema, orderAggregateSchema, setOrderDeliverySchema, setRatedOrderDeliverySchema, registerPaymentSchema } from "@shared/contracts/orders";
import type { OrderId, PaymentId, CompanyId, UserId } from "@core/src/features/orders/domain/order";
import { resolvePublicImage } from "@core/src/shared/images";
import { Button } from "@core/app/components/ui/button";
import { ErrorState } from "@core/app/components/ui/error-state";

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const result = await orders.getAggregate((params.orderId ?? "") as OrderId,
    { companyId: access.company.id, userId: access.user.id });
  if (!result.success) throw new Response(result.error.message, { status: result.error.code === "ORDER_NOT_FOUND" ? 404 : result.error.code === "INVALID_ORDER" ? 400 : 503 });
  const receiptUrls: Record<string, string> = {};
  for (const payment of result.data.payments) {
    const imageId = payment.status === "reported" ? payment.data.receiptImageId : payment.data.evidence.kind === "buyer_report"
      ? payment.data.evidence.report.receiptImageId : null;
    if (!imageId) continue;
    const image = await resolvePublicImage(imageId);
    if (image.success && image.data) receiptUrls[payment.id] = image.data.url;
  }
  const settings = await deliverySettings.get({ companyId: access.company.id, userId: access.user.id });
  return { ...orderDetailLoaderSchema.parse({ order: toOrderAggregateJson(result.data), base: companyPath(new URL(request.url).pathname, access.company.country, "/orders"),
    manualPaymentId: randomUUID(), receiptUrls }),
    settings: settings.success ? deliverySettingsSchema.parse(settings.data) : null,
    settingsPath: companyPath(new URL(request.url).pathname, access.company.country, "/settings/delivery") };
}

async function deliveryAction({ params, request, context }: ActionFunctionArgs) {
  const id = z.uuid().safeParse(params.orderId);
  let raw: unknown;
  try { raw = await request.json(); } catch { return { operation: "delivery" as const, url: null, success: false, error: "invalid" as const }; }
  const parsed = z.union([setRatedOrderDeliverySchema, setOrderDeliverySchema]).safeParse(raw);
  if (!id.success || !parsed.success) return { operation: "delivery" as const, url: null, success: false, error: "invalid" as const };
  const access = context.get(privateUserContext);
  try {
    const seller = { companyId: access.company.id as CompanyId, userId: access.user.id as UserId };
    let result: Awaited<ReturnType<typeof setConfiguredOrderDelivery>>;
    if ("expectedPrice" in parsed.data) {
      const selection = parseRatedDeliverySelection(parsed.data.delivery);
      if (!selection.success) return { operation: "delivery" as const, url: null, success: false, error: "invalid" as const };
      result = await setConfiguredOrderDelivery({ orderId: id.data as OrderId, delivery: selection.data, expectedPrice: parsed.data.expectedPrice }, seller);
    } else {
      const selection = parseDeliverySelection(parsed.data.delivery);
      if (!selection.success) return { operation: "delivery" as const, url: null, success: false, error: "invalid" as const };
      result = await setConfiguredOrderDelivery({ orderId: id.data as OrderId, delivery: selection.data,
        chargeDeliveryToCustomer: parsed.data.chargeDeliveryToCustomer }, seller, context.get(deliveryCostContext) ?? undefined);
    }
    if (result.success) return { operation: "delivery" as const, url: null, success: false, error: false, order: orderAggregateSchema.parse(toOrderAggregateJson(result.data)) };
    if (result.error.code === "TOTAL_CHANGED") return { operation: "delivery" as const, url: null, success: false, error: "priceChanged" as const, currentPrice: result.error.currentPrice };
    return { operation: "delivery" as const, url: null, success: false, error: result.error.code === "RATE_UNAVAILABLE" ? "rateUnavailable" as const
      : result.error.code === "DELIVERY_METHOD_DISABLED" ? "disabled" as const
      : result.error.code === "COURIER_UNAVAILABLE" ? "courierUnavailable" as const
      : result.error.code === "DELIVERY_UNAVAILABLE" ? "unavailable" as const
      : result.error.code === "DELIVERY_LOCKED" || result.error.code === "ORDER_CANCELLED" ? "locked" as const
      : result.error.code === "INSUFFICIENT_STOCK" ? "stockError" as const
      : result.error.code === "INVALID_ORDER" ? "invalid" as const : "saveError" as const };
  } catch (cause) {
    log.error({ event: "order_delivery_request_failed", operation: "set_order_delivery", entryPoint: "web_action", orderId: id.data,
      userId: access.user.id, errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle order delivery request");
    return { operation: "delivery" as const, url: null, success: false, error: "saveError" as const };
  }
}

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });

export async function action({ params, context, request }: ActionFunctionArgs) {
  if (request.headers.get("content-type")?.includes("application/json")) return deliveryAction({ params, context, request } as ActionFunctionArgs);
  const access = context.get(privateUserContext);
  const id = z.uuid().safeParse(params.orderId);
  const fields = await request.formData();
  const operation = fields.get("operation");
  if (!id.success || ([...fields].length !== 0 && operation !== "confirm" && operation !== "void" && operation !== "ship" && operation !== "deliver")) {
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
    if (fields.get("operation") === "void") {
      const result = await orders.voidPayment({ orderId: id.data as OrderId, paymentId: paymentId.data as PaymentId }, seller);
      return result.success ? { url: null, success: true, error: false } : { url: null, success: false, error: result.error.code };
    }
    if (fields.get("operation") !== "confirm") return { url: null, success: false, error: "INVALID_INPUT" };
    const parsed = registerPaymentSchema.safeParse({ paymentId: paymentId.data, source: fields.get("source"),
      amount: { amount: Number(fields.get("amount")), currency: fields.get("currency") }, method: fields.get("method"),
      deductStockIfPartial: fields.get("deductStockIfPartial") === "on" });
    if (!parsed.success) return { url: null, success: false, error: "INVALID_INPUT" };
    const result = await orders.registerPayment({ ...parsed.data, orderId: id.data as OrderId,
      paymentId: parsed.data.paymentId as PaymentId }, seller);
    return result.success ? { url: null, success: true, error: false } : { url: null, success: false, error: result.error.code };
  }
  bindRequestOperation({ operation: "enable_checkout" });
  try {
    const result = await orders.enableCheckout(id.data as OrderId, { companyId: access.company.id, userId: access.user.id });
    if (!result.success) return data({ url: null, success: false, error: true }, { status: result.error.code === "ORDER_CANCELLED" ? 409 : result.error.code === "CHECKOUT_UNAVAILABLE" ? 404 : 503, headers: headers() });
    return data({ url: checkoutLinkSchema.parse(result.data).url, success: false, error: false }, { headers: headers() });
  } catch (cause) {
    bindRequestOperation({ outcome: "technical_failure" });
    log.error({ event: "order_api_operation_failed", err: cause }, "Unable to enable checkout");
    return data({ url: null, success: false, error: true }, { status: 503, headers: headers() });
  }
}

export default function OrderDetail() {
  const { t, i18n } = useTranslation();
  const { order, base, manualPaymentId, receiptUrls, settings, settingsPath } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const result = actionData && "operation" in actionData && actionData.operation === "delivery" ? actionData : undefined;
  const fulfillment = actionData && "operation" in actionData && (actionData.operation === "ship" || actionData.operation === "deliver") ? actionData : undefined;
  const navigation = useNavigation();
  const editable = !order.cancelled && order.deliveryStatus === "pending" && order.completedAt === null;
  const [editingDelivery, setEditingDelivery] = useState(false);
  const checkout = useFetcher<typeof action>();
  const [copyMessage, setCopyMessage] = useState<"copied" | "copyManually" | null>(null);
  async function copyLink() {
    if (!checkout.data?.url) return;
    try { await navigator.clipboard.writeText(checkout.data.url); setCopyMessage("copied"); }
    catch { setCopyMessage("copyManually"); }
  }
  const amount = (money: typeof order.total) => formatCurrency(money.amount, money.currency, i18n.language);
  const date = (value: string) => new Date(value).toLocaleString(i18n.language === "pt" ? "pt-BR" : "es-PE", { timeZone: "America/Lima" });
  const badge = "inline-flex items-center gap-2 rounded-[var(--radius-badge)] px-3 py-2 text-sm font-medium";
  return <section className="flex min-w-0 flex-col gap-6" aria-labelledby="order-title">
    <header className="flex flex-col gap-4">
      <Link to={base} className="inline-flex min-h-control w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-md:min-h-touch"><ArrowLeft className="size-icon-inline" aria-hidden="true" />{t("orders.view")}</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 id="order-title" className="text-2xl font-semibold">{t("orders.orderNumber", { number: order.number })}</h1>
          <p className="text-sm text-muted-foreground">{t("orders.createdOn", { date: date(order.createdAt) })}</p>
          {order.completedAt && <p className="text-sm text-muted-foreground">{t("orders.completedOn", { date: date(order.completedAt) })}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`${badge} ${order.cancelled ? "bg-[var(--error-surface)] text-[var(--error)]" : "bg-[var(--success-surface)] text-[var(--success)]"}`}><span aria-hidden="true">{order.cancelled ? <CircleX className="size-icon-inline" /> : <CircleCheck className="size-icon-inline" />}</span>{t(`orders.status.${order.status}`)}</span>
          <span className={`${badge} ${order.paymentStatus === "paid" ? "bg-[var(--info-surface)] text-[var(--info)]" : "bg-[var(--warning-surface)] text-[var(--warning)]"}`}><CreditCard className="size-icon-inline" aria-hidden="true" />{t("orders.payment")}: {order.paymentStatus === "paid" ? t("orders.paid") : t("orderDetail.pendingPayment")}</span>
          <span className={`${badge} ${order.deliveryStatus === "pending" ? "bg-[var(--warning-surface)] text-[var(--warning)]" : "bg-[var(--success-surface)] text-[var(--success)]"}`}><Truck className="size-icon-inline" aria-hidden="true" />{t("orders.delivery")}: {t(`orders.deliveryStatus.${order.deliveryStatus}`)}</span>
        </div>
      </div>
    </header>

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
        <Card role="region" aria-labelledby="order-products-title" className="min-w-0 max-xl:order-1">
          <div className="flex items-center justify-between gap-3 p-4"><h2 id="order-products-title" className="text-lg font-semibold">{t("products.title")}</h2><span className="text-sm text-muted-foreground">{t("orders.itemCount", { count: order.items.length })}</span></div>
          <div className="px-4 pb-4">
            <table className="w-full table-fixed text-sm max-sm:block">
              <thead className="bg-background text-muted-foreground max-sm:sr-only"><tr><th scope="col" className="w-1/2 rounded-l-sm px-3 py-3 text-left font-medium">{t("nav.product")}</th><th scope="col" className="px-2 py-3 text-center font-medium">{t("orders.quantity")}</th><th scope="col" className="rounded-r-sm px-3 py-3 text-right font-medium">{t("orderDetail.amount")}</th></tr></thead>
              <tbody className="divide-y max-sm:block">{order.items.map(item => <tr key={item.id} className="max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-3 max-sm:py-3">
                <td className="break-words px-3 py-4 align-top max-sm:min-w-0 max-sm:p-0"><p className="font-medium">{item.productName}</p><p className="mt-1 text-muted-foreground">{Object.values(item.variantAttributes).join(" · ") || item.sku || t("orders.uniqueVariant")} · <span className="tabular-nums">{amount(item.unitPrice)}</span></p></td>
                <td className="px-2 py-4 text-center align-top tabular-nums max-sm:col-start-1 max-sm:row-start-2 max-sm:p-0 max-sm:pt-2 max-sm:text-left max-sm:text-muted-foreground"><span className="sm:sr-only">{t("orders.quantity")}: </span>{item.quantity}</td><td className="break-words px-3 py-4 text-right align-top font-semibold tabular-nums max-sm:col-start-2 max-sm:row-start-1 max-sm:p-0 max-sm:whitespace-nowrap">{amount(item.subtotal)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </Card>

        <Card role="region" aria-labelledby="order-payments-title" className="min-w-0 max-xl:order-2">
          <h2 id="order-payments-title" className="p-4 text-lg font-semibold">{t("orders.payments")}</h2>
          <div className="flex flex-col gap-6 px-4 pb-4">
            <dl className="flex flex-col gap-3 text-sm tabular-nums sm:ml-auto sm:w-2/3">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{t("orderDetail.subtotal")}</dt><dd>{amount(order.itemsTotal)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{t("orderDetail.deliveryCharge")}</dt><dd>{amount(order.deliveryCharge)}</dd></div>
              <div className="flex justify-between gap-4 border-t pt-3 text-lg font-semibold"><dt>{t("orders.total")}:</dt>{" "}<dd>{amount(order.total)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{t("orderDetail.received")}</dt><dd>{amount(order.paidAmount)}</dd></div>
              <div className="flex justify-between gap-4 font-medium"><dt>{t("orderDetail.balance")}</dt><dd>{amount(order.balanceDue)}</dd></div>
              {order.overpaidAmount.amount > 0 && <div className="rounded-sm bg-[var(--warning-surface)] p-3 text-[var(--warning)]">{t("orders.overpaid", { amount: amount(order.overpaidAmount) })}</div>}
            </dl>
            {actionData?.error && !("operation" in actionData) && <p role="alert" className="text-sm text-destructive">{actionData.error === "INSUFFICIENT_STOCK" ? t("orders.paymentStockError") : t("orders.paymentSaveError")}</p>}
            {actionData?.success && !("operation" in actionData) && <p role="status" className="text-sm text-[var(--success)]">{t("orders.paymentSaved")}</p>}
            <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="payment-history-title">
              <h3 id="payment-history-title" className="text-sm font-semibold">{t("orderDetail.paymentHistory")}</h3>
              {order.payments.length === 0 ? <p className="text-sm text-muted-foreground">{t("orderDetail.noPayments")}</p> : <ul className="divide-y">{order.payments.map(payment => <li key={payment.id} className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                  <div className="flex min-w-0 flex-col gap-1"><p className="font-medium">{t(payment.status === "reported" ? "orders.paymentReported" : payment.status === "voided" ? "orders.paymentVoided" : "orderDetail.confirmedPayment")}</p><p className="text-muted-foreground">{date(payment.status === "reported" ? payment.data.reportedAt : payment.data.confirmedAt)}</p>{payment.method && <p className="text-muted-foreground">{t(payment.method === "digital_wallet" ? "orders.wallet" : "orders.bankTransfer")}</p>}</div>
                  {payment.status !== "reported" && <strong className="tabular-nums">{amount(payment.amount)}</strong>}
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                  {receiptUrls[payment.id] && <a className="inline-flex min-h-control items-center text-sm text-primary underline underline-offset-4 max-md:min-h-touch" href={receiptUrls[payment.id]} target="_blank" rel="noreferrer">{t("orders.viewReceipt")}</a>}
                  {payment.status === "confirmed" && <Form method="post"><input type="hidden" name="operation" value="void" /><input type="hidden" name="paymentId" value={payment.id} /><Button type="submit" variant="outline" disabled={navigation.state !== "idle"}>{t("orders.voidPayment")}</Button></Form>}
                </div>
                {payment.status === "reported" && !order.cancelled && <div className="sm:col-span-2"><PaymentForm paymentId={payment.id} source="buyer_report" currency={order.total.currency} balance={order.balanceDue.amount} /></div>}
              </li>)}</ul>}
            </section>
            {!order.cancelled && order.balanceDue.amount > 0 && <section className="flex flex-col gap-3 border-t pt-4"><h3 className="text-sm font-semibold">{t("orders.manualPayment")}</h3><PaymentForm paymentId={manualPaymentId} source="manual" currency={order.total.currency} balance={order.balanceDue.amount} /></section>}
          </div>
        </Card>

        <Card role="region" aria-labelledby="checkout-title" className="min-w-0 max-xl:order-5">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4"><h2 id="checkout-title" className="text-lg font-semibold">{t("orders.checkout")}</h2>{!order.cancelled && <checkout.Form method="post"><Button type="submit" variant="outline" disabled={checkout.state !== "idle"}>{t("orders.getCheckoutLink")}</Button></checkout.Form>}</div>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <p className="text-sm text-muted-foreground">{t(order.cancelled ? "orders.checkoutCancelled" : order.checkoutConfirmedAt ? "orders.checkoutConfirmed" : order.checkoutEnabledAt ? "orders.checkoutPending" : "orders.checkoutDisabled")}</p>
            {checkout.data?.error && <p role="alert" className="text-sm text-destructive">{t("orders.checkoutLinkError")}</p>}
            {checkout.data?.url && <><Field><FieldLabel htmlFor="checkout-link">{t("orders.checkoutLink")}</FieldLabel><Input id="checkout-link" readOnly value={checkout.data.url} onFocus={event => event.target.select()} /></Field><Button type="button" variant="outline" className="self-start" onClick={copyLink}>{t("orders.copyCheckoutLink")}</Button>{copyMessage && <p role="status" className="text-sm">{t(`orders.${copyMessage}`)}</p>}</>}
            <a href={`/pago/${order.id}`} target="_blank" rel="noreferrer" className="flex min-h-control items-center justify-between gap-3 border-t pt-3 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring max-md:min-h-touch">{t("orders.buyerPaymentLink")}<ExternalLink className="size-icon-inline shrink-0" aria-hidden="true" /></a>
          </div>
        </Card>
      </div>

      <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
        <Card role="region" aria-labelledby="order-customer-title" className="min-w-0 max-xl:order-3">
          <h2 id="order-customer-title" className="p-4 text-lg font-semibold">{t("orders.customer")}</h2>
          <div className="flex flex-col gap-2 px-4 pb-4"><p className="break-words font-medium">{order.buyer !== null ? order.buyer.name ?? order.buyer.phone : t("orders.generalPublic")}</p>{order.buyer !== null && <dl className="text-sm"><dt className="text-muted-foreground">{t("orders.phoneAtSale")}</dt><dd className="mt-1 break-words">{order.buyer.phone}</dd></dl>}</div>
        </Card>

        <Card role="region" aria-labelledby="order-delivery-title" className="min-w-0 max-xl:order-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4"><h2 id="order-delivery-title" className="text-lg font-semibold">{t("orders.delivery")}</h2>{editable && settings && (settings.store.enabled || settings.home.enabled || settings.agency.enabled) && <Button type="button" aria-expanded={editingDelivery} aria-controls="delivery-editor" onClick={() => setEditingDelivery(!editingDelivery)}>{t(editingDelivery ? "orderDetail.closeEditor" : order.delivery ? "orderDetail.editDelivery" : "orderDelivery.assign")}</Button>}</div>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-col gap-3">
              {(["ship", "deliver"] as const).map(operation => {
                const blocked = fulfillmentBlock(order, operation);
                return <Form key={operation} method="post" className="flex flex-col gap-1">
                  <input type="hidden" name="operation" value={operation} />
                  <Button type="submit" variant="outline" disabled={!!blocked || navigation.state !== "idle"} aria-describedby={blocked ? `fulfillment-${operation}-reason` : undefined}>{t(`orderFulfillment.${operation}`)}</Button>
                  {blocked && <p id={`fulfillment-${operation}-reason`} className="text-sm text-muted-foreground">{t(`orderFulfillment.${blocked}`)}</p>}
                </Form>;
              })}
              {fulfillment?.error && <p role="alert" className="text-sm text-destructive">{t(`orderFulfillment.${fulfillment.error}`, { defaultValue: t("orderFulfillment.saveError") })}</p>}
              {fulfillment?.success && <p role="status" className="text-sm text-[var(--success)]">{t(`orderFulfillment.${fulfillment.operation}Saved`)}</p>}
            </div>
            {order.delivery ? <>
              <section className="flex flex-col gap-2 text-sm">
                <h3 className="font-semibold">{t(`deliverySettings.${order.delivery.method}`)}</h3>
                {order.delivery.method === "store" && <><p className="break-words">{order.delivery.pickupPoint.name}</p><p className="whitespace-pre-wrap break-words">{order.delivery.pickupPoint.address}</p>{order.delivery.pickupPoint.instructions && <p className="whitespace-pre-wrap break-words text-muted-foreground">{order.delivery.pickupPoint.instructions}</p>}</>}
                {order.delivery.method === "home" && <><p className="whitespace-pre-wrap break-words">{order.delivery.destination.address}</p><p className="break-words">{order.delivery.destination.district}</p>{order.delivery.destination.instructions && <p className="whitespace-pre-wrap break-words text-muted-foreground">{order.delivery.destination.instructions}</p>}</>}
                {order.delivery.method === "agency" && (order.delivery.courier === null ? <div><p>{order.delivery.destination.district}</p><p className="text-muted-foreground">{t("orderDelivery.assignmentPending")}</p></div> : <dl className="grid grid-cols-2 gap-x-3 gap-y-2"><dt className="text-muted-foreground">{t("orderDelivery.courier")}</dt><dd className="break-words">{order.delivery.courier.name}</dd><dt className="text-muted-foreground">{t("orderDelivery.agency")}</dt><dd className="whitespace-pre-wrap break-words">{order.delivery.agency}</dd></dl>)}
              </section>
              <section className="flex flex-col gap-2 border-t pt-4 text-sm"><h3 className="font-semibold">{t("orders.recipient")}</h3><p className="break-words">{order.delivery.recipient.name}</p><p className="break-words text-muted-foreground">{order.delivery.recipient.phone}</p>{order.delivery.recipient.identity.kind === "document" && <p className="break-words text-muted-foreground">{t(`orders.documentType.${order.delivery.recipient.identity.documentType}`)}: {order.delivery.recipient.identity.document}</p>}</section>
              <dl className="border-t pt-4 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">{t("orderDetail.internalDeliveryCost")}</dt><dd className="shrink-0 tabular-nums">{amount(order.deliveryCost)}</dd></div></dl>
            </> : editable && <p className="text-sm text-muted-foreground">{t("orderDelivery.undefined")}</p>}
            {result && typeof result.error === "string" && <p role="alert" className="text-sm text-destructive">{t(`orderDelivery.${result.error}`)}</p>}
            {result && "order" in result && result.order && <p role="status" className="text-sm text-[var(--success)]">{t("orderDelivery.saved")}</p>}
            {editable ? settings && (settings.store.enabled || settings.home.enabled || settings.agency.enabled) ? <div id="delivery-editor" hidden={!editingDelivery} className="border-t pt-4"><DeliveryForm key={JSON.stringify(order.delivery)} order={order} settings={settings} pending={navigation.state !== "idle"} /></div>
              : <div className="flex flex-col gap-2 text-sm"><p className="text-muted-foreground">{t(settings ? "orderDelivery.disabled" : "deliverySettings.loadError")}</p><Link className="text-primary underline underline-offset-4" to={settingsPath}>{t("orderDelivery.configure")}</Link></div>
              : <p className="text-sm text-muted-foreground">{t("orderDelivery.locked")}</p>}
          </div>
        </Card>

        <Card className="min-w-0 max-xl:order-6"><details className="group p-4"><summary className="flex min-h-control cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring max-md:min-h-touch [&::-webkit-details-marker]:hidden">{t("orderDetail.internalDetails")}<ChevronDown className="size-icon-inline shrink-0 group-open:rotate-180" aria-hidden="true" /></summary><dl className="mt-3 flex flex-col gap-3 border-t pt-4 text-sm"><div><dt className="text-muted-foreground">{t("orders.stock")}</dt><dd>{t(order.stockDeducted ? "orders.stockDeducted" : "orders.stockPending")}</dd></div><div><dt className="text-muted-foreground">{t("orders.seller")}</dt><dd className="break-all">{order.sellerId}</dd></div>{order.delivery && <div><dt className="text-muted-foreground">{t("orderDelivery.recordedBy")}</dt><dd className="break-all">{order.delivery.recordedBy.kind === "seller" ? order.delivery.recordedBy.userId : t("orderDelivery.buyer")}</dd></div>}</dl></details></Card>
      </div>
    </div>
  </section>;
}

function PaymentForm({ paymentId, source, currency, balance }: { paymentId: string; source: "manual" | "buyer_report"; currency: string; balance: number }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [value, setValue] = useState<PaymentDraft>({ amount: balance.toFixed(2), method: "digital_wallet", deductStockIfPartial: false });
  return <Form method="post" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
    <input type="hidden" name="operation" value="confirm" /><input type="hidden" name="source" value={source} />
    <input type="hidden" name="paymentId" value={paymentId} /><input type="hidden" name="currency" value={currency} />
    <PaymentFields value={value} onChange={setValue} />
    <Button type="submit" disabled={navigation.state !== "idle"} className="sm:col-start-3 sm:row-start-1">{t("orders.confirmPayment")}</Button>
  </Form>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <ErrorState title={missing ? t("orders.missing") : t("orders.loadError")} description={missing ? t("orders.missingHint") : t("common.retry")} action={<Button asChild variant="outline"><a href="../">{t("orders.view")}</a></Button>} />;
}
