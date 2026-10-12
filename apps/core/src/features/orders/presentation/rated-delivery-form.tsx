import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSubmit } from "react-router";
import { useTranslation } from "react-i18next";
import { setRatedOrderDeliverySchema, type OrderAggregateResponse, type SetRatedOrderDeliveryRequest } from "@shared/contracts/orders";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import type { QuotationResponse } from "@shared/contracts/quotations";
import { add, type Money } from "@shared/money";
import { getPeruDistrict } from "@shared/peru-geography";
import { requestDeliveryQuotation } from "@core/src/features/delivery-settings/infrastructure/quotation-api";
import { PeruDistrictSelect } from "@core/app/components/peru-district-select";
import { agencyLabel, rateLabel } from "@core/app/rate-label";
import { useClientReady } from "@core/app/use-client-ready";
import { formatCurrency } from "@core/app/format-currency";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldLabel, FieldError, FieldLegend, FieldSet } from "@core/app/components/ui/field";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/app/components/ui/select";

const draftSchema = z.object({ method: z.enum(["home", "agency", "store"]), districtCode: z.string().nullable(), rateId: z.string(), agencyId: z.string(),
  name: z.string().trim().min(1), phone: z.string().trim().min(1), address: z.string().max(500), instructions: z.string().max(1000),
  documentType: z.enum(["absent", "national_id", "passport", "foreign_id"]), document: z.string() });
type Draft = z.infer<typeof draftSchema>;

export type RatedDeliveryReview = Readonly<{ request: SetRatedOrderDeliveryRequest | null; price: Money | null }>;

