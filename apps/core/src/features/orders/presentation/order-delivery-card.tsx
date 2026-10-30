import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { formatCurrency } from "@core/app/format-currency";
import { Card, CardContent, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { Checkbox } from "@core/app/components/ui/checkbox";
import { Field, FieldError, FieldLabel, FieldSet } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/app/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@core/app/components/ui/tabs";
import { TextLink } from "@core/app/components/ui/text-link";
import { QuotedPlaceFields } from "@core/src/features/orders/presentation/rated-delivery-form";
import {
  screenLocks, unsavedParts, type DeliveryDraft, type DeliveryFields, type DeliveryTab, type DocumentType, type InvalidField, type OrderViewState,
} from "@core/src/features/orders/presentation/order-view-state";

const idPrefix = "order-delivery";
const documentTypes = ["national_id", "passport", "foreign_id"] as const;
const blankPlace = { districtCode: null, rateId: "", agencyId: "", ratePrice: null, address: "", instructions: "" } as const;

type Props = Readonly<{
  state: OrderViewState; settings: DeliverySettingsResponse | null; invalid: readonly InvalidField[]; settingsHref: string;
  onChange: (delivery: DeliveryDraft) => void; onDeliverImmediatelyChange: (checked: boolean) => void;
  /** Where «Marcar enviado» and «Marcar entregado» go, at the top of the card. */
  fulfillment?: ReactNode;
}>;

/** Chosen place, reset when the method changes; the recipient survives so the seller does not retype it. */
const withTab = (delivery: DeliveryDraft, tab: DeliveryTab, customer: { name: string; phone: string }): DeliveryDraft => tab === "none"
  ? { tab, sameAsCustomer: true, fields: { ...delivery.fields, ...blankPlace, name: customer.name, phone: customer.phone, documentType: "absent", document: "" } }
  : { ...delivery, tab, fields: { ...delivery.fields, ...blankPlace } };

export function OrderDeliveryCard({ state, settings, invalid, settingsHref, onChange, onDeliverImmediatelyChange, fulfillment }: Props) {
  const { t, i18n } = useTranslation();
  const { draft, base, loaded } = state;
  const { delivery, customer } = draft;
  const { fields, tab } = delivery;
  const lock = screenLocks(state).delivery;
  const isNew = base === null;
  const savedHasDelivery = base !== null && base.delivery.saved.tab !== "none";
  const marks = invalid.filter(mark => mark.section === "delivery");
  const marked = new Set(marks.filter(mark => mark.reason === "delivery_incomplete").map(mark => mark.field));
  const coverMark = marks.some(mark => mark.reason === "deliver_needs_payment");
  const methods = settings === null ? [] : (["store", "home", "agency"] as const).filter(method => settings[method].enabled);
  const tabs: readonly { value: DeliveryTab; label: string; disabled: boolean }[] = [
    { value: "none", label: t("orderView.delivery.pending"), disabled: savedHasDelivery },
    ...methods.map(method => ({ value: ({ store: "store", home: "home", agency: "agency" } as const)[method], label: t(`orderView.delivery.${method === "store" ? "pickup" : method}`), disabled: false })),
  ];
  const recordedByBuyer = loaded?.order.delivery?.recordedBy.kind === "buyer" && !unsavedParts(state).includes("delivery");
  const set = (patch: Partial<DeliveryFields>, sameAsCustomer = delivery.sameAsCustomer) => onChange({ ...delivery, sameAsCustomer, fields: { ...fields, ...patch } });
  const recipientInput = (name: "name" | "phone" | "document", label: string) => <Field data-invalid={marked.has(name)}>
    <FieldLabel htmlFor={`${idPrefix}-${name}`}>{label}</FieldLabel>
    <Input id={`${idPrefix}-${name}`} value={fields[name]} type={name === "phone" ? "tel" : "text"} required aria-invalid={marked.has(name)}
      onChange={event => set({ [name]: event.target.value }, name === "document" ? delivery.sameAsCustomer : false)} /></Field>;
  const documentItems = [{ value: "absent", label: t("orderDelivery.noDocument") }, ...documentTypes.map(type => ({ value: type, label: t(`orders.documentType.${type}`) }))];
  const internalCost = tab === "store" ? 0 : fields.ratePrice?.amount ?? (savedHasDelivery && !unsavedParts(state).includes("delivery") ? loaded?.order.deliveryCost.amount ?? null : null);
  const incomplete = marked.size > 0 ? t(isNew || !savedHasDelivery ? "orderView.delivery.incompleteNew" : "orderView.delivery.incompleteSaved") : null;
  const lockedNote = lock === "shipped" ? t("orderView.delivery.lockedShipped") : lock === "delivered" ? t("orderView.delivery.lockedDelivered") : null;

  return <Card id="order-delivery"><CardHeader><CardTitle>{t("orderView.delivery.title")}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-4">
      {fulfillment}
      {lockedNote && <p role="status" className="text-sm text-muted-foreground">{lockedNote}</p>}
      {methods.length === 0 && !savedHasDelivery
        ? <div className="flex flex-col gap-2 text-sm"><p className="text-muted-foreground">{t(settings ? "orderDelivery.disabled" : "deliverySettings.loadError")}</p>
          <TextLink asChild><Link to={settingsHref}>{t("orderDelivery.configure")}</Link></TextLink></div>
        : <FieldSet disabled={lock !== null} className="flex min-w-0 flex-col gap-4">
          <Tabs value={tab} onValueChange={value => { if (value !== tab) onChange(withTab(delivery, value as DeliveryTab, customer)); }}>
            <TabsList className="h-auto flex-wrap">{tabs.map(item => <TabsTrigger key={item.value} value={item.value} disabled={item.disabled || lock !== null}>{item.label}</TabsTrigger>)}</TabsList>
          </Tabs>
          {savedHasDelivery && <p className="text-sm text-muted-foreground">{t("orderView.delivery.cannotClear")}</p>}
          {recordedByBuyer && <p className="text-sm text-muted-foreground">{t("orderView.delivery.chosenByBuyer")}</p>}
          {tab === "none" ? <p className="text-sm text-muted-foreground">{t("orderView.delivery.pendingHint")}</p> : <>
            {settings && <QuotedPlaceFields method={tab} place={fields} settings={settings} disabled={lock !== null} invalid={marked} idPrefix={idPrefix} onChange={place => set(place)} />}
            <h3 className="text-sm font-medium">{t("orderView.delivery.recipient")}</h3>
            <Field orientation="horizontal" className="min-h-touch items-center">
              <Checkbox id={`${idPrefix}-same`} checked={delivery.sameAsCustomer}
                onCheckedChange={checked => checked === true ? onChange({ ...delivery, sameAsCustomer: true, fields: { ...fields, name: customer.name, phone: customer.phone } }) : onChange({ ...delivery, sameAsCustomer: false })} />
              <FieldLabel htmlFor={`${idPrefix}-same`}>{t("orderView.delivery.sameAsCustomer")}</FieldLabel></Field>
            {recipientInput("name", t("orderDelivery.recipientName"))}{recipientInput("phone", t("orderDelivery.recipientPhone"))}
            <Field data-invalid={marked.has("document")}><FieldLabel htmlFor={`${idPrefix}-documentType`}>{t(tab === "agency" ? "orderDelivery.identityRequired" : "orderDelivery.identity")}</FieldLabel>
              <Select items={documentItems} value={fields.documentType} onValueChange={value => set({ documentType: value as DocumentType, document: value === "absent" ? "" : fields.document })}>
                <SelectTrigger id={`${idPrefix}-documentType`} aria-invalid={marked.has("document") && fields.documentType === "absent"}><SelectValue /></SelectTrigger>
                <SelectContent>{documentItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>
            {fields.documentType !== "absent" && recipientInput("document", t("orderDelivery.document"))}
            {internalCost !== null && <p className="text-sm">{t("orderView.delivery.internalCost")}: {internalCost === 0 ? t("deliveryZones.free") : formatCurrency(internalCost, draft.currency, i18n.language)}</p>}
          </>}
          {incomplete && <FieldError id={`${idPrefix}-incomplete`} role="alert">{incomplete}</FieldError>}
        </FieldSet>}
      {isNew && <Field orientation="horizontal" className="min-h-touch items-center" data-invalid={coverMark}>
        <Checkbox id={`${idPrefix}-deliverImmediately`} checked={draft.deliverImmediately} aria-invalid={coverMark} onCheckedChange={checked => onDeliverImmediatelyChange(checked === true)} />
        <FieldLabel htmlFor={`${idPrefix}-deliverImmediately`}>{t("orderView.delivery.deliverOnSave")}</FieldLabel></Field>}
      {coverMark && <FieldError role="alert">{t("orderView.delivery.coverPayments")}</FieldError>}
    </CardContent></Card>;
}
