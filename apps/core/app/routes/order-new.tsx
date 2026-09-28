import { useState } from "react";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { createOrderSchema, newOrderLoaderSchema, orderActionErrorSchema } from "@shared/contracts/orders";
import { privateUserContext } from "@core/app/private-user-context";
import { orders } from "@core/src/features/orders/composition";
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
  const result = await orders.create(parsed.data, { companyId: access.company.id, sellerId: access.user.id });
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
  const search = useFetcher<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const catalog = search.data ?? initial;
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderId, setOrderId] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactLabel, setContactLabel] = useState("Público general");
  const currencies = new Set(cart.map((item) => item.currency));
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  function add(item: CartItem) {
    if (!orderId) setOrderId(crypto.randomUUID());
    setCart((current) => current.some((row) => row.variantId === item.variantId)
      ? current.map((row) => row.variantId === item.variantId ? { ...row, quantity: row.quantity + 1 } : row)
      : [...current, item]);
  }

  return <section className="space-y-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Nueva venta</h1><p className="text-muted-foreground">Cobro y entrega en el momento</p></div><Button asChild variant="outline"><Link to={initial.base}>Ver ventas</Link></Button></header>
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <search.Form method="get" className="flex gap-2"><label className="flex-1">Buscar productos por nombre<Input name="search" type="search" className="mt-1" /></label><Button type="submit" className="self-end">Buscar</Button></search.Form>
        <ul className="divide-y rounded-md border">{catalog.products.flatMap((product) => product.variants.map((variant) => {
          const label = Object.values(variant.attributes).join(" · ") || variant.sku || "Variante única";
          return <li key={variant.id} className="flex items-center justify-between gap-3 p-3"><div><p className="font-medium">{product.name}</p><p className="text-sm text-muted-foreground">{label} · {variant.price.toFixed(2)} {product.currency} · Stock: {variant.stock}</p></div><Button type="button" size="sm" variant="outline" onClick={() => add({ variantId: variant.id, productName: product.name, label, price: variant.price, currency: product.currency, quantity: 1 })}>Agregar</Button></li>;
        }))}</ul>
        <search.Form method="get" className="flex gap-2"><label className="flex-1">Buscar cliente por nombre o teléfono<Input name="customerSearch" type="search" className="mt-1" /></label><Button type="submit" className="self-end">Buscar</Button></search.Form>
        <div className="space-y-2"><Button type="button" variant={contactId === null ? "default" : "outline"} onClick={() => { setContactId(null); setContactLabel("Público general"); }}>Público general</Button>
          <ul className="divide-y rounded-md border">{catalog.contacts.map((contact) => <li key={contact.id} className="flex items-center justify-between gap-3 p-3"><span>{contact.name ? `${contact.name} · ${contact.phone}` : contact.phone}</span><Button type="button" size="sm" variant={contactId === contact.id ? "default" : "outline"} onClick={() => { setContactId(contact.id); setContactLabel(contact.name ? `${contact.name} · ${contact.phone}` : contact.phone); }}>Seleccionar</Button></li>)}</ul>
        </div>
      </div>
      <div className="space-y-4 rounded-md border p-5"><h2 className="text-xl font-semibold">Revisar venta</h2><p>Cliente: {contactLabel}</p>
        {cart.length === 0 ? <p className="text-muted-foreground">Agrega productos para comenzar.</p> : <ul className="space-y-3">{cart.map((item) => <li key={item.variantId} className="flex flex-wrap items-center gap-3 border-b pb-3"><div className="min-w-40 flex-1"><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{item.label} · {item.price.toFixed(2)} {item.currency}</p></div><label>Cantidad<Input type="number" min="1" step="1" value={item.quantity} className="w-24" onChange={(event) => { const quantity = Number(event.target.value); setCart((current) => current.map((row) => row.variantId === item.variantId ? { ...row, quantity } : row)); }} /></label><Button type="button" variant="ghost" onClick={() => setCart((current) => current.filter((row) => row.variantId !== item.variantId))}>Quitar</Button></li>)}</ul>}
        <p className="text-lg font-semibold">Total mostrado: {total.toFixed(2)} {currencies.size === 1 ? [...currencies][0] : ""}</p>{currencies.size > 1 && <p role="alert" className="text-destructive">Los productos deben tener la misma moneda.</p>}<p className="text-sm text-muted-foreground">El precio final se calcula al completar la venta.</p>
        <Form method="post" className="space-y-3"><input type="hidden" name="order" value={JSON.stringify({ id: orderId, contactId, items: cart.map(({ variantId, quantity }) => ({ variantId, quantity })) })} /><p>Confirma que recibiste el total por billetera digital y entregaste los productos.</p><Button type="submit" disabled={cart.length === 0 || currencies.size > 1 || cart.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity <= 0) || navigation.state === "submitting"}>{navigation.state === "submitting" ? "Completando…" : "Confirmar cobro y completar venta"}</Button></Form>
        {actionData?.error && <p role="alert" className="text-destructive">{actionData.error}</p>}
      </div>
    </div>
  </section>;
}

export function ErrorBoundary() {
  return <ErrorState title="No se pudo cargar el punto de venta" description="Inténtalo de nuevo." action={<Button asChild variant="outline"><a href="">Reintentar</a></Button>} />;
}
