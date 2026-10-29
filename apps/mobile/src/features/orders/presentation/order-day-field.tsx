import { useState } from "react";
import { View } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { DeliveryRow, deliveryRowSymbols } from "@mobile/features/orders/presentation/order-delivery-parts";

export const calendarDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function OrderDayField({ label, value, onChange, row = false }: { label: string; value: string; onChange: (day: string) => void; row?: boolean }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  return <View style={{ gap: 4 }}>
    {row ? <DeliveryRow symbol={deliveryRowSymbols.dispatch} label={label} value={value || t('chooseDay')} muted={!value} onPress={() => setOpen(true)} /> : <>
      <ThemedText type="small">{label}</ThemedText>
      <Button variant="secondary" accessibilityLabel={`${label}: ${value || t('chooseDay')}`} onPress={() => setOpen(true)}>{value || t('chooseDay')}</Button>
    </>}
    {value ? <Button variant="ghost" onPress={() => onChange("")}>{t('clearDay', { label: label.toLowerCase() })}</Button> : null}
    {open ? <DateTimePicker testID={`order-${label.toLowerCase()}-picker`} value={value ? new Date(`${value}T12:00:00`) : new Date()}
      mode="date" onValueChange={(_event, date) => { onChange(calendarDay(date)); setOpen(false); }} onDismiss={() => setOpen(false)} /> : null}
  </View>;
}
