import { useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { useTheme } from "@mobile/hooks/use-theme";

type QuestionPoint = Readonly<{ id: string; text: string; about: string }>;

/** A question the seller may send the buyer. A copy the system refuses fails silently: the text stays selectable. */
export function QuestionBox({ point }: Readonly<{ point: QuestionPoint }>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { if (await Clipboard.setStringAsync(point.text)) { setCopied(true); AccessibilityInfo.announceForAccessibility(t("whatsappQuestionCopied")); } }
    catch { /* The seller can select the text instead. */ }
  };
  return (
    <View style={[styles.box, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="smallBold">{t("whatsappQuestionTitle")}</ThemedText>
      <ThemedText selectable>{point.text}</ThemedText>
      <Button variant="secondary" accessibilityLabel={point.about === "" ? undefined : t("whatsappQuestionCopyAbout", { about: point.about })} onPress={() => void copy()}>{t("whatsappQuestionCopy")}</Button>
      {copied ? <ThemedText type="small" themeColor="textSecondary">{t("whatsappQuestionCopied")}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 16, marginBottom: 4, padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
});
