/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@mobile/components/ui/button";
import { ListRow } from "@mobile/components/ui/list-row";
import { ThemedText } from "@mobile/components/themed-text";
import { orders } from "@mobile/features/orders/composition";
import { dispatchPrinting } from "@mobile/features/orders/composition-dispatch-printing";
import { prepareDispatchLabels } from "@mobile/features/orders/application/order-printing";
import { resolveUnknown, runDispatchBatch, type DispatchBatchEnd, type DispatchPrintEntry } from "@mobile/features/orders/application/dispatch-print-batch";
import type { DispatchLabelExclusion, DispatchLabelPreparation } from "@mobile/features/orders/domain/dispatch-label";
import { usePrint } from "@mobile/features/printing/presentation/print-provider";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { useTheme } from "@mobile/hooks/use-theme";
import tokens from "../../../../../../docs/design-tokens.json";

type Reference = Readonly<{ id: string; number: number }>;
type Preparation = DispatchLabelPreparation<Readonly<{ message: string }>>;
type Phase =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "preparing" }>
  | Readonly<{ kind: "review"; results: readonly Preparation[] }>
  | Readonly<{ kind: "batch"; entries: readonly DispatchPrintEntry[]; running: boolean; end: DispatchBatchEnd | null }>;

const DispatchPrintContext = createContext<Readonly<{ open: (selected: readonly Reference[]) => void; active: boolean; show: () => void }> | null>(null);

/** In-memory dispatch print state above Ventas; it is dropped when the company or user changes. */
export function DispatchPrintProvider({ children }: { children: ReactNode }) {
  const { state } = useAccess();
  const key = state.status === "ready" ? `${state.user.id}:${state.company.id}` : "signed-out";
  return <DispatchPrintSession key={key} sender={state.status === "ready" ? state.company.name : null}>{children}</DispatchPrintSession>;
}