export function RatedDeliveryForm({ order, settings, pending, active, recovery, onChange }: Readonly<{
  order: Pick<OrderAggregateResponse, "delivery" | "buyer" | "itemsTotal" | "total"> & { id?: string }; settings: DeliverySettingsResponse; pending: boolean; active: boolean; recovery?: object; onChange?: (review: RatedDeliveryReview) => void;
}>) {
  const { t, i18n } = useTranslation();
  const submit = useSubmit();
  const ready = useClientReady();
  const saved = order.delivery;
  const form = useForm<Draft>({ resolver: zodResolver(draftSchema), defaultValues: {
    method: saved?.method ?? (settings.store.enabled ? "store" : settings.home.enabled ? "home" : "agency"),
    districtCode: saved && "pricing" in saved && saved.pricing && "destination" in saved ? saved.destination.districtCode : null,
    rateId: "", agencyId: "", name: saved?.recipient.name ?? order.buyer?.name ?? "", phone: saved?.recipient.phone ?? order.buyer?.phone ?? "",
    address: saved?.method === "home" ? saved.destination.address : "", instructions: saved?.method === "home" ? saved.destination.instructions ?? "" : "",
    documentType: saved?.recipient.identity.kind === "document" ? saved.recipient.identity.documentType : "absent",
    document: saved?.recipient.identity.kind === "document" ? saved.recipient.identity.document : "",
  } });
  const draft = useWatch({ control: form.control });
  const [revision, setRevision] = useState(0);
  const [received, setReceived] = useState<{ key: string; recovery?: object; quotation: QuotationResponse | null } | null>(null);
  const key = JSON.stringify([order.id, draft.method, draft.districtCode, revision, settings.version]);
  const current = received?.key === key && received.recovery === recovery ? received : null;
  const rates = current?.quotation?.rates.filter(rate => rate.method === draft.method) ?? [];
  const rate = rates.find(rate => rate.id === draft.rateId);
  const agencies = rate?.method === "agency" ? rate.agencies : [];
  const enabled = draft.method !== undefined && settings[draft.method].enabled;
  useEffect(() => {
    if (current || !active || !enabled || draft.method === "store" || !draft.districtCode) return;
    const controller = new AbortController();
    void requestDeliveryQuotation({ districtCode: draft.districtCode }, controller.signal).then(result => {
      if (!controller.signal.aborted) setReceived({ key, recovery, quotation: result.success ? result.data : null });
    });
    return () => controller.abort();
  }, [active, enabled, draft.method, draft.districtCode, key, recovery, current]);
  const review = useMemo<RatedDeliveryReview>(() => {
    const price = draft.method === "store" && enabled ? { amount: 0, currency: order.total.currency } : rate?.price;
    const recipient = { name: draft.name, phone: draft.phone, identity: draft.documentType === "absent" ? { kind: "absent" }
      : { kind: "document", documentType: draft.documentType, document: draft.document } };
    const selection = draft.method === "store" ? { method: "store", recipient } : draft.method === "home"
      ? { method: "home", recipient, rateId: rate?.id, destination: { districtCode: draft.districtCode, address: draft.address, instructions: draft.instructions?.trim() || null } }
      : { method: "agency", recipient, rateId: rate?.id, districtCode: draft.districtCode, agencyId: draft.agencyId };
    const request = setRatedOrderDeliverySchema.safeParse({ delivery: selection, expectedPrice: price });
    return { request: enabled && request.success ? request.data : null, price: enabled ? price ?? null : null };
  }, [draft.method, draft.name, draft.phone, draft.documentType, draft.document, draft.districtCode, draft.address, draft.instructions, draft.agencyId, rate, enabled, order.total.currency]);
  useEffect(() => { onChange?.(review); }, [onChange, review]);
  const { request, price } = review;
  const total = price ? add(price)(order.itemsTotal) : null;
  const input = (name: "name" | "phone" | "address" | "instructions" | "document", label: string, required = false) => <Controller key={name} name={name} control={form.control} render={({ field, fieldState }) =>
    <Field data-invalid={fieldState.invalid}><FieldLabel htmlFor={`rated-${name}`}>{label}</FieldLabel><Input {...field} id={`rated-${name}`} required={required} aria-invalid={fieldState.invalid} type={name === "phone" ? "tel" : "text"} />{fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}</Field>} />;
  const methodItems = (["store", "home", "agency"] as const).filter(method => settings[method].enabled).map(method => ({ value: method, label: t(`deliverySettings.${method}`) }));
  const documentItems = [{ value: "absent", label: t("orderDelivery.noDocument") }, ...(["national_id", "passport", "foreign_id"] as const).map(type => ({ value: type, label: t(`orders.documentType.${type}`) }))];
  const fields = <FieldSet disabled={pending || !ready || !active} className="flex min-w-0 flex-col gap-4">
    <FieldLegend className="mb-3">{t("orderDelivery.assign")}</FieldLegend>
    <Controller name="method" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="rated-method">{t("orderDelivery.method")}</FieldLabel>
      <Select name={field.name} items={methodItems} value={enabled ? field.value : null} onValueChange={value => {
        field.onChange(value); form.setValue("rateId", ""); form.setValue("agencyId", ""); setRevision(revision => revision + 1);
      }}><SelectTrigger id="rated-method" onBlur={field.onBlur}><SelectValue placeholder={t("orderDelivery.chooseMethod")} /></SelectTrigger>
        <SelectContent>{methodItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>} />
    {draft.method === "store" && settings.store.pickupPoint && <p>{settings.store.pickupPoint.name} · {settings.store.pickupPoint.address}{settings.store.pickupPoint.instructions && <> · {settings.store.pickupPoint.instructions}</>}</p>}
    {draft.method !== "store" && <>
      <PeruDistrictSelect value={draft.districtCode ? getPeruDistrict(draft.districtCode)?.code ?? null : null} onChange={code => { form.setValue("districtCode", code); form.setValue("rateId", ""); form.setValue("agencyId", ""); setRevision(value => value + 1); }} />
      {enabled && draft.districtCode && !current && <Alert><AlertDescription>{t("orderDelivery.quoting")}</AlertDescription></Alert>}
      {current && !current.quotation && <Alert variant="destructive"><AlertDescription>{t("orderDelivery.quoteError")}</AlertDescription><Button type="button" variant="outline" onClick={() => setRevision(value => value + 1)}>{t("orderDelivery.retryRates")}</Button></Alert>}
      {current?.quotation && rates.length === 0 && <Alert><AlertDescription>{t("orderDelivery.noRates")}</AlertDescription></Alert>}
      {rates.length > 0 && <Controller name="rateId" control={form.control} render={({ field }) => { const rateItems = rates.map(item => ({ value: item.id, label: `${rateLabel(item, rates)} · ${item.price.amount === 0 ? t("deliveryZones.free") : formatCurrency(item.price.amount, item.price.currency, i18n.language)}` })); return <Field><FieldLabel htmlFor="rated-rate">{t("orderDelivery.rate")}</FieldLabel>
        <Select name={field.name} items={rateItems} value={rate ? field.value : null} onValueChange={value => {
          field.onChange(value);
          const chosen = rates.find(item => item.id === value);
          form.setValue("agencyId", chosen?.method === "agency" && chosen.agencies.length === 1 ? chosen.agencies[0].id : "");
        }}><SelectTrigger id="rated-rate" onBlur={field.onBlur}><SelectValue placeholder={t("orderDelivery.chooseRate")} /></SelectTrigger>
          <SelectContent>{rateItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>; }} />}
      {agencies.length > 0 && <Controller name="agencyId" control={form.control} render={({ field }) => { const agencyItems = agencies.map(item => ({ value: item.id, label: agencyLabel(item) })); return <Field><FieldLabel htmlFor="rated-agency">{t("orderDelivery.agency")}</FieldLabel>
        <Select name={field.name} items={agencyItems} value={agencies.some(item => item.id === field.value) ? field.value : null} onValueChange={field.onChange}><SelectTrigger id="rated-agency" onBlur={field.onBlur}><SelectValue placeholder={t("orderDelivery.chooseAgency")} /></SelectTrigger>
          <SelectContent>{agencyItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>; }} />}
    </>}
    {input("name", t("orderDelivery.recipientName"), true)}{input("phone", t("orderDelivery.recipientPhone"), true)}
    {draft.method === "home" && <>{input("address", t("orderDelivery.address"), true)}{input("instructions", t("orderDelivery.instructions"))}</>}
    <Controller name="documentType" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="rated-document-type">{t(draft.method === "agency" ? "orderDelivery.identityRequired" : "orderDelivery.identity")}</FieldLabel>
      <Select name={field.name} items={documentItems} value={field.value} onValueChange={field.onChange}><SelectTrigger id="rated-document-type" onBlur={field.onBlur}><SelectValue /></SelectTrigger>
        <SelectContent>{documentItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>} />
    {draft.documentType !== "absent" && input("document", t("orderDelivery.document"), true)}
    {price && <p>{price.amount === 0 ? t("deliveryZones.free") : t("orderDelivery.cost", { amount: formatCurrency(price.amount, price.currency, i18n.language) })}</p>}
    {total?.success && <p className="font-semibold">Total: {formatCurrency(total.data.amount, total.data.currency, i18n.language)}</p>}
  </FieldSet>;
  if (onChange) return fields;
  return <form className="flex max-w-form flex-col gap-4" onSubmit={form.handleSubmit(() => {
    if (ready && enabled && request && total?.success) submit(request, { method: "post", encType: "application/json" });
  })}>{fields}<Button type="submit" disabled={pending || !ready || !enabled || !request || !total?.success}>{t(pending ? "deliverySettings.saving" : "orderDelivery.save")}</Button></form>;
}
