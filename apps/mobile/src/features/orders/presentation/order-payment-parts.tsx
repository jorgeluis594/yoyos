import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { useTheme } from "@mobile/hooks/use-theme";
import { normalizeDecimalInput } from "@mobile/shared/decimal-input";
import tokens from "../../../../../../docs/design-tokens.json";

export type PaymentMethod = "digital_wallet" | "bank_transfer";
export type PaymentBadgeStatus = "pending" | "partial" | "paid";
export type PillTone = "neutral" | "success" | "warning";

/** Pending without money in, partial while a balance remains, paid once nothing is owed. */
export const paymentBadgeStatus = (paid: number, balance: number): PaymentBadgeStatus => paid > 0 ? (balance > 0 ? "partial" : "paid") : balance > 0 ? "pending" : "paid";

export function StatusPill({ label, tone, symbol }: { label: string; tone: PillTone; symbol?: { ios: string; android: string } }) {
  const theme = useTheme();
  const color = tone === "success" ? theme.success : tone === "warning" ? theme.warning : theme.textSecondary;
  return <View accessible accessibilityLabel={label} style={[styles.pill, { backgroundColor: tone === "success" ? theme.successSurface : tone === "warning" ? theme.warningSurface : theme.secondary }]}>
    {symbol ? <SymbolView name={symbol as never} size={14} tintColor={color} /> : null}
    <ThemedText type="small" numberOfLines={1} style={{ color }}>{label}</ThemedText>
  </View>;
}

export function PaymentBadge({ status }: { status: PaymentBadgeStatus }) {
  const { t } = useTranslation();
  return status === "paid" ? <StatusPill tone="success" label={t('paymentPaid')} symbol={{ ios: "checkmark.circle", android: "check_circle" }} />
    : status === "partial" ? <StatusPill tone="warning" label={t('paymentPartial')} symbol={{ ios: "circle.lefthalf.filled", android: "timelapse" }} />
    : <StatusPill tone="warning" label={t('paymentPending')} symbol={{ ios: "clock", android: "schedule" }} />;
}

export function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <View style={styles.summaryRow}>
    <ThemedText themeColor={strong ? "text" : "textSecondary"} style={[styles.flex, strong && styles.strong]}>{label}</ThemedText>
    <ThemedText style={[styles.amount, strong && styles.strong]}>{value}</ThemedText>
  </View>;
}

/** Total always; paid and balance once at least one payment exists. */
export function PaymentSummary({ total, paid, balance, showPaid }: { total: string; paid: string; balance: string; showPaid: boolean }) {
  const { t } = useTranslation();
  return <View style={styles.gap8}>
    <SummaryRow label={t('detailTotal')} value={total} strong={!showPaid} />
    {showPaid ? <><SummaryRow label={t('paymentPaid')} value={paid} /><SummaryRow label={t('balanceLabel')} value={balance} strong /></> : null}
  </View>;
}

export function PaymentRow({ method, amount, meta, tag, onPress, accessibilityLabel, trailing }: {
  method: string; amount: string; meta?: string; tag?: string; onPress?: () => void; accessibilityLabel?: string; trailing?: React.ReactNode;
}) {
  const theme = useTheme();
  const body = <>
    <View style={styles.flex}>
      <View style={styles.methodLine}>
        <ThemedText style={styles.strong} numberOfLines={1}>{method}</ThemedText>
        {tag ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>· {tag}</ThemedText> : null}
      </View>
      {meta ? <ThemedText type="small" themeColor="textSecondary">{meta}</ThemedText> : null}
    </View>
    <ThemedText style={[styles.amount, styles.strong]}>{amount}</ThemedText>
    {onPress ? <SymbolView name={{ ios: "chevron.right", android: "chevron_right" }} size={18} tintColor={theme.textSecondary} /> : null}
  </>;
  return <View style={[styles.paymentRow, { borderColor: theme.border }]}>
    {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.paymentMain, { backgroundColor: pressed ? theme.backgroundSelected : "transparent" }]}>{body}</Pressable>
      : <View accessible accessibilityLabel={accessibilityLabel} style={styles.paymentMain}>{body}</View>}
    {trailing}
  </View>;
}

type StockOffer = Readonly<{ offered: boolean; reason: string | null }>;
type SheetProps = {
  visible: boolean;
  balance: number;
  currency: string;
  format: (amount: number) => string;
  busy: boolean;
  error: string;
  /** Whether "deduct stock now" applies to the typed amount, and why not when it does not. */
  stockOffer: (amount: number | null) => StockOffer;
  onClose: () => void;
  onSubmit: (value: { amount: string; method: PaymentMethod; deductStockIfPartial: boolean }) => void;
};

/** Floating sheet to register one payment: the full balance or another amount, plus the method. */
export function PaymentRegisterSheet({ visible, onClose, ...body }: SheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Pressable style={styles.scrim} accessibilityRole="button" accessibilityLabel={t('detailClose')} onPress={onClose} />
      <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View style={[styles.grab, { backgroundColor: theme.input }]} />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
          <View style={styles.sheetHeader}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t('detailRegisterPayment')}</ThemedText>
            <Button variant="ghost" onPress={onClose}>{t('detailClose')}</Button>
          </View>
          {visible ? <SheetBody {...body} /> : null}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}