function DispatchPrintSession({ children, sender }: { children: ReactNode; sender: string | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const { showPrinterPicker, printerName } = usePrint();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [hidden, setHidden] = useState(false);
  const alive = useRef(true);
  const stopRequested = useRef(false);
  const [numbers, setNumbers] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const open = (selected: readonly Reference[]) => {
    if (!sender || !selected.length || phase.kind === "batch") return;
    setHidden(false);
    setNumbers(new Map(selected.map(({ id, number }) => [id, number])));
    setPhase({ kind: "preparing" });
    void (async () => {
      const fits = await dispatchPrinting.createFit();
      const results = await prepareDispatchLabels(selected.map(({ id }) => id), {
        sender, fits, readOrder: async (id) => { const read = await orders.get(id); return read.success ? read : { success: false, error: { message: read.error.message } }; },
      });
      if (alive.current) setPhase({ kind: "review", results });
    })().catch(() => { if (alive.current) setPhase({ kind: "idle" }); });
  };

  const run = (entries: readonly DispatchPrintEntry[]) => {
    stopRequested.current = false;
    setPhase({ kind: "batch", entries, running: true, end: null });
    void runDispatchBatch({
      entries, reserve: dispatchPrinting.reserve, render: dispatchPrinting.render,
      execution: { isSessionCurrent: () => alive.current, onStage: () => undefined },
      shouldStop: () => stopRequested.current || !alive.current,
      onChange: (changed) => { if (alive.current) setPhase({ kind: "batch", entries: changed, running: true, end: null }); },
    }).then((result) => { if (alive.current) setPhase({ kind: "batch", entries: result.entries, running: false, end: result.end }); });
  };

  const name = (orderId: string) => `#${numbers.get(orderId) ?? ""}`;
  const reason = (exclusion: DispatchLabelExclusion) => exclusion.code === "MISSING_DATA"
    ? t('dispatchMissingData', { fields: exclusion.fields.map((field) => t(`dispatchField_${field}`)).join(", ") }) : t(`dispatchExcluded_${exclusion.code}`);
  // A batch keeps its progress while hidden; only an explicit discard drops it.
  const close = () => (phase.kind === "batch" ? setHidden(true) : setPhase({ kind: "idle" }));

  const review = phase.kind === "review" ? {
    ready: phase.results.flatMap((r): DispatchPrintEntry[] => r.status === "ready" ? [{ orderId: r.orderId, label: r.label, state: { status: "pending" } }] : []),
    blocked: phase.results.filter((r) => r.status !== "ready"),
  } : null;

  const body = () => {
    if (phase.kind === "preparing") return <ThemedText themeColor="textSecondary">{t('dispatchPreparing')}</ThemedText>;
    if (review) return <>
      <View style={[styles.notice, review.blocked.length ? { backgroundColor: theme.warningSurface } : { backgroundColor: theme.successSurface }]}>
        <ThemedText type="smallBold" accessibilityRole="summary" style={{ color: review.blocked.length ? theme.warning : theme.success }}>
          {t('dispatchReviewSummary', { ready: review.ready.length, blocked: review.blocked.length })}
        </ThemedText>
      </View>
      {review.blocked.length ? <BoundedList>
        {review.blocked.map((r, index) => <View key={r.orderId} style={index ? [styles.separator, { borderColor: theme.border }] : null}>
          <ListRow title={name(r.orderId)} description={r.status === "read-error" ? t('dispatchReadError') : r.status === "excluded" ? reason(r.exclusion) : undefined}
            onPress={() => { close(); router.push(`/orders/${r.orderId}`); }} />
        </View>)}
      </BoundedList> : null}
      {review.blocked.length ? <ThemedText type="small" themeColor="textSecondary">{t('dispatchReprepareHint')}</ThemedText> : null}
      {review.ready.length ? <>
        <View style={[styles.printer, { borderColor: theme.border }]}>
          <View style={styles.grow}>
            <ThemedText type="small" themeColor="textSecondary">{t('printer')}</ThemedText>
            <ThemedText type="smallBold">{printerName ?? t('noPrinterSelected')}</ThemedText>
          </View>
          <Button variant="secondary" onPress={showPrinterPicker}>{printerName ? t('changePrinter') : t('choosePrinterAction')}</Button>
        </View>
        <ThemedText type="small" themeColor="textSecondary">{t('dispatchRollNotice')}</ThemedText>
      </> : null}
    </>;
    if (phase.kind === "batch") {
      const unresolved = phase.entries.some((e) => e.state.status === "unknown");
      return <>
        <ThemedText type="smallBold" accessibilityLiveRegion="polite">{t('dispatchProgress', { done: confirmedCount(phase.entries), total: phase.entries.length })}</ThemedText>
        {phase.end === "busy" ? <ThemedText accessibilityRole="alert">{t('dispatchBusy')}</ThemedText> : null}
        {phase.end === "selection-required" ? <ThemedText accessibilityRole="alert">{t('dispatchSelectPrinter')}</ThemedText> : null}
        {phase.end === "failed" ? <ThemedText accessibilityRole="alert">{t('dispatchFailed')}</ThemedText> : null}
        {phase.end === "stopped" ? <ThemedText>{t('dispatchStopped')}</ThemedText> : null}
        {phase.end === "completed" ? <ThemedText>{t('dispatchCompleted')}</ThemedText> : null}
        {unresolved ? <ThemedText accessibilityRole="alert">{t('dispatchUnknownHint')}</ThemedText> : null}
        <BoundedList>
          {phase.entries.map((entry, index) => <View key={entry.orderId} style={[styles.row, index ? [styles.separator, { borderColor: theme.border }] : null]}>
            <View style={styles.grow}>
              <ThemedText type="smallBold">{name(entry.orderId)} · {entry.label.recipient.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t(`dispatchState_${entry.state.status}`)}</ThemedText>
              {entry.state.status === "not-sent" || entry.state.status === "unknown" ? <ThemedText type="small">{entry.state.error.message}</ThemedText> : null}
            </View>
            {entry.state.status === "unknown" && !phase.running ? <View style={styles.actions}>
              <Button variant="secondary" onPress={() => setPhase({ ...phase, entries: resolveUnknown(phase.entries, entry.orderId, true) })}>{t('dispatchMarkPrinted')}</Button>
              <Button variant="secondary" onPress={() => setPhase({ ...phase, entries: resolveUnknown(phase.entries, entry.orderId, false) })}>{t('dispatchResend')}</Button>
            </View> : null}
          </View>)}
        </BoundedList>
      </>;
    }
    return null;
  };

  const footer = () => {
    if (review?.ready.length) return <Button onPress={() => run(review.ready)}>{t('dispatchPrint', { count: review.ready.length })}</Button>;
    if (phase.kind !== "batch") return null;
    if (phase.running) return <Button variant="secondary" onPress={() => { stopRequested.current = true; }}>{t('dispatchStop')}</Button>;
    const unresolved = phase.entries.some((e) => e.state.status === "unknown");
    return <View style={styles.actions}>
      <Button variant="ghost" onPress={() => setPhase({ kind: "idle" })}>{t('dispatchDiscard')}</Button>
      {phase.end === "selection-required" ? <Button variant="secondary" onPress={showPrinterPicker}>{t('choosePrinterAction')}</Button> : null}
      {phase.end !== "completed" && confirmedCount(phase.entries) < phase.entries.length ? <Button disabled={unresolved} onPress={() => run(phase.entries)}>{t('dispatchContinue')}</Button> : null}
    </View>;
  };

  return <DispatchPrintContext.Provider value={{ open, active: phase.kind === "batch", show: () => setHidden(false) }}>
    {children}
    <Modal visible={phase.kind !== "idle" && !hidden} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.scrim}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('close')} style={styles.dismiss} onPress={close} />
        <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.header}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.grow}>{t('dispatchTitle')}</ThemedText>
            <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={close}
              style={({ pressed }) => [styles.iconAction, { backgroundColor: pressed ? theme.accent : "transparent" }]}>
              <SymbolView name={{ ios: "xmark", android: "close" }} size={tokens.sizing.iconNavigation} tintColor={theme.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body}>{body()}</ScrollView>
          {review?.ready.length || phase.kind === "batch" ? <View style={styles.footer}>{footer()}</View> : null}
        </SafeAreaView>
      </View>
    </Modal>
  </DispatchPrintContext.Provider>;
}

