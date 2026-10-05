import { useState } from "react";
import { z } from "zod";
import { checkoutLinkSchema } from "@shared/contracts/order-checkout";
import { log, bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { useTranslation } from "react-i18next";
import { companyPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { data, isRouteErrorResponse, Link, useFetcher, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { privateUserContext } from "@core/app/private-user-context";
import { orders } from "@core/src/features/orders/composition";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import { orderDetailLoaderSchema } from "@shared/contracts/orders";
import type { OrderId } from "@core/src/features/orders/domain/order";
import { Button } from "@core/app/components/ui/button";
import { ErrorState } from "@core/app/components/ui/error-state";

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const result = await orders.getAggregate((params.orderId ?? "") as OrderId,
    { companyId: access.company.id, userId: access.user.id });
  if (!result.success) throw new Response(result.error.message, { status: result.error.code === "ORDER_NOT_FOUND" ? 404 : result.error.code === "INVALID_ORDER" ? 400 : 503 });
  return orderDetailLoaderSchema.parse({ order: toOrderAggregateJson(result.data), base: companyPath(new URL(request.url).pathname, access.company.country, "/orders") });
}

export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });

export async function action({ params, context, request }: ActionFunctionArgs) {
  const access = context.get(privateUserContext);
  bindRequestOperation({ operation: "enable_checkout" });
  const id = z.uuid().safeParse(params.orderId);
  const fields = await request.formData();
  if (!id.success || [...fields].length !== 0) {
    bindRequestOperation({ outcome: "invalid_input" });
    return data({ url: null, error: true }, { status: 422, headers: headers() });
  }
  try {
    const result = await orders.enableCheckout(id.data as OrderId, { companyId: access.company.id, userId: access.user.id });
    if (!result.success) return data({ url: null, error: true }, { status: result.error.code === "ORDER_CANCELLED" ? 409 : result.error.code === "CHECKOUT_UNAVAILABLE" ? 404 : 503, headers: headers() });
    return data({ url: checkoutLinkSchema.parse(result.data).url, error: false }, { headers: headers() });
  } catch (cause) {
    bindRequestOperation({ outcome: "technical_failure" });
    log.error({ event: "order_api_operation_failed", err: cause }, "Unable to enable checkout");
    return data({ url: null, error: true }, { status: 503, headers: headers() });
  }
}

export default function OrderDetail() {
  const { t, i18n } = useTranslation();
  const { order, base } = useLoaderData<typeof loader>();
  const checkout = useFetcher<typeof action>();
  const [copyMessage, setCopyMessage] = useState<"copied" | "copyManually" | null>(null);
  async function copyLink() {
    if (!checkout.data?.url) return;
    try { await navigator.clipboard.writeText(checkout.data.url); setCopyMessage("copied"); }
    catch { setCopyMessage("copyManually"); }
  }
  const amount = (money: typeof order.total) => formatCurrency(money.amount, money.currency, i18n.language);
  const status = t(`orders.status.${order.status}`);
  const date = (value: string) => new Date(value).toLocaleString(i18n.language === "pt" ? "pt-BR" : "es-PE", { timeZone: "America/Lima" });
  return <section className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{t("orders.orderNumber", { number: order.number })}</h1><p>{status}</p><p className="text-muted-foreground">{t("orders.createdOn", { date: date(order.createdAt) })}</p>{order.completedAt && <p className="text-muted-foreground">{t("orders.completedOn", { date: date(order.completedAt) })}</p>}</div><Button asChild variant="outline"><Link to={base}>{t("orders.view")}</Link></Button></header>
    <section className="flex flex-col gap-3" aria-label={t("orders.checkout")}>
      <h2 className="font-semibold">{t("orders.checkout")}</h2>
      <p>{t(order.cancelled ? "orders.checkoutCancelled" : order.checkoutConfirmedAt ? "orders.checkoutConfirmed" : order.checkoutEnabledAt ? "orders.checkoutPending" : "orders.checkoutDisabled")}</p>
      {!order.cancelled && <><checkout.Form method="post"><Button type="submit" disabled={checkout.state !== "idle"}>{t("orders.getCheckoutLink")}</Button></checkout.Form>
        {checkout.data?.error && <p role="alert">{t("orders.checkoutLinkError")}</p>}
        {checkout.data?.url && <><Field><FieldLabel htmlFor="checkout-link">{t("orders.checkoutLink")}</FieldLabel><Input id="checkout-link" readOnly value={checkout.data.url} onFocus={(event) => event.target.select()} /></Field><Button type="button" variant="outline" onClick={copyLink}>{t("orders.copyCheckoutLink")}</Button>{copyMessage && <p role="status">{t(`orders.${copyMessage}`)}</p>}</>}
      </>}
    </section>
    <dl className="grid gap-3 rounded-md border p-5 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">{t("orders.customer")}</dt><dd>{order.buyer !== null ? order.buyer.name ?? order.buyer.phone : t("orders.generalPublic")}</dd></div><div><dt className="text-sm text-muted-foreground">{t("orders.payment")}</dt><dd>{order.paymentStatus === "paid" ? t("orders.paid") : t("orders.balanceDue", { amount: amount(order.balanceDue) })}</dd></div>{order.buyer !== null && <div><dt className="text-sm text-muted-foreground">{t("orders.phoneAtSale")}</dt><dd>{order.buyer.phone}</dd></div>}<div><dt className="text-sm text-muted-foreground">{t("orders.delivery")}</dt><dd>{t(`orders.deliveryStatus.${order.deliveryStatus}`)}</dd></div><div><dt className="text-sm text-muted-foreground">{t("orders.stock")}</dt><dd>{order.stockDeducted ? t("orders.stockDeducted") : t("orders.stockPending")}</dd></div><div><dt className="text-sm text-muted-foreground">{t("orders.seller")}</dt><dd>{order.sellerId}</dd></div></dl>
    {order.delivery && <div className="rounded-md border p-5"><h2 className="font-semibold">{t("orders.recipient")}</h2><p>{order.delivery.recipient.name} · {order.delivery.recipient.phone}</p>{order.delivery.recipient.identity.kind === "document" && <p>{t(`orders.documentType.${order.delivery.recipient.identity.documentType}`)}: {order.delivery.recipient.identity.document}</p>}</div>}
    <ul className="divide-y rounded-md border">{order.items.map((item) => <li key={item.id} className="flex justify-between gap-3 p-4"><div><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{Object.values(item.variantAttributes).join(" · ") || item.sku || t("orders.uniqueVariant")} · {item.quantity} × {amount(item.unitPrice)}</p></div><strong>{amount(item.subtotal)}</strong></li>)}</ul>
    <p className="text-right text-xl font-semibold">{t("orders.total")}: {amount(order.total)}</p>
    {order.deliveryCharge.amount > 0 && <p className="text-right">{t("orders.deliveryCharge", { amount: amount(order.deliveryCharge) })}</p>}
    {order.overpaidAmount.amount > 0 && <p className="text-right">{t("orders.overpaid", { amount: amount(order.overpaidAmount) })}</p>}
    {order.payments.length > 0 && <section><h2 className="font-semibold">{t("orders.payments")}</h2><ul>{order.payments.map((payment) => <li key={payment.id}>{amount(payment.amount)} · {date(payment.recordedAt)}</li>)}</ul></section>}
  </section>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <ErrorState title={missing ? t("orders.missing") : t("orders.loadError")} description={missing ? t("orders.missingHint") : t("common.retry")} action={<Button asChild variant="outline"><a href="../">{t("orders.view")}</a></Button>} />;
}
