import { useTranslation } from "react-i18next";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { companyPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { Form, isRouteErrorResponse, Link, useActionData, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { privateUserContext } from "@core/app/private-user-context";
import { orders } from "@core/src/features/orders/composition";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import { orderDetailLoaderSchema, registerPaymentSchema } from "@shared/contracts/orders";
import type { OrderId, PaymentId } from "@core/src/features/orders/domain/order";
import { resolvePublicImage } from "@core/src/shared/images";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
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
  return orderDetailLoaderSchema.parse({ order: toOrderAggregateJson(result.data), base: companyPath(new URL(request.url).pathname, access.company.country, "/orders"),
    manualPaymentId: randomUUID(), receiptUrls });
}

export async function action({ params, context, request }: ActionFunctionArgs) {
  const access = context.get(privateUserContext);
  const orderId = z.uuid().safeParse(params.orderId);
  if (!orderId.success) return { error: "INVALID_INPUT" };
  const form = await request.formData();
  const paymentId = z.uuid().safeParse(form.get("paymentId"));
  if (!paymentId.success) return { error: "INVALID_INPUT" };
  const seller = { companyId: access.company.id, userId: access.user.id };
  if (form.get("operation") === "void") {
    const result = await orders.voidPayment({ orderId: orderId.data as OrderId, paymentId: paymentId.data as PaymentId }, seller);
    return result.success ? { success: true } : { error: result.error.code };
  }
  if (form.get("operation") !== "confirm") return { error: "INVALID_INPUT" };
  const parsed = registerPaymentSchema.safeParse({ paymentId: paymentId.data, source: form.get("source"),
    amount: { amount: Number(form.get("amount")), currency: form.get("currency") }, method: form.get("method"),
    deductStockIfPartial: form.get("deductStockIfPartial") === "on" });
  if (!parsed.success) return { error: "INVALID_INPUT" };
  const result = await orders.registerPayment({ ...parsed.data, orderId: orderId.data as OrderId,
    paymentId: parsed.data.paymentId as PaymentId }, seller);
  return result.success ? { success: true } : { error: result.error.code };
}

export default function OrderDetail() {
  const { t, i18n } = useTranslation();
  const { order, base, manualPaymentId, receiptUrls } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const amount = (money: typeof order.total) => formatCurrency(money.amount, money.currency, i18n.language);
  const status = t(`orders.status.${order.status}`);
  const date = (value: string) => new Date(value).toLocaleString(i18n.language === "pt" ? "pt-BR" : "es-PE", { timeZone: "America/Lima" });
  return <section className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{status}</h1><p className="text-muted-foreground">{t("orders.createdOn", { date: date(order.createdAt) })}</p>{order.completedAt && <p className="text-muted-foreground">{t("orders.completedOn", { date: date(order.completedAt) })}</p>}</div><div className="flex gap-2"><Button asChild variant="outline"><a href={`/pago/${order.id}`} target="_blank" rel="noreferrer">{t("orders.buyerPaymentLink")}</a></Button><Button asChild variant="outline"><Link to={base}>{t("orders.view")}</Link></Button></div></header>
    <dl className="grid gap-3 rounded-md border p-5 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">{t("orders.customer")}</dt><dd>{order.customer.kind === "contact" ? order.customer.name ?? order.customer.phone : t("orders.generalPublic")}</dd></div><div><dt className="text-sm text-muted-foreground">{t("orders.payment")}</dt><dd>{order.paymentStatus === "paid" ? t("orders.paid") : t("orders.balanceDue", { amount: amount(order.balanceDue) })}</dd></div>{order.customer.kind === "contact" && <div><dt className="text-sm text-muted-foreground">{t("orders.phoneAtSale")}</dt><dd>{order.customer.phone}</dd></div>}<div><dt className="text-sm text-muted-foreground">{t("orders.delivery")}</dt><dd>{t(`orders.deliveryStatus.${order.deliveryStatus}`)}</dd></div><div><dt className="text-sm text-muted-foreground">{t("orders.stock")}</dt><dd>{order.stockDeducted ? t("orders.stockDeducted") : t("orders.stockPending")}</dd></div><div><dt className="text-sm text-muted-foreground">{t("orders.seller")}</dt><dd>{order.sellerId}</dd></div></dl>
    {order.delivery && <div className="rounded-md border p-5"><h2 className="font-semibold">{t("orders.recipient")}</h2><p>{order.delivery.recipient.name} · {order.delivery.recipient.phone}</p>{order.delivery.recipient.identity.kind === "document" && <p>{t(`orders.documentType.${order.delivery.recipient.identity.documentType}`)}: {order.delivery.recipient.identity.document}</p>}</div>}
    <ul className="divide-y rounded-md border">{order.items.map((item) => <li key={item.id} className="flex justify-between gap-3 p-4"><div><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{Object.values(item.variantAttributes).join(" · ") || item.sku || t("orders.uniqueVariant")} · {item.quantity} × {amount(item.unitPrice)}</p></div><strong>{amount(item.subtotal)}</strong></li>)}</ul>
    <p className="text-right text-xl font-semibold">{t("orders.total")}: {amount(order.total)}</p>
    {order.deliveryCharge.amount > 0 && <p className="text-right">{t("orders.deliveryCharge", { amount: amount(order.deliveryCharge) })}</p>}
    {order.overpaidAmount.amount > 0 && <p className="text-right">{t("orders.overpaid", { amount: amount(order.overpaidAmount) })}</p>}
    {actionData?.error && <p role="alert" className="text-sm text-destructive">{actionData.error === "INSUFFICIENT_STOCK" ? t("orders.paymentStockError") : t("orders.paymentSaveError")}</p>}
    {actionData?.success && <p role="status" className="text-sm text-muted-foreground">{t("orders.paymentSaved")}</p>}
    {order.payments.length > 0 && <section className="flex flex-col gap-3"><h2 className="font-semibold">{t("orders.payments")}</h2><ul className="divide-y rounded-md border bg-card">{order.payments.map((payment) => <li key={payment.id} className="flex flex-col gap-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span>{payment.status === "reported"
      ? `${t("orders.paymentReported")} · ${date(payment.data.reportedAt)}`
      : `${payment.status === "voided" ? `${t("orders.paymentVoided")} · ` : ""}${amount(payment.amount)} · ${date(payment.data.confirmedAt)}`}</span>
      {receiptUrls[payment.id] && <a className="text-sm text-primary underline underline-offset-4" href={receiptUrls[payment.id]} target="_blank" rel="noreferrer">{t("orders.viewReceipt")}</a>}</div>
      {payment.status === "reported" && !order.cancelled && <PaymentForm paymentId={payment.id} source="buyer_report" currency={order.total.currency}
        balance={order.balanceDue.amount} />}
      {payment.status === "confirmed" && <Form method="post"><input type="hidden" name="operation" value="void" /><input type="hidden" name="paymentId" value={payment.id} />
        <Button type="submit" size="sm" variant="outline">{t("orders.voidPayment")}</Button></Form>}
    </li>)}</ul></section>}
    {!order.cancelled && order.balanceDue.amount > 0 && <section className="flex flex-col gap-3 rounded-md border bg-card p-5"><h2 className="font-semibold">{t("orders.manualPayment")}</h2>
      <PaymentForm paymentId={manualPaymentId} source="manual" currency={order.total.currency} balance={order.balanceDue.amount} /></section>}
  </section>;
}

