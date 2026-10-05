import { useTranslation } from "react-i18next";
import { companyPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { isRouteErrorResponse, Link, useLoaderData, useActionData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { privateUserContext } from "@core/app/private-user-context";
import { z } from "zod";
import { deliverySettingsSchema } from "@shared/contracts/delivery-settings";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { deliveryCostContext } from "@core/app/delivery-cost-context";
import { log } from "@core/src/shared/infrastructure/logger";
import { DeliveryForm } from "@core/src/features/orders/presentation/delivery-form";
import { parseDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { setConfiguredOrderDelivery } from "@core/src/features/orders/composition";
import { orders } from "@core/src/features/orders/composition";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import { orderDetailLoaderSchema, orderAggregateSchema, setOrderDeliverySchema } from "@shared/contracts/orders";
import type { OrderId, CompanyId, UserId } from "@core/src/features/orders/domain/order";
import { Button } from "@core/app/components/ui/button";
import { ErrorState } from "@core/app/components/ui/error-state";

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const result = await orders.getAggregate((params.orderId ?? "") as OrderId,
    { companyId: access.company.id, userId: access.user.id });
  if (!result.success) throw new Response(result.error.message, { status: result.error.code === "ORDER_NOT_FOUND" ? 404 : result.error.code === "INVALID_ORDER" ? 400 : 503 });
  const settings = await deliverySettings.get({ companyId: access.company.id, userId: access.user.id });
  return { ...orderDetailLoaderSchema.parse({ order: toOrderAggregateJson(result.data), base: companyPath(new URL(request.url).pathname, access.company.country, "/orders") }),
    settings: settings.success ? deliverySettingsSchema.parse(settings.data) : null,
    settingsPath: companyPath(new URL(request.url).pathname, access.company.country, "/settings/delivery") };
}

export async function action({ params, request, context }: ActionFunctionArgs) {
  const id = z.uuid().safeParse(params.orderId);
  let raw: unknown;
  try { raw = await request.json(); } catch { return { error: "invalid" as const }; }
  const parsed = setOrderDeliverySchema.safeParse(raw);
  if (!id.success || !parsed.success) return { error: "invalid" as const };
  const selection = parseDeliverySelection(parsed.data.delivery);
  if (!selection.success) return { error: "invalid" as const };
  const access = context.get(privateUserContext);
  try {
    const result = await setConfiguredOrderDelivery({ orderId: id.data as OrderId, delivery: selection.data,
      chargeDeliveryToCustomer: parsed.data.chargeDeliveryToCustomer }, { companyId: access.company.id as CompanyId, userId: access.user.id as UserId }, context.get(deliveryCostContext) ?? undefined);
    if (result.success) return { order: orderAggregateSchema.parse(toOrderAggregateJson(result.data)) };
    return { error: result.error.code === "DELIVERY_METHOD_DISABLED" ? "disabled" as const
      : result.error.code === "COURIER_UNAVAILABLE" ? "courierUnavailable" as const
      : result.error.code === "DELIVERY_UNAVAILABLE" ? "unavailable" as const
      : result.error.code === "DELIVERY_LOCKED" || result.error.code === "ORDER_CANCELLED" ? "locked" as const
      : result.error.code === "INSUFFICIENT_STOCK" ? "stockError" as const
      : result.error.code === "INVALID_ORDER" ? "invalid" as const : "saveError" as const };
  } catch (cause) {
    log.error({ event: "order_delivery_request_failed", operation: "set_order_delivery", entryPoint: "web_action", orderId: id.data,
      userId: access.user.id, errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle order delivery request");
    return { error: "saveError" as const };
  }
}

export default function OrderDetail() {
  const { t, i18n } = useTranslation();
  const { order, base, settings, settingsPath } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const editable = !order.cancelled && order.deliveryStatus === "pending" && order.completedAt === null;
  const amount = (money: typeof order.total) => formatCurrency(money.amount, money.currency, i18n.language);
  const status = t(`orders.status.${order.status}`);
  const date = (value: string) => new Date(value).toLocaleString(i18n.language === "pt" ? "pt-BR" : "es-PE", { timeZone: "America/Lima" });
  return <section className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{status}</h1><p className="text-muted-foreground">{t("orders.createdOn", { date: date(order.createdAt) })}</p>{order.completedAt && <p className="text-muted-foreground">{t("orders.completedOn", { date: date(order.completedAt) })}</p>}</div><Button asChild variant="outline"><Link to={base}>{t("orders.view")}</Link></Button></header>
    <dl className="grid gap-3 rounded-md border p-5 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">{t("orders.customer")}</dt><dd>{order.customer.kind === "contact" ? order.customer.name ?? order.customer.phone : t("orders.generalPublic")}</dd></div><div><dt className="text-sm text-muted-foreground">{t("orders.payment")}</dt><dd>{order.paymentStatus === "paid" ? t("orders.paid") : t("orders.balanceDue", { amount: amount(order.balanceDue) })}</dd></div>{order.customer.kind === "contact" && <div><dt className="text-sm text-muted-foreground">{t("orders.phoneAtSale")}</dt><dd>{order.customer.phone}</dd></div>}<div><dt className="text-sm text-muted-foreground">{t("orders.delivery")}</dt><dd>{t(`orders.deliveryStatus.${order.deliveryStatus}`)}</dd></div><div><dt className="text-sm text-muted-foreground">{t("orders.stock")}</dt><dd>{order.stockDeducted ? t("orders.stockDeducted") : t("orders.stockPending")}</dd></div><div><dt className="text-sm text-muted-foreground">{t("orders.seller")}</dt><dd>{order.sellerId}</dd></div></dl>
    {editable && !order.delivery && <p>{t("orderDelivery.undefined")}</p>}
    {order.delivery && <div className="break-words rounded-md border p-5"><h2 className="font-semibold">{t("orders.recipient")}</h2><p>{order.delivery.recipient.name} · {order.delivery.recipient.phone}</p>{order.delivery.recipient.identity.kind === "document" && <p>{t(`orders.documentType.${order.delivery.recipient.identity.documentType}`)}: {order.delivery.recipient.identity.document}</p>}</div>}
    {order.delivery?.method === "store" && <section className="flex flex-col gap-2"><h2 className="font-semibold">{t("deliverySettings.store")}</h2><p className="break-words">{order.delivery.pickupPoint.name}</p><p className="whitespace-pre-wrap break-words">{order.delivery.pickupPoint.address}</p>{order.delivery.pickupPoint.instructions && <p className="whitespace-pre-wrap break-words">{order.delivery.pickupPoint.instructions}</p>}<p className="break-words text-sm text-muted-foreground">{t("orderDelivery.recordedBy")}: {order.delivery.recordedBy.kind === "seller" ? order.delivery.recordedBy.userId : t("orderDelivery.buyer")}</p></section>}
    {order.delivery?.method === "home" && <section className="flex flex-col gap-2"><h2 className="font-semibold">{t("deliverySettings.home")}</h2><p className="whitespace-pre-wrap break-words">{order.delivery.destination.address}</p><p className="break-words">{order.delivery.destination.district}</p>{order.delivery.destination.instructions && <p className="whitespace-pre-wrap break-words">{order.delivery.destination.instructions}</p>}<p className="break-words text-sm text-muted-foreground">{t("orderDelivery.recordedBy")}: {order.delivery.recordedBy.kind === "seller" ? order.delivery.recordedBy.userId : t("orderDelivery.buyer")}</p></section>}
    {order.delivery?.method === "agency" && <section className="flex flex-col gap-2"><h2 className="font-semibold">{t("deliverySettings.agency")}</h2><p className="break-words">{order.delivery.courier.name}</p><p className="whitespace-pre-wrap break-words">{order.delivery.agency}</p><p className="break-words text-sm text-muted-foreground">{t("orderDelivery.recordedBy")}: {order.delivery.recordedBy.kind === "seller" ? order.delivery.recordedBy.userId : t("orderDelivery.buyer")}</p></section>}
    {result?.error && <p role="alert" className="text-sm text-destructive">{t(`orderDelivery.${result.error}`)}</p>}
    {result?.order && <p role="status">{t("orderDelivery.saved")}</p>}
    {editable ? settings && (settings.store.enabled || settings.home.enabled || settings.agency.enabled) ? <DeliveryForm key={JSON.stringify(order.delivery)} order={order} settings={settings} pending={navigation.state !== "idle"} />
      : <section className="flex flex-col gap-2"><p>{t(settings ? "orderDelivery.disabled" : "deliverySettings.loadError")}</p><Link className="text-primary underline underline-offset-4" to={settingsPath}>{t("orderDelivery.configure")}</Link></section>
      : <p className="text-sm text-muted-foreground">{t("orderDelivery.locked")}</p>}
    <ul className="divide-y rounded-md border">{order.items.map((item) => <li key={item.id} className="flex justify-between gap-3 p-4"><div><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{Object.values(item.variantAttributes).join(" · ") || item.sku || t("orders.uniqueVariant")} · {item.quantity} × {amount(item.unitPrice)}</p></div><strong>{amount(item.subtotal)}</strong></li>)}</ul>
    <p className="text-right text-xl font-semibold">{t("orders.total")}: {amount(order.total)}</p>
    {order.delivery && <div className="flex flex-col gap-2 text-right"><p>{t("orderDelivery.cost", { amount: amount(order.deliveryCost) })}</p><p>{t("orders.deliveryCharge", { amount: amount(order.deliveryCharge) })}</p></div>}
    {order.overpaidAmount.amount > 0 && <p className="text-right">{t("orders.overpaid", { amount: amount(order.overpaidAmount) })}</p>}
    {order.payments.length > 0 && <section><h2 className="font-semibold">{t("orders.payments")}</h2><ul>{order.payments.map((payment) => <li key={payment.id}>{amount(payment.amount)} · {date(payment.recordedAt)}</li>)}</ul></section>}
  </section>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <ErrorState title={missing ? t("orders.missing") : t("orders.loadError")} description={missing ? t("orders.missingHint") : t("common.retry")} action={<Button asChild variant="outline"><a href="../">{t("orders.view")}</a></Button>} />;
}
