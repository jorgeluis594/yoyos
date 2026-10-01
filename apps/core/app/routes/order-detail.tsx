import { useTranslation } from "react-i18next";
import { companyPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { isRouteErrorResponse, Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { privateUserContext } from "@core/app/private-user-context";
import { orders } from "@core/src/features/orders/composition";
import { toOrderJson } from "@core/src/features/orders/presentation/order-json";
import { orderDetailLoaderSchema } from "@shared/contracts/orders";
import { Button } from "@core/app/components/ui/button";
import { ErrorState } from "@core/app/components/ui/error-state";

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const result = await orders.get(params.orderId ?? "");
  if (!result.success) throw new Response(result.error.message, { status: result.error.code === "ORDER_NOT_FOUND" ? 404 : result.error.code === "INVALID_ORDER" ? 400 : 503 });
  const company = context.get(privateUserContext).company;
  return orderDetailLoaderSchema.parse({ order: toOrderJson(result.data), base: companyPath(new URL(request.url).pathname, company.country, "/orders") });
}

export default function OrderDetail() {
  const { t, i18n } = useTranslation();
  const { order, base } = useLoaderData<typeof loader>();
  return <section className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{t("orders.completed")}</h1><p className="text-muted-foreground">{new Date(order.completedAt).toLocaleString(i18n.language === "pt" ? "pt-BR" : "es-PE", { timeZone: "America/Lima" })}</p></div><Button asChild variant="outline"><Link to={base}>{t("orders.view")}</Link></Button></header>
    <dl className="grid gap-3 rounded-md border p-5 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">{t("orders.customer")}</dt><dd>{order.customer.kind === "contact" ? order.customer.name ?? order.customer.phone : t("orders.generalPublic")}</dd></div><div><dt className="text-sm text-muted-foreground">{t("orders.payment")}</dt><dd>{t("orders.paymentConfirmed")}</dd></div>{order.customer.kind === "contact" && <div><dt className="text-sm text-muted-foreground">{t("orders.phoneAtSale")}</dt><dd>{order.customer.phone}</dd></div>}<div><dt className="text-sm text-muted-foreground">{t("orders.seller")}</dt><dd>{order.sellerId}</dd></div></dl>
    <ul className="divide-y rounded-md border">{order.items.map((item) => <li key={item.id} className="flex justify-between gap-3 p-4"><div><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{Object.values(item.variantAttributes).join(" · ") || item.sku || t("orders.uniqueVariant")} · {item.quantity} × {formatCurrency(item.unitPrice, order.currency, i18n.language)}</p></div><strong>{formatCurrency(item.subtotal, order.currency, i18n.language)}</strong></li>)}</ul>
    <p className="text-right text-xl font-semibold">{t("orders.total")}: {formatCurrency(order.total, order.currency, i18n.language)}</p>
  </section>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <ErrorState title={missing ? t("orders.missing") : t("orders.loadError")} description={missing ? t("orders.missingHint") : t("common.retry")} action={<Button asChild variant="outline"><a href="../">{t("orders.view")}</a></Button>} />;
}
