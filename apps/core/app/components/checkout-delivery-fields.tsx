import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@core/app/components/ui/input";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel, controlClass } from "@core/app/components/ui/field";
import { PeruDistrictSelect } from "@core/app/components/peru-district-select";
import { formatCurrency } from "@core/app/format-currency";
import { useClientReady } from "@core/app/use-client-ready";
import { CheckoutAgencyDestination } from "@core/app/components/checkout-agency-destination";
import { agencyChoices, chosenAgency } from "@core/app/checkout-agency-choices";
import { getPeruDistrict, peruDeliveryDistrict } from "@shared/peru-geography";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import { checkoutDeliveryChangeSchema, type CheckoutDeliveryOptions, type ConfirmCheckoutDeliveryRequest, type PublicCheckoutResponse } from "@shared/contracts/order-checkout";
import type { QuotationResponse } from "@shared/contracts/quotations";
import { rateLabel } from "@core/app/rate-label";
import { requestDeliveryQuotation, type QuotationRequestError } from "@core/src/features/delivery-settings/infrastructure/quotation-api";

const draftSchema = z.object({ mode: z.enum(["", "keep", "home", "agency", "store"]), districtCode: z.string().nullable(), rateId: z.string(), agencyId: z.string(),
  name: z.string(), phone: z.string(), address: z.string(), instructions: z.string(), document: z.string(),
  documentType: z.enum(["national_id", "passport", "foreign_id"]) });
type Draft = z.infer<typeof draftSchema>;
export type CheckoutDeliveryDraft = Readonly<{ delivery: ConfirmCheckoutDeliveryRequest["delivery"]; price: Money }>;

