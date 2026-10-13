import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@mobile/components/ui/button";
import { ThemedText } from "@mobile/components/themed-text";
import { orders } from "@mobile/features/orders/composition";
import { dispatchPrinting } from "@mobile/features/orders/composition-dispatch-printing";
import { prepareDispatchLabels } from "@mobile/features/orders/application/order-printing";
import { resolveUnknown, runDispatchBatch, type DispatchBatchEnd, type DispatchPrintEntry } from "@mobile/features/orders/application/dispatch-print-batch";
import type { DispatchLabelExclusion, DispatchLabelPreparation } from "@mobile/features/orders/domain/dispatch-label";
import { usePrint } from "@mobile/features/printing/presentation/print-provider";
import { useAccess } from "@mobile/features/users/presentation/access-provider";

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
  const { showPrinterPicker, printerName } = usePrint();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [hidden, setHidden] = useState(false);
  const alive = useRef(true);
  const stopRequested = useRef(false);
  const [numbers, setNumbers] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => () => { alive.current = false; }, []);

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

  const body = () => {
    if (phase.kind === "preparing") return <ThemedText>{t('dispatchPreparing')}</ThemedText>;
    if (phase.kind === "review") {
      const ready = phase.results.flatMap((r): DispatchPrintEntry[] => r.status === "ready" ? [{ orderId: r.orderId, label: r.label, state: { status: "pending" } }] : []);
      const blocked = phase.results.filter((r) => r.status !== "ready");
      return <>
        <ThemedText type="smallBold" accessibilityRole="summary">{t('dispatchReviewSummary', { ready: ready.length, blocked: blocked.length })}</ThemedText>
        {blocked.map((r) => <View key={r.orderId} style={styles.row}>
          <View style={styles.grow}>
            <ThemedText type="smallBold">{name(r.orderId)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{r.status === "read-error" ? t('dispatchReadError') : r.status === "excluded" ? reason(r.exclusion) : ""}</ThemedText>
          </View>
          <Button variant="secondary" onPress={() => { close(); router.push(`/orders/${r.orderId}`); }}>{t('dispatchOpenOrder')}</Button>
        </View>)}
        {ready.length ? <>
          <ThemedText type="small">{t('dispatchRollNotice')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t('dispatchPrinter', { name: printerName ?? t('noPrinterSelected') })}</ThemedText>
          <Button onPress={() => run(ready)}>{t('dispatchPrint', { count: ready.length })}</Button>
        </> : null}
        <ThemedText type="small" themeColor="textSecondary">{t('dispatchReprepareHint')}</ThemedText>
      </>;
    }
    if (phase.kind === "batch") {
      const confirmed = phase.entries.filter((e) => e.state.status === "confirmed" || e.state.status === "confirmed-by-user").length;
      const unresolved = phase.entries.some((e) => e.state.status === "unknown");
      return <>
        <ThemedText type="smallBold" accessibilityLiveRegion="polite">{t('dispatchProgress', { done: confirmed, total: phase.entries.length })}</ThemedText>
        {phase.end === "busy" ? <ThemedText accessibilityRole="alert">{t('dispatchBusy')}</ThemedText> : null}
        {phase.end === "selection-required" ? <ThemedText accessibilityRole="alert">{t('dispatchSelectPrinter')}</ThemedText> : null}
        {phase.end === "failed" ? <ThemedText accessibilityRole="alert">{t('dispatchFailed')}</ThemedText> : null}
        {phase.end === "stopped" ? <ThemedText>{t('dispatchStopped')}</ThemedText> : null}
        {phase.end === "completed" ? <ThemedText>{t('dispatchCompleted')}</ThemedText> : null}
        {unresolved ? <ThemedText accessibilityRole="alert">{t('dispatchUnknownHint')}</ThemedText> : null}
        {phase.entries.map((entry) => <View key={entry.orderId} style={styles.row}>
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
        <View style={styles.actions}>
          {phase.running ? <Button variant="secondary" onPress={() => { stopRequested.current = true; }}>{t('dispatchStop')}</Button> : <>
            <Button variant="ghost" onPress={() => setPhase({ kind: "idle" })}>{t('dispatchDiscard')}</Button>
            {phase.end === "selection-required" ? <Button variant="secondary" onPress={showPrinterPicker}>{t('choosePrinterAction')}</Button> : null}
            {phase.end !== "completed" && confirmed < phase.entries.length ? <Button disabled={unresolved} onPress={() => run(phase.entries)}>{t('dispatchContinue')}</Button> : null}
          </>}
        </View>
      </>;
    }
    return null;
  };

  return <DispatchPrintContext.Provider value={{ open, active: phase.kind === "batch", show: () => setHidden(false) }}>
    {children}
    <Modal visible={phase.kind !== "idle" && !hidden} animationType="slide" onRequestClose={close}>
      <ScrollView contentContainerStyle={styles.screen}>
        <ThemedText type="subtitle" accessibilityRole="header">{t('dispatchTitle')}</ThemedText>
        {body()}
        <Button variant="ghost" onPress={close}>{t('close')}</Button>
      </ScrollView>
    </Modal>
  </DispatchPrintContext.Provider>;
}

export function useDispatchPrint() {
  const value = useContext(DispatchPrintContext);
  if (!value) throw new Error("DispatchPrintProvider is required");
  return value;
}

const styles = StyleSheet.create({
  screen: { padding: 24, paddingTop: 64, gap: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  grow: { flex: 1, minWidth: 160 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
