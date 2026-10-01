import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";

export function OrderDayField({ label, value, onChange }: { label: string; value: string; onChange: (day: string) => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return <View style={{ gap: 4 }}><ThemedText type="small">{label}</ThemedText>
    <input type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-label={t('dateAccessibility', { label })}
      style={{ minHeight: 44, padding: 8, borderRadius: 8, border: `1px solid ${theme.input}`, background: theme.backgroundElement, color: theme.text }} />
  </View>;
}
