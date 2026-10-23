import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { useTheme } from "@mobile/hooks/use-theme";
import { useNotices } from "./notices-provider";

/** Non-blocking notice while notification permission is off (never asked, «Ahora no» or denied). */
export function NoticesOffBanner() {
  const { t } = useTranslation();
  const theme = useTheme();
  const notices = useNotices();
  if (notices === null || notices.permission === null || notices.permission === "granted") return null;
  return (
    <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small">{t("noticesOff")}</ThemedText>
      <Button variant="secondary" onPress={() => void notices.enable()}>{t("noticesEnable")}</Button>
    </View>
  );
}

const styles = StyleSheet.create({ banner: { padding: 12, borderRadius: 8, gap: 12 } });
