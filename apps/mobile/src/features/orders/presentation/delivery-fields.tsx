import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { ThemedText } from "@mobile/components/themed-text";
import { Field, FieldGroup, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { PeruDistrictSelect } from "@mobile/components/peru-district-select";
import { getPeruDistrict } from "@shared/peru-geography";
import type { DeliveryQuotation } from "@mobile/features/delivery-settings";
import type { OrderDeliveryFormValues } from "@mobile/features/orders/presentation/order-delivery-form";
import { Button } from "@mobile/components/ui/button";
import { documentTypeLabel, orderLanguage } from "@mobile/features/orders/presentation/order-labels";

export function deliveryDraftFromOrder(order: Pick<OrderAggregateResponse, "buyer" | "delivery" | "deliveryCharge">, settings: DeliverySettingsResponse): OrderDeliveryFormValues {
  const recipient = order.delivery?.recipient;
  const destination = order.delivery?.method === "home" ? order.delivery.destination : null;
  return { name: recipient?.name ?? order.buyer?.name ?? "", phone: recipient?.phone ?? order.buyer?.phone ?? "",
    documentType: recipient?.identity.kind === "document" ? recipient.identity.documentType : "absent",
    document: recipient?.identity.kind === "document" ? recipient.identity.document : "", rateId: "", price: null, currency: order.deliveryCharge.currency,
    method: order.delivery?.method ?? (settings.store.enabled ? "store" : settings.home.enabled ? "home" : settings.agency.enabled ? "agency" : "store"),
    address: destination?.address ?? "", districtCode: order.delivery && "pricing" in order.delivery ? order.delivery.destination.districtCode : "", instructions: destination?.instructions ?? "" };
}

export function DeliveryFields({ value, onChange, settings, busy, language, rates, quoting, quoteError, onRetry }: {
  value: OrderDeliveryFormValues; onChange: (value: OrderDeliveryFormValues) => void;
  settings: DeliverySettingsResponse; busy: boolean; language: ReturnType<typeof orderLanguage>;
  rates: DeliveryQuotation["rates"]; quoting: boolean; quoteError: boolean; onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { method, address, districtCode, instructions, name, phone, documentType, document, rateId } = value;
  const enabled = !!method && settings[method].enabled;
  const formatPrice = (amount: number, currency: string) => new Intl.NumberFormat(i18n.language === "pt-BR" ? "pt-BR" : "es-PE", { style: "currency", currency }).format(amount);
  const point = settings.store.pickupPoint;
  return <>
        <Field disabled={busy}><FieldLabel>{t("orderDeliveryMethod")}</FieldLabel><OptionSelector testID="delivery-method" value={enabled ? method : null}
          onValueChange={next => { if (next === "store" || next === "home" || next === "agency") onChange({ ...value, method: next, rateId: "", price: null }); }} options={[
            ...(settings.store.enabled ? [{ value: "store", label: t("pickupStoreTitle") }] : []),
            ...(settings.home.enabled ? [{ value: "home", label: t("homeDeliveryTitle") }] : []),
            ...(settings.agency.enabled ? [{ value: "agency", label: t("agencyDeliveryTitle") }] : []),
          ]} /></Field>
        {!enabled ? <ThemedText>{t("orderDeliveryDisabled")}</ThemedText> : null}
        {method === "store" ? <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t("pickupStoreTitle")}</ThemedText>
          <ThemedText>{point?.name}</ThemedText><ThemedText>{point?.address}</ThemedText>
          {point?.instructions ? <ThemedText themeColor="textSecondary">{point.instructions}</ThemedText> : null}</View> : method === "home" ? <FieldGroup>
          <Field required disabled={busy}><FieldLabel>{t("orderDeliveryAddress")}</FieldLabel><Input value={address} onChangeText={next => onChange({ ...value, address: next })} maxLength={500} multiline accessibilityLabel={t("orderDeliveryAddress")} /></Field>
          <Field disabled={busy}><FieldLabel>{t("orderDeliveryInstructions")}</FieldLabel><Input value={instructions} onChangeText={next => onChange({ ...value, instructions: next })} maxLength={1000} multiline accessibilityLabel={t("orderDeliveryInstructions")} /></Field>
        </FieldGroup> : null}
        {method === "home" || method === "agency" ? <View style={styles.section}>
          <PeruDistrictSelect value={getPeruDistrict(districtCode)?.code ?? null} disabled={busy}
            onChange={code => onChange({ ...value, districtCode: code ?? "", rateId: "", price: null })} />
          {quoting ? <ThemedText accessibilityLiveRegion="polite">{t("orderQuotationLoading")}</ThemedText> : null}
          {quoteError ? <ThemedText accessibilityRole="alert">{t("orderQuotationError")}</ThemedText> : null}
          {!quoting && districtCode && !quoteError && rates.length === 0 ? <ThemedText>{t("orderQuotationEmpty")}</ThemedText> : null}
          {rates.length > 0 ? <Field required disabled={busy || quoting}><FieldLabel>{t("orderDeliveryRate")}</FieldLabel>
            <OptionSelector testID="delivery-rate" value={rates.some(rate => rate.id === rateId) ? rateId : null}
              options={rates.map(rate => ({ value: rate.id, label: rate.price.amount === 0 ? t("zonesFree") : formatPrice(rate.price.amount, rate.price.currency) }))}
              onValueChange={id => { const rate = rates.find(rate => rate.id === id); onChange({ ...value, rateId: rate?.id ?? "", price: rate?.price ?? null }); }} />
          </Field> : null}
          {districtCode && !quoting ? <Button variant="secondary" disabled={busy} onPress={onRetry}>{t("orderQuotationRetry")}</Button> : null}
        </View> : null}
        <FieldGroup><Field required disabled={busy}><FieldLabel>{t("deliveryRecipientName")}</FieldLabel><Input value={name} onChangeText={next => onChange({ ...value, name: next })} accessibilityLabel={t("deliveryRecipientName")} /></Field>
          <Field required disabled={busy}><FieldLabel>{t("deliveryRecipientPhone")}</FieldLabel><Input value={phone} onChangeText={next => onChange({ ...value, phone: next })} keyboardType="phone-pad" accessibilityLabel={t("deliveryRecipientPhone")} /></Field>
          <Field required={method === "agency"} disabled={busy}><FieldLabel>{t("deliveryDocumentType")}</FieldLabel><OptionSelector testID="delivery-document-type" value={method === "agency" && documentType === "absent" ? null : documentType} onValueChange={next => onChange({ ...value, documentType: (next ?? "absent") as OrderDeliveryFormValues["documentType"] })}
            options={[...(method === "agency" ? [] : [{ value: "absent", label: t("deliveryNoDocument") }]), ...(["national_id", "passport", "foreign_id"] as const).map(value => ({ value, label: documentTypeLabel(value, language) }))]} /></Field>
          {documentType !== "absent" ? <Field required disabled={busy}><FieldLabel>{t("deliveryDocument")}</FieldLabel><Input value={document} onChangeText={next => onChange({ ...value, document: next })} accessibilityLabel={t("deliveryDocument")} /></Field> : null}</FieldGroup>
        <ThemedText type="small" themeColor="textSecondary">{t("orderRatedDeliveryHint")}</ThemedText>
  </>;
}
const styles = StyleSheet.create({ section: { gap: 8 } });
