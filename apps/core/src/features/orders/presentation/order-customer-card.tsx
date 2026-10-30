import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { Field, FieldError, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { PhoneField } from "@core/app/components/phone-field";
import { WhatsAppMark } from "@core/app/components/order-buyer-label";
import type { CustomerDraft, InvalidField } from "@core/src/features/orders/presentation/order-view-state";

type OrderSource = OrderAggregateResponse["source"];

export type OrderCustomerCardProps = Readonly<{
  customer: CustomerDraft;
  source: OrderSource;
  /** The customer is read-only once the order is cancelled. */
  locked: boolean;
  /** The customer marks from `invalidFields`, shown only after a save attempt. */
  marks: readonly InvalidField[];
  onChange: (customer: CustomerDraft) => void;
  onRemove: () => void;
}>;

const fieldIds = { customerName: "customer-name", customerPhone: "customer-phone" } as const;
/** The element id a customer mark (`InvalidField.field`) points at, for focus and the alert link. */
export const customerFieldId = (field: string): string | undefined => fieldIds[field as keyof typeof fieldIds];

export function OrderCustomerCard({ customer, source, locked, marks, onChange, onRemove }: OrderCustomerCardProps) {
  const { t } = useTranslation();
  const nameRef = useRef<HTMLInputElement>(null);
  const whatsapp = source === "whatsapp";
  const empty = customer.name.trim() === "" && customer.phone.trim() === "";
  const markOf = (field: string) => marks.find(mark => mark.field === field);
  const messageOf = (field: string, invalid: "invalidName" | "invalidPhone") => {
    const mark = markOf(field);
    return mark ? t(mark.reason === "customer_incomplete" ? "orderView.customer.incomplete" : `orderView.customer.${invalid}`) : null;
  };
  const nameError = messageOf("customerName", "invalidName");
  const phoneError = messageOf("customerPhone", "invalidPhone");
  function remove() {
    onRemove();
    nameRef.current?.focus();
  }
  return <Card role="region" aria-labelledby="order-customer-title" className="min-w-0 max-xl:order-3">
    <CardHeader><CardTitle id="order-customer-title" className="flex items-center gap-2">{whatsapp && <WhatsAppMark />}{t("orderView.customer.title")}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{whatsapp && empty ? t("orderView.customer.whatsapp") : t("orderView.customer.hint")}</p>
      <Field data-invalid={Boolean(nameError)}>
        <FieldLabel htmlFor={fieldIds.customerName}>{t("orderView.customer.name")}</FieldLabel>
        <Input ref={nameRef} id={fieldIds.customerName} autoComplete="off" disabled={locked} value={customer.name} aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? "customer-name-error" : undefined} onChange={event => onChange({ ...customer, name: event.target.value })} />
        {nameError && <FieldError id="customer-name-error">{nameError}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(phoneError)}>
        <FieldLabel htmlFor={fieldIds.customerPhone}>{t("orderView.customer.phone")}</FieldLabel>
        <PhoneField id={fieldIds.customerPhone} value={customer.phone} disabled={locked} invalid={Boolean(phoneError)}
          describedBy={phoneError ? "customer-phone-error" : undefined} onChange={phone => onChange({ ...customer, phone })} />
        {phoneError && <FieldError id="customer-phone-error">{phoneError}</FieldError>}
      </Field>
      {!locked && !whatsapp && !empty && <Button type="button" variant="outline" className="min-h-control w-fit max-md:min-h-touch" onClick={remove}>{t("orderView.customer.remove")}</Button>}
    </CardContent>
  </Card>;
}
