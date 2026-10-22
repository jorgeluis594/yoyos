import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { useTheme } from "@mobile/hooks/use-theme";
import { useIosAnnouncement } from "@mobile/features/store-appearance/presentation/announce-on-ios";
import type { SaveState } from "@mobile/features/store-appearance/presentation/use-store-appearance";

/** Fixed under the content, above the tab bar. At the unknown-theme starting point it shows only **Guardar cambios**. */
export function SaveBar({ changed, uploading, save, onDiscard, onSave }: Readonly<{ changed: boolean; uploading: boolean; save: SaveState; onDiscard: () => void; onSave: () => void }>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const saving = save.kind === "saving";
  const failure = save.kind === "failed" ? (save.code === "INVALID_IMAGE" ? "appearanceInvalidLogo" : save.code === "INVALID_STORE_APPEARANCE" ? "appearanceInvalidTheme" : "appearanceSaveError") : null;
  useIosAnnouncement(failure ? t(failure) : null);
  return <View style={[styles.bar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
    {changed ? <ThemedText type="smallBold">{t("appearanceUnsaved")}</ThemedText> : null}
    {failure ? <ThemedText type="small" accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: theme.error }}>{t(failure)}</ThemedText> : null}
    <View style={styles.actions}>
      {changed ? <View style={styles.action}><Button variant="secondary" disabled={saving || uploading} onPress={onDiscard}>{t("discard")}</Button></View> : null}
      <View style={styles.action}><Button disabled={saving || uploading} onPress={onSave}>{t(saving ? "appearanceSaving" : failure === "appearanceSaveError" ? "retry" : "appearanceSave")}</Button></View>
    </View>
  </View>;
}

const styles = StyleSheet.create({ bar: { gap: 8, padding: 16, borderTopWidth: 1 }, actions: { flexDirection: "row", gap: 8 }, action: { flex: 1 } });
