import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { checkoutBuyerSchema, type PublicCheckoutResponse, type ConfirmCheckoutRequest } from "@shared/contracts/order-checkout";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { deliveryDraft, deliveryRequest } from "@core/src/features/orders/presentation/delivery-form";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldError, FieldLabel, controlClass } from "@core/app/components/ui/field";

export function DeliverySummary({ delivery, buyer }: { delivery: PublicCheckoutResponse["delivery"]; buyer?: PublicCheckoutResponse["buyer"] }) {
  if (!delivery) return <p className="text-muted-foreground">Coordina la entrega con la tienda.</p>;
  return <div className="space-y-1 break-words text-sm"><p className="font-medium">{delivery.method === "home" ? "A domicilio" : delivery.method === "store" ? "Retiro en tienda" : `Agencia · ${delivery.courier.name}`}</p>
    {delivery.method === "home" ? <><p>{delivery.destination.address}</p><p>{delivery.destination.district}</p>{delivery.destination.instructions && <p>{delivery.destination.instructions}</p>}</>
      : delivery.method === "store" ? <><p>{delivery.pickupPoint.name} · {delivery.pickupPoint.address}</p>{delivery.pickupPoint.instructions && <p>{delivery.pickupPoint.instructions}</p>}</> : <p>{delivery.agency}</p>}
    {(delivery.recipient.name !== buyer?.name || delivery.recipient.phone !== buyer?.phone) && <p className="text-muted-foreground">Recibe {delivery.recipient.name} · {delivery.recipient.phone}</p>}
    {delivery.recipient.identity.kind === "document" && <p className="text-muted-foreground">Documento: {delivery.recipient.identity.document}</p>}
  </div>;
}

const draftSchema = z.object({ name: z.string(), phone: z.string(), documentType: z.enum(["absent", "national_id", "passport", "foreign_id"]), document: z.string(),
  charge: z.boolean(), method: z.enum(["home", "agency", "store"]), courierId: z.string(), agency: z.string(), address: z.string(), district: z.string(), instructions: z.string() });
const schema = z.object({ buyer: checkoutBuyerSchema, delivery: draftSchema, changeDelivery: z.boolean(), sameRecipient: z.boolean() }).superRefine((value, ctx) => {
  if (!value.changeDelivery) return;
  const parsed = deliveryRequest({ ...value.delivery, ...(value.sameRecipient ? value.buyer : {}) });
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const last = issue.path.at(-1);
    const field = last === "name" || last === "phone" || last === "document" || last === "documentType" || last === "courierId" || last === "agency" || last === "address" || last === "district" || last === "instructions" ? last : "documentType";
    ctx.addIssue({ code: "custom", path: ["delivery", field], message: "Completa este dato para la entrega." });
  }
});
type Values = z.infer<typeof schema>;

