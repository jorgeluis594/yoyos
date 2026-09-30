import { useState } from "react";
import { View } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";

export const calendarDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function OrderDayField({ label, value, onChange }: { label: string; value: string; onChange: (day: string) => void }) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 4 }}>
    <ThemedText type="small">{label}</ThemedText>
    <Button variant="secondary" accessibilityLabel={`${label}: ${value || "Elegir día"}`} onPress={() => setOpen(true)}>{value || "Elegir día"}</Button>
    {value ? <Button variant="ghost" onPress={() => onChange("")}>{`Limpiar ${label.toLowerCase()}`}</Button> : null}
    {open ? <DateTimePicker testID={`order-${label.toLowerCase()}-picker`} value={value ? new Date(`${value}T12:00:00`) : new Date()}
      mode="date" onValueChange={(_event, date) => { onChange(calendarDay(date)); setOpen(false); }} onDismiss={() => setOpen(false)} /> : null}
  </View>;
}