const confirmedCount = (entries: readonly DispatchPrintEntry[]) =>
  entries.filter((e) => e.state.status === "confirmed" || e.state.status === "confirmed-by-user").length;

/** Bordered list capped at about three and a half rows so a partly visible row signals that it scrolls. */
function BoundedList({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.list, { borderColor: theme.border }]}>
    <ScrollView nestedScrollEnabled style={styles.listScroll}>{children}</ScrollView>
  </View>;
}

export function useDispatchPrint() {
  const value = useContext(DispatchPrintContext);
  if (!value) throw new Error("DispatchPrintProvider is required");
  return value;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.5)" },
  dismiss: { flex: 1 },
  sheet: { maxHeight: "85%", borderTopLeftRadius: tokens.radius.overlay, borderTopRightRadius: tokens.radius.overlay, borderWidth: tokens.sizing.borderWidth, borderBottomWidth: 0 },
  header: { minHeight: tokens.layout.appHeaderMinHeight, flexDirection: "row", alignItems: "center", gap: tokens.spacing["2"], paddingLeft: tokens.spacing["4"], paddingRight: tokens.spacing["1"] },
  iconAction: { width: tokens.sizing.touchTargetMinSize, height: tokens.sizing.touchTargetMinSize, borderRadius: tokens.sizing.touchTargetMinSize / 2, alignItems: "center", justifyContent: "center" },
  body: { gap: tokens.spacing["4"], paddingHorizontal: tokens.spacing["4"], paddingBottom: tokens.spacing["4"] },
  footer: { paddingHorizontal: tokens.spacing["4"], paddingTop: tokens.spacing["2"], paddingBottom: tokens.spacing["4"] },
  notice: { borderRadius: tokens.radius.control, padding: tokens.spacing["3"] },
  list: { borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card, overflow: "hidden" },
  listScroll: { maxHeight: tokens.sizing.listRowMobileMinHeight * 1.2 * 3.5 },
  separator: { borderTopWidth: tokens.sizing.borderWidth },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: tokens.spacing["2"], paddingHorizontal: tokens.spacing["4"], paddingVertical: tokens.spacing["2"] },
  printer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: tokens.spacing["3"], borderTopWidth: tokens.sizing.borderWidth, paddingTop: tokens.spacing["4"] },
  grow: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing["2"] },
});
