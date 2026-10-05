import { useState } from "react";
import { useClientReady } from "@core/app/use-client-ready";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";
import type { OrderAggregateResponse, SetOrderDeliveryRequest } from "@shared/contracts/orders";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel, controlClass } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";

type Recipient = SetOrderDeliveryRequest["delivery"]["recipient"];
export function DeliveryForm({ order, settings, pending }: { order: OrderAggregateResponse; settings: DeliverySettingsResponse; pending: boolean }) {
  const { t } = useTranslation();
  const submit = useSubmit();
  const ready = useClientReady();
  const recipient = order.delivery?.recipient;
  const [name, setName] = useState(recipient?.name ?? (order.customer.kind === "contact" ? order.customer.name ?? "" : ""));
  const [phone, setPhone] = useState(recipient?.phone ?? (order.customer.kind === "contact" ? order.customer.phone : ""));
  const [documentType, setDocumentType] = useState<"absent" | "national_id" | "passport" | "foreign_id">(recipient?.identity.kind === "document" ? recipient.identity.documentType : "absent");
  const [document, setDocument] = useState(recipient?.identity.kind === "document" ? recipient.identity.document : "");
  const [charge, setCharge] = useState(order.delivery ? order.deliveryCharge.amount > 0 : false);
  const [method, setMethod] = useState<SetOrderDeliveryRequest["delivery"]["method"]>(order.delivery?.method ?? (settings.store.enabled ? "store" : settings.home.enabled ? "home" : "agency"));
  const [courierId, setCourierId] = useState(order.delivery?.method === "agency" ? order.delivery.courier.id : "");
  const [agency, setAgency] = useState(order.delivery?.method === "agency" ? order.delivery.agency : "");
  const couriers = settings.couriers.filter(courier => courier.enabled);
  const courierAvailable = couriers.some(courier => courier.id === courierId);
  const destination = order.delivery?.method === "home" ? order.delivery.destination : null;
  const [address, setAddress] = useState(destination?.address ?? "");
  const [district, setDistrict] = useState(destination?.district ?? "");
  const [instructions, setInstructions] = useState(destination?.instructions ?? "");
  const point = settings.store.pickupPoint;
  const enabled = method === "store" ? settings.store.enabled : method === "home" ? settings.home.enabled : settings.agency.enabled;
  return <form className="flex max-w-form flex-col gap-4" onSubmit={event => {
    event.preventDefault();
    if (!ready) return;
    const identity: Recipient["identity"] = documentType === "absent" ? { kind: "absent" } : { kind: "document", documentType, document };
    const recipient = { name, phone, identity };
    let delivery: SetOrderDeliveryRequest["delivery"];
    if (method === "agency") {
      if (identity.kind === "absent" || !courierAvailable) return;
      delivery = { method, recipient: { name, phone, identity }, courierId, agency };
    } else delivery = method === "store" ? { method, recipient }
      : { method, recipient, destination: { address, district, instructions: instructions.trim() || null } };
    submit({ delivery, chargeDeliveryToCustomer: charge }, { method: "post", encType: "application/json" });
  }}>
    <fieldset disabled={pending || !ready} className="flex min-w-0 flex-col gap-4">
      <legend className="mb-3 text-lg font-semibold">{t(order.delivery ? "orderDelivery.replace" : "orderDelivery.assign")}</legend>
      <Field><FieldLabel htmlFor="delivery-method">{t("orderDelivery.method")}</FieldLabel><select id="delivery-method" className={`${controlClass} max-md:min-h-touch`} value={enabled ? method : ""} required onChange={event => setMethod(event.target.value as typeof method)}>
        <option value="" disabled>{t("orderDelivery.chooseMethod")}</option>
        {settings.store.enabled && <option value="store">{t("deliverySettings.store")}</option>}
        {settings.home.enabled && <option value="home">{t("deliverySettings.home")}</option>}
        {settings.agency.enabled && <option value="agency">{t("deliverySettings.agency")}</option>}
      </select></Field>
      {method === "store" ? <><p className="break-words text-sm">{t("deliverySettings.store")}{point && <> · {point.name} · {point.address}</>}</p>
      {point?.instructions && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{point.instructions}</p>}</> : method === "home" ? <>
        <Field><FieldLabel htmlFor="delivery-address">{t("orderDelivery.address")}</FieldLabel><Input id="delivery-address" value={address} required maxLength={500} onChange={event => setAddress(event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="delivery-district">{t("orderDelivery.district")}</FieldLabel><Input id="delivery-district" value={district} required maxLength={120} onChange={event => setDistrict(event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="delivery-instructions">{t("orderDelivery.instructions")}</FieldLabel><Input id="delivery-instructions" value={instructions} maxLength={1000} onChange={event => setInstructions(event.target.value)} /></Field>
      </> : <>
        <Field><FieldLabel htmlFor="delivery-courier">{t("orderDelivery.courier")}</FieldLabel><select id="delivery-courier" className={`${controlClass} max-md:min-h-touch`} value={courierAvailable ? courierId : ""} required onChange={event => setCourierId(event.target.value)}>
          <option value="" disabled>{t("orderDelivery.chooseCourier")}</option>{couriers.map(courier => <option key={courier.id} value={courier.id}>{courier.name}</option>)}
        </select></Field>
        <Field><FieldLabel htmlFor="delivery-agency">{t("orderDelivery.agency")}</FieldLabel><Input id="delivery-agency" value={agency} required maxLength={500} onChange={event => setAgency(event.target.value)} /></Field>
      </>}
      <Field><FieldLabel htmlFor="recipient-name">{t("orderDelivery.recipientName")}</FieldLabel><Input id="recipient-name" value={name} required onChange={event => setName(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="recipient-phone">{t("orderDelivery.recipientPhone")}</FieldLabel><Input id="recipient-phone" type="tel" value={phone} required onChange={event => setPhone(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="recipient-document-type">{t(method === "agency" ? "orderDelivery.identityRequired" : "orderDelivery.identity")}</FieldLabel><select id="recipient-document-type" className={`${controlClass} max-md:min-h-touch`} value={method === "agency" && documentType === "absent" ? "" : documentType} required={method === "agency"} onChange={event => setDocumentType(event.target.value as typeof documentType)}>
        {method === "agency" ? <option value="" disabled>{t("orderDelivery.chooseDocument")}</option> : <option value="absent">{t("orderDelivery.noDocument")}</option>}<option value="national_id">{t("orders.documentType.national_id")}</option><option value="passport">{t("orders.documentType.passport")}</option><option value="foreign_id">{t("orders.documentType.foreign_id")}</option>
      </select></Field>
      {documentType !== "absent" && <Field><FieldLabel htmlFor="recipient-document">{t("orderDelivery.document")}</FieldLabel><Input id="recipient-document" value={document} required onChange={event => setDocument(event.target.value)} /></Field>}
      <label className="flex min-h-touch items-center gap-3"><input type="checkbox" checked={charge} onChange={event => setCharge(event.target.checked)} />{t("orderDelivery.charge")}</label>
      <p className="text-sm text-muted-foreground">{t("orderDelivery.priceHint")}</p>
    </fieldset>
    <Button type="submit" disabled={pending || !ready || !enabled || (method === "agency" && !courierAvailable)}>{t(pending ? "deliverySettings.saving" : "orderDelivery.save")}</Button>
  </form>;
}
