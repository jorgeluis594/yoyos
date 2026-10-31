import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { err, ok } from "@shared/functional";
import type { CourierCatalogResponse, DeliveryZonesResponse, SaveDeliveryZonesRequest, DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import { DeliveryZonesSection, coverageWarnings, useZonesCoverage } from "@mobile/features/delivery-settings/presentation/delivery-zones-section";
import { useInstantDeliverySettings } from "@mobile/features/delivery-settings/presentation/use-instant-delivery-settings";
import type { PickupField, RowSaveState } from "@mobile/features/delivery-settings/application/delivery-settings";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { ScreenState } from "@mobile/components/ui/screen-state";
import { useTheme } from "@mobile/hooks/use-theme";

const noCouriers: DeliverySettingsResponse["couriers"] = [];
const pickupMaxLength = { name: 120, address: 500, instructions: 1000 } as const;

/** The save state of one method, under its description. */
function RowStatus({ state, onRetry }: Readonly<{ state: RowSaveState; onRetry: () => void }>) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (state.kind === "saving" || state.kind === "saved") return <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{t(state.kind === "saving" ? "rowSaving" : "rowSaved")}</ThemedText>;
  if (state.kind === "invalid") return <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.error }}>{t("deliverySettingsInvalid")}</ThemedText>;
  if (state.kind !== "failed") return null;
  return <View style={styles.heading}><ThemedText type="small" accessibilityRole="alert" style={{ color: theme.error }}>{t("deliverySettingsSaveError")}</ThemedText>
    <Button variant="secondary" onPress={onRetry}>{t("retrySave")}</Button></View>;
}

