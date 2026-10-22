import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { useTheme } from "@mobile/hooks/use-theme";
import type { StoreLogo } from "@mobile/features/store-appearance/application/store-appearance";
import type { LogoState } from "@mobile/features/store-appearance/presentation/use-store-appearance";
import type { LogoAsset } from "@mobile/features/store-appearance/domain/logo-file";

const failureText = { UNSUPPORTED_FORMAT: "appearanceUploadTypeError", FILE_TOO_HEAVY: "appearanceUploadSizeError", DIMENSIONS_TOO_LARGE: "appearanceUploadDimensionsError", UPLOAD_FAILED: "appearanceUploadError" } as const;

export function LogoSection({ logo, state, disabled, onChoose, onRetry, onRemove }: Readonly<{
  logo: StoreLogo | null; state: LogoState; disabled: boolean;
  onChoose: (source: LogoAsset["source"]) => Promise<"permission_denied" | undefined>; onRetry: () => void; onRemove: () => void;
}>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const uploading = state.kind === "uploading";
  const locked = disabled || uploading;
  const shown = logo?.url ?? null;
  const choose = (source: LogoAsset["source"]) => void onChoose(source).then(outcome => { if (outcome === "permission_denied") Alert.alert(t("cameraPermission"), t("cameraPermissionHint")); });
  const chooseSource = () => Alert.alert(t("appearanceLogoTitle"), undefined, [
    { text: t("chooseGallery"), onPress: () => choose("library") },
    { text: t("takePhoto"), onPress: () => choose("camera") },
    { text: t("cancel"), style: "cancel" },
  ]);
  return <View style={[styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
    <ThemedText type="subtitle" accessibilityRole="header">{t("appearanceLogoTitle")}</ThemedText>
    <View style={styles.row}>
      <View style={styles.plate}>{shown ? <Image source={{ uri: shown }} contentFit="contain" style={styles.image} accessibilityLabel={t("appearanceLogoLabel")} /> : null}</View>
      <View style={styles.copy}>
        {uploading ? <View style={styles.row}><ActivityIndicator color={theme.textSecondary} /><ThemedText accessibilityLiveRegion="polite">{t("appearanceLogoUploading")}</ThemedText></View>
          : shown ? null : <ThemedText>{t("appearanceLogoNone")}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">{t("appearanceLogoHint")}</ThemedText>
      </View>
    </View>
    {state.kind === "failed" ? <View style={styles.copy}>
      <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{t(failureText[state.code])}</ThemedText>
      {state.code === "UPLOAD_FAILED" ? <Button variant="secondary" disabled={disabled} onPress={onRetry}>{t("retry")}</Button> : null}
    </View> : null}
    <View style={styles.actions}>
      <Button variant="secondary" disabled={locked} onPress={chooseSource}>{t(shown ? "appearanceLogoChange" : "appearanceLogoUpload")}</Button>
      {shown ? <Button variant="ghost" disabled={locked} onPress={onRemove}>{t("appearanceLogoRemove")}</Button> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, padding: 16, borderWidth: 1, borderRadius: 8 }, row: { flexDirection: "row", alignItems: "center", gap: 12 }, copy: { flex: 1, gap: 8 },
  plate: { width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderColor: "#E5E5E5", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: 56, height: 56 }, actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
});
