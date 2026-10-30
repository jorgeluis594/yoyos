import type { RatedSetDeliveryInput } from "@core/src/features/orders/application/set-delivery";
import { deliverySettings, toDeliverySettingsResponse } from "@core/src/features/delivery-settings";
import { parseRatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { useTranslation } from "react-i18next";
import { companyPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { lostResponse, lostResponseStatus } from "@core/app/routes/lost-response";
import { useCallback, useEffect, useRef, useState } from "react";
import { data, useActionData, useLoaderData, useNavigate, useNavigation, useSubmit, type ActionFunctionArgs, type ClientActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { countryCurrencies, type Country } from "@shared/country";
import { completeOrderSchema, newOrderLoaderSchema, orderActionErrorSchema } from "@shared/contracts/orders";
import { privateUserContext } from "@core/app/private-user-context";
import { createConfiguredOrder } from "@core/src/features/orders/composition";
import type { OrderId, PaymentId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { Button } from "@core/app/components/ui/button";
import { ErrorState } from "@core/app/components/ui/error-state";
import { OrderView, type ViewNotice } from "@core/src/features/orders/presentation/order-view";
import { applyRateRecovery, saleOutcome, type SaleActionResult, type SaleOutcome } from "@core/src/features/orders/presentation/new-sale-outcome";
import { buildCreateRequest, initialDraft, invalidFields, isEmptyDraft, type OrderViewState } from "@core/src/features/orders/presentation/order-view-state";
import { useUnsavedChangesGuard } from "@core/src/features/orders/presentation/use-unsaved-changes-guard";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const settings = await deliverySettings.get({ companyId: access.company.id, userId: access.user.id });
  const base = companyPath(new URL(request.url).pathname, access.company.country, "/orders");
  return { ...newOrderLoaderSchema.parse({ base, orderId: crypto.randomUUID(), currency: countryCurrencies[access.company.country as Country] }),
    settings: settings.success ? toDeliverySettingsResponse(settings.data) : null };
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
  const result = await createConfiguredOrder({ id: parsed.data.id as OrderId, customer: parsed.data.customer,
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
  return Response.redirect(new URL(companyPath(new URL(request.url).pathname, access.company.country, `/orders/${result.data.order.id}`), request.url));
}

/** A request that never reached the server is a connection problem; a gateway failure after it left is an uncertain result that the view resolves by reading the order. */
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try { return await serverAction<typeof action>(); }
  catch (cause) {
    const lost = lostResponse(cause);
    if (!lost) throw cause;
    return data({ lost }, { status: lostResponseStatus });
  }
}

type Doubt = "checking" | "failed" | null;

export default function OrderNew() {
  const { t, i18n } = useTranslation();
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData() as SaleActionResult | undefined;
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [state, setState] = useState<OrderViewState>(() => initialDraft({ kind: "new", orderId: loaded.orderId, currency: loaded.currency }));
  const [attempts, setAttempts] = useState(0);
  const [outcome, setOutcome] = useState<SaleOutcome | null>(null);
  const [doubt, setDoubt] = useState<Doubt>(null);
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const guard = useUnsavedChangesGuard({ dirty: !isEmptyDraft(state), inDoubt: doubt !== null });
  const saving = navigation.state !== "idle" && navigation.formMethod?.toUpperCase() === "POST";
  const orderPath = `${loaded.base}/${state.draft.orderId}`;
  const money = (amount: { amount: number; currency: string }) => formatCurrency(amount.amount, amount.currency, i18n.language);

  // Stock and «✓ n» never stay stale: every loader revalidation drops the picker's cached search.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    setCatalogEpoch((epoch) => epoch + 1);
  }, [loaded]);

  // A lost answer is resolved by reading the order with the same id: found, the sale was saved; missing, the form is intact and saving again can never make a second order.
  const { allowLeaving, holdLeaving } = guard;
  const readOrder = useCallback(() => fetch(`/api/orders/${state.draft.orderId}/aggregate`, { headers: { accept: "application/json" } }).then((response) => {
    if (response.ok) { allowLeaving(); navigate(orderPath, { replace: true }); return; }
    if (response.status === 404) { setDoubt(null); setOutcome(null); return; }
    setDoubt("failed");
  // The check itself got no answer.
  }, () => setDoubt("failed")), [allowLeaving, navigate, orderPath, state.draft.orderId]);
  useEffect(() => { if (doubt === "checking") void readOrder(); }, [doubt, readOrder]);

  // Each answer of the action is read once, when it arrives: the outcome belongs to the answer that produced it.
  const [answered, setAnswered] = useState<SaleActionResult | undefined>(undefined);
  if (result !== undefined && result !== answered) {
    const next = saleOutcome(result, { t, formatMoney: money, orderPath });
    setAnswered(result);
    setOutcome(next);
    setState(applyRateRecovery(state, next.rate));
    setDoubt(next.check ? "checking" : null);
  }
  useEffect(() => { if (result !== undefined) holdLeaving(); }, [result, holdLeaving]);

  function save() {
    const request = buildCreateRequest(state);
    if (invalidFields(state).length > 0 || !request.success) { setAttempts((count) => count + 1); return; }
    setOutcome(null);
    guard.allowLeaving();
    submit({ order: JSON.stringify(request.data) }, { method: "post", replace: true });
  }

  function discard() {
    setState(initialDraft({ kind: "new", orderId: crypto.randomUUID(), currency: loaded.currency }));
    setAttempts(0);
    setOutcome(null);
  }

  const notice: ViewNotice | null = doubt ? { kind: "doubt", checking: doubt === "checking" } : outcome?.notice ?? null;
  return <OrderView state={state} onStateChange={setState} settings={loaded.settings}
    links={{ sales: loaded.base, deliverySettings: loaded.base.replace(/\/orders$/, "/settings/delivery"), createProduct: loaded.base.replace(/\/orders$/, "/products") + "/new" }}
    catalogEpoch={catalogEpoch} guard={guard} saving={saving} notice={notice} attempts={attempts}
    unavailableVariantId={outcome?.unavailableVariantId ?? null} coverRequired={outcome?.coverRequired ?? false}
    format={{ amount: money, date: (iso) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(new Date(iso)) }}
    newPaymentId={() => crypto.randomUUID()} onSave={save} onCheckAgain={() => setDoubt("checking")} onDiscard={discard} />;
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return <ErrorState title={t("orders.pointOfSaleError")} description={t("common.retry")} action={<Button asChild variant="outline"><a href="">{t("products.retry")}</a></Button>} />;
}