function SheetBody({ balance, currency, format, busy, error, stockOffer, onSubmit }: Omit<SheetProps, "visible" | "onClose">) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [mode, setMode] = useState<"full" | "other">("full");
  const [other, setOther] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("digital_wallet");
  const [deduct, setDeduct] = useState(false);
  const typed = Number(normalizeDecimalInput(other));
  const amount = mode === "full" ? balance : other.trim() && Number.isFinite(typed) ? typed : null;
  const offer = mode === "other" ? stockOffer(amount) : { offered: false, reason: null };
  const methodLabel = (value: PaymentMethod) => t(value === "digital_wallet" ? 'wallet' : 'bankTransfer');
  const label = mode === "full" ? format(balance) : amount !== null && amount > 0 ? format(amount) : "";
  return <>
    <View accessibilityRole="radiogroup" style={styles.gap12}>
      <Pressable accessibilityRole="radio" accessibilityState={{ checked: mode === "full", disabled: busy }} disabled={busy} onPress={() => setMode("full")}
        style={[styles.option, { borderColor: mode === "full" ? theme.primary : theme.border }]}>
        <Radio selected={mode === "full"} />
        <ThemedText style={styles.flex}>{t('fullPayment', { amount: format(balance) })}</ThemedText>
      </Pressable>
      <View style={[styles.option, styles.optionColumn, { borderColor: mode === "other" ? theme.primary : theme.border }]}>
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: mode === "other", disabled: busy }} disabled={busy} onPress={() => setMode("other")} style={styles.optionHead}>
          <Radio selected={mode === "other"} />
          <ThemedText style={styles.flex}>{t('otherAmount')}</ThemedText>
        </Pressable>
        {mode === "other" ? <>
          <Field required invalid={!!error} disabled={busy}><FieldLabel>{t('amountShort')} ({currency})</FieldLabel>
            <Input value={other} keyboardType="decimal-pad" accessibilityLabel={`${t('amountShort')} (${currency})`} onChangeText={setOther} />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          {amount !== null && amount > 0 && amount < balance - 0.005
            ? <ThemedText type="small" themeColor="textSecondary">{t('balanceAfterAdvance', { amount: format(balance - amount) })}</ThemedText> : null}
        </> : null}
      </View>
    </View>
    <View style={styles.gap8}>
      <ThemedText type="small">{t('paymentMethod')}</ThemedText>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('paymentMethod')} style={styles.chips}>
        {(["digital_wallet", "bank_transfer"] as const).map(value => {
          const selected = method === value;
          return <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: busy }} accessibilityLabel={methodLabel(value)} disabled={busy}
            onPress={() => setMethod(value)}
            style={({ pressed }) => [styles.chip, { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected || pressed ? theme.accent : "transparent" }]}>
            {selected ? <SymbolView name={{ ios: "checkmark", android: "check" }} size={16} tintColor={theme.primary} /> : null}
            <ThemedText type="small" style={{ color: selected ? theme.primary : theme.text }}>{methodLabel(value)}</ThemedText>
          </Pressable>;
        })}
      </View>
    </View>
    {offer.offered ? <View style={styles.toggle}>
      <ThemedText style={styles.flex}>{t('deductStockNow')}</ThemedText>
      <Switch disabled={busy} value={deduct} onValueChange={setDeduct} accessibilityLabel={t('deductStockNow')} />
    </View> : mode === "other" && offer.reason ? <ThemedText type="small" themeColor="textSecondary">{offer.reason}</ThemedText> : null}
    {mode === "full" && error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{error}</ThemedText> : null}
    <Button disabled={busy || (mode === "other" && !(amount !== null && amount > 0))} loading={busy}
      onPress={() => onSubmit({ amount: mode === "full" ? balance.toFixed(2) : other, method, deductStockIfPartial: offer.offered && deduct })}>
      {t('registerAmount', { amount: label })}
    </Button>
  </>;
}

function Radio({ selected }: { selected: boolean }) {
  const theme = useTheme();
  return <View style={[styles.radio, { borderColor: selected ? theme.primary : theme.input }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: theme.primary }]} /> : null}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, strong: { fontWeight: 600 },
  gap8: { gap: 8 }, gap12: { gap: 12 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start", flexShrink: 0 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  amount: { fontVariant: ["tabular-nums"], textAlign: "right" },
  paymentRow: { flexDirection: "row", alignItems: "center", gap: 4, borderTopWidth: tokens.sizing.borderWidth },
  paymentMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56, paddingVertical: 8, borderRadius: 6 },
  methodLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { borderTopLeftRadius: tokens.radius.overlay, borderTopRightRadius: tokens.radius.overlay, borderTopWidth: tokens.sizing.borderWidth, maxHeight: "90%" },
  grab: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8 },
  sheetContent: { padding: 16, gap: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: tokens.radius.card, padding: 16, minHeight: 56 },
  optionColumn: { flexDirection: "column", alignItems: "stretch" },
  optionHead: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 32 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 48, paddingHorizontal: 14, borderRadius: 24, borderWidth: tokens.sizing.borderWidth, flexDirection: "row", alignItems: "center", gap: 6 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 48 },
});
