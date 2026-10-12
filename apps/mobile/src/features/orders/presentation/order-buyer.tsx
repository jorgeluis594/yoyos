import { StyleSheet, View, type StyleProp, type TextStyle } from "react-native";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";

type Props = Readonly<{ buyer: OrderAggregateResponse["buyer"]; source: OrderAggregateResponse["source"]; style?: StyleProp<TextStyle>; labelled?: boolean }>;

// Text is name ?? phone; "Público general" is only for orders without an OrderBuyer.
export function OrderBuyerName({ buyer, source, style, labelled }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const text = buyer === null ? t("generalPublic") : buyer.name ?? buyer.phone;
  return <View style={styles.row}>
    {source === "whatsapp" ? <View accessible accessibilityRole="image" accessibilityLabel="WhatsApp">
      <SymbolView name={{ ios: "message.fill", android: "chat" }} size={18} tintColor={theme.success} /></View> : null}
    {text !== null ? <ThemedText style={[styles.text, style]} accessibilityLabel={labelled ? `${t("detailBuyer")}: ${text}` : undefined}>{text}</ThemedText> : null}
  </View>;
}

const styles = StyleSheet.create({ row: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }, text: { flexShrink: 1 } });
