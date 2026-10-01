import { useEffect, useRef, useState } from "react";
import { ArrowRight, Plus, Search, ShoppingBag } from "lucide-react";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { createOrderSchema, newOrderLoaderSchema, orderActionErrorSchema } from "@shared/contracts/orders";
import { privateUserContext } from "@core/app/private-user-context";
import { orders } from "@core/src/features/orders/composition";
import type { ContactId, OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { ErrorState } from "@core/app/components/ui/error-state";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const params = new URL(request.url).searchParams;
  const [products, contacts] = await Promise.all([
    orders.searchProducts((params.get("search") ?? "").trim()),
    orders.searchContacts((params.get("customerSearch") ?? "").trim()),
  ]);
  if (!products.success || !contacts.success) throw new Response("No se pudo cargar el catálogo.", { status: 503 });
  const company = context.get(privateUserContext).company;
  return newOrderLoaderSchema.parse({ products: products.data, contacts: contacts.data, base: `/es-${company.country}/orders` });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const access = context.get(privateUserContext);
  let raw: unknown;
  try { raw = JSON.parse(String((await request.formData()).get("order"))); }
  catch { return orderActionErrorSchema.parse({ code: "INVALID_ORDER", error: "Revisa los datos de la venta." }); }
  const parsed = createOrderSchema.safeParse(raw);
  if (!parsed.success) return orderActionErrorSchema.parse({ code: "INVALID_ORDER", error: "Revisa los datos de la venta." });
  const [first, ...rest] = parsed.data.items;
  if (!first) return orderActionErrorSchema.parse({ code: "INVALID_ORDER", error: "Revisa los datos de la venta." });
  const item = (selection: typeof first) => ({ variantId: selection.variantId as VariantId, quantity: selection.quantity as PositiveInteger });
  const result = await orders.registerImmediateSale({ id: parsed.data.id as OrderId,
    contactId: parsed.data.contactId as ContactId | null, items: [item(first), ...rest.map(item)] },
  { companyId: access.company.id, userId: access.user.id });
  if (!result.success) return orderActionErrorSchema.parse({ code: result.error.code, error: result.error.code === "INSUFFICIENT_STOCK" ? "No hay stock suficiente para uno de los productos." :
    result.error.code === "ORDER_ALREADY_EXISTS" ? "Esta venta ya se registró. Revisa el historial antes de intentar otra." :
    result.error.code === "CONTACT_NOT_FOUND" ? "El cliente ya no está disponible." :
    result.error.code === "VARIANT_NOT_FOUND" ? "Uno de los productos ya no está disponible." :
    result.error.code === "CURRENCY_MISMATCH" ? "Los productos deben tener la misma moneda." :
    result.error.code === "PERSISTENCE_UNAVAILABLE" ? "No se pudo completar la venta. Inténtalo de nuevo." : "Revisa los datos de la venta." });
  return Response.redirect(new URL(`/es-${access.company.country}/orders/${result.data.id}`, request.url));
}

type CartItem = { variantId: string; productName: string; label: string; price: number; currency: string; quantity: number };

