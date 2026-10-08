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
import { useClientReady } from "@core/app/use-client-ready";
import { formatCurrency } from "@core/app/format-currency";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldLabel, FieldError, controlClass } from "@core/app/components/ui/field";

const draftSchema = z.object({ method: z.enum(["home", "agency", "store"]), districtCode: z.string().nullable(), rateId: z.string(),
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
    rateId: "", name: saved?.recipient.name ?? order.buyer?.name ?? "", phone: saved?.recipient.phone ?? order.buyer?.phone ?? "",
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
      : { method: "agency", recipient, rateId: rate?.id, districtCode: draft.districtCode };
    const request = setRatedOrderDeliverySchema.safeParse({ delivery: selection, expectedPrice: price });
    return { request: enabled && request.success ? request.data : null, price: enabled ? price ?? null : null };
  }, [draft.method, draft.name, draft.phone, draft.documentType, draft.document, draft.districtCode, draft.address, draft.instructions, rate, enabled, order.total.currency]);
  useEffect(() => { onChange?.(review); }, [onChange, review]);
  const { request, price } = review;
  const total = price ? add(price)(order.itemsTotal) : null;
  const input = (name: "name" | "phone" | "address" | "instructions" | "document", label: string, required = false) => <Controller key={name} name={name} control={form.control} render={({ field, fieldState }) =>
    <Field data-invalid={fieldState.invalid}><FieldLabel htmlFor={`rated-${name}`}>{label}</FieldLabel><Input {...field} id={`rated-${name}`} required={required} aria-invalid={fieldState.invalid} type={name === "phone" ? "tel" : "text"} />{fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}</Field>} />;
  const fields = <fieldset disabled={pending || !ready || !active} className="flex min-w-0 flex-col gap-4">
    <legend className="mb-3 text-lg font-semibold">{t("orderDelivery.assign")}</legend>
    <Controller name="method" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="rated-method">{t("orderDelivery.method")}</FieldLabel><select id="rated-method" className={controlClass} value={enabled ? field.value : ""} onBlur={field.onBlur} onChange={event => {
      field.onChange(event); form.setValue("rateId", ""); setRevision(value => value + 1);
    }}><option value="" disabled>{t("orderDelivery.chooseMethod")}</option>{(["store", "home", "agency"] as const).filter(method => settings[method].enabled).map(method => <option key={method} value={method}>{t(`deliverySettings.${method}`)}</option>)}</select></Field>} />
    {draft.method === "store" && settings.store.pickupPoint && <p>{settings.store.pickupPoint.name} · {settings.store.pickupPoint.address}{settings.store.pickupPoint.instructions && <> · {settings.store.pickupPoint.instructions}</>}</p>}
    {draft.method !== "store" && <>
      <PeruDistrictSelect value={draft.districtCode ? getPeruDistrict(draft.districtCode)?.code ?? null : null} onChange={code => { form.setValue("districtCode", code); form.setValue("rateId", ""); setRevision(value => value + 1); }} />
      {enabled && draft.districtCode && !current && <p role="status">{t("orderDelivery.quoting")}</p>}
      {current && !current.quotation && <div><p role="alert">{t("orderDelivery.quoteError")}</p><Button type="button" variant="outline" onClick={() => setRevision(value => value + 1)}>{t("orderDelivery.retryRates")}</Button></div>}
      {current?.quotation && rates.length === 0 && <p role="status">{t("orderDelivery.noRates")}</p>}
      {rates.length > 0 && <Controller name="rateId" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="rated-rate">{t("orderDelivery.rate")}</FieldLabel><select {...field} value={rate ? field.value : ""} id="rated-rate" className={controlClass}><option value="">{t("orderDelivery.chooseRate")}</option>{rates.map((item, index) => <option key={item.id} value={item.id}>{t(`deliverySettings.${item.method}`)} · {formatCurrency(item.price.amount, item.price.currency, i18n.language)} · {index + 1}</option>)}</select></Field>} />}
    </>}
    {input("name", t("orderDelivery.recipientName"), true)}{input("phone", t("orderDelivery.recipientPhone"), true)}
    {draft.method === "home" && <>{input("address", t("orderDelivery.address"), true)}{input("instructions", t("orderDelivery.instructions"))}</>}
    <Controller name="documentType" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="rated-document-type">{t(draft.method === "agency" ? "orderDelivery.identityRequired" : "orderDelivery.identity")}</FieldLabel><select {...field} id="rated-document-type" className={controlClass}><option value="absent">{t("orderDelivery.noDocument")}</option>{(["national_id", "passport", "foreign_id"] as const).map(type => <option key={type} value={type}>{t(`orders.documentType.${type}`)}</option>)}</select></Field>} />
    {draft.documentType !== "absent" && input("document", t("orderDelivery.document"), true)}
    {price && <p>{t("orderDelivery.cost", { amount: formatCurrency(price.amount, price.currency, i18n.language) })}</p>}
    {total?.success && <p className="font-semibold">Total: {formatCurrency(total.data.amount, total.data.currency, i18n.language)}</p>}
  </fieldset>;
  if (onChange) return fields;
  return <form className="flex max-w-form flex-col gap-4" onSubmit={form.handleSubmit(() => {
    if (ready && enabled && request && total?.success) submit(request, { method: "post", encType: "application/json" });
  })}>{fields}<Button type="submit" disabled={pending || !ready || !enabled || !request || !total?.success}>{t(pending ? "deliverySettings.saving" : "orderDelivery.save")}</Button></form>;
}
