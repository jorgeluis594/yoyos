import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@core/app/components/ui/input";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel, controlClass } from "@core/app/components/ui/field";
import { PeruLocationFields } from "@core/app/components/peru-district-select";
import { titleCase } from "@core/app/components/zone-entries";
import { chooseUpperLevel, enterLocationMethod, isNewUpperLevel, type LocationNotice, type LocationStep } from "@core/app/components/checkout-location";
import { formatCurrency } from "@core/app/format-currency";
import { useClientReady } from "@core/app/use-client-ready";
import { CheckoutAgencyDestination } from "@core/app/components/checkout-agency-destination";
import { agencyChoices, chosenAgency } from "@core/app/checkout-agency-choices";
import { getPeruDistrict, peruDeliveryDistrict, type PeruArea } from "@shared/peru-geography";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import { checkoutDeliveryChangeSchema, type CheckoutDeliveryOptions, type ConfirmCheckoutDeliveryRequest, type PublicCheckoutResponse } from "@shared/contracts/order-checkout";
import type { QuotationResponse } from "@shared/contracts/quotations";
import { rateLabel } from "@core/app/rate-label";
import { requestDeliveryQuotation, type QuotationRequestError } from "@core/src/features/delivery-settings/infrastructure/quotation-api";

const draftSchema = z.object({ mode: z.enum(["", "keep", "home", "agency", "store"]), location: z.custom<PeruArea | null>(), districtSource: z.enum(["picked", "automatic"]), rateId: z.string(), agencyId: z.string(),
  address: z.string(), instructions: z.string(), document: z.string(),
  documentType: z.enum(["national_id", "passport", "foreign_id"]) });
type Draft = z.infer<typeof draftSchema>;
export type CheckoutDeliveryDraft = Readonly<{ delivery: ConfirmCheckoutDeliveryRequest["delivery"]; price: Money }>;

/** The first method on the page, and the form's location and notice for it; the saved delivery's district is the starting point. */
function initialLocation(options: CheckoutDeliveryOptions, saved: PublicCheckoutResponse["delivery"]) {
  const mode: Draft["mode"] = saved ? "keep" : options.home.offered ? "home" : options.agency.offered ? "agency" : options.store.enabled ? "store" : "";
  const savedCode = saved && "destination" in saved && "districtCode" in saved.destination ? saved.destination.districtCode : null;
  const start: PeruArea | null = savedCode && getPeruDistrict(savedCode) ? { kind: "district", code: getPeruDistrict(savedCode)!.code } : null;
  const places = mode === "home" && options.home.offered ? options.home.places : mode === "agency" && options.agency.offered ? options.agency.places : null;
  const step: LocationStep = places ? enterLocationMethod(places, start) : { location: start, notice: { kind: "none" } };
  return { mode, location: step.location, notice: step.notice };
}

