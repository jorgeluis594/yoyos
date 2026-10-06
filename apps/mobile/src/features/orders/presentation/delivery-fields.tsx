import { StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import type { DraftDelivery } from "@mobile/features/orders/domain/order-draft";
import { ThemedText } from "@mobile/components/themed-text";
import { Field, FieldGroup, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { useTheme } from "@mobile/hooks/use-theme";
import { documentTypeLabel, orderLanguage } from "@mobile/features/orders/presentation/order-labels";

export function deliveryDraftFromOrder(order: Pick<OrderAggregateResponse, "buyer" | "delivery" | "deliveryCharge">, settings: DeliverySettingsResponse): DraftDelivery {
  const recipient = order.delivery?.recipient;
  const destination = order.delivery?.method === "home" ? order.delivery.destination : null;
  return { name: recipient?.name ?? order.buyer?.name ?? "", phone: recipient?.phone ?? order.buyer?.phone ?? "",
    documentType: recipient?.identity.kind === "document" ? recipient.identity.documentType : "absent",
    document: recipient?.identity.kind === "document" ? recipient.identity.document : "", charge: order.deliveryCharge.amount > 0,
    method: order.delivery?.method ?? (settings.store.enabled ? "store" : settings.home.enabled ? "home" : settings.agency.enabled ? "agency" : "store"),
    courierId: order.delivery?.method === "agency" ? order.delivery.courier.id : "", agency: order.delivery?.method === "agency" ? order.delivery.agency : "",
    address: destination?.address ?? "", district: destination?.district ?? "", instructions: destination?.instructions ?? "" };
}

export function DeliveryFields({ value, onChange, settings, busy, language }: { value: DraftDelivery; onChange: (value: DraftDelivery) => void;
  settings: DeliverySettingsResponse; busy: boolean; language: ReturnType<typeof orderLanguage> }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { method, courierId, agency, address, district, instructions, name, phone, documentType, document, charge } = value;
  const enabled = settings[method].enabled;
  const activeCouriers = settings.couriers.filter(courier => courier.enabled);
  const courierAvailable = activeCouriers.some(courier => courier.id === courierId);
  const point = settings.store.pickupPoint;
  return <>
        <Field disabled={busy}><FieldLabel>{t("orderDeliveryMethod")}</FieldLabel><OptionSelector testID="delivery-method" value={enabled ? method : null}
          onValueChange={next => { if (next) onChange({ ...value, method: next as DraftDelivery["method"] }); }} options={[
            ...(settings.store.enabled ? [{ value: "store", label: t("pickupStoreTitle") }] : []),
            ...(settings.home.enabled ? [{ value: "home", label: t("homeDeliveryTitle") }] : []),
            ...(settings.agency.enabled ? [{ value: "agency", label: t("agencyDeliveryTitle") }] : []),
          ]} /></Field>
        {!enabled ? <ThemedText>{t("orderDeliveryDisabled")}</ThemedText> : null}
        {method === "store" ? <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t("pickupStoreTitle")}</ThemedText>
          <ThemedText>{point?.name}</ThemedText><ThemedText>{point?.address}</ThemedText>
          {point?.instructions ? <ThemedText themeColor="textSecondary">{point.instructions}</ThemedText> : null}</View> : method === "home" ? <FieldGroup>
          <Field required disabled={busy}><FieldLabel>{t("orderDeliveryAddress")}</FieldLabel><Input value={address} onChangeText={next => onChange({ ...value, address: next })} maxLength={500} multiline accessibilityLabel={t("orderDeliveryAddress")} /></Field>
          <Field required disabled={busy}><FieldLabel>{t("orderDeliveryDistrict")}</FieldLabel><Input value={district} onChangeText={next => onChange({ ...value, district: next })} maxLength={120} accessibilityLabel={t("orderDeliveryDistrict")} /></Field>
          <Field disabled={busy}><FieldLabel>{t("orderDeliveryInstructions")}</FieldLabel><Input value={instructions} onChangeText={next => onChange({ ...value, instructions: next })} maxLength={1000} multiline accessibilityLabel={t("orderDeliveryInstructions")} /></Field>
        </FieldGroup> : method === "agency" ? <FieldGroup>
          <Field required disabled={busy}><FieldLabel>{t("orderDeliveryCourier")}</FieldLabel><OptionSelector testID="delivery-courier" value={courierAvailable ? courierId : null} onValueChange={next => onChange({ ...value, courierId: next ?? "" })} options={activeCouriers.map(courier => ({ value: courier.id, label: courier.name }))} /></Field>
          <Field required disabled={busy}><FieldLabel>{t("orderDeliveryAgency")}</FieldLabel><Input value={agency} onChangeText={next => onChange({ ...value, agency: next })} maxLength={500} multiline accessibilityLabel={t("orderDeliveryAgency")} /></Field>
        </FieldGroup> : null}
        <FieldGroup><Field required disabled={busy}><FieldLabel>{t("deliveryRecipientName")}</FieldLabel><Input value={name} onChangeText={next => onChange({ ...value, name: next })} accessibilityLabel={t("deliveryRecipientName")} /></Field>
          <Field required disabled={busy}><FieldLabel>{t("deliveryRecipientPhone")}</FieldLabel><Input value={phone} onChangeText={next => onChange({ ...value, phone: next })} keyboardType="phone-pad" accessibilityLabel={t("deliveryRecipientPhone")} /></Field>
          <Field required={method === "agency"} disabled={busy}><FieldLabel>{t("deliveryDocumentType")}</FieldLabel><OptionSelector testID="delivery-document-type" value={method === "agency" && documentType === "absent" ? null : documentType} onValueChange={next => onChange({ ...value, documentType: (next ?? "absent") as DraftDelivery["documentType"] })}
            options={[...(method === "agency" ? [] : [{ value: "absent", label: t("deliveryNoDocument") }]), ...(["national_id", "passport", "foreign_id"] as const).map(value => ({ value, label: documentTypeLabel(value, language) }))]} /></Field>
          {documentType !== "absent" ? <Field required disabled={busy}><FieldLabel>{t("deliveryDocument")}</FieldLabel><Input value={document} onChangeText={next => onChange({ ...value, document: next })} accessibilityLabel={t("deliveryDocument")} /></Field> : null}</FieldGroup>
        <View style={styles.toggle}><ThemedText style={styles.label}>{t("chargeOrderDelivery")}</ThemedText><Switch value={charge} disabled={busy} hitSlop={10} trackColor={{ true: theme.primary }} accessibilityLabel={t("chargeOrderDelivery")} onValueChange={next => onChange({ ...value, charge: next })} /></View>
        <ThemedText type="small" themeColor="textSecondary">{t("orderDeliveryCostHint")}</ThemedText>
  </>;
}
const styles = StyleSheet.create({ section: { gap: 8 }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