export function CheckoutForm({ checkout, settings, pending, message, onConfirm, onDeliveryChange }: { checkout: PublicCheckoutResponse; settings: DeliverySettingsResponse; pending: boolean; message?: string | null; onDeliveryChange: (changing: boolean) => void; onConfirm: (input: ConfirmCheckoutRequest) => void }) {
  const enabled = settings.home.enabled || settings.store.enabled || settings.agency.enabled;
  const [editBuyer, setEditBuyer] = useState(!checkout.buyer?.name || !checkout.buyer?.phone);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { buyer: { name: checkout.buyer?.name ?? "", phone: checkout.buyer?.phone ?? "" },
    delivery: deliveryDraft({ buyer: checkout.buyer ? { ...checkout.buyer, contactId: null } : null,
      delivery: checkout.delivery ? { ...checkout.delivery, recordedBy: { kind: "buyer" } } : null,
      deliveryCharge: checkout.deliveryCharge ?? { amount: 0, currency: checkout.total.currency } }, settings),
    changeDelivery: !checkout.delivery && enabled,
    sameRecipient: !checkout.delivery || (checkout.delivery.recipient.name === checkout.buyer?.name && checkout.delivery.recipient.phone === checkout.buyer?.phone) } });
  const value = useWatch({ control: form.control }) as Values;
  const text = (name: "buyer.name" | "buyer.phone" | `delivery.${"name" | "phone" | "document" | "agency" | "address" | "district" | "instructions"}`, label: string, autoComplete?: string) => <Controller key={name} name={name} control={form.control} render={({ field, fieldState }) => {
    const error = fieldState.error ? name === "buyer.name" ? "Ingresa tu nombre." : name === "buyer.phone" ? "Ingresa un teléfono con código de país, por ejemplo +51987654321." : fieldState.error.message : null;
    const errorId = name === "buyer.phone" ? "phone-error" : `${name}-error`;
    return <Field data-invalid={!!error}><FieldLabel htmlFor={name}>{label}</FieldLabel><Input {...field} id={name} autoComplete={autoComplete} type={name.endsWith("phone") ? "tel" : "text"} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} />{error && <FieldError id={errorId}>{error}</FieldError>}</Field>;
  }} />;
  const select = (name: "delivery.courierId" | "delivery.documentType", label: string, options: { value: string; label: string }[]) => <Controller name={name} control={form.control} render={({ field, fieldState }) => <Field><FieldLabel htmlFor={name}>{label}</FieldLabel><select {...field} id={name} className={controlClass} aria-invalid={!!fieldState.error}><option value="">Selecciona una opción</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}</Field>} />;
  return <form id="checkout-form" noValidate onSubmit={form.handleSubmit(values => {
    const delivery = values.changeDelivery ? deliveryRequest({ ...values.delivery, ...(values.sameRecipient ? values.buyer : {}) }) : null;
    if (delivery && !delivery.success) return;
    onConfirm({ buyer: values.buyer, expectedTotal: checkout.total, ...(delivery?.success ? { delivery: delivery.data.delivery } : {}) });
  }, () => setEditBuyer(true))} className="flex flex-col">
    <fieldset disabled={pending} className="min-w-0 space-y-4">
      <section className="space-y-4 rounded-lg border bg-card p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Tus datos</h2><Button type="button" variant="ghost" size="sm" aria-expanded={editBuyer} onClick={() => setEditBuyer(!editBuyer)}>{editBuyer ? "Listo" : "Editar"}</Button></div>
        {editBuyer ? <div className="grid gap-4 sm:grid-cols-2">{text("buyer.name", "Nombre", "name")}{text("buyer.phone", "Teléfono", "tel")}<p className="text-sm text-muted-foreground sm:col-span-2">Incluye el código de país, por ejemplo +51987654321.</p></div> : <div className="space-y-1 text-sm"><p className="font-medium">{value.buyer.name}</p><p className="text-muted-foreground">{value.buyer.phone}</p></div>}
      </section>
      <section className="space-y-4 rounded-lg border bg-card p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Entrega</h2>{enabled && checkout.delivery && <Button type="button" variant="ghost" size="sm" aria-expanded={value.changeDelivery} onClick={() => { form.setValue("changeDelivery", !value.changeDelivery); onDeliveryChange(!value.changeDelivery); }}>{value.changeDelivery ? "Conservar entrega" : "Cambiar"}</Button>}</div>
        {!value.changeDelivery ? <DeliverySummary delivery={checkout.delivery} /> : <div className="space-y-4">
          <Controller name="delivery.method" control={form.control} render={({ field }) => <fieldset className="flex flex-wrap gap-2"><legend className="sr-only">Forma de entrega</legend>{([['home', 'A domicilio'], ['store', 'Retiro en tienda'], ['agency', 'Agencia']] as const).filter(([method]) => settings[method].enabled).map(([method, label]) => <label key={method} className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent"><input type="radio" name={field.name} value={method} checked={field.value === method} onChange={() => { field.onChange(method); if (method === "agency" && form.getValues("delivery.documentType") === "absent") form.setValue("delivery.documentType", "national_id"); }} className="accent-primary" />{label}</label>)}</fieldset>} />
          {value.delivery.method === "home" ? <div className="grid gap-4">{text("delivery.address", "Dirección", "street-address")}{text("delivery.district", "Distrito / ciudad", "address-level2")}{text("delivery.instructions", "Referencia (opcional)")}</div>
            : value.delivery.method === "store" ? <p className="text-sm">{settings.store.pickupPoint?.name} · {settings.store.pickupPoint?.address}<br />{settings.store.pickupPoint?.instructions}</p>
              : <>{select("delivery.courierId", "Courier", settings.couriers.filter(courier => courier.enabled).map(courier => ({ value: courier.id, label: courier.name })))}{text("delivery.agency", "Agencia de destino")}</>}
          <Controller name="sameRecipient" control={form.control} render={({ field }) => <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={field.value} onChange={event => field.onChange(event.target.checked)} className="accent-primary" />Yo recibiré el pedido</label>} />
          {!value.sameRecipient && <div className="grid gap-4 sm:grid-cols-2">{text("delivery.name", "Nombre de quien recibe")}{text("delivery.phone", "Teléfono de quien recibe")}</div>}
          {(value.delivery.method === "agency" || value.delivery.documentType !== "absent") && <div className="grid gap-4 sm:grid-cols-2">{select("delivery.documentType", "Tipo de documento", [{ value: "national_id", label: "DNI" }, { value: "foreign_id", label: "Carné de extranjería" }, { value: "passport", label: "Pasaporte" }])}{text("delivery.document", "Número de documento")}</div>}
          <p className="rounded-md bg-muted p-3 text-sm">La tienda confirmará el costo de esta entrega antes de habilitar el pago.</p>
        </div>}
      </section>
      <section className="space-y-3 rounded-lg border bg-card p-5"><h2 className="text-lg font-semibold">Pago</h2><p className="text-sm text-muted-foreground">{value.changeDelivery ? "Primero enviaremos tu entrega a la tienda para que confirme el costo." : "Al confirmar, verás los medios de pago disponibles y podrás adjuntar tu comprobante."}</p></section>
    </fieldset>
    {message && <p role="alert" className="mt-4 text-sm text-destructive">{message}</p>}

  </form>;
}
