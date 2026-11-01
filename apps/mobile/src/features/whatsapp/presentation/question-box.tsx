import { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import type { QuestionPoint } from "@mobile/features/whatsapp/infrastructure/message-questions-api";
import { useTheme } from "@mobile/hooks/use-theme";

/** A question the seller may send the buyer. A copy the system refuses fails silently: the text stays selectable. */
export function QuestionBox({ point }: Readonly<{ point: QuestionPoint }>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (copied) AccessibilityInfo.announceForAccessibility(t("whatsappQuestionCopied")); }, [copied, t]);
  const copy = async () => {
    try { if (await Clipboard.setStringAsync(point.text)) setCopied(true); }
    catch { /* The seller can select the text instead. */ }
  };
  return (
    <View style={[styles.box, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="smallBold">{t("whatsappQuestionTitle")}</ThemedText>
      <ThemedText selectable>{point.text}</ThemedText>
      <Button variant="secondary" onPress={() => void copy()}>{t("whatsappQuestionCopy")}</Button>
      {copied ? <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{t("whatsappQuestionCopied")}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 16, marginBottom: 4, padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
});
