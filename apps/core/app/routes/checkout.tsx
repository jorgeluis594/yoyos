import { useState } from "react";
import { redirect, data, isRouteErrorResponse, useFetcher, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs, type ShouldRevalidateFunctionArgs } from "react-router";
import { z } from "zod";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldError, FieldLabel } from "@core/app/components/ui/field";
import { formatCurrency } from "@core/app/format-currency";
import { orders } from "@core/src/features/orders/composition";
import { parseBuyer, type CheckoutAccess, type CheckoutView } from "@core/src/features/orders/domain/checkout";
import { parseRatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import type { CheckoutDeliveryChange } from "@core/src/features/orders/application/checkout";
import type { Money } from "@shared/money";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";
import { checkoutPathSchema, checkoutDeliveryOptionsSchema, confirmCheckoutDeliverySchema, confirmCheckoutSchema, publicCheckoutSchema, type CheckoutDeliveryOptions, type PublicCheckoutResponse } from "@shared/contracts/order-checkout";

const privacyHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export const headers = () => privacyHeaders;
export const shouldRevalidate = ({ formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) =>
  formMethod?.toUpperCase() === "POST" ? false : defaultShouldRevalidate;
export const meta = () => [{ title: "Revisa tu pedido" }, { name: "robots", content: "noindex, nofollow" }];
const unavailable = "Enlace no disponible";
const retry = "No se pudo completar la solicitud. Inténtalo de nuevo.";
type PageData = { checkout: PublicCheckoutResponse | null; deliveryOptions?: CheckoutDeliveryOptions; message: string | null; fieldErrors?: { name?: string; phone?: string }; unavailable?: boolean; code?: string; currentPrice?: Money };
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
  if (result.data.state.kind !== "pending") return response({ checkout: serialize(result.data), message: null });
  const settings = await withTenantIsolation(path.data.companyId, () => deliverySettings.getForCompany(path.data.companyId));
  if (!settings.success) {
    bindRequestOperation({ outcome: "technical_failure" });
    throw new Response(retry, { status: 503, headers: privacyHeaders });
  }
  const options = checkoutDeliveryOptionsSchema.safeParse({ home: settings.data.home, agency: settings.data.agency, store: settings.data.store });
  if (!options.success) {
    bindRequestOperation({ outcome: "technical_failure" });
    throw new Response(retry, { status: 503, headers: privacyHeaders });
  }
  return response({ checkout: serialize(result.data), deliveryOptions: options.data, message: null });
}

const formSchema = z.strictObject({ name: z.string(), phone: z.string(), expectedTotal: z.string(), delivery: z.string().optional() });
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
      if (!parsed.success || [...fields.keys()].length !== (parsed.data.delivery === undefined ? 3 : 4)) body = null;
      else body = { buyer: { name: parsed.data.name, phone: parsed.data.phone }, expectedTotal: JSON.parse(parsed.data.expectedTotal),
        ...(parsed.data.delivery === undefined ? {} : { delivery: JSON.parse(parsed.data.delivery) }) };
    }
  } catch {
    body = null;
  }
  const deliveryRequest = confirmCheckoutDeliverySchema.safeParse(body);
  const parsed = typeof body === "object" && body !== null && "delivery" in body
    ? deliveryRequest : confirmCheckoutSchema.safeParse(body);
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
  try {
    let delivery: CheckoutDeliveryChange | undefined;
    if (deliveryRequest.success) {
      if (deliveryRequest.data.delivery.kind === "keep") delivery = { kind: "keep" };
      else {
        const selection = parseRatedDeliverySelection(deliveryRequest.data.delivery.selection);
        if (!selection.success) return response({ checkout: null, message: "Revisa el destino y los datos de entrega.", code: selection.error.code }, 422);
        delivery = { kind: "replace", selection: selection.data, expectedPrice: deliveryRequest.data.delivery.expectedPrice };
      }
    }
    const result = delivery
      ? await orders.confirmCheckoutDelivery({ buyer: buyer.data, expectedTotal: parsed.data.expectedTotal, delivery }, access)
      : await orders.confirmCheckout({ buyer: buyer.data, expectedTotal: parsed.data.expectedTotal }, access);
    if (result.success) return delivery ? redirect(`/pago/${access.orderId}`, { headers: privacyHeaders })
      : response({ checkout: serialize(result.data), message: null });
    if (result.error.code === "CHECKOUT_UNAVAILABLE") return response({ checkout: null, message: unavailable, unavailable: true }, 404);
    if (result.error.code === "TOTAL_CHANGED" || result.error.code === "ORDER_CANCELLED") {
      const latest = await orders.getCheckout(access);
      if (!latest.success) {
        const missing = latest.error.code === "CHECKOUT_UNAVAILABLE";
        bindRequestOperation({ operation: "confirm_checkout", outcome: missing ? "unavailable" : "technical_failure" });
        return response({ checkout: null, message: missing ? unavailable : retry, unavailable: missing }, missing ? 404 : 503);
      }
      bindRequestOperation({ operation: "confirm_checkout", outcome: result.error.code === "TOTAL_CHANGED" ? "total_changed" : "cancelled" });
      return response({ checkout: serialize(latest.data), code: result.error.code,
        ...("currentPrice" in result.error ? { currentPrice: result.error.currentPrice } : {}), message: result.error.code === "TOTAL_CHANGED"
        ? "El total cambió. Revisa el nuevo importe y vuelve a confirmar." : null }, 409);
    }
    if (["RATE_UNAVAILABLE", "INVALID_DELIVERY_RATE", "INVALID_DISTRICT", "DELIVERY_METHOD_DISABLED", "INVALID_CHECKOUT", "INVALID_ORDER", "DELIVERY_LOCKED"].includes(result.error.code))
      return response({ checkout: null, code: result.error.code, message: "Revisa la entrega y vuelve a confirmar." }, 422);
    if (result.error.code === "INSUFFICIENT_STOCK") return response({ checkout: null, code: result.error.code, message: "No hay stock suficiente. Contacta al vendedor." }, 409);
    return response({ checkout: null, message: retry }, 503);
  } catch (cause) {
    if (cause instanceof Response) return response({ checkout: null, message: retry }, cause.status);
    log.error({ event: "order_checkout_request_failed", err: cause }, "Checkout request failed");
    bindRequestOperation({ operation: "confirm_checkout", outcome: "technical_failure" });
    return response({ checkout: null, message: retry }, 503);
  }
}

