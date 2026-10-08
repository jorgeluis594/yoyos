import type { RatedSetDeliveryInput } from "@core/src/features/orders/application/set-delivery";
import { PaymentFields, type PaymentDraft } from "@core/src/features/orders/presentation/payment-fields";
import { RatedDeliveryForm, type RatedDeliveryReview } from "@core/src/features/orders/presentation/rated-delivery-form";
import { add as addMoney, multiply, subtract, isCurrency, type Money, type MoneyError } from "@shared/money";
import { andThen, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { deliverySettingsSchema } from "@shared/contracts/delivery-settings";
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
import type { ContactId, OrderId, PaymentId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { ErrorState } from "@core/app/components/ui/error-state";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const params = new URL(request.url).searchParams;
  const access = context.get(privateUserContext);
  const [products, contacts, settings] = await Promise.all([
    orders.searchProducts((params.get("search") ?? "").trim()),
    orders.searchContacts((params.get("customerSearch") ?? "").trim()),
    deliverySettings.get({ companyId: access.company.id, userId: access.user.id }),
  ]);
  if (!products.success || !contacts.success) throw new Response("No se pudo cargar el catálogo.", { status: 503 });
  const company = context.get(privateUserContext).company;
  return { ...newOrderLoaderSchema.parse({ products: products.data, contacts: contacts.data, base: companyPath(new URL(request.url).pathname, company.country, "/orders") }), settings: settings.success ? deliverySettingsSchema.parse(settings.data) : null };
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
    contactId: parsed.data.contactId as ContactId | null, items: [item(first), ...rest.map(item)],
    payments: parsed.data.payments?.map(payment => ({ ...payment, paymentId: payment.paymentId as PaymentId })),
    delivery,
    deliverImmediately: parsed.data.deliverImmediately },
  { companyId: access.company.id, userId: access.user.id });
  if (!result.success) return orderActionErrorSchema.parse({ code: result.error.code,
    ...(result.error.code === "TOTAL_CHANGED" ? { currentPrice: result.error.currentPrice } : {}), error: result.error.code === "INSUFFICIENT_STOCK" ? "No hay stock suficiente para uno de los productos." :
    result.error.code === "ORDER_ALREADY_EXISTS" ? "Esta venta ya se registró. Revisa el historial antes de intentar otra." :
    result.error.code === "CONTACT_NOT_FOUND" ? "El cliente ya no está disponible." :
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
  const contactSearch = useFetcher<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const products = productSearch.data?.products ?? initial.products;
  const contacts = contactSearch.data?.contacts ?? initial.contacts;
  const [payments, setPayments] = useState<(PaymentDraft & { paymentId: string })[]>([]);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryReview, setDeliveryReview] = useState<RatedDeliveryReview>({ request: null, price: null });
  const [deliverImmediately, setDeliverImmediately] = useState(false);
  const parsedDelivery = deliveryEnabled ? deliveryReview.request : null;
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderId, setOrderId] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactLabel, setContactLabel] = useState<string | null>(null);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [searchedProduct, setSearchedProduct] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const summaryRef = useRef<HTMLElement>(null);
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
    <header className="flex items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">{t("orders.new")}</h1><p className="text-sm text-muted-foreground">{t("orders.creationHint")}</p></div>
      <Button asChild variant="ghost" className="text-muted-foreground"><Link to={initial.base}>{t("orders.view")}</Link></Button>
    </header>
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="products-heading">
        <div><h2 id="products-heading" className="text-lg font-semibold">{t("orders.addProducts")}</h2><p className="text-sm text-muted-foreground">{t("orders.addDescription")}</p></div>
        <productSearch.Form method="get" className="flex gap-2" onSubmit={() => setSearchedProduct(true)}>
          <label className="min-w-0 flex-1"><span className="sr-only">{t("orders.searchProducts")}</span><Input name="search" type="search" placeholder={t("orders.productName")} value={productQuery} onChange={(event) => setProductQuery(event.target.value)} /></label>
          <Button type="submit" variant="outline"><Search aria-hidden="true" data-icon="inline-start" />{t("orders.search")}</Button>
        </productSearch.Form>
        <div aria-live="polite" className="rounded-md border bg-card">
          {variants.length > 0 ? <ul className="divide-y">{variants.map(({ product, variant }) => {
            const label = Object.values(variant.attributes).join(" · ") || variant.sku || t("orders.uniqueVariant");
            const inCart = cart.find((item) => item.variantId === variant.id);
            return <li key={variant.id} className="flex min-h-18 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><p className="font-medium leading-5">{product.name}</p><p className="mt-1 text-sm text-muted-foreground">{label} · {t("orders.stock")}: {variant.stock}</p></div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end"><span className="text-sm font-semibold tabular-nums">{formatCurrency(variant.price, product.currency, i18n.language)}</span><Button type="button" size="sm" variant="outline" aria-label={t("orders.addNamed", { name: product.name })} onClick={() => add({ variantId: variant.id, productName: product.name, label, price: variant.price, currency: product.currency, quantity: 1, stock: variant.stock })}><Plus aria-hidden="true" />{t("orders.add")}{inCart ? ` (${inCart.quantity})` : ""}</Button></div>
            </li>;
          })}</ul> : <div className="flex flex-col gap-2 p-5"><p className="font-medium">{searchedProduct && productQuery ? t("orders.noProduct") : t("orders.noProducts")}</p><p className="text-sm text-muted-foreground">{searchedProduct && productQuery ? t("orders.tryAnother") : t("orders.createFirst")}</p></div>}
        </div>
        <p className="text-sm text-muted-foreground">{t("orders.missingCatalog")}<Link to={initial.base.replace(/\/orders$/, "/products") + "/new"} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-4">{t("orders.createOtherTab")}</Link></p>
      </section>
      <section ref={summaryRef} id="resumen" className="flex min-w-0 scroll-mt-4 flex-col gap-5 rounded-md border bg-card p-4 lg:p-5" aria-labelledby="summary-heading">
        <div className="flex items-center justify-between gap-3"><div><h2 id="summary-heading" className="text-lg font-semibold">{t("orders.current")}</h2><p className="text-sm text-muted-foreground">{t(cart.length === 1 ? "orders.itemCount_one" : "orders.itemCount_other", { count: cart.length })}</p></div><ShoppingBag aria-hidden="true" className="size-5 text-muted-foreground" /></div>
        {cart.length === 0 ? <div className="border-y py-6 text-center"><p className="font-medium">{t("orders.empty")}</p><p className="mt-1 text-sm text-muted-foreground">{t("orders.emptyHint")}</p></div> : <ul className="divide-y border-y">{cart.map((item) => <li key={item.variantId} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-stretch">
          <div className="min-w-0"><p className="font-medium">{item.productName}</p>{item.quantity > item.stock && <p role="status" className="text-sm text-muted-foreground">{t("orders.stockWarning", { stock: item.stock })}</p>}<p className="text-sm text-muted-foreground">{item.label} · {item.price.toFixed(2)} {item.currency}</p></div>
          <div className="flex items-center justify-between gap-2 sm:justify-end lg:justify-between"><label className="flex items-center gap-2 text-sm">{t("orders.quantity")}<Input type="number" min="1" step="1" value={item.quantity} className="w-20 text-center tabular-nums" onChange={(event) => { const quantity = Number(event.target.value); setCart((current) => current.map((row) => row.variantId === item.variantId ? { ...row, quantity } : row)); }} /></label><Button type="button" variant="ghost" onClick={() => setCart((current) => current.filter((row) => row.variantId !== item.variantId))}>{t("orders.remove")}</Button></div>
        </li>)}</ul>}
        <p className="flex items-center justify-between gap-3"><span className="font-medium">{t("orders.shownTotal")}:</span><strong className="text-xl font-semibold tabular-nums">{currency && total !== null ? formatCurrency(total, currency, i18n.language) : "—"}</strong></p>
        {currencies.size > 1 && <p role="alert" className="text-sm text-destructive">{t("orders.currencyMismatch")}</p>}
        <div className="border-t pt-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">{t("orders.customer")}</p><p className="text-sm text-muted-foreground">{contactLabel ?? t("orders.generalPublic")}</p></div><Button type="button" variant="ghost" onClick={() => setEditingCustomer((open) => !open)} aria-expanded={editingCustomer} aria-controls="order-customer-search">{editingCustomer ? t("orders.close") : t("orders.change")}</Button></div>
          {editingCustomer && <div id="order-customer-search" className="mt-4 flex flex-col gap-3"><contactSearch.Form method="get" className="flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">{t("orders.searchCustomer")}</span><Input name="customerSearch" type="search" placeholder={t("orders.nameOrPhone")} /></label><Button type="submit" variant="outline">{t("orders.search")}</Button></contactSearch.Form><Button type="button" variant={contactId === null ? "secondary" : "ghost"} className="self-start" onClick={() => { setContactId(null); setContactLabel(null); setEditingCustomer(false); }}>{t("orders.generalPublic")}</Button><ul className="divide-y">{contacts.map((contact) => <li key={contact.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 break-words text-sm">{contact.name ? `${contact.name} · ${contact.phone}` : contact.phone}</span><Button type="button" size="sm" variant={contactId === contact.id ? "secondary" : "outline"} onClick={() => { setContactId(contact.id); setContactLabel(contact.name ? `${contact.name} · ${contact.phone}` : contact.phone); setEditingCustomer(false); }}>{t("orders.select")}</Button></li>)}</ul></div>}
        </div>
      </section>
        <Form method="post" className="grid items-start gap-6 lg:col-span-2 lg:grid-cols-2">
          <input type="hidden" name="order" value={JSON.stringify({ id: orderId, contactId,
            items: cart.map(({ variantId, quantity }) => ({ variantId, quantity })),
            payments: payments.map(payment => ({ ...payment, amount: { amount: Number(payment.amount), currency } })),
            delivery: parsedDelivery ?? undefined, deliverImmediately })} />
          <section className="flex flex-col gap-3 rounded-md border bg-card p-4" aria-labelledby="new-payments-title">
            <h2 id="new-payments-title" className="text-lg font-semibold">{t("orders.payments")}</h2>
            {payments.length === 0 && <p className="text-sm text-muted-foreground">{t("orders.noInitialPayments")}</p>}
            {payments.map((payment, index) => <fieldset key={payment.paymentId} disabled={navigation.state === "submitting"} className="grid min-w-0 gap-3 border-b pb-4 sm:grid-cols-2">
              <legend className="mb-3 text-sm font-medium">{t("orders.initialPayment", { number: index + 1 })}</legend>
              <PaymentFields value={payment} onChange={value => setPayments(current => current.map(row => row.paymentId === payment.paymentId ? { ...value, paymentId: row.paymentId } : row))} />
              <Button type="button" variant="ghost" className="justify-self-start" onClick={() => setPayments(current => current.filter(row => row.paymentId !== payment.paymentId))}>{t("orders.remove")}</Button>
            </fieldset>)}
            <Button type="button" variant="outline" className="self-start" onClick={() => setPayments(current => [...current, { paymentId: crypto.randomUUID(), amount: "", method: "digital_wallet", deductStockIfPartial: false }])}>{t("orders.addPayment")}</Button>
          </section>
          <section className="flex flex-col gap-3 rounded-md border bg-card p-4" aria-labelledby="new-delivery-title">
            <h2 id="new-delivery-title" className="text-lg font-semibold">{t("orders.delivery")}</h2>
            {initial.settings && (initial.settings.store.enabled || initial.settings.home.enabled || initial.settings.agency.enabled || deliveryEnabled)
              ? <><label className="flex min-h-touch items-center gap-3"><input type="checkbox" checked={deliveryEnabled} onChange={event => setDeliveryEnabled(event.target.checked)} />{t("orders.configureInitialDelivery")}</label>
                <div hidden={!deliveryEnabled}><RatedDeliveryForm order={{ id: orderId, delivery: null, buyer: null,
                  itemsTotal: productTotal?.success ? productTotal.data : { amount: 0, currency: "PEN" }, total: productTotal?.success ? productTotal.data : { amount: 0, currency: "PEN" } }}
                  settings={initial.settings} active={deliveryEnabled} pending={navigation.state !== "idle"} onChange={setDeliveryReview}
                  recovery={actionData && ["TOTAL_CHANGED", "RATE_UNAVAILABLE", "DELIVERY_METHOD_DISABLED", "COURIER_UNAVAILABLE", "INVALID_DISTRICT"].includes(actionData.code) ? actionData : undefined} /></div></>
              : <div className="flex flex-col gap-2 text-sm"><p className="text-muted-foreground">{t(initial.settings ? "orderDelivery.disabled" : "deliverySettings.loadError")}</p><Link className="text-primary underline underline-offset-4" to={initial.base.replace(/\/orders$/, "/settings/delivery")}>{t("orderDelivery.configure")}</Link></div>}
            <label className="flex min-h-touch items-center gap-3"><input type="checkbox" checked={deliverImmediately} onChange={event => setDeliverImmediately(event.target.checked)} />{t("orders.deliverImmediately")}</label>
            <p className="text-sm text-muted-foreground">{t("orders.immediateRequirements")}</p>
          </section>
          <section className="flex flex-col gap-3 rounded-md border bg-card p-4 lg:col-span-2" aria-labelledby="new-summary-title">
            <h2 id="new-summary-title" className="text-lg font-semibold">{t("orders.creationSummary")}</h2>
            <p className="text-sm">{t("orders.initialPaid")}: {currency && paidAmount !== null ? formatCurrency(paidAmount, currency, i18n.language) : "—"}</p>
            <p className="text-sm">{t("orders.estimatedBalance")}: {balance?.success ? formatCurrency(Math.max(0, balance.data.amount), balance.data.currency, i18n.language) : "—"}</p>
            {deliveryEnabled && deliveryReview.price && <p className="text-sm">{t("orderDelivery.cost", { amount: formatCurrency(deliveryReview.price.amount, deliveryReview.price.currency, i18n.language) })}</p>}
            <p className="text-sm text-muted-foreground">{t("orders.finalPriceHint")}</p>
            <Button type="submit" className="w-full" disabled={!canComplete || (deliveryEnabled && !parsedDelivery) || navigation.state === "submitting"}>{t(navigation.state === "submitting" ? "orders.savingOrder" : "orders.saveOrder")}<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button>
          </section>
        </Form>
        {actionData?.error && <p role="alert" className="text-sm text-destructive">{t(actionData.code === "INSUFFICIENT_STOCK" ? "orders.insufficientStock" : actionData.code === "ORDER_ALREADY_EXISTS" ? "orders.alreadyExists" : actionData.code === "CONTACT_NOT_FOUND" ? "orders.contactMissing" : actionData.code === "VARIANT_NOT_FOUND" ? "orders.variantMissing" : actionData.code === "CURRENCY_MISMATCH" ? "orders.currencyMismatch" : actionData.code === "PAYMENT_REQUIRED" ? "orders.immediateRequirements" : actionData.code === "TOTAL_CHANGED" ? "orderDelivery.priceChanged" : actionData.code === "RATE_UNAVAILABLE" ? "orderDelivery.rateUnavailable" : actionData.code === "DELIVERY_UNAVAILABLE" ? "orderDelivery.unavailable" : actionData.code === "DELIVERY_METHOD_DISABLED" ? "orderDelivery.disabled" : actionData.code === "COURIER_UNAVAILABLE" ? "orderDelivery.courierUnavailable" : actionData.code === "PERSISTENCE_UNAVAILABLE" ? "orders.saveError" : "orders.invalidOrder")}</p>}
    </div>
    {cart.length > 0 && !summaryVisible && <div className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"><div><p className="text-xs text-muted-foreground">{t("orders.shownTotal")}</p><p className="font-semibold tabular-nums">{currency && total !== null ? formatCurrency(total, currency, i18n.language) : "—"}</p></div><Button asChild variant="outline"><a href="#resumen">{t("orders.review")} <ArrowRight aria-hidden="true" data-icon="inline-end" /></a></Button></div>}
  </section>;
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return <ErrorState title={t("orders.pointOfSaleError")} description={t("common.retry")} action={<Button asChild variant="outline"><a href="">{t("products.retry")}</a></Button>} />;
}