export function CheckoutDeliveryFields({ orderId, checkout, options, onChange, recoveryVersion = 0, disabled = false }: Readonly<{
  orderId: string; checkout: PublicCheckoutResponse; options: CheckoutDeliveryOptions;
  onChange: (draft: CheckoutDeliveryDraft | null) => void; recoveryVersion?: number | object; disabled?: boolean;
}>) {
  const { t, i18n } = useTranslation();
  const ready = useClientReady();
  const saved = checkout.delivery;
  const homeEnabled = options.home.enabled;
  const agencyEnabled = options.agency.enabled && options.agency.covered;
  const districtRef = useRef<HTMLDivElement>(null);
  const form = useForm<Draft>({ resolver: zodResolver(draftSchema), defaultValues: {
    mode: saved ? "keep" : homeEnabled ? "home" : agencyEnabled ? "agency" : options.store.enabled ? "store" : "", districtCode: saved && "destination" in saved && "districtCode" in saved.destination ? saved.destination.districtCode : null,
    rateId: "", agencyId: "", name: saved?.recipient.name ?? checkout.buyer?.name ?? "", phone: saved?.recipient.phone ?? checkout.buyer?.phone ?? "",
    address: saved?.method === "home" ? saved.destination.address : "", instructions: saved?.method === "home" ? saved.destination.instructions ?? "" : "",
    documentType: saved?.recipient.identity.kind === "document" ? saved.recipient.identity.documentType : "national_id",
    document: saved?.recipient.identity.kind === "document" ? saved.recipient.identity.document : "",
  } });
  const draft = useWatch({ control: form.control });
  const [revision, setRevision] = useState(0);
  const [received, setReceived] = useState<Readonly<{ districtCode: string; revision: number; recoveryVersion: number | object; result: Result<QuotationResponse, QuotationRequestError> }> | null>(null);
  const current = received && received.districtCode === draft.districtCode && received.revision === revision && received.recoveryVersion === recoveryVersion ? received.result : null;
  const rates = useMemo(() => current?.success ? current.data.rates : [], [current]);
  const known = draft.districtCode ? getPeruDistrict(draft.districtCode) : null;
  const buyerDistrict = known ? peruDeliveryDistrict(known.code) : null;
  const homeRates = useMemo(() => rates.filter(item => item.method === "home"), [rates]);
  const rate = draft.mode === "home" && homeEnabled ? homeRates.find(item => item.id === draft.rateId) : undefined;
  const choices = useMemo(() => draft.mode === "agency" && draft.districtCode ? agencyChoices(rates, draft.districtCode) : { level: "none" as const }, [draft.mode, draft.districtCode, rates]);
  const choice = draft.mode === "agency" && agencyEnabled ? chosenAgency(choices, draft.agencyId ?? "") : null;
  const quoting = (draft.mode === "home" && homeEnabled) || (draft.mode === "agency" && agencyEnabled);
  useEffect(() => {
    if (!quoting || !draft.districtCode) return;
    const controller = new AbortController();
    const districtCode = draft.districtCode;
    void requestDeliveryQuotation({ orderId, districtCode }, controller.signal).then(result => {
      if (!controller.signal.aborted) setReceived({ districtCode, revision, recoveryVersion, result });
    });
    return () => controller.abort();
  }, [quoting, draft.mode, draft.districtCode, orderId, revision, recoveryVersion]);
  const prepared = useMemo<CheckoutDeliveryDraft | null>(() => {
    if (draft.mode === "keep") return saved ? { delivery: { kind: "keep" }, price: checkout.deliveryCharge } : null;
    const identity = draft.mode === "agency" || draft.document?.trim()
      ? { kind: "document", documentType: draft.documentType, document: draft.document }
      : { kind: "absent" };
    const recipient = { name: draft.name, phone: draft.phone, identity };
    const price: Money | undefined = draft.mode === "store" && options.store.enabled ? { amount: 0, currency: checkout.total.currency } : draft.mode === "agency" ? choice?.price : rate?.price;
    const selection = draft.mode === "store" ? { method: "store", recipient } : draft.mode === "home"
      ? { method: "home", rateId: rate?.id, recipient, destination: { districtCode: draft.districtCode, address: draft.address, instructions: draft.instructions?.trim() || null } }
      : { method: "agency", rateId: choice?.rateId, recipient, districtCode: draft.districtCode, agencyId: choice?.agency.id };
    const parsed = checkoutDeliveryChangeSchema.safeParse({ kind: "replace", selection, expectedPrice: price });
    return price && parsed.success ? { delivery: parsed.data, price } : null;
  }, [draft.mode, draft.name, draft.phone, draft.documentType, draft.document, draft.districtCode, draft.address, draft.instructions,
    rate, choice, saved, checkout.deliveryCharge, checkout.total.currency, options.store.enabled]);
  useEffect(() => onChange(prepared), [prepared, onChange]);
  const amount = (price: Money) => price.amount === 0 ? t("checkoutDelivery.free") : formatCurrency(price.amount, price.currency, i18n.language);
  const changeMode = (mode: Draft["mode"]) => { form.setValue("mode", mode); form.setValue("rateId", ""); form.setValue("agencyId", ""); setReceived(null); };
  const changeDistrict = () => (districtRef.current?.querySelector<HTMLSelectElement>('select[id$="-district"]:not(:disabled)') ?? districtRef.current?.querySelector<HTMLSelectElement>('select[id$="-department"]'))?.focus();
  const input = (name: "name" | "phone" | "address" | "instructions" | "document", label: string, required = false) => <Controller key={name} name={name} control={form.control} render={({ field }) =>
    <Field><FieldLabel htmlFor={`delivery-${name}`}>{label}</FieldLabel><Input {...field} name={undefined} id={`delivery-${name}`} required={required} type={name === "phone" ? "tel" : "text"} /></Field>} />;
  return <fieldset disabled={disabled || !ready} className="flex min-w-0 flex-col gap-4">
    <legend data-checkout-part="section-title" className="mb-4 text-lg font-semibold">{t("checkoutDelivery.title")}</legend>
    {!saved && !homeEnabled && !agencyEnabled && !options.store.enabled ? <p role="status" className="rounded-[var(--radius-control)] bg-muted p-4 text-sm text-muted-foreground">{t("checkoutDelivery.noModes")}</p>
      : <Controller name="mode" control={form.control} render={({ field }) => <div role="radiogroup" aria-labelledby="delivery-mode-label" className="flex flex-col gap-2">
        <span id="delivery-mode-label" className="text-sm font-medium">{t("checkoutDelivery.mode")}</span>
        <div data-checkout-part="option-group" className="flex flex-col divide-y overflow-hidden rounded-[var(--radius-control)] border border-input">
          {([saved && ["keep", t("checkoutDelivery.keep")], homeEnabled && ["home", t("checkoutDelivery.method.home")], agencyEnabled && ["agency", t("checkoutDelivery.method.agency")], options.store.enabled && ["store", t("checkoutDelivery.storeFree")]]
            .filter((option): option is [Draft["mode"], string] => Boolean(option))).map(([value, label]) =>
            <label key={value} data-checkout-part="option" className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3 transition-colors has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring">
              <input type="radio" data-slot="radio-group-item" name={field.name} value={value} checked={field.value === value} onBlur={field.onBlur} className="size-4 accent-[var(--accent-strong,var(--primary))]" onChange={() => changeMode(value)} /><span className="font-medium">{label}</span>
            </label>)}
        </div>
      </div>} />}
    {draft.mode === "keep" && saved && <div className="space-y-1 rounded-[var(--radius-control)] bg-muted p-4 text-sm"><p className="font-medium">{t(`checkoutDelivery.method.${saved.method}`)} · {amount(checkout.deliveryCharge)}</p>
      <p>{saved.method === "home" ? `${saved.destination.address}, ${saved.destination.district}` : saved.method === "store" ? saved.pickupPoint.address : `${saved.courier.name} · ${saved.agency.name} · ${saved.agency.address}`}</p><p className="text-muted-foreground">{t("checkoutDelivery.kept")}</p></div>}
    {draft.mode === "store" && options.store.enabled && <div className="space-y-1 rounded-[var(--radius-control)] bg-muted p-4 text-sm"><p className="font-medium">{options.store.pickupPoint.name} · {t("checkoutDelivery.free")}</p><p>{options.store.pickupPoint.address}</p>{options.store.pickupPoint.instructions && <p>{options.store.pickupPoint.instructions}</p>}</div>}
    {quoting && <>
      <div ref={districtRef}><PeruDistrictSelect value={draft.districtCode ? getPeruDistrict(draft.districtCode)?.code ?? null : null} disabled={disabled} onChange={code => { form.setValue("districtCode", code); form.setValue("rateId", ""); form.setValue("agencyId", ""); }} /></div>
      {draft.districtCode && !current && <p role="status" className="text-sm text-muted-foreground">{t("checkoutDelivery.loading")}</p>}
      {current && !current.success && <div className="flex flex-col items-start gap-2"><p role="alert" className="text-sm text-[var(--error)]">{t("checkoutDelivery.ratesError")}</p><Button type="button" variant="outline" onClick={() => setRevision(value => value + 1)}>{t("checkoutDelivery.retry")}</Button></div>}
      {draft.mode === "home" && current?.success && homeRates.length === 0 && <p role="status" className="rounded-[var(--radius-control)] bg-muted p-4 text-sm text-muted-foreground">{t(options.store.enabled ? "checkoutDelivery.noRatesOrStore" : "checkoutDelivery.noRates")}</p>}
      {draft.mode === "home" && homeRates.length > 0 && <Controller name="rateId" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="delivery-rate">{t("checkoutDelivery.rate")}</FieldLabel><select id="delivery-rate" data-slot="select" className={controlClass} value={field.value} onBlur={field.onBlur} onChange={field.onChange}>
        <option value="">{t("checkoutDelivery.selectRate")}</option>{homeRates.map(item => <option key={item.id} value={item.id}>{rateLabel(item, homeRates)} · {amount(item.price)}</option>)}</select></Field>} />}
      {draft.mode === "agency" && current?.success && buyerDistrict && <CheckoutAgencyDestination choices={choices} buyerDistrict={buyerDistrict} value={draft.agencyId ?? ""} homeOffered={homeEnabled} disabled={disabled}
        onChange={agencyId => form.setValue("agencyId", agencyId)} onChangeDistrict={changeDistrict} onSwitchToHome={() => changeMode("home")} amount={amount} />}
    </>}
    {draft.mode && draft.mode !== "keep" && <>
      {input("name", t("checkoutDelivery.recipientName"), true)}{input("phone", t("checkoutDelivery.recipientPhone"), true)}
      {rate && <>{input("address", t("checkoutDelivery.address"), true)}{input("instructions", t("checkoutDelivery.instructions"))}</>}
      {draft.mode === "agency" && <><Controller name="documentType" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="delivery-document-type">{t("checkoutDelivery.documentType")}</FieldLabel><select id="delivery-document-type" data-slot="select" className={controlClass} value={field.value} onChange={field.onChange} onBlur={field.onBlur}><option value="national_id">{t("checkoutDelivery.documentTypes.national_id")}</option><option value="passport">{t("checkoutDelivery.documentTypes.passport")}</option><option value="foreign_id">{t("checkoutDelivery.documentTypes.foreign_id")}</option></select></Field>} />{input("document", t("checkoutDelivery.document"), true)}</>}
    </>}
  </fieldset>;
}
