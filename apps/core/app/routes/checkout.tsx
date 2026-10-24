import { useState } from "react";
import { useController, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckoutDeliveryFields, type CheckoutDeliveryDraft } from "@core/app/components/checkout-delivery-fields";
import { redirect, data, isRouteErrorResponse, useFetcher, useLoaderData, useParams, type ActionFunctionArgs, type LoaderFunctionArgs, type ShouldRevalidateFunctionArgs } from "react-router";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Button } from "@core/app/components/ui/button";
import { CheckoutBuyerDetails, CheckoutConfirmAction, CheckoutOrderSummary, CheckoutPayment, CheckoutReviewFields, CheckoutShell, checkoutTotal } from "@core/app/components/checkout-sections";
import { brandHostCompanyContext } from "@core/app/brand-host-context";
import { orders } from "@core/src/features/orders/composition";
import { parseBuyer, type CheckoutAccess } from "@core/src/features/orders/domain/checkout";
import { checkoutFormSchema, otherPersonReceives, type CheckoutForm } from "@core/app/checkout-recipient";
import { internationalPhonePattern, savedPhoneForForm } from "@shared/phone";
import { recipientForCheckout, recipientForKeptDelivery, withBuyerAsRecipient } from "@core/src/features/orders/domain/checkout-recipient";
import { parseRatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import type { CheckoutDeliveryChange, CheckoutPage } from "@core/src/features/orders/application/checkout";
import type { Money } from "@shared/money";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";
import { buyerPaymentViewSchema, type BuyerPaymentView } from "@shared/contracts/orders";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { parseCompanyId } from "@core/src/features/store-appearance/domain/store-appearance";
import { defaultStoreTheme } from "@shared/store-themes";
import type { ColorSchemeHandle } from "@core/app/color-scheme";
import { publicStoreAppearanceSchema, type PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";
import { checkoutPathSchema, checkoutDeliveryOptionsSchema, confirmCheckoutDeliverySchema, publicCheckoutSchema, type CheckoutDeliveryOptions, type PublicCheckoutResponse } from "@shared/contracts/order-checkout";

const privacyHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export const headers = () => privacyHeaders;
// A rejected confirmation keeps the buyer's input; a successful one redirects here and needs the payment view.
export const shouldRevalidate = ({ formMethod, actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) =>
  formMethod?.toUpperCase() === "POST" && actionResult !== undefined ? false : defaultShouldRevalidate;
/** A checkout renders a fixed theme; an unavailable link (the loader threw) keeps following the buyer's system preference. */
export const handle = { colorScheme: (data: unknown) => (data as Partial<PageData> | undefined)?.checkout ? "fixed" : "system" } satisfies ColorSchemeHandle;
export const meta = () => [{ title: "Revisa tu pedido" }, { name: "robots", content: "noindex, nofollow" }];
const unavailable = "Enlace no disponible";
const retry = "No se pudo completar la solicitud. Inténtalo de nuevo.";
type PageData = { checkout: PublicCheckoutResponse | null; payment?: BuyerPaymentView; appearance?: PublicStoreAppearance | null; deliveryOptions?: CheckoutDeliveryOptions; message: string | null; fieldErrors?: { name?: string; phone?: string; recipientName?: string; recipientPhone?: string }; unavailable?: boolean; code?: string; currentPrice?: Money };
const response = (value: PageData, status = 200) => data(value, { status, headers: privacyHeaders });

function serialize({ checkout, photos }: CheckoutPage): PublicCheckoutResponse {
  const parsed = publicCheckoutSchema.safeParse({ ...checkout,
    items: checkout.items.map(({ variantId, ...item }) => ({ ...item, imageUrl: photos.get(variantId) ?? null })),
    state: checkout.state.kind === "confirmed" ? { kind: "confirmed", confirmedAt: checkout.state.confirmedAt.toISOString() } : checkout.state });
  if (!parsed.success) {
    log.error({ event: "order_checkout_data_invalid", errorCode: "INVALID_CHECKOUT_RESPONSE" }, "Invalid checkout response");
    bindRequestOperation({ outcome: "technical_failure" });
    throw new Response(retry, { status: 503, headers: privacyHeaders });
  }
  return parsed.data;
}

/** The brand is decorative: any failure reading it falls back to the Yoyos look and never blocks the order. */
async function loadAppearance(companyId: string): Promise<PublicStoreAppearance | null> {
  const id = parseCompanyId(companyId);
  if (!id.success) {
    log.error({ event: "order_store_appearance_failed", errorCode: id.error.code }, "Checkout appearance unavailable");
    bindRequestOperation({ storeAppearance: "fallback", storeTheme: defaultStoreTheme });
    return null;
  }
  let kind: "default" | "custom" | "fallback";
  let appearance: PublicStoreAppearance | null = null;
  try {
    const result = await storeAppearance.getPublic(id.data);
    kind = result.kind;
    if (result.kind === "custom") {
      const parsed = publicStoreAppearanceSchema.safeParse(result.appearance);
      if (parsed.success) appearance = parsed.data;
      else {
        kind = "fallback";
        log.error({ event: "order_checkout_data_invalid", errorCode: "INVALID_APPEARANCE_RESPONSE" }, "Invalid checkout appearance response");
      }
    }
  } catch (cause) {
    kind = "fallback";
    log.error({ event: "order_store_appearance_failed", err: cause }, "Checkout appearance unavailable");
  }
  bindRequestOperation({ storeAppearance: kind, storeTheme: appearance?.theme ?? defaultStoreTheme });
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

/** The checkout opens only on the brand host of the company that owns the order; any other pairing is «no disponible» and says nothing about the order. */
const servedByHost = (context: LoaderFunctionArgs["context"], companyId: string | undefined) => companyId !== undefined && context.get(brandHostCompanyContext) === companyId;

export async function loader({ params, context }: LoaderFunctionArgs) {
  bindRequestOperation({ operation: "get_checkout" });
  const path = checkoutPathSchema.safeParse(params);
  if (!path.success || !servedByHost(context, path.data.companyId)) {
    bindRequestOperation({ outcome: "unavailable" });
    throw new Response(unavailable, { status: 404, headers: privacyHeaders });
  }
  const result = await orders.getCheckout(path.data as CheckoutAccess);
  if (!result.success) throw new Response(result.error.code === "CHECKOUT_UNAVAILABLE" ? unavailable : retry,
    { status: result.error.code === "CHECKOUT_UNAVAILABLE" ? 404 : 503, headers: privacyHeaders });
  const appearance = loadAppearance(path.data.companyId);
  if (result.data.checkout.state.kind === "confirmed") {
    const [payment, branded] = await Promise.all([loadPayment(path.data.orderId), appearance]);
    return response({ checkout: serialize(result.data), payment, appearance: branded, message: null });
  }
  if (result.data.checkout.state.kind !== "pending") return response({ checkout: serialize(result.data), appearance: await appearance, message: null });
  const [settings, branded] = await Promise.all([withTenantIsolation(path.data.companyId, () => deliverySettings.getCheckoutDeliveryOptions(path.data.companyId)), appearance]);
  if (!settings.success) {
    bindRequestOperation({ outcome: "technical_failure" });
    throw new Response(retry, { status: 503, headers: privacyHeaders });
  }
  const options = checkoutDeliveryOptionsSchema.safeParse({
    home: settings.data.settings.home, agency: { enabled: settings.data.settings.agency.enabled, covered: settings.data.agencyCovered }, store: settings.data.settings.store });
  if (!options.success) {
    bindRequestOperation({ outcome: "technical_failure" });
    throw new Response(retry, { status: 503, headers: privacyHeaders });
  }
  return response({ checkout: serialize(result.data), deliveryOptions: options.data, appearance: branded, message: null });
}

const recipientFieldErrors = (recipient?: { name: string; phone: string }): NonNullable<PageData["fieldErrors"]> => ({
  ...(!recipient?.name.trim() ? { recipientName: "Ingresa el nombre de quien recibe." } : {}),
  ...(!recipient || !internationalPhonePattern.test(recipient.phone.trim()) ? { recipientPhone: "Ingresa el teléfono de quien recibe, por ejemplo 977 909 427." } : {}),
});
const sentRecipient = (body: unknown) => (body as { delivery?: { selection?: { recipient?: { name: string; phone: string } } } } | null)?.delivery?.selection?.recipient;
const formSchema = z.strictObject({ name: z.string(), phone: z.string(), expectedTotal: z.string(), delivery: z.string() });
export async function action({ request, params, context }: ActionFunctionArgs) {
  bindRequestOperation({ operation: "confirm_checkout" });
  const path = checkoutPathSchema.safeParse(params);
  if (!path.success || !servedByHost(context, path.data.companyId)) {
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
  const parsed = confirmCheckoutDeliverySchema.safeParse(withBuyerAsRecipient(body));
  if (!parsed.success) {
    bindRequestOperation({ outcome: "invalid_input" });
    const fieldErrors: NonNullable<PageData["fieldErrors"]> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === "buyer" && issue.path[1] === "name") fieldErrors.name = "Ingresa tu nombre.";
      if (issue.path[0] === "buyer" && issue.path[1] === "phone") fieldErrors.phone = "Ingresa un teléfono válido, por ejemplo 977 909 427.";
      if (issue.path.join(".") === "delivery.selection.recipient.name") Object.assign(fieldErrors, recipientFieldErrors(sentRecipient(body)));
    }
    return response({ checkout: null, message: "Revisa los datos del formulario.", fieldErrors }, 422);
  }
  const buyer = parseBuyer(parsed.data.buyer);
  if (!buyer.success) return response({ checkout: null, message: "Revisa los datos del comprador." }, 422);
  const access = path.data as CheckoutAccess;
  try {
    let delivery: CheckoutDeliveryChange;
    if (parsed.data.delivery.kind === "keep") {
      const recipient = recipientForKeptDelivery(parsed.data.delivery.recipient, buyer.data, parsed.data.otherRecipient);
      if (!recipient.success) return response({ checkout: null, message: "Revisa los datos de quien recibe.", fieldErrors: recipientFieldErrors(parsed.data.delivery.recipient) }, 422);
      delivery = { kind: "keep", recipient: recipient.data };
    } else {
      const recipient = recipientForCheckout(parsed.data.delivery.selection, buyer.data, parsed.data.otherRecipient);
      if (!recipient.success) return response({ checkout: null, message: "Revisa los datos de quien recibe.", fieldErrors: recipientFieldErrors(parsed.data.delivery.selection.recipient) }, 422);
      const selection = parseRatedDeliverySelection(recipient.data);
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
  const { t } = useTranslation();
  const initialData = useLoaderData<typeof loader>();
  const initial = initialData.checkout!;
  const { orderId = "" } = useParams();
  const fetcher = useFetcher<typeof action>();
  const checkout = initial.state.kind === "confirmed" ? initial : fetcher.data?.checkout ?? initial;
  const savedRecipient = initial.delivery?.recipient ?? null;
  const buyerForm = useForm<CheckoutForm>({ resolver: zodResolver(checkoutFormSchema), defaultValues: {
    name: initial.buyer?.name ?? "", phone: savedPhoneForForm(initial.buyer?.phone ?? ""), otherRecipient: otherPersonReceives(savedRecipient, initial.buyer),
    recipientName: savedRecipient?.name ?? "", recipientPhone: savedPhoneForForm(savedRecipient?.phone ?? "") } });
  const name = useController({ name: "name", control: buyerForm.control });
  const phone = useController({ name: "phone", control: buyerForm.control });
  const other = useController({ name: "otherRecipient", control: buyerForm.control });
  const recipientName = useController({ name: "recipientName", control: buyerForm.control });
  const recipientPhone = useController({ name: "recipientPhone", control: buyerForm.control });
  const [deliveryDraft, setDeliveryDraft] = useState<CheckoutDeliveryDraft | null>(null);
  const recipient = other.field.value ? { name: recipientName.field.value, phone: recipientPhone.field.value } : { name: name.field.value, phone: phone.field.value };
  const total = checkoutTotal(checkout, deliveryDraft);
  const recoveryVersion = fetcher.data?.code && ["TOTAL_CHANGED", "RATE_UNAVAILABLE", "INVALID_DISTRICT", "INVALID_DELIVERY_RATE", "DELIVERY_METHOD_DISABLED"].includes(fetcher.data.code) ? fetcher.data : undefined;
  const pending = fetcher.state !== "idle";
  const errors = { name: name.fieldState.error ? t("checkoutPage.nameRequired") : fetcher.data?.fieldErrors?.name,
    phone: phone.fieldState.error ? t("checkoutPage.phoneInvalid") : fetcher.data?.fieldErrors?.phone,
    recipientName: recipientName.fieldState.error ? t("checkoutRecipient.nameRequired") : fetcher.data?.fieldErrors?.recipientName,
    recipientPhone: recipientPhone.fieldState.error ? t("checkoutRecipient.phoneInvalid") : fetcher.data?.fieldErrors?.recipientPhone };
  if (fetcher.data?.unavailable) return <main className="mx-auto max-w-lg p-6"><h1 className="text-2xl font-semibold">{t("checkoutPage.unavailable")}</h1><p>{t("checkoutPage.askSeller")}</p></main>;
  const confirmable = checkout.state.kind === "pending";
  return <CheckoutShell appearance={initialData.appearance ?? null} checkout={checkout}
    summary={<CheckoutOrderSummary checkout={checkout} deliveryDraft={deliveryDraft}
      action={confirmable && <CheckoutConfirmAction form="checkout-form" type="submit" disabled={pending || !deliveryDraft || !total} pending={pending} />} />}>
    {confirmable ? <fetcher.Form id="checkout-form" method="post" noValidate className="flex flex-col gap-4" onSubmit={buyerForm.handleSubmit(form => {
      if (pending || !deliveryDraft || !total) return;
      const { delivery } = deliveryDraft;
      const kept = delivery.kind === "keep" && form.otherRecipient ? { kind: "keep" as const, recipient: { name: form.recipientName, phone: form.recipientPhone } } : delivery;
      fetcher.submit({ buyer: { name: form.name, phone: form.phone }, delivery: kept, expectedTotal: total, otherRecipient: form.otherRecipient }, { method: "post", encType: "application/json" });
    })}>
      <CheckoutReviewFields message={fetcher.data?.message ?? null} name={name.field} nameError={errors.name} phone={phone.field} phoneError={errors.phone}
        recipient={{ other: other.field.value, onOtherChange: other.field.onChange, name: { ...recipientName.field }, nameError: errors.recipientName,
          phone: recipientPhone.field, phoneError: errors.recipientPhone }}
        delivery={<CheckoutDeliveryFields orderId={orderId} checkout={checkout} options={initialData.deliveryOptions!} recipient={recipient} onChange={setDeliveryDraft} recoveryVersion={recoveryVersion} disabled={pending} />} />
    </fetcher.Form> : <CheckoutBuyerDetails buyer={checkout.buyer} delivery={checkout.delivery} />}
    {checkout.state.kind === "confirmed" && initialData.payment && <CheckoutPayment view={initialData.payment} />}
  </CheckoutShell>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <main className="mx-auto flex max-w-lg flex-col gap-4 p-6"><h1 className="text-2xl font-semibold">{missing ? t("checkoutPage.unavailable") : t("checkoutPage.loadError")}</h1><p>{missing ? t("checkoutPage.askSeller") : t("checkoutPage.loadErrorHint")}</p>{!missing && <Button asChild><a href="">{t("checkoutPage.retry")}</a></Button>}</main>;
}
