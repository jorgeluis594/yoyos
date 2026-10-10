import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import type { DraftPayment } from "@mobile/features/orders/domain/order-draft";
import { PaymentFields } from "@mobile/features/orders/presentation/payment-fields";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { useTheme } from "@mobile/hooks/use-theme";
import tokens from "../../../../../../docs/design-tokens.json";

type Method = DraftPayment["method"];
type Props = {
  payments: readonly DraftPayment[];
  paidPaymentId: string | null;
  balance: string | null;
  total: number | null;
  currency: string;
  busy: boolean;
  format: (amount: number) => string;
  onPaymentsChange: (update: (payments: readonly DraftPayment[]) => readonly DraftPayment[]) => void;
  onPaidChange: (paymentId: string | null) => void;
  newId: () => string;
};

const validAmount = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) > 0;

export function OrderPaymentCard({ payments, paidPaymentId, balance, total, currency, busy, format, onPaymentsChange, onPaidChange, newId }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [sheet, setSheet] = useState<{ paymentId: string; amount: string; method: Method } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const paid = !!paidPaymentId && payments.some(payment => payment.paymentId === paidPaymentId);
  const remainingFor = (paymentId: string) => total === null ? null : total - payments
    .filter(payment => payment.paymentId !== paymentId).reduce((sum, payment) => sum + (validAmount(payment.amount) ? Number(payment.amount) : 0), 0);
  const remaining = sheet ? remainingFor(sheet.paymentId) : null;
  const methodLabel = (method: Method) => t(method === "digital_wallet" ? 'wallet' : 'bankTransfer');

  const openSheet = (payment?: DraftPayment) => {
    setInvalid(false);
    if (payment) { setSheet({ paymentId: payment.paymentId, amount: payment.amount, method: payment.method }); return; }
    const paymentId = newId();
    const suggested = remainingFor(paymentId);
    setSheet({ paymentId, amount: suggested !== null && suggested > 0 ? suggested.toFixed(2) : "", method: "digital_wallet" });
  };
  const confirm = () => {
    if (!sheet) return;
    if (!validAmount(sheet.amount)) { setInvalid(true); return; }
    const editing = payments.some(payment => payment.paymentId === sheet.paymentId);
    const covers = remaining === null || Number(sheet.amount) >= remaining - 0.005;
    const next: DraftPayment = { paymentId: sheet.paymentId, amount: sheet.amount, method: sheet.method, deductStockIfPartial: false };
    onPaymentsChange(current => editing ? current.map(payment => payment.paymentId === next.paymentId ? next : payment) : [...current, next]);
    onPaidChange(covers ? sheet.paymentId : null);
    setSheet(null);
  };
  const choosePending = () => {
    if (!paid) return;
    onPaymentsChange(current => current.filter(payment => payment.paymentId !== paidPaymentId));
    onPaidChange(null);
  };

  return <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
    <ThemedText type="subtitle" accessibilityRole="header">{t('payments')}</ThemedText>
    <View accessibilityRole="radiogroup" accessibilityLabel={t('paymentStatus')} style={[styles.segment, { backgroundColor: theme.secondary }]}>
      {([["pending", t('paymentPending'), "clock", "schedule"], ["paid", t('paymentPaid'), "checkmark", "check"]] as const).map(([value, label, ios, android]) => {
        const selected = (value === "paid") === paid;
        return <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected, disabled: busy }} disabled={busy}
          onPress={() => value === "paid" ? paid ? undefined : openSheet() : choosePending()}
          style={({ pressed }) => [styles.segmentItem, { backgroundColor: selected ? theme.backgroundElement : pressed ? theme.accent : "transparent" }]}>
          <SymbolView name={{ ios, android }} size={18} tintColor={selected ? theme.text : theme.textSecondary} />
          <ThemedText type="small" style={{ color: selected ? theme.text : theme.textSecondary }}>{label}</ThemedText>
        </Pressable>;
      })}
    </View>

    {paid ? payments.map(payment => <View key={payment.paymentId} style={[styles.paidRow, { borderColor: theme.border }]}>
      <View style={styles.flex}>
        <ThemedText style={styles.amount}>{validAmount(payment.amount) ? format(Number(payment.amount)) : payment.amount}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{payment.paymentId === paidPaymentId ? methodLabel(payment.method) : `${t('advancePayment')} · ${methodLabel(payment.method)}`}</ThemedText>
      </View>
      {payment.paymentId === paidPaymentId ? <Button variant="ghost" disabled={busy} accessibilityLabel={t('editPayment')} onPress={() => openSheet(payment)}>{t('editShort')}</Button> : null}
    </View>) : <>
      <ThemedText type="small" themeColor="textSecondary">{balance ? t('paymentPendingHint', { amount: balance }) : t('noInitialPayments')}</ThemedText>
      {payments.map((payment, index) => <View key={payment.paymentId} style={[styles.advance, { borderColor: theme.border }]}>
        <ThemedText type="smallBold">{t('initialPayment', { number: index + 1 })}</ThemedText>
        <PaymentFields value={payment} currency={currency} busy={busy} compact
          onChange={value => onPaymentsChange(current => current.map(row => row.paymentId === payment.paymentId ? { ...value, paymentId: row.paymentId } : row))} />
        <Button variant="ghost" disabled={busy} onPress={() => onPaymentsChange(current => current.filter(row => row.paymentId !== payment.paymentId))}>{t('remove')}</Button>
      </View>)}
      <Button variant="ghost" disabled={busy} onPress={() => onPaymentsChange(current => [...current, { paymentId: newId(), amount: "", method: "digital_wallet", deductStockIfPartial: false }])}>{t('addInitialPayment')}</Button>
    </>}

    <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={styles.scrim} accessibilityRole="button" accessibilityLabel={t('detailClose')} onPress={() => setSheet(null)} />
        <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={[styles.grab, { backgroundColor: theme.input }]} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
            <View style={styles.sheetHeader}>
              <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t('markAsPaid')}</ThemedText>
              <Button variant="ghost" onPress={() => setSheet(null)}>{t('detailClose')}</Button>
            </View>
            <ThemedText type="small" themeColor="textSecondary">{t('markAsPaidHint')}</ThemedText>
            {sheet ? <>
              <Field required invalid={invalid}><FieldLabel>{t('paymentAmount')} ({currency})</FieldLabel>
                <Input value={sheet.amount} keyboardType="decimal-pad" onChangeText={amount => { setInvalid(false); setSheet({ ...sheet, amount }); }} />
                {invalid ? <FieldError>{t('invalidPaymentAmount')}</FieldError> : null}
              </Field>
              {remaining !== null && validAmount(sheet.amount) && Number(sheet.amount) < remaining - 0.005
                ? <ThemedText type="small" style={{ color: theme.warning }}>{t('belowBalanceHint')}</ThemedText> : null}
              <View style={styles.gap8}>
                <ThemedText type="small">{t('paymentMethod')}</ThemedText>
                <View accessibilityRole="radiogroup" accessibilityLabel={t('paymentMethod')} style={styles.chips}>
                  {(["digital_wallet", "bank_transfer"] as const).map(method => {
                    const selected = sheet.method === method;
                    return <Pressable key={method} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={methodLabel(method)}
                      onPress={() => setSheet({ ...sheet, method })}
                      style={({ pressed }) => [styles.chip, { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected || pressed ? theme.accent : "transparent" }]}>
                      {selected ? <SymbolView name={{ ios: "checkmark", android: "check" }} size={16} tintColor={theme.primary} /> : null}
                      <ThemedText type="small" style={{ color: selected ? theme.primary : theme.text }}>{methodLabel(method)}</ThemedText>
                    </Pressable>;
                  })}
                </View>
              </View>
              <View style={styles.gap8}>
                <ThemedText type="small">{t('receiptLabel')}</ThemedText>
                <View accessibilityState={{ disabled: true }} style={[styles.drop, { borderColor: theme.input }]}>
                  <SymbolView name={{ ios: "doc.text.image", android: "receipt_long" }} size={24} tintColor={theme.textSecondary} />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{t('receiptSoon')}</ThemedText>
                </View>
              </View>
            </> : null}
            <Button onPress={confirm}>{t('confirmPayment')}</Button>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card, padding: 16, gap: 12 },
  segment: { flexDirection: "row", borderRadius: tokens.radius.card, padding: 3, gap: 3 },
  segmentItem: { flex: 1, minHeight: 42, borderRadius: tokens.radius.control, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  paidRow: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: tokens.sizing.borderWidth, paddingTop: 12 },
  amount: { fontWeight: 600, fontVariant: ["tabular-nums"] },
  advance: { gap: 12, borderTopWidth: tokens.sizing.borderWidth, paddingTop: 12 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { borderTopLeftRadius: tokens.radius.overlay, borderTopRightRadius: tokens.radius.overlay, borderTopWidth: tokens.sizing.borderWidth, maxHeight: "90%" },
  grab: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8 },
  sheetContent: { padding: 16, gap: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  gap8: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 48, paddingHorizontal: 14, borderRadius: 24, borderWidth: tokens.sizing.borderWidth, flexDirection: "row", alignItems: "center", gap: 6 },
  drop: { borderWidth: 1.5, borderStyle: "dashed", borderRadius: tokens.radius.card, padding: 16, alignItems: "center", gap: 6 },
  center: { textAlign: "center" },
});
