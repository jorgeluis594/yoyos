import { useState } from "react";
import { useController, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckoutDeliveryFields, type CheckoutDeliveryDraft } from "@core/app/components/checkout-delivery-fields";
import { add } from "@shared/money";
import { redirect, data, isRouteErrorResponse, useFetcher, useLoaderData, useParams, type ActionFunctionArgs, type LoaderFunctionArgs, type ShouldRevalidateFunctionArgs } from "react-router";
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
import { buyerPaymentViewSchema, type BuyerPaymentView } from "@shared/contracts/orders";
import { checkoutAppearance, parseCompanyId } from "@core/src/features/checkout-appearance";
import { CheckoutBrandHeader } from "@core/src/features/checkout-appearance/presentation/checkout-brand-header";
import { CheckoutTheme } from "@core/src/features/checkout-appearance/presentation/checkout-theme";
import { publicCheckoutAppearanceSchema, type PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
import { BuyerPaymentContent } from "@core/src/features/orders/presentation/buyer-payment-content";
import { checkoutBuyerSchema, checkoutPathSchema, checkoutDeliveryOptionsSchema, confirmCheckoutDeliverySchema, publicCheckoutSchema, type CheckoutDeliveryOptions, type PublicCheckoutResponse } from "@shared/contracts/order-checkout";

const privacyHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export const headers = () => privacyHeaders;
// A rejected confirmation keeps the buyer's input; a successful one redirects here and needs the payment view.
export const shouldRevalidate = ({ formMethod, actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) =>
  formMethod?.toUpperCase() === "POST" && actionResult !== undefined ? false : defaultShouldRevalidate;
export const meta = () => [{ title: "Revisa tu pedido" }, { name: "robots", content: "noindex, nofollow" }];
const unavailable = "Enlace no disponible";
const retry = "No se pudo completar la solicitud. Inténtalo de nuevo.";
type PageData = { checkout: PublicCheckoutResponse | null; payment?: BuyerPaymentView; appearance?: PublicCheckoutAppearance | null; deliveryOptions?: CheckoutDeliveryOptions; message: string | null; fieldErrors?: { name?: string; phone?: string }; unavailable?: boolean; code?: string; currentPrice?: Money };
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

/** The brand is decorative: any failure reading it falls back to the Yoyos look and never blocks the order. */
async function loadAppearance(companyId: string): Promise<PublicCheckoutAppearance | null> {
  const id = parseCompanyId(companyId);
  let kind: "default" | "custom" | "fallback";
  let appearance: PublicCheckoutAppearance | null = null;
  try {
    const result = id.success ? await checkoutAppearance.getPublic(id.data) : { kind: "fallback" as const };
    kind = result.kind;
    if (result.kind === "custom") {
      const parsed = publicCheckoutAppearanceSchema.safeParse(result.appearance);
      if (parsed.success) appearance = parsed.data;
      else {
        kind = "fallback";
        log.error({ event: "order_checkout_data_invalid", errorCode: "INVALID_APPEARANCE_RESPONSE" }, "Invalid checkout appearance response");
      }
    }
  } catch (cause) {
    kind = "fallback";
    log.error({ event: "order_checkout_appearance_failed", err: cause }, "Checkout appearance unavailable");
  }
  bindRequestOperation({ checkoutAppearance: kind });
  return appearance;
}

async function loadPayment(orderId: string): Promise<BuyerPaymentView> {
  const payment = await orders.getBuyerPaymentView(orderId);
  if (!payment.success) log.error({ event: "order_checkout_payment_unavailable", errorCode: payment.error.code }, "Checkout payment view unavailable");
  const parsed = payment.success ? buyerPaymentViewSchema.safeParse(payment.data) : null;
  if (parsed?.success) return parsed.data;
  if (parsed) log.error({ event: "order_checkout_data_invalid", errorCode: "INVALID_PAYMENT_RESPONSE" }, "Invalid checkout payment response");
  bindRequestOperation({ outcome: "technical_failure" });
  throw new Response(retry, { status: 503, headers: privacyHeaders });
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
  const appearance = loadAppearance(path.data.companyId);
  if (result.data.state.kind === "confirmed") {
    const [payment, branded] = await Promise.all([loadPayment(path.data.orderId), appearance]);
    return response({ checkout: serialize(result.data), payment, appearance: branded, message: null });
  }
  if (result.data.state.kind !== "pending") return response({ checkout: serialize(result.data), appearance: await appearance, message: null });
  const [settings, branded] = await Promise.all([withTenantIsolation(path.data.companyId, () => deliverySettings.getForCompany(path.data.companyId)), appearance]);
  if (!settings.success) {
    bindRequestOperation({ outcome: "technical_failure" });
    throw new Response(retry, { status: 503, headers: privacyHeaders });
  }
  const options = checkoutDeliveryOptionsSchema.safeParse({ home: settings.data.home, agency: settings.data.agency, store: settings.data.store });
  if (!options.success) {
    bindRequestOperation({ outcome: "technical_failure" });
    throw new Response(retry, { status: 503, headers: privacyHeaders });
  }
  return response({ checkout: serialize(result.data), deliveryOptions: options.data, appearance: branded, message: null });
}

const formSchema = z.strictObject({ name: z.string(), phone: z.string(), expectedTotal: z.string(), delivery: z.string() });
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
      if (!parsed.success || [...fields.keys()].length !== 4) body = null;
      else body = { buyer: { name: parsed.data.name, phone: parsed.data.phone }, expectedTotal: JSON.parse(parsed.data.expectedTotal),
        delivery: JSON.parse(parsed.data.delivery) };
    }
  } catch {
    body = null;
  }
  const parsed = confirmCheckoutDeliverySchema.safeParse(body);
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
    let delivery: CheckoutDeliveryChange;
    if (parsed.data.delivery.kind === "keep") delivery = { kind: "keep" };
    else {
      const selection = parseRatedDeliverySelection(parsed.data.delivery.selection);
      if (!selection.success) return response({ checkout: null, message: "Revisa el destino y los datos de entrega.", code: selection.error.code }, 422);
      delivery = { kind: "replace", selection: selection.data, expectedPrice: parsed.data.delivery.expectedPrice };
    }
    const result = await orders.confirmCheckoutDelivery({ buyer: buyer.data, expectedTotal: parsed.data.expectedTotal, delivery }, access);
    if (result.success) return redirect(`/checkout/${access.companyId}/${access.orderId}`, { headers: privacyHeaders });
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
  const initialData = useLoaderData<typeof loader>();
  const initial = initialData.checkout!;
  const { orderId = "" } = useParams();
  const fetcher = useFetcher<typeof action>();
  const checkout = initial.state.kind === "confirmed" ? initial : fetcher.data?.checkout ?? initial;
  const buyerForm = useForm<{ name: string; phone: string }>({ resolver: zodResolver(checkoutBuyerSchema),
    defaultValues: { name: initial.buyer?.name ?? "", phone: initial.buyer?.phone ?? "" } });
  const name = useController({ name: "name", control: buyerForm.control });
  const phone = useController({ name: "phone", control: buyerForm.control });
  const [deliveryDraft, setDeliveryDraft] = useState<CheckoutDeliveryDraft | null>(null);
  const summed = deliveryDraft?.delivery.kind === "replace" ? add(deliveryDraft.price)(checkout.itemsTotal) : null;
  const total = checkout.state.kind !== "pending" || deliveryDraft?.delivery.kind === "keep" ? checkout.total : summed?.success ? summed.data : null;
  const recoveryVersion = fetcher.data?.code && ["TOTAL_CHANGED", "RATE_UNAVAILABLE", "INVALID_DISTRICT", "INVALID_DELIVERY_RATE", "DELIVERY_METHOD_DISABLED"].includes(fetcher.data.code) ? fetcher.data : undefined;
  const pending = fetcher.state !== "idle";
  const errors = { name: name.fieldState.error ? "Ingresa tu nombre." : fetcher.data?.fieldErrors?.name,
    phone: phone.fieldState.error ? "Ingresa un teléfono con código de país, por ejemplo +51987654321." : fetcher.data?.fieldErrors?.phone };
  const amount = (money: PublicCheckoutResponse["total"]) => formatCurrency(money.amount, money.currency, "es");
  if (fetcher.data?.unavailable) return <main className="mx-auto max-w-lg p-6"><h1 className="text-2xl font-semibold">{unavailable}</h1><p>Solicita el enlace al vendedor.</p></main>;
  return <CheckoutTheme appearance={initialData.appearance ?? null}><main className="mx-auto flex max-w-lg flex-col gap-6 p-5 py-8">
    <header><CheckoutBrandHeader companyName={checkout.companyName} logoUrl={initialData.appearance?.logoUrl ?? null} /><h1 className="text-2xl font-semibold">Pedido #{checkout.number}</h1><p>Revisa los productos y el total de tu pedido.</p></header>
    {checkout.state.kind === "cancelled" && <section role="status"><h2 className="text-xl font-semibold">Pedido cancelado</h2><p>Este pedido ya no puede confirmarse. Contacta al vendedor.</p></section>}
    {checkout.state.kind === "confirmed" && <section role="status"><h2 className="text-xl font-semibold">Pedido confirmado</h2><p>Recibimos tu confirmación. Esto no registra un pago.</p><p>Para solicitar cambios, contacta al vendedor por el canal que ya utilizan.</p></section>}
    <section aria-labelledby="products-title"><h2 id="products-title" className="font-semibold">Productos</h2><ul className="divide-y">{checkout.items.map((item, index) => <li key={index} className="flex justify-between gap-4 py-4"><div className="min-w-0 break-words"><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{Object.values(item.variantAttributes).join(" · ")}</p><p>{item.quantity} × {amount(item.unitPrice)}</p></div><strong className="shrink-0">{amount(item.subtotal)}</strong></li>)}</ul></section>
    <dl className="flex flex-col gap-2"><div className="flex justify-between gap-4"><dt>Subtotal de productos</dt><dd>{amount(checkout.itemsTotal)}</dd></div><div className="flex justify-between gap-4"><dt>Entrega</dt><dd>{checkout.state.kind !== "pending" ? (checkout.deliveryCharge.amount === 0 ? "Gratis" : amount(checkout.deliveryCharge)) : deliveryDraft ? (deliveryDraft.price.amount === 0 ? "Gratis" : amount(deliveryDraft.price)) : "Selecciona una opción"}</dd></div><div className="flex justify-between gap-4 text-xl font-semibold"><dt>Total a pagar</dt><dd>{total ? amount(total) : "Selecciona entrega"}</dd></div></dl>
    {checkout.state.kind === "pending" ? <fetcher.Form method="post" noValidate className="flex flex-col gap-5" onSubmit={buyerForm.handleSubmit(buyer => {
      if (pending || !deliveryDraft || !total) return;
      fetcher.submit({ buyer, delivery: deliveryDraft.delivery, expectedTotal: total }, { method: "post", encType: "application/json" });
    })}>
      <h2 className="text-lg font-semibold">Tus datos</h2>
      {fetcher.data?.message && <p role="alert">{fetcher.data.message}</p>}
      <Field data-invalid={Boolean(errors?.name)}><FieldLabel htmlFor="buyer-name">Nombre</FieldLabel><Input {...name.field} id="buyer-name" autoComplete="name" required aria-invalid={Boolean(errors?.name)} aria-describedby={errors?.name ? "name-error" : undefined} />{errors?.name && <FieldError id="name-error">{errors.name}</FieldError>}</Field>
      <Field data-invalid={Boolean(errors?.phone)}><FieldLabel htmlFor="buyer-phone">Teléfono</FieldLabel><Input {...phone.field} id="buyer-phone" type="tel" autoComplete="tel" required aria-invalid={Boolean(errors?.phone)} aria-describedby="phone-hint phone-error" /><p id="phone-hint" className="text-sm text-muted-foreground">Incluye el código de país, por ejemplo +51987654321.</p>{errors?.phone && <FieldError id="phone-error">{errors.phone}</FieldError>}</Field>
      <CheckoutDeliveryFields orderId={orderId} checkout={checkout} options={initialData.deliveryOptions!} onChange={setDeliveryDraft} recoveryVersion={recoveryVersion} disabled={pending} />
      <Button type="submit" disabled={pending || !deliveryDraft || !total}>{pending ? "Confirmando…" : "Confirmar pedido"}</Button><p className="text-sm text-muted-foreground">Confirmas tu intención de compra. El pago se coordina por separado.</p>
    </fetcher.Form> : checkout.buyer && <section><h2 className="font-semibold">Datos del comprador</h2><p>{checkout.buyer.name}</p><p>{checkout.buyer.phone}</p></section>}
    {checkout.state.kind === "confirmed" && initialData.payment && <section aria-label="Pago del pedido" className="flex flex-col gap-4"><BuyerPaymentContent view={initialData.payment} /></section>}
  </main></CheckoutTheme>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <main className="mx-auto flex max-w-lg flex-col gap-4 p-6"><h1 className="text-2xl font-semibold">{missing ? unavailable : "No se pudo cargar el pedido"}</h1><p>{missing ? "Solicita el enlace al vendedor." : "Reintenta para consultar el estado actual de tu pedido."}</p>{!missing && <Button asChild><a href="">Reintentar</a></Button>}</main>;
}