export default function Checkout() {
  const initial = useLoaderData<typeof loader>().checkout!;
  const fetcher = useFetcher<typeof action>();
  const checkout = fetcher.data?.checkout ?? initial;
  const [name, setName] = useState(initial.buyer?.name ?? "");
  const [phone, setPhone] = useState(initial.buyer?.phone ?? "");
  const pending = fetcher.state !== "idle";
  const errors = fetcher.data?.fieldErrors;
  const amount = (money: PublicCheckoutResponse["total"]) => formatCurrency(money.amount, money.currency, "es");
  if (fetcher.data?.unavailable) return <main className="mx-auto max-w-lg p-6"><h1 className="text-2xl font-semibold">{unavailable}</h1><p>Solicita el enlace al vendedor.</p></main>;
  return <main className="mx-auto flex max-w-lg flex-col gap-6 p-5 py-8">
    <header><p className="text-muted-foreground">{checkout.companyName}</p><h1 className="text-2xl font-semibold">Pedido #{checkout.number}</h1><p>Revisa los productos y el total de tu pedido.</p></header>
    {checkout.state.kind === "cancelled" && <section role="status"><h2 className="text-xl font-semibold">Pedido cancelado</h2><p>Este pedido ya no puede confirmarse. Contacta al vendedor.</p></section>}
    {checkout.state.kind === "confirmed" && <section role="status"><h2 className="text-xl font-semibold">Pedido confirmado</h2><p>Recibimos tu confirmación. Esto no registra un pago.</p><p>Para solicitar cambios, contacta al vendedor por el canal que ya utilizan.</p></section>}
    <section aria-labelledby="products-title"><h2 id="products-title" className="font-semibold">Productos</h2><ul className="divide-y">{checkout.items.map((item, index) => <li key={index} className="flex justify-between gap-4 py-4"><div className="min-w-0 break-words"><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{Object.values(item.variantAttributes).join(" · ")}</p><p>{item.quantity} × {amount(item.unitPrice)}</p></div><strong className="shrink-0">{amount(item.subtotal)}</strong></li>)}</ul></section>
    <dl className="flex flex-col gap-2"><div className="flex justify-between gap-4"><dt>Subtotal de productos</dt><dd>{amount(checkout.itemsTotal)}</dd></div><div className="flex justify-between gap-4 text-xl font-semibold"><dt>Total a pagar</dt><dd>{amount(checkout.total)}</dd></div></dl>
    {checkout.state.kind === "pending" ? <fetcher.Form method="post" noValidate className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">Tus datos</h2>
      {fetcher.data?.message && <p role="alert">{fetcher.data.message}</p>}
      <Field data-invalid={Boolean(errors?.name)}><FieldLabel htmlFor="buyer-name">Nombre</FieldLabel><Input id="buyer-name" name="name" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(errors?.name)} aria-describedby={errors?.name ? "name-error" : undefined} />{errors?.name && <FieldError id="name-error">{errors.name}</FieldError>}</Field>
      <Field data-invalid={Boolean(errors?.phone)}><FieldLabel htmlFor="buyer-phone">Teléfono</FieldLabel><Input id="buyer-phone" name="phone" type="tel" autoComplete="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} aria-invalid={Boolean(errors?.phone)} aria-describedby="phone-hint phone-error" /><p id="phone-hint" className="text-sm text-muted-foreground">Incluye el código de país, por ejemplo +51987654321.</p>{errors?.phone && <FieldError id="phone-error">{errors.phone}</FieldError>}</Field>
      <input type="hidden" name="expectedTotal" value={JSON.stringify(checkout.total)} />
      <Button type="submit" disabled={pending}>{pending ? "Confirmando…" : "Confirmar pedido"}</Button><p className="text-sm text-muted-foreground">Confirmas tu intención de compra. El pago se coordina por separado.</p>
    </fetcher.Form> : checkout.buyer && <section><h2 className="font-semibold">Datos del comprador</h2><p>{checkout.buyer.name}</p><p>{checkout.buyer.phone}</p></section>}
  </main>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <main className="mx-auto flex max-w-lg flex-col gap-4 p-6"><h1 className="text-2xl font-semibold">{missing ? unavailable : "No se pudo cargar el pedido"}</h1><p>{missing ? "Solicita el enlace al vendedor." : "Reintenta para consultar el estado actual de tu pedido."}</p>{!missing && <Button asChild><a href="">Reintentar</a></Button>}</main>;
}