function PaymentForm({ paymentId, source, currency, balance }: { paymentId: string; source: "manual" | "buyer_report"; currency: string; balance: number }) {
  const { t } = useTranslation();
  return <Form method="post" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
    <input type="hidden" name="operation" value="confirm" /><input type="hidden" name="source" value={source} />
    <input type="hidden" name="paymentId" value={paymentId} /><input type="hidden" name="currency" value={currency} />
    <label className="flex flex-col gap-1 text-sm">{t("orders.paymentAmount")}<Input name="amount" type="number" min="0.01" step="0.01" defaultValue={balance.toFixed(2)} required /></label>
    <label className="flex flex-col gap-1 text-sm">{t("orders.paymentMethod")}<select name="method" className="h-10 rounded-md border bg-background px-3" defaultValue="digital_wallet">
      <option value="digital_wallet">{t("orders.wallet")}</option><option value="bank_transfer">{t("orders.bankTransfer")}</option></select></label>
    <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="deductStockIfPartial" />{t("orders.deductStockIfPartial")}</label>
    <Button type="submit" className="sm:col-start-3 sm:row-start-1">{t("orders.confirmPayment")}</Button>
  </Form>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <ErrorState title={missing ? t("orders.missing") : t("orders.loadError")} description={missing ? t("orders.missingHint") : t("common.retry")} action={<Button asChild variant="outline"><a href="../">{t("orders.view")}</a></Button>} />;
}