export function CheckoutDeliveryFields({ orderId, checkout, options, recipient, onChange, recoveryVersion = 0, disabled = false }: Readonly<{
  orderId: string; checkout: PublicCheckoutResponse; options: CheckoutDeliveryOptions;
  /** Who receives the order: the buyer, or whoever «Otra persona recibe el pedido» names. */
  recipient: Readonly<{ name: string; phone: string }>;
  onChange: (draft: CheckoutDeliveryDraft | null) => void; recoveryVersion?: number | object; disabled?: boolean;
}>) {
  const { t, i18n } = useTranslation();
  const ready = useClientReady();
  const saved = checkout.delivery;
  const homeEnabled = options.home.offered;
  const agencyEnabled = options.agency.offered;
  const districtRef = useRef<HTMLDivElement>(null);
  // Computed once: the server render already shows the preselected levels, and `defaultValues` would otherwise be evaluated on every render.
  const [initial] = useState(() => initialLocation(options, saved));
  const [notice, setNotice] = useState<LocationNotice>(initial.notice);
  const [inFlight, setInFlight] = useState(false);
  const form = useForm<Draft>({ resolver: zodResolver(draftSchema), defaultValues: {
    mode: initial.mode, location: initial.location, districtSource: "automatic",
    rateId: "", agencyId: "",
    address: saved?.method === "home" ? saved.destination.address : "", instructions: saved?.method === "home" ? saved.destination.instructions ?? "" : "",
    documentType: saved?.recipient.identity.kind === "document" ? saved.recipient.identity.documentType : "national_id",
    document: saved?.recipient.identity.kind === "document" ? saved.recipient.identity.document : "",
  } });
  const draft = useWatch({ control: form.control });
  const [revision, setRevision] = useState(0);
  const [received, setReceived] = useState<Readonly<{ districtCode: string; revision: number; recoveryVersion: number | object; result: Result<QuotationResponse, QuotationRequestError> }> | null>(null);
  const districtCode = draft.location?.kind === "district" ? draft.location.code : null;
  const districtSource = draft.districtSource ?? "automatic";
  const current = received && received.districtCode === districtCode && received.revision === revision && received.recoveryVersion === recoveryVersion ? received.result : null;
  const rates = useMemo(() => current?.success ? current.data.rates : [], [current]);
  const known = districtCode ? getPeruDistrict(districtCode) : null;
  const buyerDistrict = known ? peruDeliveryDistrict(known.code) : null;
  const homeRates = useMemo(() => rates.filter(item => item.method === "home"), [rates]);
  const rate = draft.mode === "home" && homeEnabled ? homeRates.find(item => item.id === draft.rateId) : undefined;
  const choices = useMemo(() => draft.mode === "agency" && districtCode ? agencyChoices(rates, districtCode) : { level: "none" as const }, [draft.mode, districtCode, rates]);
  const choice = draft.mode === "agency" && agencyEnabled ? chosenAgency(choices, draft.agencyId ?? "") : null;
  const quoting = (draft.mode === "home" && homeEnabled) || (draft.mode === "agency" && agencyEnabled);
  // What the page last asked for, so a retry repeats its trigger and a recovery re-quotation (which the buyer did not start) is automatic.
  const lastRequest = useRef<Readonly<{ key: string; trigger: "picked" | "automatic"; recoveryVersion: number | object }> | null>(null);
  useEffect(() => {
    if (!ready || !quoting || !districtCode) { lastRequest.current = null; return; }
    const key = `${draft.mode}:${districtCode}`;
    const last = lastRequest.current;
    const trigger = last && last.recoveryVersion !== recoveryVersion ? "automatic" : last?.key === key ? last.trigger : districtSource;
    lastRequest.current = { key, trigger, recoveryVersion };
    const controller = new AbortController();
    // The loading text comes from this state, so it always lands in an update after the notice's (the design's «Announcements»).
    const request = async () => {
      setInFlight(true);
      const result = await requestDeliveryQuotation({ orderId, districtCode, trigger }, controller.signal);
      if (controller.signal.aborted) return;
      setReceived({ districtCode, revision, recoveryVersion, result });
      setInFlight(false);
    };
    void request();
    return () => { controller.abort(); setInFlight(false); };
  }, [ready, quoting, draft.mode, districtCode, districtSource, orderId, revision, recoveryVersion]);
  const prepared = useMemo<CheckoutDeliveryDraft | null>(() => {
    if (draft.mode === "keep") return saved ? { delivery: { kind: "keep" }, price: checkout.deliveryCharge } : null;
    const identity = draft.mode === "agency" || draft.document?.trim()
      ? { kind: "document", documentType: draft.documentType, document: draft.document }
      : { kind: "absent" };
    const recipientData = { name: recipient.name, phone: recipient.phone, identity };
    const price: Money | undefined = draft.mode === "store" && options.store.enabled ? { amount: 0, currency: checkout.total.currency } : draft.mode === "agency" ? choice?.price : rate?.price;
    const selection = draft.mode === "store" ? { method: "store", recipient: recipientData } : draft.mode === "home"
      ? { method: "home", rateId: rate?.id, recipient: recipientData, destination: { districtCode, address: draft.address, instructions: draft.instructions?.trim() || null } }
      : { method: "agency", rateId: choice?.rateId, recipient: recipientData, districtCode, agencyId: choice?.agency.id };
    const parsed = checkoutDeliveryChangeSchema.safeParse({ kind: "replace", selection, expectedPrice: price });
    return price && parsed.success ? { delivery: parsed.data, price } : null;
  }, [draft.mode, recipient.name, recipient.phone, draft.documentType, draft.document, districtCode, draft.address, draft.instructions,
    rate, choice, saved, checkout.deliveryCharge, checkout.total.currency, options.store.enabled]);
  useEffect(() => onChange(prepared), [prepared, onChange]);
  const amount = (price: Money) => price.amount === 0 ? t("checkoutDelivery.free") : formatCurrency(price.amount, price.currency, i18n.language);
  const placesOf = (mode: Draft["mode"]) => mode === "home" && options.home.offered ? options.home.places : mode === "agency" && options.agency.offered ? options.agency.places : undefined;
  const places = placesOf(draft.mode ?? "");
  const applyStep = (step: Readonly<{ location: PeruArea | null; notice: LocationNotice }>) => {
    form.setValue("location", step.location); form.setValue("districtSource", "automatic"); setNotice(step.notice);
  };
  // One handler writes mode, location and notice together, so the quotation never sees the new method with the old district.
  const changeMode = (mode: Draft["mode"]) => {
    const entered = placesOf(mode);
    if (entered) applyStep(enterLocationMethod(entered, form.getValues("location"))); else setNotice({ kind: "none" });
    form.setValue("mode", mode); form.setValue("rateId", ""); form.setValue("agencyId", ""); setReceived(null);
  };
  const changeLocation = (next: PeruArea | null, level: "department" | "province" | "district") => {
    if (places && next && isNewUpperLevel(form.getValues("location"), next, level)) applyStep(chooseUpperLevel(places, next));
    else { form.setValue("location", next); form.setValue("districtSource", level === "district" && next?.kind === "district" ? "picked" : "automatic"); setNotice({ kind: "none" }); }
    form.setValue("rateId", ""); form.setValue("agencyId", "");
  };
  const noticeDistrict = notice.kind === "cleared" ? getPeruDistrict(notice.place.code) : null;
  const noticeParams = { method: draft.mode === "agency" ? t("checkoutDelivery.method.agency") : t("checkoutDelivery.method.home"), district: noticeDistrict ? titleCase(noticeDistrict.name) : "" };
  const noticeText = !ready || notice.kind === "none" ? null : notice.kind === "preselected" ? t("checkoutDelivery.notice.preselected")
    : t(notice.filled === "none" ? "checkoutDelivery.notice.clearedNone" : notice.filled === "partial" ? "checkoutDelivery.notice.clearedPartial" : "checkoutDelivery.notice.clearedComplete", noticeParams);
  const locationTexts = { groupHint: t("checkoutDelivery.locationHint"), noResults: { department: t("checkoutDelivery.noResults.department"), province: t("checkoutDelivery.noResults.province"), district: t("checkoutDelivery.noResults.district") } };
  const changeDistrict = () => (districtRef.current?.querySelector<HTMLInputElement>('input[id$="-district"]:not(:disabled)') ?? districtRef.current?.querySelector<HTMLInputElement>('input[id$="-department"]'))?.focus();
  const input = (name: "address" | "instructions" | "document", label: string, required = false, describedBy?: string) => <Controller key={name} name={name} control={form.control} render={({ field }) =>
    <Field data-store-part="field"><FieldLabel htmlFor={`delivery-${name}`}>{label}</FieldLabel><Input {...field} name={undefined} id={`delivery-${name}`} required={required} type="text" aria-describedby={describedBy} /></Field>} />;
  return <fieldset disabled={disabled || !ready} className="flex min-w-0 flex-col gap-4">
    <legend data-store-part="section-title" className="mb-4 text-lg font-semibold">{t("checkoutDelivery.title")}</legend>
    {!saved && !homeEnabled && !agencyEnabled && !options.store.enabled ? <p role="status" className="rounded-[var(--radius-control)] bg-muted p-4 text-sm text-muted-foreground">{t("checkoutDelivery.noModes")}</p>
      : <Controller name="mode" control={form.control} render={({ field }) => <div role="radiogroup" aria-labelledby="delivery-mode-label" className="flex flex-col gap-2">
        <span id="delivery-mode-label" data-slot="label" className="text-sm font-medium">{t("checkoutDelivery.mode")}</span>
        <div data-store-part="option-group" className="flex flex-col divide-y overflow-hidden rounded-[var(--radius-control)] border border-input">
          {([saved && ["keep", t("checkoutDelivery.keep")], homeEnabled && ["home", t("checkoutDelivery.method.home")], agencyEnabled && ["agency", t("checkoutDelivery.method.agency")], options.store.enabled && ["store", t("checkoutDelivery.storeFree")]]
            .filter((option): option is [Draft["mode"], string] => Boolean(option))).map(([value, label]) =>
            <label key={value} data-store-part="option" className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3 transition-colors has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring">
              <input type="radio" data-slot="radio-group-item" name={field.name} value={value} checked={field.value === value} onBlur={field.onBlur} className="size-4 accent-[var(--accent-strong,var(--primary))]" onChange={() => changeMode(value)} /><span className="font-medium">{label}</span>
            </label>)}
        </div>
      </div>} />}
    {/* Always mounted and empty in the server HTML: a live region is announced reliably only when its text arrives after it. Margins cancel the fieldset gap while empty. */}
    <div role="status" aria-live="polite" className="-mb-4 min-w-0">
      {noticeText && <p className={`mb-4 text-sm text-muted-foreground ${notice.kind === "cleared" ? "rounded-[var(--radius-control)] bg-muted p-4" : ""}`}>{noticeText}</p>}
    </div>
    {draft.mode === "keep" && saved && <div className="space-y-1 rounded-[var(--radius-control)] bg-muted p-4 text-sm"><p className="font-medium">{t(`checkoutDelivery.method.${saved.method}`)} · {amount(checkout.deliveryCharge)}</p>
      <p>{saved.method === "home" ? `${saved.destination.address}, ${saved.destination.district}` : saved.method === "store" ? saved.pickupPoint.address : `${saved.courier.name} · ${saved.agency.name} · ${saved.agency.address}`}</p><p>{t("checkoutDelivery.receives", { name: recipient.name, phone: recipient.phone })}</p><p className="text-muted-foreground">{t("checkoutDelivery.kept")}</p></div>}
    {draft.mode === "store" && options.store.enabled && <div className="space-y-1 rounded-[var(--radius-control)] bg-muted p-4 text-sm"><p className="font-medium">{options.store.pickupPoint.name} · {t("checkoutDelivery.free")}</p><p>{options.store.pickupPoint.address}</p>{options.store.pickupPoint.instructions && <p>{options.store.pickupPoint.instructions}</p>}</div>}
    {quoting && <div ref={districtRef}><PeruLocationFields themed value={(draft.location ?? null) as PeruArea | null} places={places} texts={locationTexts} disabled={disabled} onChange={changeLocation} /></div>}
    <div role="status" aria-live="polite" className="-mb-4 min-w-0">{inFlight && <p className="mb-4 text-sm text-muted-foreground">{t("checkoutDelivery.loading")}</p>}</div>
    {quoting && <>
      {current && !current.success && <div className="flex flex-col items-start gap-2"><p role="alert" className="text-sm text-[var(--error)]">{t("checkoutDelivery.ratesError")}</p><Button type="button" variant="outline" onClick={() => setRevision(value => value + 1)}>{t("checkoutDelivery.retry")}</Button></div>}
      {draft.mode === "home" && current?.success && homeRates.length === 0 && <p role="status" className="rounded-[var(--radius-control)] bg-muted p-4 text-sm text-muted-foreground">{t(options.store.enabled ? "checkoutDelivery.noRatesOrStore" : "checkoutDelivery.noRates")}</p>}
      {draft.mode === "home" && homeRates.length > 0 && <Controller name="rateId" control={form.control} render={({ field }) => <div data-store-part="field-group" className="flex flex-col gap-4"><Field data-store-part="field"><FieldLabel htmlFor="delivery-rate">{t("checkoutDelivery.rate")}</FieldLabel><select id="delivery-rate" data-slot="select" className={controlClass} value={field.value} onBlur={field.onBlur} onChange={field.onChange}>
        <option value="">{t("checkoutDelivery.selectRate")}</option>{homeRates.map(item => <option key={item.id} value={item.id}>{rateLabel(item, homeRates)} · {amount(item.price)}</option>)}</select></Field></div>} />}
      {draft.mode === "agency" && current?.success && buyerDistrict && <CheckoutAgencyDestination choices={choices} buyerDistrict={buyerDistrict} value={draft.agencyId ?? ""} homeOffered={homeEnabled} disabled={disabled}
        onChange={agencyId => form.setValue("agencyId", agencyId)} onChangeDistrict={changeDistrict} onSwitchToHome={() => changeMode("home")} amount={amount} />}
    </>}
    {draft.mode && draft.mode !== "keep" && <div data-store-part="field-group" className="flex flex-col gap-4">
      {rate && <>{input("address", t("checkoutDelivery.address"), true)}{input("instructions", t("checkoutDelivery.instructions"))}</>}
      {draft.mode === "agency" && <><Controller name="documentType" control={form.control} render={({ field }) => <Field data-store-part="field"><FieldLabel htmlFor="delivery-document-type">{t("checkoutRecipient.documentType")}</FieldLabel><select id="delivery-document-type" data-slot="select" className={controlClass} value={field.value} onChange={field.onChange} onBlur={field.onBlur}><option value="national_id">{t("checkoutDelivery.documentTypes.national_id")}</option><option value="passport">{t("checkoutDelivery.documentTypes.passport")}</option><option value="foreign_id">{t("checkoutDelivery.documentTypes.foreign_id")}</option></select></Field>} />{input("document", t("checkoutRecipient.document"), true, "delivery-document-hint")}<p id="delivery-document-hint" className="-mt-2 text-sm text-muted-foreground">{t("checkoutRecipient.documentHint")}</p></>}
    </div>}
  </fieldset>;
}
