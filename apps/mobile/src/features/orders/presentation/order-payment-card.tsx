import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import type { DraftPayment } from "@mobile/features/orders/domain/order-draft";
import { PaymentBadge, PaymentRegisterSheet, PaymentRow, PaymentSummary, paymentBadgeStatus, type PaymentMethod } from "@mobile/features/orders/presentation/order-payment-parts";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { useTheme } from "@mobile/hooks/use-theme";
import { normalizeDecimalInput } from "@mobile/shared/decimal-input";
import tokens from "../../../../../../docs/design-tokens.json";

type Props = {
  payments: readonly DraftPayment[];
  total: number | null;
  /** False while the delivery charge is still unknown, so the amounts are not yet the sale total. */
  totalConfirmed: boolean;
  currency: string;
  busy: boolean;
  format: (amount: number) => string;
  onPaymentsChange: (update: (payments: readonly DraftPayment[]) => readonly DraftPayment[]) => void;
  newId: () => string;
};

const validAmount = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) > 0;
const cents = (amount: number) => Math.round(amount * 100);
const amountCents = (payment: DraftPayment) => validAmount(payment.amount) ? cents(Number(payment.amount)) : 0;

/** Payments of a sale being built: status at a glance, amounts, the entered payments and one action to register more. */
export function OrderPaymentCard({ payments, total, totalConfirmed, currency, busy, format, onPaymentsChange, newId }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [sheet, setSheet] = useState(false);
  const [invalid, setInvalid] = useState(false);
  // Whole cents, so sums such as 10.10 + 20.20 settle a 30.30 order exactly.
  const paidCents = payments.reduce((sum, payment) => sum + amountCents(payment), 0);
  const totalCents = total === null ? 0 : cents(total);
  const paid = paidCents / 100;
  const balance = Math.max(0, totalCents - paidCents) / 100;
  // A payment is an advance when the cumulative amount after it still leaves a balance.
  const advanceIds = new Set<string>();
  payments.reduce((running, payment) => {
    const next = running + amountCents(payment);
    if (next < totalCents) advanceIds.add(payment.paymentId);
    return next;
  }, 0);
  const status = paymentBadgeStatus(paid, balance);
  const methodLabel = (method: PaymentMethod) => t(method === "digital_wallet" ? 'wallet' : 'bankTransfer');
  const open = () => { setInvalid(false); setSheet(true); };

  return <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
    <View style={styles.header}>
      <ThemedText type="subtitle" accessibilityRole="header" style={styles.title}>{t('payments')}</ThemedText>
      <PaymentBadge status={status} />
    </View>
    {total !== null && totalConfirmed ? <PaymentSummary total={format(total)} paid={format(paid)} balance={format(balance)} showPaid={payments.length > 0} /> : null}
    {total !== null && paidCents > totalCents ? <ThemedText type="small" style={{ color: theme.warning }}>{t('overpaid', { amount: format((paidCents - totalCents) / 100) })}</ThemedText> : null}
    {payments.map(payment => <PaymentRow key={payment.paymentId} method={methodLabel(payment.method)} amount={validAmount(payment.amount) ? format(Number(payment.amount)) : payment.amount}
      tag={advanceIds.has(payment.paymentId) ? t('advancePayment') : undefined}
      trailing={<Pressable accessibilityRole="button" accessibilityLabel={`${t('removePayment')} ${validAmount(payment.amount) ? format(Number(payment.amount)) : payment.amount}`} disabled={busy}
        onPress={() => onPaymentsChange(current => current.filter(row => row.paymentId !== payment.paymentId))} style={styles.remove}>
        <SymbolView name={{ ios: "xmark", android: "close" }} size={18} tintColor={theme.textSecondary} />
      </Pressable>} />)}
    {total !== null && balance > 0 ? <Button disabled={busy} onPress={open}>{payments.length ? t('collectBalance', { amount: format(balance) }) : t('detailRegisterPayment')}</Button> : null}
    {payments.length === 0 ? <ThemedText type="small" themeColor="textSecondary">{t('noInitialPayments')}</ThemedText> : null}

    <PaymentRegisterSheet visible={sheet} balance={balance} currency={currency} format={format} busy={busy}
      error="" amountError={invalid ? t('invalidPaymentAmount') : ""}
      stockOffer={amount => amount === null || cents(amount) < cents(balance) ? { offered: true, reason: null }
        : { offered: false, reason: t('stockWithFullPayment') }}
      onClose={() => setSheet(false)}
      onSubmit={({ amount, method, deductStockIfPartial }) => {
        const normalized = normalizeDecimalInput(amount.trim());
        if (!validAmount(normalized)) { setInvalid(true); return; }
        onPaymentsChange(current => [...current, { paymentId: newId(), amount: normalized, method, deductStockIfPartial }]);
        setSheet(false);
      }} />
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card, padding: 16, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1 },
  remove: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
