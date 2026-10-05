import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";
import type { OrderAggregateResponse, SetOrderDeliveryRequest } from "@shared/contracts/orders";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel, controlClass } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";

type Recipient = SetOrderDeliveryRequest["delivery"]["recipient"];
export function StoreDeliveryForm({ order, settings, pending }: { order: OrderAggregateResponse; settings: DeliverySettingsResponse; pending: boolean }) {
  const { t } = useTranslation();
  const submit = useSubmit();
  const recipient = order.delivery?.recipient;
  const [name, setName] = useState(recipient?.name ?? (order.customer.kind === "contact" ? order.customer.name ?? "" : ""));
  const [phone, setPhone] = useState(recipient?.phone ?? (order.customer.kind === "contact" ? order.customer.phone : ""));
  const [documentType, setDocumentType] = useState<"absent" | "national_id" | "passport" | "foreign_id">(recipient?.identity.kind === "document" ? recipient.identity.documentType : "absent");
  const [document, setDocument] = useState(recipient?.identity.kind === "document" ? recipient.identity.document : "");
  const [charge, setCharge] = useState(order.delivery ? order.deliveryCharge.amount > 0 : false);
  const point = settings.store.pickupPoint;
  return <form className="flex max-w-form flex-col gap-4" onSubmit={event => {
    event.preventDefault();
    const identity: Recipient["identity"] = documentType === "absent" ? { kind: "absent" } : { kind: "document", documentType, document };
    submit({ delivery: { method: "store", recipient: { name, phone, identity } }, chargeDeliveryToCustomer: charge }, { method: "post", encType: "application/json" });
  }}>
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
      <legend className="mb-3 text-lg font-semibold">{t(order.delivery ? "orderDelivery.replace" : "orderDelivery.assign")}</legend>
      <p className="break-words text-sm">{t("deliverySettings.store")}{point && <> · {point.name} · {point.address}</>}</p>
      {point?.instructions && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{point.instructions}</p>}
      <Field><FieldLabel htmlFor="recipient-name">{t("orderDelivery.recipientName")}</FieldLabel><Input id="recipient-name" value={name} required onChange={event => setName(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="recipient-phone">{t("orderDelivery.recipientPhone")}</FieldLabel><Input id="recipient-phone" type="tel" value={phone} required onChange={event => setPhone(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="recipient-document-type">{t("orderDelivery.identity")}</FieldLabel><select id="recipient-document-type" className={controlClass} value={documentType} onChange={event => setDocumentType(event.target.value as typeof documentType)}>
        <option value="absent">{t("orderDelivery.noDocument")}</option><option value="national_id">{t("orders.documentType.national_id")}</option><option value="passport">{t("orders.documentType.passport")}</option><option value="foreign_id">{t("orders.documentType.foreign_id")}</option>
      </select></Field>
      {documentType !== "absent" && <Field><FieldLabel htmlFor="recipient-document">{t("orderDelivery.document")}</FieldLabel><Input id="recipient-document" value={document} required onChange={event => setDocument(event.target.value)} /></Field>}
      <label className="flex min-h-touch items-center gap-3"><input type="checkbox" checked={charge} onChange={event => setCharge(event.target.checked)} />{t("orderDelivery.charge")}</label>
      <p className="text-sm text-muted-foreground">{t("orderDelivery.priceHint")}</p>
    </fieldset>
    <Button type="submit" disabled={pending}>{t(pending ? "deliverySettings.saving" : "orderDelivery.save")}</Button>
  </form>;
}
