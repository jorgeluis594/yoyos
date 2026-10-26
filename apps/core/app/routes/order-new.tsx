import type { RatedSetDeliveryInput } from "@core/src/features/orders/application/set-delivery";
import { PaymentFields, type PaymentDraft } from "@core/src/features/orders/presentation/payment-fields";
import { RatedDeliveryForm, type RatedDeliveryReview } from "@core/src/features/orders/presentation/rated-delivery-form";
import { add as addMoney, multiply, subtract, isCurrency, type Money, type MoneyError } from "@shared/money";
import { andThen, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { deliverySettings, toDeliverySettingsResponse } from "@core/src/features/delivery-settings";
import { parseRatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { useTranslation } from "react-i18next";
import { companyPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Plus, Search, ShoppingBag } from "lucide-react";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { completeOrderSchema, newOrderLoaderSchema, orderActionErrorSchema } from "@shared/contracts/orders";
import { privateUserContext } from "@core/app/private-user-context";
import { orders, createConfiguredOrder } from "@core/src/features/orders/composition";
import type { OrderId, PaymentId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { ErrorState } from "@core/app/components/ui/error-state";
import { PageHeader } from "@core/app/components/ui/page-header";
import { Card, CardContent, CardTitle } from "@core/app/components/ui/card";
import { Field, FieldLabel, FieldDescription } from "@core/app/components/ui/field";
import { Checkbox } from "@core/app/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@core/app/components/ui/empty";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { TextLink } from "@core/app/components/ui/text-link";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const params = new URL(request.url).searchParams;
  const access = context.get(privateUserContext);
  const [products, settings] = await Promise.all([
    orders.searchProducts((params.get("search") ?? "").trim()),
    deliverySettings.get({ companyId: access.company.id, userId: access.user.id }),
  ]);
  if (!products.success) throw new Response("No se pudo cargar el catálogo.", { status: 503 });
  const company = context.get(privateUserContext).company;
  return { ...newOrderLoaderSchema.parse({ products: products.data, base: companyPath(new URL(request.url).pathname, company.country, "/orders") }), settings: settings.success ? toDeliverySettingsResponse(settings.data) : null };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const access = context.get(privateUserContext);
  let raw: unknown;
  try { raw = JSON.parse(String((await request.formData()).get("order"))); }
  catch { return orderActionErrorSchema.parse({ code: "INVALID_ORDER", error: "Revisa los datos de la venta." }); }
  const parsed = completeOrderSchema.safeParse(raw);
  if (!parsed.success) return orderActionErrorSchema.parse({ code: "INVALID_ORDER", error: "Revisa los datos de la venta." });
  const [first, ...rest] = parsed.data.items;
  if (!first) return orderActionErrorSchema.parse({ code: "INVALID_ORDER", error: "Revisa los datos de la venta." });
  const item = (selection: typeof first) => ({ variantId: selection.variantId as VariantId, quantity: selection.quantity as PositiveInteger });
  let delivery: Omit<RatedSetDeliveryInput, "orderId"> | undefined;
  if (parsed.data.delivery) {
    const input = parsed.data.delivery;
    const selected = parseRatedDeliverySelection(input.delivery);
    if (!selected.success) return orderActionErrorSchema.parse({ code: "INVALID_ORDER", error: "Revisa la entrega." });
    delivery = { delivery: selected.data, expectedPrice: input.expectedPrice };
  }
  const result = await createConfiguredOrder({ id: parsed.data.id as OrderId,
    items: [item(first), ...rest.map(item)],
    payments: parsed.data.payments?.map(payment => ({ ...payment, paymentId: payment.paymentId as PaymentId })),
    delivery,
    deliverImmediately: parsed.data.deliverImmediately },
  { companyId: access.company.id, userId: access.user.id });
  if (!result.success) return orderActionErrorSchema.parse({ code: result.error.code,
    ...(result.error.code === "TOTAL_CHANGED" ? { currentPrice: result.error.currentPrice } : {}),
    ...(result.error.code === "VARIANT_NOT_FOUND" && "variantId" in result.error ? { variantId: result.error.variantId } : {}), error: result.error.code === "INSUFFICIENT_STOCK" ? "No hay stock suficiente para uno de los productos." :
    result.error.code === "ORDER_ALREADY_EXISTS" ? "Esta venta ya se registró. Revisa el historial antes de intentar otra." :
    result.error.code === "VARIANT_NOT_FOUND" ? "Uno de los productos ya no está disponible." :
    result.error.code === "CURRENCY_MISMATCH" ? "Los productos deben tener la misma moneda." :
    result.error.code === "PERSISTENCE_UNAVAILABLE" ? "No se pudo completar la venta. Inténtalo de nuevo." : "Revisa los datos de la venta." });
  return Response.redirect(new URL(companyPath(new URL(request.url).pathname, access.company.country, `/orders/${result.data.id}`), request.url));
}

type CartItem = { variantId: string; productName: string; label: string; price: number; currency: string; quantity: number; stock: number };

export default function OrderNew() {
  const { t, i18n } = useTranslation();
  const initial = useLoaderData<typeof loader>();
  const productSearch = useFetcher<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const products = productSearch.data?.products ?? initial.products;
  const [payments, setPayments] = useState<(PaymentDraft & { paymentId: string })[]>([]);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryReview, setDeliveryReview] = useState<RatedDeliveryReview>({ request: null, price: null });
  const [deliverImmediately, setDeliverImmediately] = useState(false);
  const parsedDelivery = deliveryEnabled ? deliveryReview.request : null;
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderId, setOrderId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [searchedProduct, setSearchedProduct] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const currencies = new Set(cart.map((item) => item.currency));
  const currency = currencies.size === 1 ? [...currencies][0] : "";
  const productTotal = isCurrency(currency) ? cart.reduce<Result<Money, MoneyError>>((sum, item) =>
    andThen(sum, current => andThen(multiply({ amount: item.price, currency })(item.quantity), price => addMoney(price)(current))), ok({ amount: 0, currency })) : null;
  const reviewedTotal = productTotal && deliveryEnabled ? deliveryReview.price ? andThen(productTotal, addMoney(deliveryReview.price)) : null : productTotal;
  const total = reviewedTotal?.success ? reviewedTotal.data.amount : null;
  const paidTotal = isCurrency(currency) ? payments.reduce<Result<Money, MoneyError>>((sum, payment) =>
    andThen(sum, addMoney({ amount: Number(payment.amount) || 0, currency })), ok({ amount: 0, currency })) : null;
  const paidAmount = paidTotal?.success ? paidTotal.data.amount : null;
  const balance = reviewedTotal?.success && paidTotal?.success ? subtract(paidTotal.data)(reviewedTotal.data) : null;
  const canComplete = reviewedTotal?.success && cart.length > 0 && currencies.size <= 1 && cart.every((item) => Number.isSafeInteger(item.quantity) && item.quantity > 0);
  const variants = products.flatMap((product) => product.variants.map((variant) => ({ product, variant })));

  useEffect(() => {
    const summary = summaryRef.current;
    if (!summary) return;
    const observer = new IntersectionObserver(([entry]) => setSummaryVisible(entry.isIntersecting));
    observer.observe(summary);
    return () => observer.disconnect();
  }, []);

  function add(item: CartItem) {
    if (!orderId) setOrderId(crypto.randomUUID());
    setCart((current) => current.some((row) => row.variantId === item.variantId)
      ? current.map((row) => row.variantId === item.variantId ? { ...row, quantity: row.quantity + 1 } : row)
      : [...current, item]);
  }

  return <section className="flex flex-col gap-6 pb-24 lg:pb-0">
    <PageHeader>
      <PageHeader.Heading><PageHeader.Title>{t("orders.new")}</PageHeader.Title><PageHeader.Description>{t("orders.creationHint")}</PageHeader.Description></PageHeader.Heading>
      <PageHeader.Actions><Button asChild variant="ghost" className="text-muted-foreground"><Link to={initial.base}>{t("orders.view")}</Link></Button></PageHeader.Actions>
    </PageHeader>
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="products-heading">
        <div><h2 id="products-heading" className="text-lg font-semibold">{t("orders.addProducts")}</h2><p className="text-sm text-muted-foreground">{t("orders.addDescription")}</p></div>
        <productSearch.Form method="get" className="flex gap-2" onSubmit={() => setSearchedProduct(true)}>
          <Field className="min-w-0 flex-1"><FieldLabel htmlFor="order-product-search" className="sr-only">{t("orders.searchProducts")}</FieldLabel><Input id="order-product-search" name="search" type="search" placeholder={t("orders.productName")} value={productQuery} onChange={(event) => setProductQuery(event.target.value)} /></Field>
          <Button type="submit" variant="outline"><Search aria-hidden="true" data-icon="inline-start" />{t("orders.search")}</Button>
        </productSearch.Form>
        <Card aria-live="polite">
          {variants.length > 0 ? <ul className="divide-y">{variants.map(({ product, variant }) => {
            const label = Object.values(variant.attributes).join(" · ") || variant.sku || t("orders.uniqueVariant");
            const inCart = cart.find((item) => item.variantId === variant.id);
            return <li key={variant.id} className="flex min-h-18 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><p className="font-medium leading-5">{product.name}</p><p className="mt-1 text-sm text-muted-foreground">{label} · {t("orders.stock")}: {variant.stock}</p></div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end"><span className="text-sm font-semibold tabular-nums">{formatCurrency(variant.price, product.currency, i18n.language)}</span><Button type="button" size="sm" variant="outline" aria-label={t("orders.addNamed", { name: product.name })} onClick={() => add({ variantId: variant.id, productName: product.name, label, price: variant.price, currency: product.currency, quantity: 1, stock: variant.stock })}><Plus aria-hidden="true" />{t("orders.add")}{inCart ? ` (${inCart.quantity})` : ""}</Button></div>
            </li>;
          })}</ul> : <Empty><EmptyHeader><EmptyTitle>{searchedProduct && productQuery ? t("orders.noProduct") : t("orders.noProducts")}</EmptyTitle><EmptyDescription>{searchedProduct && productQuery ? t("orders.tryAnother") : t("orders.createFirst")}</EmptyDescription></EmptyHeader></Empty>}
        </Card>
        <p className="text-sm text-muted-foreground">{t("orders.missingCatalog")}<TextLink asChild><Link to={initial.base.replace(/\/orders$/, "/products") + "/new"} target="_blank" rel="noopener noreferrer">{t("orders.createOtherTab")}</Link></TextLink></p>
      </section>
      <Card ref={summaryRef} id="resumen" role="region" className="min-w-0 scroll-mt-4" aria-labelledby="summary-heading"><CardContent className="flex flex-col gap-5 p-4 lg:p-5">
        <div className="flex items-center justify-between gap-3"><div><CardTitle id="summary-heading" className="text-lg font-semibold">{t("orders.current")}</CardTitle><p className="text-sm text-muted-foreground">{t(cart.length === 1 ? "orders.itemCount_one" : "orders.itemCount_other", { count: cart.length })}</p></div><ShoppingBag aria-hidden="true" className="size-5 text-muted-foreground" /></div>
        {cart.length === 0 ? <Empty className="border-y"><EmptyHeader><EmptyTitle>{t("orders.empty")}</EmptyTitle><EmptyDescription>{t("orders.emptyHint")}</EmptyDescription></EmptyHeader></Empty> : <ul className="divide-y border-y">{cart.map((item) => <li key={item.variantId} data-unavailable={actionData?.variantId === item.variantId || undefined} className="flex flex-col gap-3 py-4 data-[unavailable]:text-destructive sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-stretch">
          <div className="min-w-0"><p className="font-medium">{item.productName}</p>{actionData?.variantId === item.variantId && <p role="alert" className="text-sm font-medium">{t("orders.itemUnavailable", { item: item.label })}</p>}{item.quantity > item.stock && <p role="status" className="text-sm text-muted-foreground">{t("orders.stockWarning", { stock: item.stock })}</p>}<p className="text-sm text-muted-foreground">{item.label} · {item.price.toFixed(2)} {item.currency}</p></div>
          <div className="flex items-center justify-between gap-2 sm:justify-end lg:justify-between"><label className="flex items-center gap-2 text-sm">{t("orders.quantity")}<Input type="number" min="1" step="1" value={item.quantity} className="w-20 text-center tabular-nums" onChange={(event) => { const quantity = Number(event.target.value); setCart((current) => current.map((row) => row.variantId === item.variantId ? { ...row, quantity } : row)); }} /></label><Button type="button" variant="ghost" onClick={() => setCart((current) => current.filter((row) => row.variantId !== item.variantId))}>{t("orders.remove")}</Button></div>
        </li>)}</ul>}
        <p className="flex items-center justify-between gap-3"><span className="font-medium">{t("orders.shownTotal")}:</span><strong className="text-xl font-semibold tabular-nums">{currency && total !== null ? formatCurrency(total, currency, i18n.language) : "—"}</strong></p>
        {currencies.size > 1 && <Alert variant="destructive"><AlertDescription>{t("orders.currencyMismatch")}</AlertDescription></Alert>}
      </CardContent></Card>
        <Form method="post" className="grid items-start gap-6 lg:col-span-2 lg:grid-cols-2">
          <input type="hidden" name="order" value={JSON.stringify({ id: orderId,
            items: cart.map(({ variantId, quantity }) => ({ variantId, quantity })),
            payments: payments.map(payment => ({ ...payment, amount: { amount: Number(payment.amount), currency } })),
            delivery: parsedDelivery ?? undefined, deliverImmediately })} />
          <Card role="region" aria-labelledby="new-payments-title"><CardContent className="flex flex-col gap-3 p-4">
            <CardTitle id="new-payments-title" className="text-lg font-semibold">{t("orders.payments")}</CardTitle>
            {payments.length === 0 && <p className="text-sm text-muted-foreground">{t("orders.noInitialPayments")}</p>}
            {payments.map((payment, index) => <fieldset key={payment.paymentId} disabled={navigation.state === "submitting"} className="grid min-w-0 gap-3 border-b pb-4 sm:grid-cols-2">
              <legend className="mb-3 text-sm font-medium">{t("orders.initialPayment", { number: index + 1 })}</legend>
              <PaymentFields value={payment} onChange={value => setPayments(current => current.map(row => row.paymentId === payment.paymentId ? { ...value, paymentId: row.paymentId } : row))} />
              <Button type="button" variant="ghost" className="justify-self-start" onClick={() => setPayments(current => current.filter(row => row.paymentId !== payment.paymentId))}>{t("orders.remove")}</Button>
            </fieldset>)}
            <Button type="button" variant="outline" className="self-start" onClick={() => setPayments(current => [...current, { paymentId: crypto.randomUUID(), amount: "", method: "digital_wallet", deductStockIfPartial: false }])}>{t("orders.addPayment")}</Button>
          </CardContent></Card>
          <Card role="region" aria-labelledby="new-delivery-title"><CardContent className="flex flex-col gap-3 p-4">
            <CardTitle id="new-delivery-title" className="text-lg font-semibold">{t("orders.delivery")}</CardTitle>
            {initial.settings && (initial.settings.store.enabled || initial.settings.home.enabled || initial.settings.agency.enabled || deliveryEnabled)
              ? <><Field orientation="horizontal" className="min-h-touch items-center"><Checkbox id="order-delivery-enabled" checked={deliveryEnabled} onCheckedChange={checked => setDeliveryEnabled(checked === true)} /><FieldLabel htmlFor="order-delivery-enabled">{t("orders.configureInitialDelivery")}</FieldLabel></Field>
                <div hidden={!deliveryEnabled}><RatedDeliveryForm order={{ id: orderId, delivery: null, buyer: null,
                  itemsTotal: productTotal?.success ? productTotal.data : { amount: 0, currency: "PEN" }, total: productTotal?.success ? productTotal.data : { amount: 0, currency: "PEN" } }}
                  settings={initial.settings} active={deliveryEnabled} pending={navigation.state !== "idle"} onChange={setDeliveryReview}
                  recovery={actionData && ["TOTAL_CHANGED", "RATE_UNAVAILABLE", "DELIVERY_METHOD_DISABLED", "INVALID_DISTRICT"].includes(actionData.code) ? actionData : undefined} /></div></>
              : <div className="flex flex-col gap-2 text-sm"><p className="text-muted-foreground">{t(initial.settings ? "orderDelivery.disabled" : "deliverySettings.loadError")}</p><TextLink asChild><Link to={initial.base.replace(/\/orders$/, "/settings/delivery")}>{t("orderDelivery.configure")}</Link></TextLink></div>}
            <Field orientation="horizontal" className="min-h-touch items-center"><Checkbox id="order-deliver-immediately" checked={deliverImmediately} onCheckedChange={checked => setDeliverImmediately(checked === true)} /><FieldLabel htmlFor="order-deliver-immediately">{t("orders.deliverImmediately")}</FieldLabel></Field>
            <FieldDescription>{t("orders.immediateRequirements")}</FieldDescription>
          </CardContent></Card>
          <Card role="region" className="lg:col-span-2" aria-labelledby="new-summary-title"><CardContent className="flex flex-col gap-3 p-4">
            <CardTitle id="new-summary-title" className="text-lg font-semibold">{t("orders.creationSummary")}</CardTitle>
            <p className="text-sm">{t("orders.initialPaid")}: {currency && paidAmount !== null ? formatCurrency(paidAmount, currency, i18n.language) : "—"}</p>
            <p className="text-sm">{t("orders.estimatedBalance")}: {balance?.success ? formatCurrency(Math.max(0, balance.data.amount), balance.data.currency, i18n.language) : "—"}</p>
            {deliveryEnabled && deliveryReview.price && <p className="text-sm">{t("orderDelivery.cost", { amount: formatCurrency(deliveryReview.price.amount, deliveryReview.price.currency, i18n.language) })}</p>}
            <p className="text-sm text-muted-foreground">{t("orders.finalPriceHint")}</p>
            <Button type="submit" className="w-full" disabled={!canComplete || (deliveryEnabled && !parsedDelivery) || navigation.state === "submitting"}>{t(navigation.state === "submitting" ? "orders.savingOrder" : "orders.saveOrder")}<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button>
          </CardContent></Card>
        </Form>
        {actionData?.error && <Alert variant="destructive"><AlertDescription>{t(actionData.code === "INSUFFICIENT_STOCK" ? "orders.insufficientStock" : actionData.code === "ORDER_ALREADY_EXISTS" ? "orders.alreadyExists" : actionData.code === "VARIANT_NOT_FOUND" ? "orders.variantMissing" : actionData.code === "CURRENCY_MISMATCH" ? "orders.currencyMismatch" : actionData.code === "PAYMENT_REQUIRED" ? "orders.immediateRequirements" : actionData.code === "TOTAL_CHANGED" ? "orderDelivery.priceChanged" : actionData.code === "RATE_UNAVAILABLE" ? "orderDelivery.rateUnavailable" : actionData.code === "DELIVERY_UNAVAILABLE" ? "orderDelivery.unavailable" : actionData.code === "DELIVERY_METHOD_DISABLED" ? "orderDelivery.disabled" : actionData.code === "PERSISTENCE_UNAVAILABLE" ? "orders.saveError" : "orders.invalidOrder")}</AlertDescription></Alert>}
    </div>
    {cart.length > 0 && !summaryVisible && <Card className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-3 rounded-none border-x-0 border-b-0 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"><div><p className="text-xs text-muted-foreground">{t("orders.shownTotal")}</p><p className="font-semibold tabular-nums">{currency && total !== null ? formatCurrency(total, currency, i18n.language) : "—"}</p></div><Button asChild variant="outline"><a href="#resumen">{t("orders.review")} <ArrowRight aria-hidden="true" data-icon="inline-end" /></a></Button></Card>}
  </section>;
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return <ErrorState title={t("orders.pointOfSaleError")} description={t("common.retry")} action={<Button asChild variant="outline"><a href="">{t("products.retry")}</a></Button>} />;
}
