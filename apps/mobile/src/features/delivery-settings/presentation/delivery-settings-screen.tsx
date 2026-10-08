import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { err, ok } from "@shared/functional";
import type { DeliveryZonesResponse, SaveDeliveryZonesRequest, DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import { DeliveryZonesSection } from "@mobile/features/delivery-settings/presentation/delivery-zones-section";
import type { CourierDraft, DeliverySettingsDraft } from "@mobile/features/delivery-settings/application/delivery-settings";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useTheme } from "@mobile/hooks/use-theme";

function draftFrom(settings: DeliverySettingsResponse): DeliverySettingsDraft {
  return { expectedVersion: settings.version, agencyEnabled: settings.agency.enabled, couriers: settings.couriers.map(courier => ({ ...courier, kind: "existing" as const })), homeEnabled: settings.home.enabled, storeEnabled: settings.store.enabled, pickupName: settings.store.pickupPoint?.name ?? "",
    pickupAddress: settings.store.pickupPoint?.address ?? "", pickupInstructions: settings.store.pickupPoint?.instructions ?? "" };
}

export default function DeliverySettingsScreen() {
  const { t } = useTranslation();
  const { state } = useAccess();
  const theme = useTheme();
  const companyId = state.status === "ready" ? state.company.id : "";
  const [draft, setDraft] = useState<DeliverySettingsDraft | null>(null);
  const country = state.status === "ready" ? state.company.country : "";
  const [zones, setZones] = useState<DeliveryZonesResponse | null>(null);
  const [zoneConflict, setZoneConflict] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  const initialized = useRef(false);
  const nextCourierKey = useRef(0);
  const load = useCallback(async () => {
    if (!companyId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const [result, zoneResult] = await Promise.all([deliverySettings.get(),
      country === "PE" ? deliverySettings.getZones() : Promise.resolve(ok(null))]);
    if (result.success && zoneResult.success) { setZones(zoneResult.data); setZoneConflict(false); setGeneration(value => value + 1); }
    if (result.success && zoneResult.success) { setDraft(draftFrom(result.data)); setError(""); setConflict(false); setSaved(false); }
    else setError("deliverySettingsLoadError");
    inFlight.current = false;
    setBusy(false);
  }, [companyId, country]);
  useEffect(() => {
    if (companyId && !initialized.current) { initialized.current = true; void load(); }
  }, [companyId, load]);

  const save = async () => {
    if (!draft || inFlight.current || conflict || zoneConflict) return;
    inFlight.current = true;
    setBusy(true);
    setSaved(false);
    const result = await deliverySettings.save(draft);
    if (result.success) {
      setDraft(draftFrom(result.data)); setError(""); setSaved(true);
      setZones(previous => previous ? { ...previous, version: result.data.version, home: result.data.home, agency: result.data.agency } : null);
    }
    else {
      setConflict(result.error.code === "DELIVERY_SETTINGS_CONFLICT");
      setError(result.error.code === "DELIVERY_SETTINGS_CONFLICT" ? "deliverySettingsConflict"
        : result.error.code === "INVALID_DELIVERY_SETTINGS" || result.error.code === "INVALID_INPUT" ? "deliverySettingsInvalid" : "deliverySettingsSaveError");
    }
    inFlight.current = false;
    setBusy(false);
  };
  const saveZones = async (input: SaveDeliveryZonesRequest) => {
    if (inFlight.current || zoneConflict || conflict) return err({ code: "INVALID_INPUT" as const, message: "Reload before saving" });
    inFlight.current = true; setBusy(true);
    const result = await deliverySettings.saveZones(input);
    if (result.success) {
      setZones(result.data);
      setDraft(previous => previous ? { ...previous, expectedVersion: result.data.version } : null);
      setZoneConflict(false);
    } else setZoneConflict(!["INVALID_INPUT", "INVALID_DELIVERY_ZONE"].includes(result.error.code));
    inFlight.current = false; setBusy(false);
    return result;
  };
  if (state.status !== "ready") return null;
  if (!draft) return busy ? <ScreenState status="loading" title={t("loadingDeliverySettings")} />
    : <ScreenState status="error" title={t("deliverySettingsLoadError")} description={t(error)} onRetry={() => void load()} />;
  const setText = (field: "pickupName" | "pickupAddress" | "pickupInstructions", value: string) => { setDraft({ ...draft, [field]: value }); setSaved(false); };
  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={styles.heading}><ThemedText type="title" accessibilityRole="header">{t("deliverySettingsTitle")}</ThemedText>
        <ThemedText themeColor="textSecondary">{t("deliverySettingsDescription")}</ThemedText></View>
      <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t("pickupStoreTitle")}</ThemedText>
        <View style={styles.toggle}><ThemedText style={styles.label}>{t("pickupEnabled")}</ThemedText><Switch accessibilityLabel={t("pickupEnabled")}
          value={draft.storeEnabled} disabled={busy} hitSlop={10} trackColor={{ true: theme.primary }}
          onValueChange={value => { setDraft({ ...draft, storeEnabled: value }); setSaved(false); }} /></View>
        <ThemedText type="small" themeColor="textSecondary">{t("pickupHint")}</ThemedText>
        <FieldGroup><Field disabled={busy}><FieldLabel>{t("pickupName")}</FieldLabel><Input value={draft.pickupName} onChangeText={value => setText("pickupName", value)} maxLength={120} accessibilityLabel={t("pickupName")} /></Field>
          <Field disabled={busy}><FieldLabel>{t("pickupAddress")}</FieldLabel><Input value={draft.pickupAddress} onChangeText={value => setText("pickupAddress", value)} maxLength={500} multiline accessibilityLabel={t("pickupAddress")} /></Field>
          <Field disabled={busy}><FieldLabel>{t("pickupInstructions")}</FieldLabel><Input value={draft.pickupInstructions} onChangeText={value => setText("pickupInstructions", value)} maxLength={1000} multiline accessibilityLabel={t("pickupInstructions")} /></Field></FieldGroup>
      </View>
      <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t("homeDeliveryTitle")}</ThemedText>
        <View style={styles.toggle}><ThemedText style={styles.label}>{t("homeDeliveryEnabled")}</ThemedText><Switch accessibilityLabel={t("homeDeliveryEnabled")}
          value={draft.homeEnabled} disabled={busy} hitSlop={10} trackColor={{ true: theme.primary }}
          onValueChange={value => { setDraft({ ...draft, homeEnabled: value }); setSaved(false); }} /></View>
        {zones ? <DeliveryZonesSection key={`home-${generation}`} method="home" state={zones} disabled={busy} blocked={zoneConflict || conflict} onSave={saveZones} onReload={() => void load()} /> : null}
      </View>
      <View style={styles.section}><ThemedText type="subtitle" accessibilityRole="header">{t("agencyDeliveryTitle")}</ThemedText>
        <View style={styles.toggle}><ThemedText style={styles.label}>{t("agencyDeliveryEnabled")}</ThemedText><Switch accessibilityLabel={t("agencyDeliveryEnabled")}
          value={draft.agencyEnabled} disabled={busy} hitSlop={10} trackColor={{ true: theme.primary }}
          onValueChange={value => { setDraft({ ...draft, agencyEnabled: value }); setSaved(false); }} /></View>
        <ThemedText type="small" themeColor="textSecondary">{t("courierHint")}</ThemedText>
        {draft.couriers.length === 0 ? <ThemedText themeColor="textSecondary">{t("noCouriers")}</ThemedText> : null}
        {draft.couriers.map((courier, index) => {
          const key = courier.kind === "existing" ? courier.id : `new-${courier.localKey}`;
          const label = t("courierName", { number: index + 1 });
          const update = (change: Partial<Pick<CourierDraft, "name" | "enabled">>) => { setDraft({ ...draft, couriers: draft.couriers.map((row, rowIndex) => rowIndex === index ? { ...row, ...change } : row) }); setSaved(false); };
          return <View key={key} style={[styles.courier, { borderColor: theme.input }]}>
            <Field disabled={busy} required><FieldLabel>{label}</FieldLabel><Input value={courier.name} maxLength={120} accessibilityLabel={label} onChangeText={name => update({ name })} /></Field>
            <View style={styles.toggle}><ThemedText style={styles.label}>{t("courierEnabled", { number: index + 1 })}</ThemedText><Switch accessibilityLabel={t("courierEnabled", { number: index + 1 })}
              value={courier.enabled} disabled={busy} hitSlop={10} trackColor={{ true: theme.primary }} onValueChange={enabled => update({ enabled })} /></View>
            {courier.kind === "new" ? <Button variant="ghost" disabled={busy} accessibilityLabel={t("removeCourierLabel", { number: index + 1 })}
              onPress={() => { setDraft({ ...draft, couriers: draft.couriers.filter(row => row !== courier) }); setSaved(false); }}>{t("removeCourier")}</Button> : null}
          </View>;
        })}
        <Button variant="secondary" disabled={busy} onPress={() => { setDraft({ ...draft, couriers: [...draft.couriers, { kind: "new", localKey: ++nextCourierKey.current, name: "", enabled: true }] }); setSaved(false); }}>{t("addCourier")}</Button>
        {zones ? <DeliveryZonesSection key={`agency-${generation}`} method="agency" state={zones} disabled={busy} blocked={zoneConflict || conflict} onSave={saveZones} onReload={() => void load()} /> : null}
      </View>
      {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(error)}</ThemedText> : null}
      {saved ? <ThemedText accessibilityLiveRegion="polite">{t("deliverySettingsSaved")}</ThemedText> : null}
      <Button onPress={() => void save()} disabled={busy || conflict || zoneConflict} loading={busy}>{t("saveDeliverySettings")}</Button>
      {conflict ? <Button variant="secondary" onPress={() => void load()} disabled={busy}>{t("reloadDeliverySettings")}</Button> : null}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { padding: 16, gap: 24, paddingBottom: 32, width: "100%", maxWidth: 640, alignSelf: "center" },
  courier: { gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 }, heading: { gap: 8 }, section: { gap: 16 }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
