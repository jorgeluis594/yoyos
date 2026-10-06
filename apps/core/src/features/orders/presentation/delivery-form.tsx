import { useState } from "react";
import { useClientReady } from "@core/app/use-client-ready";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";
import { setOrderDeliverySchema, type OrderAggregateResponse } from "@shared/contracts/orders";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel, controlClass } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";

export type DeliveryDraft = { name: string; phone: string; documentType: "absent" | "national_id" | "passport" | "foreign_id";
  document: string; charge: boolean; method: "store" | "home" | "agency"; courierId: string; agency: string;
  address: string; district: string; instructions: string };

export function deliveryDraft(order: Pick<OrderAggregateResponse, "delivery" | "buyer" | "deliveryCharge">, settings: DeliverySettingsResponse): DeliveryDraft {
  const recipient = order.delivery?.recipient;
  const destination = order.delivery?.method === "home" ? order.delivery.destination : null;
  return { name: recipient?.name ?? order.buyer?.name ?? "", phone: recipient?.phone ?? order.buyer?.phone ?? "",
    documentType: recipient?.identity.kind === "document" ? recipient.identity.documentType : "absent",
    document: recipient?.identity.kind === "document" ? recipient.identity.document : "",
    charge: order.delivery ? order.deliveryCharge.amount > 0 : false,
    method: order.delivery?.method ?? (settings.store.enabled ? "store" : settings.home.enabled ? "home" : "agency"),
    courierId: order.delivery?.method === "agency" ? order.delivery.courier.id : "",
    agency: order.delivery?.method === "agency" ? order.delivery.agency : "",
    address: destination?.address ?? "", district: destination?.district ?? "", instructions: destination?.instructions ?? "" };
}

export function deliveryRequest(value: DeliveryDraft) {
  const { name, phone, documentType, document, method, courierId, agency, address, district, instructions } = value;
  const recipient = { name, phone, identity: documentType === "absent" ? { kind: "absent" } : { kind: "document", documentType, document } };
  const delivery = method === "agency" ? { method, recipient, courierId, agency } : method === "store" ? { method, recipient }
    : { method, recipient, destination: { address, district, instructions: instructions.trim() || null } };
  return setOrderDeliverySchema.safeParse({ delivery, chargeDeliveryToCustomer: value.charge });
}

