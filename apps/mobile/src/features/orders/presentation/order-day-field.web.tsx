import { View } from "react-native";
import { ThemedText } from "@mobile/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";

export function OrderDayField({ label, value, onChange }: { label: string; value: string; onChange: (day: string) => void }) {
  const theme = useTheme();
  return <View style={{ gap: 4 }}><ThemedText type="small">{label}</ThemedText>
    <input type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-label={`${label}, año mes día`}
      style={{ minHeight: 44, padding: 8, borderRadius: 8, border: `1px solid ${theme.input}`, background: theme.backgroundElement, color: theme.text }} />
  </View>;
}