export default function DeliverySettingsScreen() {
  const { t } = useTranslation();
  const { state } = useAccess();
  const theme = useTheme();
  const companyId = state.status === "ready" ? state.company.id : "";
  const [settings, setSettings] = useState<DeliverySettingsResponse | null>(null);
  const country = state.status === "ready" ? state.company.country : "";
  const [catalog, setCatalog] = useState<CourierCatalogResponse["couriers"]>([]);
  const [zones, setZones] = useState<DeliveryZonesResponse | null>(null);
  const [zoneConflict, setZoneConflict] = useState(false);
  const [zonesBusy, setZonesBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const initialized = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const zonesTop = useRef(0);
  const load = useCallback(async () => {
    if (!companyId || inFlight.current) return false;
    inFlight.current = true;
    setLoading(true);
    const [result, catalogResult, zoneResult] = await Promise.all([deliverySettings.get(), deliverySettings.getCourierCatalog(),
      country === "PE" ? deliverySettings.getZones() : Promise.resolve(ok(null))]);
    const loaded = result.success && catalogResult.success && zoneResult.success;
    if (loaded) { setCatalog(catalogResult.data.couriers); setZones(zoneResult.data); setZoneConflict(false); setSettings(result.data); setError(""); }
    else setError("deliverySettingsLoadError");
    inFlight.current = false;
    setLoading(false);
    return loaded;
  }, [companyId, country]);
  useEffect(() => {
    if (companyId && !initialized.current) { initialized.current = true; void load(); }
  }, [companyId, load]);

  const instant = useInstantDeliverySettings({ settings, zonesBusy: zonesBusy || zoneConflict, ready: settings !== null && !loading, onReload: load,
    onSaved: saved => { setSettings(saved); setError(""); } });
  const { rows, checked, draft, activating, conflict, invalidFields } = instant;
  const busy = loading || instant.busy;
  const saveZones = async (input: SaveDeliveryZonesRequest) => {
    if (busy || zoneConflict || conflict) return err({ code: "INVALID_INPUT" as const, message: "Reload before saving" });
    setZonesBusy(true);
    const result = await deliverySettings.saveZones(input);
    if (result.success) {
      setZones(result.data);
      setSettings(previous => previous && { ...previous, version: result.data.version, home: result.data.home, agency: result.data.agency });
      setZoneConflict(false);
      // Zone saves are the only writer of company couriers, and the zones response does not carry them.
      const refreshed = await deliverySettings.get();
      if (refreshed.success) setSettings(previous => previous && { ...previous, couriers: refreshed.data.couriers });
      else setError("deliverySettingsLoadError"); // couriers shown may be stale until reload
    } else setZoneConflict(!["INVALID_INPUT", "INVALID_DELIVERY_ZONE", "INVALID_DELIVERY_OPTION"].includes(result.error.code));
    setZonesBusy(false);
    return result;
  };
  // Before any early return, so the hook order does not change between the loading state and the ready one.
  const zonesCoverage = useZonesCoverage(zones?.zones ?? null, zones?.agencies ?? null, settings?.couriers ?? noCouriers);
  if (state.status !== "ready") return null;
  if (!settings) return loading ? <ScreenState status="loading" title={t("loadingDeliverySettings")} />
    : <ScreenState status="error" title={t("deliverySettingsLoadError")} description={t(error)} onRetry={() => void load()} />;
  const goToZones = () => scroll.current?.scrollTo({ y: zonesTop.current, animated: true });
  const zonesState = zones && { ...zones, version: settings.version, home: settings.home, agency: settings.agency };
  const warnings = coverageWarnings(zonesCoverage, { home: settings.home.enabled, agency: settings.agency.enabled });
  const coverage = (method: "home" | "agency") => warnings[method] ? <View style={styles.heading}>
    <ThemedText type="small" themeColor="textSecondary">{t(method === "home" ? "zonesMissingHome" : "zonesMissingAgency")}</ThemedText>
    <Button variant="ghost" onPress={goToZones}>{t("goToZones")}</Button></View> : null;
  const section = [styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];
  const toggleProps = (target: "store" | "home" | "agency", label: string) => ({ accessibilityLabel: label, value: checked[target], disabled: busy || conflict, hitSlop: 10,
    trackColor: { true: theme.primary }, onValueChange: (value: boolean) => instant.toggle(target, value) });
  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={Platform.OS === "ios" ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]}>
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView ref={scroll} style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={styles.heading}><ThemedText type="title" accessibilityRole="header">{t("deliverySettingsTitle")}</ThemedText>
        <ThemedText themeColor="textSecondary">{t("deliverySettingsDescription")}</ThemedText></View>
      {conflict || error ? <View style={styles.heading}>
        {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(error)}</ThemedText> : null}
        {conflict ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t("deliverySettingsConflict")}</ThemedText> : null}
        <Button variant="secondary" onPress={() => void instant.reload()} disabled={loading || instant.saving}>{t("reloadDeliverySettings")}</Button></View> : null}
      <View style={section}><View style={styles.toggle}><View style={[styles.label, styles.heading]}><ThemedText type="subtitle" accessibilityRole="header">{t("pickupStoreTitle")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t("pickupEnabled")}</ThemedText></View><Switch {...toggleProps("store", t("pickupEnabled"))} /></View>
        <RowStatus state={rows.store} onRetry={() => instant.retry("store")} />
        <ThemedText type="small" themeColor="textSecondary">{t("pickupHint")}</ThemedText>
        {activating ? <ThemedText type="small" themeColor="textSecondary">{t("pickupActivate")}</ThemedText> : null}
        <FieldGroup>{(["name", "address", "instructions"] as const).map((name: PickupField) => {
          const invalid = invalidFields.includes(name as "name" | "address");
          return <Field key={name} invalid={invalid}><FieldLabel>{t(name === "name" ? "pickupName" : name === "address" ? "pickupAddress" : "pickupInstructions")}</FieldLabel>
            <Input ref={name === "instructions" ? undefined : instant.fields[name]} value={draft[name]} onChangeText={value => instant.changePickup(name, value)} onBlur={() => instant.blurPickup(name)}
              maxLength={pickupMaxLength[name]} multiline={name !== "name"} accessibilityLabel={t(name === "name" ? "pickupName" : name === "address" ? "pickupAddress" : "pickupInstructions")} />
            {invalid ? <FieldError>{t("deliverySettingsInvalid")}</FieldError> : null}</Field>;
        })}</FieldGroup>
      </View>
      <View style={section}><View style={styles.toggle}><View style={[styles.label, styles.heading]}><ThemedText type="subtitle" accessibilityRole="header">{t("homeDeliveryTitle")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t("homeDeliveryEnabled")}</ThemedText></View><Switch {...toggleProps("home", t("homeDeliveryEnabled"))} /></View>
        <RowStatus state={rows.home} onRetry={() => instant.retry("home")} />
        {coverage("home")}
      </View>
      <View style={section}><View style={styles.toggle}><View style={[styles.label, styles.heading]}><ThemedText type="subtitle" accessibilityRole="header">{t("agencyDeliveryTitle")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t("agencyDeliveryEnabled")}</ThemedText></View><Switch {...toggleProps("agency", t("agencyDeliveryEnabled"))} /></View>
        <RowStatus state={rows.agency} onRetry={() => instant.retry("agency")} />
        <ThemedText type="small" themeColor="textSecondary">{t("courierHint")}</ThemedText>
        {settings.agency.enabled && catalog.length === 0 ? <ThemedText type="small" themeColor="textSecondary">{t("deliveryNoCatalog")}</ThemedText> : null}
        {catalog.length > 0 ? coverage("agency") : null}
      </View>
      {zonesState ? <View onLayout={event => { zonesTop.current = event.nativeEvent.layout.y; }} style={section}><DeliveryZonesSection state={zonesState} loadAgencies={deliverySettings.getAgencyCatalog}
        couriers={settings.couriers} catalog={catalog} disabled={loading || zonesBusy || instant.saving} blocked={zoneConflict || conflict} onSave={saveZones} onReload={() => void instant.reload()} /></View> : null}
    </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { padding: 16, gap: 24, paddingBottom: 24, width: "100%", maxWidth: 640, alignSelf: "center" },
  heading: { gap: 8 }, section: { gap: 16, padding: 16, borderWidth: 1, borderRadius: 8 }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
