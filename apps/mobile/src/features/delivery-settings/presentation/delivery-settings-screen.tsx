import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import type { DeliverySettingsDraft } from "@mobile/features/delivery-settings/application/delivery-settings";
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
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  const initialized = useRef(false);
  const load = useCallback(async () => {
    if (!companyId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const result = await deliverySettings.get();
    if (result.success) { setDraft(draftFrom(result.data)); setError(""); setConflict(false); setSaved(false); }
    else setError("deliverySettingsLoadError");
    inFlight.current = false;
    setBusy(false);
  }, [companyId]);
  useEffect(() => {
    if (companyId && !initialized.current) { initialized.current = true; void load(); }
  }, [companyId, load]);

  const save = async () => {
    if (!draft || inFlight.current || conflict) return;
    inFlight.current = true;
    setBusy(true);
    setSaved(false);
    const result = await deliverySettings.save(draft);
    if (result.success) { setDraft(draftFrom(result.data)); setError(""); setSaved(true); }
    else {
      setConflict(result.error.code === "DELIVERY_SETTINGS_CONFLICT");
      setError(result.error.code === "DELIVERY_SETTINGS_CONFLICT" ? "deliverySettingsConflict"
        : result.error.code === "INVALID_DELIVERY_SETTINGS" || result.error.code === "INVALID_INPUT" ? "deliverySettingsInvalid" : "deliverySettingsSaveError");
    }
    inFlight.current = false;
    setBusy(false);
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
      </View>
      {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(error)}</ThemedText> : null}
      {saved ? <ThemedText accessibilityLiveRegion="polite">{t("deliverySettingsSaved")}</ThemedText> : null}
      <Button onPress={() => void save()} disabled={busy || conflict} loading={busy}>{t("saveDeliverySettings")}</Button>
      {conflict ? <Button variant="secondary" onPress={() => void load()} disabled={busy}>{t("reloadDeliverySettings")}</Button> : null}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { padding: 16, gap: 24, paddingBottom: 32, width: "100%", maxWidth: 640, alignSelf: "center" },
  heading: { gap: 8 }, section: { gap: 16 }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
