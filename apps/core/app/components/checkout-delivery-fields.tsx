import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@core/app/components/ui/input";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel, controlClass } from "@core/app/components/ui/field";
import { PeruDistrictSelect } from "@core/app/components/peru-district-select";
import { formatCurrency } from "@core/app/format-currency";
import { getPeruDistrict } from "@shared/peru-geography";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import { checkoutDeliveryChangeSchema, type CheckoutDeliveryOptions, type ConfirmCheckoutDeliveryRequest, type PublicCheckoutResponse } from "@shared/contracts/order-checkout";
import type { QuotationResponse } from "@shared/contracts/quotations";
import { requestDeliveryQuotation, type QuotationRequestError } from "@core/src/features/delivery-settings/infrastructure/quotation-api";

const draftSchema = z.object({ mode: z.enum(["keep", "ship", "store"]), districtCode: z.string().nullable(), rateId: z.string(),
  name: z.string(), phone: z.string(), address: z.string(), instructions: z.string(), document: z.string(),
  documentType: z.enum(["national_id", "passport", "foreign_id"]) });
type Draft = z.infer<typeof draftSchema>;
export type CheckoutDeliveryDraft = Readonly<{ delivery: ConfirmCheckoutDeliveryRequest["delivery"]; price: Money }>;

export function CheckoutDeliveryFields({ orderId, checkout, options, onChange, recoveryVersion = 0, disabled = false }: Readonly<{
  orderId: string; checkout: PublicCheckoutResponse; options: CheckoutDeliveryOptions;
  onChange: (draft: CheckoutDeliveryDraft | null) => void; recoveryVersion?: number; disabled?: boolean;
}>) {
  const saved = checkout.delivery;
  const form = useForm<Draft>({ resolver: zodResolver(draftSchema), defaultValues: {
    mode: saved ? "keep" : "ship", districtCode: saved && "destination" in saved && "districtCode" in saved.destination ? saved.destination.districtCode : null,
    rateId: "", name: saved?.recipient.name ?? checkout.buyer?.name ?? "", phone: saved?.recipient.phone ?? checkout.buyer?.phone ?? "",
    address: saved?.method === "home" ? saved.destination.address : "", instructions: saved?.method === "home" ? saved.destination.instructions ?? "" : "",
    documentType: saved?.recipient.identity.kind === "document" ? saved.recipient.identity.documentType : "national_id",
    document: saved?.recipient.identity.kind === "document" ? saved.recipient.identity.document : "",
  } });
  const draft = useWatch({ control: form.control });
  const [revision, setRevision] = useState(0);
  const [received, setReceived] = useState<Readonly<{ districtCode: string; revision: number; recoveryVersion: number; result: Result<QuotationResponse, QuotationRequestError> }> | null>(null);
  const current = received && received.districtCode === draft.districtCode && received.revision === revision && received.recoveryVersion === recoveryVersion ? received.result : null;
  const rates = current?.success ? current.data.rates : [];
  const rate = draft.mode === "ship" ? rates.find(item => item.id === draft.rateId) : undefined;
  useEffect(() => {
    if (draft.mode !== "ship" || !draft.districtCode) return;
    const controller = new AbortController();
    const districtCode = draft.districtCode;
    void requestDeliveryQuotation({ orderId, districtCode }, controller.signal).then(result => {
      if (!controller.signal.aborted) setReceived({ districtCode, revision, recoveryVersion, result });
    });
    return () => controller.abort();
  }, [draft.mode, draft.districtCode, orderId, revision, recoveryVersion]);
  const prepared = useMemo<CheckoutDeliveryDraft | null>(() => {
    if (draft.mode === "keep") return saved ? { delivery: { kind: "keep" }, price: checkout.deliveryCharge } : null;
    const identity = rate?.method === "agency" || draft.document?.trim()
      ? { kind: "document", documentType: draft.documentType, document: draft.document }
      : { kind: "absent" };
    const recipient = { name: draft.name, phone: draft.phone, identity };
    const price: Money | undefined = draft.mode === "store" && options.store.enabled ? { amount: 0, currency: checkout.total.currency } : rate?.price;
    const selection = draft.mode === "store" ? { method: "store", recipient } : rate?.method === "home"
      ? { method: "home", rateId: rate.id, recipient, destination: { districtCode: draft.districtCode, address: draft.address, instructions: draft.instructions?.trim() || null } }
      : { method: "agency", rateId: rate?.id, recipient, districtCode: draft.districtCode };
    const parsed = checkoutDeliveryChangeSchema.safeParse({ kind: "replace", selection, expectedPrice: price });
    return price && parsed.success ? { delivery: parsed.data, price } : null;
  }, [draft.mode, draft.name, draft.phone, draft.documentType, draft.document, draft.districtCode, draft.address, draft.instructions,
    rate, saved, checkout.deliveryCharge, checkout.total.currency, options.store.enabled]);
  useEffect(() => onChange(prepared), [prepared, onChange]);
  const amount = (price: Money) => price.amount === 0 ? "Gratis" : formatCurrency(price.amount, price.currency, "es");
  const input = (name: "name" | "phone" | "address" | "instructions" | "document", label: string, required = false) => <Controller key={name} name={name} control={form.control} render={({ field }) =>
    <Field><FieldLabel htmlFor={`delivery-${name}`}>{label}</FieldLabel><Input {...field} name={undefined} id={`delivery-${name}`} required={required} type={name === "phone" ? "tel" : "text"} /></Field>} />;
  return <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4">
    <legend className="mb-3 text-lg font-semibold">Entrega</legend>
    <Controller name="mode" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="delivery-mode">Forma de entrega</FieldLabel>
      <select id="delivery-mode" className={controlClass} value={field.value} onBlur={field.onBlur} onChange={event => {
        field.onChange(event); form.setValue("rateId", ""); setReceived(null);
      }}>{saved && <option value="keep">Conservar entrega actual</option>}<option value="ship">Envío</option>{options.store.enabled && <option value="store">Recojo en tienda · Gratis</option>}</select>
    </Field>} />
    {draft.mode === "keep" && saved && <div className="space-y-1 text-sm"><p>{saved.method === "home" ? "Entrega a domicilio" : saved.method === "agency" ? "Retiro en agencia" : "Recojo en tienda"} · {amount(checkout.deliveryCharge)}</p>
      <p>{saved.method === "home" ? `${saved.destination.address}, ${saved.destination.district}` : saved.method === "store" ? saved.pickupPoint.address : saved.agency ?? ("destination" in saved ? saved.destination.district : "")}</p><p>Se conserva la entrega y el importe ya asignados.</p></div>}
    {draft.mode === "store" && options.store.enabled && <div className="space-y-1 text-sm"><p className="font-medium">{options.store.pickupPoint.name} · Gratis</p><p>{options.store.pickupPoint.address}</p>{options.store.pickupPoint.instructions && <p>{options.store.pickupPoint.instructions}</p>}</div>}
    {draft.mode === "ship" && <>
      <PeruDistrictSelect value={draft.districtCode ? getPeruDistrict(draft.districtCode)?.code ?? null : null} disabled={disabled} onChange={code => { form.setValue("districtCode", code); form.setValue("rateId", ""); }} />
      {draft.districtCode && !current && <p role="status" className="text-sm text-muted-foreground">Consultando opciones de envío…</p>}
      {current && !current.success && <div><p role="alert">No se pudieron cargar las tarifas. Tus datos siguen aquí.</p><Button type="button" variant="outline" onClick={() => setRevision(value => value + 1)}>Reintentar tarifas</Button></div>}
      {current?.success && rates.length === 0 && <p role="status">No hay opciones de envío para este distrito. Elige otro distrito{options.store.enabled ? " o recojo en tienda" : ""}.</p>}
      {rates.length > 0 && <Controller name="rateId" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="delivery-rate">Tarifa de envío</FieldLabel><select id="delivery-rate" className={controlClass} value={field.value} onBlur={field.onBlur} onChange={field.onChange}>
        <option value="">Selecciona una tarifa</option>{rates.map((item, index) => <option key={item.id} value={item.id}>{item.label} · {amount(item.price)} · Opción {index + 1}</option>)}</select></Field>} />}
    </>}
    {draft.mode !== "keep" && <>
      {input("name", "Nombre del destinatario", true)}{input("phone", "Teléfono del destinatario", true)}
      {rate?.method === "home" && <>{input("address", "Dirección de entrega", true)}{input("instructions", "Indicaciones de entrega")}</>}
      {rate?.method === "agency" && <><Controller name="documentType" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="delivery-document-type">Tipo de documento</FieldLabel><select id="delivery-document-type" className={controlClass} value={field.value} onChange={field.onChange} onBlur={field.onBlur}><option value="national_id">DNI</option><option value="passport">Pasaporte</option><option value="foreign_id">Carné de extranjería</option></select></Field>} />{input("document", "Documento del destinatario", true)}<p className="text-sm text-muted-foreground">La agencia y el courier se asignarán después. No necesitas elegirlos para confirmar.</p></>}
    </>}
  </fieldset>;
}