export function DeliveryFields({ value, onChange, settings, pending }: { value: DeliveryDraft; onChange: (value: DeliveryDraft) => void; settings: DeliverySettingsResponse; pending: boolean }) {
  const { t } = useTranslation();
  const { name, phone, documentType, document, charge, method, courierId, agency, address, district, instructions } = value;
  const couriers = settings.couriers.filter(courier => courier.enabled);
  const courierAvailable = couriers.some(courier => courier.id === courierId);
  const point = settings.store.pickupPoint;
  const enabled = method === "store" ? settings.store.enabled : method === "home" ? settings.home.enabled : settings.agency.enabled;
  return (
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
      <legend className="mb-3 text-lg font-semibold">{t("orderDelivery.assign")}</legend>
      <Field><FieldLabel htmlFor="delivery-method">{t("orderDelivery.method")}</FieldLabel><select id="delivery-method" className={`${controlClass} max-md:min-h-touch`} value={enabled ? method : ""} required onChange={event => onChange({ ...value, method: event.target.value as typeof method })}>
        <option value="" disabled>{t("orderDelivery.chooseMethod")}</option>
        {settings.store.enabled && <option value="store">{t("deliverySettings.store")}</option>}
        {settings.home.enabled && <option value="home">{t("deliverySettings.home")}</option>}
        {settings.agency.enabled && <option value="agency">{t("deliverySettings.agency")}</option>}
      </select></Field>
      {method === "store" ? <><p className="break-words text-sm">{t("deliverySettings.store")}{point && <> · {point.name} · {point.address}</>}</p>
      {point?.instructions && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{point.instructions}</p>}</> : method === "home" ? <>
        <Field><FieldLabel htmlFor="delivery-address">{t("orderDelivery.address")}</FieldLabel><Input id="delivery-address" value={address} required maxLength={500} onChange={event => onChange({ ...value, address: event.target.value })} /></Field>
        <Field><FieldLabel htmlFor="delivery-district">{t("orderDelivery.district")}</FieldLabel><Input id="delivery-district" value={district} required maxLength={120} onChange={event => onChange({ ...value, district: event.target.value })} /></Field>
        <Field><FieldLabel htmlFor="delivery-instructions">{t("orderDelivery.instructions")}</FieldLabel><Input id="delivery-instructions" value={instructions} maxLength={1000} onChange={event => onChange({ ...value, instructions: event.target.value })} /></Field>
      </> : <>
        <Field><FieldLabel htmlFor="delivery-courier">{t("orderDelivery.courier")}</FieldLabel><select id="delivery-courier" className={`${controlClass} max-md:min-h-touch`} value={courierAvailable ? courierId : ""} required onChange={event => onChange({ ...value, courierId: event.target.value })}>
          <option value="" disabled>{t("orderDelivery.chooseCourier")}</option>{couriers.map(courier => <option key={courier.id} value={courier.id}>{courier.name}</option>)}
        </select></Field>
        <Field><FieldLabel htmlFor="delivery-agency">{t("orderDelivery.agency")}</FieldLabel><Input id="delivery-agency" value={agency} required maxLength={500} onChange={event => onChange({ ...value, agency: event.target.value })} /></Field>
      </>}
      <Field><FieldLabel htmlFor="recipient-name">{t("orderDelivery.recipientName")}</FieldLabel><Input id="recipient-name" value={name} required onChange={event => onChange({ ...value, name: event.target.value })} /></Field>
      <Field><FieldLabel htmlFor="recipient-phone">{t("orderDelivery.recipientPhone")}</FieldLabel><Input id="recipient-phone" type="tel" value={phone} required onChange={event => onChange({ ...value, phone: event.target.value })} /></Field>
      <Field><FieldLabel htmlFor="recipient-document-type">{t(method === "agency" ? "orderDelivery.identityRequired" : "orderDelivery.identity")}</FieldLabel><select id="recipient-document-type" className={`${controlClass} max-md:min-h-touch`} value={method === "agency" && documentType === "absent" ? "" : documentType} required={method === "agency"} onChange={event => onChange({ ...value, documentType: event.target.value as typeof documentType })}>
        {method === "agency" ? <option value="" disabled>{t("orderDelivery.chooseDocument")}</option> : <option value="absent">{t("orderDelivery.noDocument")}</option>}<option value="national_id">{t("orders.documentType.national_id")}</option><option value="passport">{t("orders.documentType.passport")}</option><option value="foreign_id">{t("orders.documentType.foreign_id")}</option>
      </select></Field>
      {documentType !== "absent" && <Field><FieldLabel htmlFor="recipient-document">{t("orderDelivery.document")}</FieldLabel><Input id="recipient-document" value={document} required onChange={event => onChange({ ...value, document: event.target.value })} /></Field>}
      <label className="flex min-h-touch items-center gap-3"><input type="checkbox" checked={charge} onChange={event => onChange({ ...value, charge: event.target.checked })} />{t("orderDelivery.charge")}</label>
      <p className="text-sm text-muted-foreground">{t("orderDelivery.priceHint")}</p>
    </fieldset>
  );
}

export function DeliveryForm({ order, settings, pending }: { order: OrderAggregateResponse; settings: DeliverySettingsResponse; pending: boolean }) {
  const { t } = useTranslation();
  const submit = useSubmit();
  const ready = useClientReady();
  const [value, setValue] = useState(() => deliveryDraft(order, settings));
  const enabled = settings[value.method].enabled;
  const validCourier = value.method !== "agency" || settings.couriers.some(courier => courier.id === value.courierId && courier.enabled);
  return <form className="flex max-w-form flex-col gap-4" onSubmit={event => {
    event.preventDefault();
    const parsed = deliveryRequest(value);
    if (ready && parsed.success) submit(parsed.data, { method: "post", encType: "application/json" });
  }}>
    <DeliveryFields value={value} onChange={setValue} settings={settings} pending={pending || !ready} />
    <Button type="submit" disabled={pending || !ready || !enabled || !validCourier}>{t(pending ? "deliverySettings.saving" : "orderDelivery.save")}</Button>
  </form>;
}
