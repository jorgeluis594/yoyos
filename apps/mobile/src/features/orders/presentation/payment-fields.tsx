import { StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { DraftPayment } from "@mobile/features/orders/domain/order-draft";
import { Field, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { OptionSelector } from "@mobile/components/ui/option-selector";
import { choiceOfPayment, defaultPaymentChoice, isPaymentChoice, paymentChoices, paymentFromChoice } from "@shared/wallet-providers";
import { paymentMethodLabel } from "@mobile/features/orders/presentation/order-payment-parts";
import { ThemedText } from "@mobile/components/themed-text";

export type PaymentFieldsValue = Omit<DraftPayment, "paymentId">;
export function PaymentFields({ value, onChange, currency, busy, compact = false, showStockOption = true }: { value: PaymentFieldsValue; onChange: (value: PaymentFieldsValue) => void; currency: string; busy: boolean; compact?: boolean; showStockOption?: boolean }) {
  const { t } = useTranslation();
  return <View style={styles.fields}>
    <Field required disabled={busy}><FieldLabel>{t(compact ? 'amountShort' : 'paymentAmount')} ({currency})</FieldLabel>
      <Input value={value.amount} onChangeText={amount => onChange({ ...value, amount })} keyboardType="decimal-pad" accessibilityLabel={t('paymentAmount')} /></Field>
    <Field required disabled={busy}><FieldLabel>{t(compact ? 'methodShort' : 'paymentMethod')}</FieldLabel><OptionSelector options={paymentChoices.map(choice => ({ value: choice, label: paymentMethodLabel(t, paymentFromChoice(choice)) }))}
      value={choiceOfPayment(value) ?? defaultPaymentChoice} onValueChange={choice => { if (isPaymentChoice(choice)) onChange({ amount: value.amount, deductStockIfPartial: value.deductStockIfPartial, ...paymentFromChoice(choice) }); }} /></Field>
    {showStockOption ? <View style={styles.toggle}><ThemedText style={styles.label}>{t('deductStockIfPartial')}</ThemedText>
      <Switch disabled={busy} value={value.deductStockIfPartial} onValueChange={deductStockIfPartial => onChange({ ...value, deductStockIfPartial })} accessibilityLabel={t('deductStockIfPartial')} /></View> : null}
  </View>;
}
const styles = StyleSheet.create({ fields: { gap: 12 }, toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 }, label: { flex: 1 } });
