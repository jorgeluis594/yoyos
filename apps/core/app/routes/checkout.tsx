import { useState } from "react";
import { useController, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckoutDeliveryFields, type CheckoutDeliveryDraft } from "@core/app/components/checkout-delivery-fields";
import { redirect, data, isRouteErrorResponse, useFetcher, useLoaderData, useParams, type ActionFunctionArgs, type LoaderFunctionArgs, type ShouldRevalidateFunctionArgs } from "react-router";
import { z } from "zod";
import { Button } from "@core/app/components/ui/button";
import { CheckoutBuyerDetails, CheckoutOrderSummary, CheckoutPayment, CheckoutReviewFields, CheckoutShell, checkoutTotal } from "@core/app/components/checkout-sections";
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
import { publicCheckoutAppearanceSchema, type PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
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
  if (!id.success) {
    log.error({ event: "order_checkout_appearance_failed", errorCode: id.error.code }, "Checkout appearance unavailable");
    bindRequestOperation({ checkoutAppearance: "fallback" });
    return null;
  }
  let kind: "default" | "custom" | "fallback";
  let appearance: PublicCheckoutAppearance | null = null;
  try {
    const result = await checkoutAppearance.getPublic(id.data);
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
  const total = checkoutTotal(checkout, deliveryDraft);
  const recoveryVersion = fetcher.data?.code && ["TOTAL_CHANGED", "RATE_UNAVAILABLE", "INVALID_DISTRICT", "INVALID_DELIVERY_RATE", "DELIVERY_METHOD_DISABLED"].includes(fetcher.data.code) ? fetcher.data : undefined;
  const pending = fetcher.state !== "idle";
  const errors = { name: name.fieldState.error ? "Ingresa tu nombre." : fetcher.data?.fieldErrors?.name,
    phone: phone.fieldState.error ? "Ingresa un teléfono con código de país, por ejemplo +51987654321." : fetcher.data?.fieldErrors?.phone };
  if (fetcher.data?.unavailable) return <main className="mx-auto max-w-lg p-6"><h1 className="text-2xl font-semibold">{unavailable}</h1><p>Solicita el enlace al vendedor.</p></main>;
  return <CheckoutShell appearance={initialData.appearance ?? null} checkout={checkout}>
    <CheckoutOrderSummary checkout={checkout} deliveryDraft={deliveryDraft} />
    {checkout.state.kind === "pending" ? <fetcher.Form method="post" noValidate className="flex flex-col gap-5" onSubmit={buyerForm.handleSubmit(buyer => {
      if (pending || !deliveryDraft || !total) return;
      fetcher.submit({ buyer, delivery: deliveryDraft.delivery, expectedTotal: total }, { method: "post", encType: "application/json" });
    })}>
      <CheckoutReviewFields message={fetcher.data?.message ?? null} name={name.field} nameError={errors.name} phone={phone.field} phoneError={errors.phone}
        delivery={<CheckoutDeliveryFields orderId={orderId} checkout={checkout} options={initialData.deliveryOptions!} onChange={setDeliveryDraft} recoveryVersion={recoveryVersion} disabled={pending} />}
        confirm={{ type: "submit", disabled: pending || !deliveryDraft || !total, pending }} />
    </fetcher.Form> : <CheckoutBuyerDetails buyer={checkout.buyer} />}
    {checkout.state.kind === "confirmed" && initialData.payment && <CheckoutPayment view={initialData.payment} />}
  </CheckoutShell>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <main className="mx-auto flex max-w-lg flex-col gap-4 p-6"><h1 className="text-2xl font-semibold">{missing ? unavailable : "No se pudo cargar el pedido"}</h1><p>{missing ? "Solicita el enlace al vendedor." : "Reintenta para consultar el estado actual de tu pedido."}</p>{!missing && <Button asChild><a href="">Reintentar</a></Button>}</main>;
}