export default function OrderNew() {
  const initial = useLoaderData<typeof loader>();
  const productSearch = useFetcher<typeof loader>();
  const contactSearch = useFetcher<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const products = productSearch.data?.products ?? initial.products;
  const contacts = contactSearch.data?.contacts ?? initial.contacts;
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderId, setOrderId] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactLabel, setContactLabel] = useState("Público general");
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [searchedProduct, setSearchedProduct] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const summaryRef = useRef<HTMLElement>(null);
  const currencies = new Set(cart.map((item) => item.currency));
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const currency = currencies.size === 1 ? [...currencies][0] : "";
  const canComplete = cart.length > 0 && currencies.size <= 1 && cart.every((item) => Number.isSafeInteger(item.quantity) && item.quantity > 0);
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
      <div><h1 className="text-2xl font-semibold">Nueva venta</h1><p className="text-sm text-muted-foreground">Cobro y entrega en el momento</p></div>
      <Button asChild variant="ghost" className="text-muted-foreground"><Link to={initial.base}>Ver ventas</Link></Button>
    </header>
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="products-heading">
        <div><h2 id="products-heading" className="text-lg font-semibold">Agrega productos</h2><p className="text-sm text-muted-foreground">Busca un producto y añádelo a la venta.</p></div>
        <productSearch.Form method="get" className="flex gap-2" onSubmit={() => setSearchedProduct(true)}>
          <label className="min-w-0 flex-1"><span className="sr-only">Buscar productos por nombre</span><Input name="search" type="search" placeholder="Nombre del producto" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} /></label>
          <Button type="submit" variant="outline"><Search aria-hidden="true" data-icon="inline-start" />Buscar</Button>
        </productSearch.Form>
        <div aria-live="polite" className="rounded-md border bg-card">
          {variants.length > 0 ? <ul className="divide-y">{variants.map(({ product, variant }) => {
            const label = Object.values(variant.attributes).join(" · ") || variant.sku || "Variante única";
            const inCart = cart.find((item) => item.variantId === variant.id);
            return <li key={variant.id} className="flex min-h-18 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><p className="font-medium leading-5">{product.name}</p><p className="mt-1 text-sm text-muted-foreground">{label} · Stock: {variant.stock}</p></div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end"><span className="text-sm font-semibold tabular-nums">{variant.price.toFixed(2)} <span className="text-xs font-medium text-muted-foreground">{product.currency}</span></span><Button type="button" size="sm" variant="outline" aria-label={`Agregar ${product.name}`} onClick={() => add({ variantId: variant.id, productName: product.name, label, price: variant.price, currency: product.currency, quantity: 1 })}><Plus aria-hidden="true" />Agregar{inCart ? ` (${inCart.quantity})` : ""}</Button></div>
            </li>;
          })}</ul> : <div className="flex flex-col gap-2 p-5"><p className="font-medium">{searchedProduct && productQuery ? "No encontramos ese producto" : "Todavía no hay productos"}</p><p className="text-sm text-muted-foreground">{searchedProduct && productQuery ? "Prueba con otro nombre o crea el producto para venderlo." : "Crea el primero para comenzar a vender."}</p></div>}
        </div>
        <p className="text-sm text-muted-foreground">¿No está en el catálogo? <Link to={initial.base.replace(/\/orders$/, "/products") + "/new"} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-4">Crear producto en otra pestaña</Link></p>
      </section>
      <section ref={summaryRef} id="resumen" className="flex min-w-0 scroll-mt-4 flex-col gap-5 rounded-md border bg-card p-4 lg:sticky lg:top-6 lg:p-5" aria-labelledby="summary-heading">
        <div className="flex items-center justify-between gap-3"><div><h2 id="summary-heading" className="text-lg font-semibold">Venta actual</h2><p className="text-sm text-muted-foreground">{cart.length} {cart.length === 1 ? "producto" : "productos"}</p></div><ShoppingBag aria-hidden="true" className="size-5 text-muted-foreground" /></div>
        {cart.length === 0 ? <div className="border-y py-6 text-center"><p className="font-medium">Tu venta está vacía</p><p className="mt-1 text-sm text-muted-foreground">Agrega productos para comenzar.</p></div> : <ul className="divide-y border-y">{cart.map((item) => <li key={item.variantId} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-stretch">
          <div className="min-w-0"><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{item.label} · {item.price.toFixed(2)} {item.currency}</p></div>
          <div className="flex items-center justify-between gap-2 sm:justify-end lg:justify-between"><label className="flex items-center gap-2 text-sm">Cantidad<Input type="number" min="1" step="1" value={item.quantity} className="w-20 text-center tabular-nums" onChange={(event) => { const quantity = Number(event.target.value); setCart((current) => current.map((row) => row.variantId === item.variantId ? { ...row, quantity } : row)); }} /></label><Button type="button" variant="ghost" onClick={() => setCart((current) => current.filter((row) => row.variantId !== item.variantId))}>Quitar</Button></div>
        </li>)}</ul>}
        <p className="flex items-center justify-between gap-3"><span className="font-medium">Total mostrado:</span><strong className="text-xl font-semibold tabular-nums">{total.toFixed(2)} {currency}</strong></p>
        {currencies.size > 1 && <p role="alert" className="text-sm text-destructive">Los productos deben tener la misma moneda.</p>}
        <div className="border-t pt-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Cliente</p><p className="text-sm text-muted-foreground">{contactLabel}</p></div><Button type="button" variant="ghost" onClick={() => setEditingCustomer((open) => !open)} aria-expanded={editingCustomer} aria-controls="order-customer-search">{editingCustomer ? "Cerrar" : "Cambiar"}</Button></div>
          {editingCustomer && <div id="order-customer-search" className="mt-4 flex flex-col gap-3"><contactSearch.Form method="get" className="flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Buscar cliente por nombre o teléfono</span><Input name="customerSearch" type="search" placeholder="Nombre o teléfono" /></label><Button type="submit" variant="outline">Buscar</Button></contactSearch.Form><Button type="button" variant={contactId === null ? "secondary" : "ghost"} className="self-start" onClick={() => { setContactId(null); setContactLabel("Público general"); setEditingCustomer(false); }}>Público general</Button><ul className="divide-y">{contacts.map((contact) => <li key={contact.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 break-words text-sm">{contact.name ? `${contact.name} · ${contact.phone}` : contact.phone}</span><Button type="button" size="sm" variant={contactId === contact.id ? "secondary" : "outline"} onClick={() => { setContactId(contact.id); setContactLabel(contact.name ? `${contact.name} · ${contact.phone}` : contact.phone); setEditingCustomer(false); }}>Seleccionar</Button></li>)}</ul></div>}
        </div>
        <Form method="post" className="flex flex-col gap-3 border-t pt-4"><input type="hidden" name="order" value={JSON.stringify({ id: orderId, contactId, items: cart.map(({ variantId, quantity }) => ({ variantId, quantity })) })} /><p className="text-sm text-muted-foreground">El precio final se calcula al completar la venta. Confirma que recibiste el total por billetera digital y entregaste los productos.</p><Button type="submit" className="w-full" disabled={!canComplete || navigation.state === "submitting"}>{navigation.state === "submitting" ? "Completando…" : "Confirmar cobro y completar venta"}<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button></Form>
        {actionData?.error && <p role="alert" className="text-sm text-destructive">{actionData.error}</p>}
      </section>
    </div>
    {cart.length > 0 && !summaryVisible && <div className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"><div><p className="text-xs text-muted-foreground">Total mostrado</p><p className="font-semibold tabular-nums">{total.toFixed(2)} {currency}</p></div><Button asChild variant="outline"><a href="#resumen">Revisar venta <ArrowRight aria-hidden="true" data-icon="inline-end" /></a></Button></div>}
  </section>;
}

export function ErrorBoundary() {
  return <ErrorState title="No se pudo cargar el punto de venta" description="Inténtalo de nuevo." action={<Button asChild variant="outline"><a href="">Reintentar</a></Button>} />;
}
