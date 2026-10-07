import { useState } from "react";
import { data, isRouteErrorResponse, useFetcher, useLoaderData, useRevalidator, type ActionFunctionArgs, type LoaderFunctionArgs, type ShouldRevalidateFunctionArgs } from "react-router";
import { z } from "zod";
import { Button } from "@core/app/components/ui/button";
import { ChevronDown, Check, Clock3 } from "lucide-react";
import { CheckoutForm, DeliverySummary } from "@core/src/features/orders/presentation/checkout-form";
import { BuyerPaymentContent } from "@core/src/features/orders/presentation/buyer-payment-content";
import { deliverySettingsSchema, type DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { buyerPaymentViewSchema, type BuyerPaymentView } from "@shared/contracts/orders";
import { formatCurrency } from "@core/app/format-currency";
import { orders } from "@core/src/features/orders/composition";
import { parseDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { parseBuyer, type CheckoutAccess, type CheckoutView } from "@core/src/features/orders/domain/checkout";
import { bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";
import { checkoutPathSchema, confirmCheckoutSchema, publicCheckoutSchema, type PublicCheckoutResponse } from "@shared/contracts/order-checkout";

const privacyHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export const headers = () => privacyHeaders;
export const shouldRevalidate = ({ formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) =>
  formMethod?.toUpperCase() === "POST" ? true : defaultShouldRevalidate;
export const meta = () => [{ title: "Revisa tu pedido" }, { name: "robots", content: "noindex, nofollow" }];
const unavailable = "Enlace no disponible";
const retry = "No se pudo completar la solicitud. Inténtalo de nuevo.";
type PageData = { settings?: DeliverySettingsResponse; payment?: BuyerPaymentView | null; checkout: PublicCheckoutResponse | null; message: string | null; fieldErrors?: { name?: string; phone?: string }; unavailable?: boolean };
const response = (value: PageData, status = 200) => data(value, { status, headers: privacyHeaders });

function serialize(checkout: CheckoutView): PublicCheckoutResponse {
  const parsed = publicCheckoutSchema.safeParse({ ...checkout, state: checkout.state.kind === "confirmed"
    ? { kind: "confirmed", confirmedAt: checkout.state.confirmedAt.toISOString() } : checkout.state });
  if (!parsed.success) {
    log.error({ event: "order_checkout_data_invalid", errorCode: "INVALID_CHECKOUT_RESPONSE" }, "Invalid checkout response");
    bindRequestOperation({ outcome: "technical_failure" });
    throw new Response(retry, { status: 503, headers: privacyHeaders });
  }
  return parsed.data;
}

export async function loader({ params }: LoaderFunctionArgs) {
  bindRequestOperation({ operation: "get_checkout" });
  const path = checkoutPathSchema.safeParse(params);
  if (!path.success) {
    bindRequestOperation({ outcome: "unavailable" });
    throw new Response(unavailable, { status: 404, headers: privacyHeaders });
  }
  const result = await orders.getCheckout(path.data as CheckoutAccess);
  if (!result.success) throw new Response(result.error.code === "CHECKOUT_UNAVAILABLE" ? unavailable : retry,
    { status: result.error.code === "CHECKOUT_UNAVAILABLE" ? 404 : 503, headers: privacyHeaders });
  const settings = await orders.getCheckoutDeliverySettings(path.data as CheckoutAccess);
  if (!settings.success) throw new Response(retry, { status: 503, headers: privacyHeaders });
  const payment = result.data.state.kind === "confirmed" && !result.data.deliveryQuotePending ? await orders.getBuyerPaymentView(path.data.orderId) : null;
  if (payment && !payment.success) throw new Response(retry, { status: 503, headers: privacyHeaders });
  return response({ checkout: serialize(result.data), settings: deliverySettingsSchema.parse(settings.data), payment: payment?.success ? buyerPaymentViewSchema.parse(payment.data) : null, message: null });
}

const formSchema = z.strictObject({ name: z.string(), phone: z.string(), expectedTotal: z.string() });
export async function action({ request, params }: ActionFunctionArgs) {
  bindRequestOperation({ operation: "confirm_checkout" });
  const path = checkoutPathSchema.safeParse(params);
  if (!path.success) {
    bindRequestOperation({ outcome: "unavailable" });
    return response({ checkout: null, message: unavailable, unavailable: true }, 404);
  }
  let body: unknown;
  try {
    if (request.headers.get("content-type")?.includes("application/json")) body = await request.json();
    else {
      const fields = await request.formData();
      const parsed = formSchema.safeParse(Object.fromEntries(fields));
      if (!parsed.success || [...fields.keys()].length !== 3) body = null;
      else body = { buyer: { name: parsed.data.name, phone: parsed.data.phone }, expectedTotal: JSON.parse(parsed.data.expectedTotal) };
    }
  } catch {
    body = null;
  }
  const parsed = confirmCheckoutSchema.safeParse(body);
  if (!parsed.success) {
    bindRequestOperation({ outcome: "invalid_input" });
    const fieldErrors: NonNullable<PageData["fieldErrors"]> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === "buyer" && issue.path[1] === "name") fieldErrors.name = "Ingresa tu nombre.";
      if (issue.path[0] === "buyer" && issue.path[1] === "phone") fieldErrors.phone = "Ingresa un teléfono con código de país, por ejemplo +51987654321.";
    }
    return response({ checkout: null, message: "Revisa los datos del formulario.", fieldErrors }, 422);
  }
  const buyer = parseBuyer(parsed.data.buyer);
  if (!buyer.success) return response({ checkout: null, message: "Revisa los datos del comprador." }, 422);
  const access = path.data as CheckoutAccess;
  const delivery = parsed.data.delivery ? parseDeliverySelection(parsed.data.delivery) : null;
  if (delivery && !delivery.success) return response({ checkout: null, message: "Revisa los datos de entrega." }, 422);
  try {
    const result = await orders.confirmCheckout({ buyer: buyer.data, expectedTotal: parsed.data.expectedTotal,
      ...(delivery?.success ? { delivery: delivery.data } : {}) }, access);
    if (result.success) return response({ checkout: serialize(result.data), message: null });
    if (result.error.code === "CHECKOUT_UNAVAILABLE") return response({ checkout: null, message: unavailable, unavailable: true }, 404);
    if (result.error.code === "TOTAL_CHANGED" || result.error.code === "ORDER_CANCELLED") {
      const latest = await orders.getCheckout(access);
      if (!latest.success) {
        const missing = latest.error.code === "CHECKOUT_UNAVAILABLE";
        bindRequestOperation({ operation: "confirm_checkout", outcome: missing ? "unavailable" : "technical_failure" });
        return response({ checkout: null, message: missing ? unavailable : retry, unavailable: missing }, missing ? 404 : 503);
      }
      bindRequestOperation({ operation: "confirm_checkout", outcome: result.error.code === "TOTAL_CHANGED" ? "total_changed" : "cancelled" });
      return response({ checkout: serialize(latest.data), message: result.error.code === "TOTAL_CHANGED"
        ? "El total cambió. Revisa el nuevo importe y vuelve a confirmar." : null }, 409);
    }
    if (["INVALID_DELIVERY", "DELIVERY_METHOD_DISABLED", "COURIER_UNAVAILABLE", "DELIVERY_LOCKED"].includes(result.error.code))
      return response({ checkout: null, message: "La entrega no está disponible. Revisa los datos o contacta a la tienda." }, 422);
    return response({ checkout: null, message: retry }, 503);
  } catch (cause) {
    if (cause instanceof Response) return response({ checkout: null, message: retry }, cause.status);
    log.error({ event: "order_checkout_request_failed", err: cause }, "Checkout request failed");
    bindRequestOperation({ operation: "confirm_checkout", outcome: "technical_failure" });
    return response({ checkout: null, message: retry }, 503);
  }
}

export default function Checkout() {
  const loaded = useLoaderData<typeof loader>();
  const initial = loaded.checkout!;
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  // A conflict response carries the latest amount; confirmed loaders carry later seller quotes.
  const checkout = initial.state.kind === "confirmed" || initial.state.kind === "cancelled" ? initial : fetcher.data?.checkout ?? initial;
  const settings = loaded.settings!;
  const [changingDelivery, setChangingDelivery] = useState(!initial.delivery && (settings.home.enabled || settings.store.enabled || settings.agency.enabled));
  const itemCount = checkout.items.reduce((sum, item) => sum + item.quantity, 0);
  const quotePending = checkout.deliveryQuotePending || (checkout.state.kind === "pending" && changingDelivery);
  const amount = (money: PublicCheckoutResponse["total"]) => formatCurrency(money.amount, money.currency, "es");
  if (fetcher.data?.unavailable) return <main className="mx-auto max-w-lg p-6"><h1 className="text-2xl font-semibold">{unavailable}</h1><p>Solicita el enlace al vendedor.</p></main>;
  return <main className="checkout-page mx-auto min-h-screen max-w-[1080px] px-5 pb-10 sm:px-8">
    <header className="flex min-h-16 items-center justify-between gap-4 border-b"><span className="font-semibold">{checkout.companyName}</span><span className="text-sm text-muted-foreground">Tu compra</span></header>
    <div className="py-5 sm:py-8"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{checkout.state.kind === "pending" ? "Revisa y confirma" : checkout.deliveryQuotePending ? "Tu pedido está en marcha" : checkout.state.kind === "cancelled" ? "Revisa tu pedido" : loaded.payment?.paymentStatus === "paid" ? "Tu pedido está pagado" : "Completa tu pago"}</h1><p className="mt-2 text-sm text-muted-foreground"><span className="font-medium">Pedido #{checkout.number}</span> · {checkout.state.kind === "pending" ? "Revisa tus datos y completa tu compra." : "Consulta tu entrega y el estado del pago."}</p></div>
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_320px] md:gap-8">
      <aside className="contents md:sticky md:top-6 md:col-start-2 md:row-start-1 md:block md:rounded-lg md:border md:bg-card md:p-5" aria-label="Resumen del pedido">
        <div className="order-1 rounded-lg border bg-card p-5 md:rounded-none md:border-0 md:p-0"><details className="group"><summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden"><span>{itemCount} {itemCount === 1 ? "producto" : "productos"} · {amount(checkout.itemsTotal)}</span><ChevronDown className="size-4 group-open:rotate-180 md:hidden" aria-hidden="true" /></summary>
          <ul className="checkout-products mt-3 divide-y">{checkout.items.map((item, index) => <li key={index} className="flex justify-between gap-3 py-3 text-sm"><div className="min-w-0 break-words"><p className="font-medium">{item.productName}</p><p className="mt-1 text-muted-foreground">{Object.values(item.variantAttributes).join(" · ")}</p><p className="mt-1 text-muted-foreground">{item.quantity} × {amount(item.unitPrice)}</p></div><span className="shrink-0 tabular-nums">{amount(item.subtotal)}</span></li>)}</ul>
        </details></div>
        <div className={`order-3 rounded-lg border bg-card p-5 md:mt-4 md:rounded-none md:border-0 md:border-t md:p-0 md:pt-4 ${checkout.state.kind !== "pending" ? "max-md:hidden" : ""}`}>
          <dl className="space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Productos</dt><dd className="tabular-nums">{amount(checkout.itemsTotal)}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Entrega</dt><dd>{quotePending ? "Por confirmar" : checkout.deliveryCharge ? amount(checkout.deliveryCharge) : "Coordinada con la tienda"}</dd></div>{!quotePending && <div className="flex justify-between gap-3 border-t pt-4 text-lg font-semibold"><dt>Total a pagar</dt><dd className="tabular-nums">{amount(checkout.total)}</dd></div>}</dl>
          {quotePending && <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Verás el total final cuando la tienda confirme el costo de entrega.</p>}
          {checkout.state.kind === "pending" && <div className="mt-5 space-y-3"><Button type="submit" form="checkout-form" disabled={fetcher.state !== "idle"} className="h-auto min-h-11 w-full whitespace-normal py-2">{fetcher.state !== "idle" ? "Confirmando…" : changingDelivery ? "Confirmar y solicitar costo de entrega" : "Confirmar pedido"}</Button><p className="text-center text-xs text-muted-foreground">{changingDelivery ? "Aún no tienes que pagar." : "La tienda verificará tu pago."}</p></div>}
        </div>
      </aside>
      <div className="order-2 min-w-0 md:col-start-1 md:row-start-1">
        {checkout.state.kind === "pending" ? <CheckoutForm checkout={checkout} settings={settings} pending={fetcher.state !== "idle"} message={fetcher.data?.message} onDeliveryChange={setChangingDelivery} onConfirm={input => fetcher.submit(input, { method: "post", encType: "application/json" })} />
          : checkout.state.kind === "cancelled" ? <section role="status"><h2 className="text-xl font-semibold">Pedido cancelado</h2><p className="mt-2 text-muted-foreground">Contacta a la tienda para revisar tu pedido.</p></section>
            : <div className="flex flex-col gap-6"><section className="rounded-lg border bg-card p-5" role="status"><div className="flex items-center gap-2"><Check className="size-5 text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold">Pedido confirmado</h2></div><p className="mt-2 text-sm text-muted-foreground">{checkout.buyer?.name} · {checkout.buyer?.phone}</p>
              <div className="mt-4 space-y-2 border-t pt-4"><h2 className="font-semibold">Entrega</h2><DeliverySummary delivery={checkout.delivery} buyer={checkout.buyer} /></div></section>
              {checkout.deliveryQuotePending ? <section className="space-y-3 border-t pt-5" role="status"><div className="flex items-center gap-2"><Clock3 className="size-5 text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold">Esperando costo de entrega</h2></div><p className="text-sm text-muted-foreground">La tienda revisará tu entrega. Cuando confirme el costo, aquí verás el total y los datos para pagar.</p><Button variant="outline" onClick={() => revalidator.revalidate()} disabled={revalidator.state !== "idle"}>{revalidator.state === "idle" ? "Actualizar estado" : "Actualizando…"}</Button></section>
                : loaded.payment ? <BuyerPaymentContent view={loaded.payment} /> : <p role="status">Cargando los datos de pago…</p>}
            </div>}
      </div>
    </div>
    <p className="mt-6 text-center text-xs text-muted-foreground">¿Necesitas cambiar tu pedido? Contacta a la tienda por el canal que ya utilizan.</p>
  </main>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <main className="mx-auto flex max-w-lg flex-col gap-4 p-6"><h1 className="text-2xl font-semibold">{missing ? unavailable : "No se pudo cargar el pedido"}</h1><p>{missing ? "Solicita el enlace al vendedor." : "Reintenta para consultar el estado actual de tu pedido."}</p>{!missing && <Button asChild><a href="">Reintentar</a></Button>}</main>;
}
