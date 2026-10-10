import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@mobile/components/ui/button";
import { ThemedText } from "@mobile/components/themed-text";
import { ThemedView } from "@mobile/components/themed-view";
import { useAccess } from "@mobile/features/users/presentation/access-provider";
import { cleanOldPrintDocuments, printing, type PrintExecution, type PrintStage, type PrinterSelection } from "@mobile/features/printing/composition";
import translations from '@mobile/i18n';

type AttemptResult =
  | Readonly<{ status: "completed" }>
  | Readonly<{ status: "selection-required" }>
  | Readonly<{ status: "failed"; message: string; outcome: "not-sent" | "unknown" }>;
export type PrintWork = (execution: PrintExecution) => Promise<AttemptResult>;
type Notice =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "preparing" | PrintStage | "selecting-printer"; id: number }>
  | Readonly<{ status: "succeeded"; id: number }>
  | Readonly<{ status: "failed"; id: number; message: string; outcome: "not-sent" | "unknown" }>;
type PrintContextValue = Readonly<{
  startAttempt: (work: PrintWork) => void;
  showPrinterPicker: () => void;
  dismissNotice: () => void;
  printerName: string | null;
}>;

const PrintContext = createContext<PrintContextValue | null>(null);

export function PrintProvider({ children }: { children: ReactNode }) {
  const { state } = useAccess();
  const sessionKey = state.status === "ready" ? `${state.user.id}:${state.company.id}` : null;
  useEffect(() => { void cleanOldPrintDocuments(); }, []);
  return <PrintSession key={sessionKey ?? "signed-out"} sessionKey={sessionKey}>{children}</PrintSession>;
}

function PrintSession({ children, sessionKey }: { children: ReactNode; sessionKey: string | null }) {
  const { t } = useTranslation();
  const sessionRef = useRef(sessionKey);
  const sequence = useRef(0);
  const selectionRevision = useRef(0);
  const searchRevision = useRef(0);
  const activeWork = useRef<PrintWork | null>(null);
  const [notice, setNotice] = useState<Notice>({ status: "idle" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [printers, setPrinters] = useState<readonly PrinterSelection[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [selection, setSelection] = useState<PrinterSelection | null>(null);
  const [preferenceWarning, setPreferenceWarning] = useState<string | null>(null);
  const [confirmRetry, setConfirmRetry] = useState(false);

  useEffect(() => {
    if (!sessionKey) return;
    const startedAt = selectionRevision.current;
    void printing.loadPrinterPreference().then((result) => {
      if (sessionRef.current !== sessionKey || selectionRevision.current !== startedAt) return;
      if (result.success) setSelection(result.data);
      else setPreferenceWarning(translations.t('printerPreferenceError'));
    });
    return () => { sessionRef.current = null; };
  }, [sessionKey]);

  const search = () => {
    const revision = ++searchRevision.current;
    setSearching(true);
    setPickerError(null);
    setPrinters([]);
    void printing.discoverPrinters().then((result) => {
      if (!sessionRef.current || searchRevision.current !== revision) return;
      if (result.success) setPrinters(result.data);
      else setPickerError(result.error.code === "PERMISSION_DENIED" ? translations.t('printerPermissionError')
        : result.error.message.includes("serial number or MAC") ? translations.t('printerIdentityError')
          : translations.t('printerSearchError'));
    }).finally(() => { if (sessionRef.current && searchRevision.current === revision) setSearching(false); });
  };

  const execute = (id: number, work: PrintWork, key: string) => {
    if (sequence.current !== id || sessionRef.current !== key) return;
    setNotice({ status: "preparing", id });
    const execution: PrintExecution = {
      isSessionCurrent: () => sessionRef.current === key,
      onStage: (stage) => { if (sequence.current === id && sessionRef.current === key) setNotice({ status: stage, id }); },
    };
    void work(execution).then((result) => {
      if (sequence.current !== id || sessionRef.current !== key) return;
      if (result.status === "selection-required") {
        setNotice({ status: "selecting-printer", id });
        setPickerOpen(true);
        search();
      } else if (result.status === "completed") setNotice({ status: "succeeded", id });
      else setNotice({ status: "failed", id, message: result.message, outcome: result.outcome });
    }).catch(() => {
      if (sequence.current === id && sessionRef.current === key) setNotice({ status: "failed", id, message: translations.t('printingError'), outcome: "unknown" });
    });
  };
  const startAttempt = (work: PrintWork) => {
    if (!sessionKey) return;
    activeWork.current = work;
    setConfirmRetry(false);
    execute(++sequence.current, work, sessionKey);
  };
  const showPrinterPicker = () => { if (sessionKey && Platform.OS === "android") { setPickerOpen(true); search(); } };
  const dismissNotice = () => { sequence.current++; activeWork.current = null; setNotice({ status: "idle" }); setPickerOpen(false); setConfirmRetry(false); };
  const choose = (candidate: PrinterSelection) => {
    const selectingAttempt = notice.status === "selecting-printer" ? notice.id : null;
    const revision = ++selectionRevision.current;
    void printing.selectPrinter(candidate).then((result) => {
      if (!sessionRef.current || selectionRevision.current !== revision) return;
      if (!result.success) { setPickerError(translations.t('printerSelectionError')); return; }
      setSelection(result.data.selection);
      setPreferenceWarning(result.data.persistence.status === "session-only" ? translations.t('printerSessionOnly') : null);
      setPickerOpen(false);
      if (selectingAttempt !== null && sequence.current === selectingAttempt && activeWork.current)
        execute(selectingAttempt, activeWork.current, sessionRef.current);
      else if (notice.status === "failed" && sequence.current === notice.id && activeWork.current) {
        if (notice.outcome === "unknown") setConfirmRetry(true);
        else startAttempt(activeWork.current);
      }
    });
  };
  const retryLatest = () => {
    if (notice.status !== "failed" || !activeWork.current) return;
    if (notice.outcome === "unknown" && !confirmRetry) { setConfirmRetry(true); return; }
    startAttempt(activeWork.current);
  };

  return <PrintContext.Provider value={{ startAttempt, showPrinterPicker, dismissNotice, printerName: selection?.printer.displayName ?? null }}>
    {children}
    {sessionKey && notice.status !== "idle" ? <ThemedView type="backgroundElement" style={styles.notice} accessibilityLiveRegion="polite" testID="print-notice">
      <ThemedText type="smallBold">{notice.status === "succeeded" ? t('printSent') : notice.status === "failed" ? t('printFailed') : notice.status === "selecting-printer" ? t('choosePrinter') : t('preparingPrint')}</ThemedText>
      {notice.status === "failed" ? <ThemedText>{notice.message}</ThemedText> : notice.status === "succeeded" ? <ThemedText>{t('sdkConfirmed')}</ThemedText> : <ThemedText themeColor="textSecondary">{notice.status === "sending" ? t('sendingToPrinter') : t('pleaseWait')}</ThemedText>}
      {notice.status === "failed" && notice.outcome === "unknown" ? <ThemedText>{t('duplicatePrintWarning')}</ThemedText> : null}
      {confirmRetry ? <ThemedText>{t('confirmDuplicatePrint')}</ThemedText> : null}
      <View style={styles.row}>
        {notice.status === "failed" ? <Button onPress={retryLatest}>{confirmRetry ? t('confirmRetry') : t('retry')}</Button> : null}
        {notice.status === "failed" || notice.status === "selecting-printer" ? <Button variant="secondary" onPress={showPrinterPicker}>{t('choosePrinterAction')}</Button> : null}
        <Button variant="ghost" onPress={dismissNotice}>{t('close')}</Button>
      </View>
    </ThemedView> : null}
    <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => { setPickerOpen(false); if (notice.status === "selecting-printer") dismissNotice(); }}>
      <ScrollView contentContainerStyle={styles.picker}>
        <ThemedText type="subtitle">{t('labelPrinter')}</ThemedText>
        {Platform.OS !== "android" ? <ThemedText>{t('printingUnavailableDevice')}</ThemedText> : <>
          {selection ? <ThemedText>{t('currentPrinter', { name: selection.printer.displayName })}</ThemedText> : null}
          {preferenceWarning ? <ThemedText accessibilityRole="alert">{preferenceWarning}</ThemedText> : null}
          {pickerError ? <ThemedText accessibilityRole="alert">{pickerError}</ThemedText> : null}
          {printers.length === 0 && !searching && !pickerError ? <ThemedText>{t('noPrintersFound')}</ThemedText> : null}
          {printers.map((candidate) => <Button key={candidate.printer.id} variant="secondary" onPress={() => choose(candidate)}>{candidate.printer.displayName}</Button>)}
          <Button onPress={search} loading={searching}>{t('searchAgain')}</Button>
        </>}
        <Button variant="ghost" onPress={() => { setPickerOpen(false); if (notice.status === "selecting-printer") dismissNotice(); }}>{t('cancel')}</Button>
      </ScrollView>
    </Modal>
  </PrintContext.Provider>;
}

export function usePrint() {
  const value = useContext(PrintContext);
  if (!value) throw new Error("PrintProvider is required");
  return value;
}

const styles = StyleSheet.create({
  notice: { position: "absolute", left: 12, right: 12, bottom: 24, borderRadius: 16, padding: 16, gap: 8, elevation: 8, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  picker: { padding: 24, paddingTop: 64, gap: 16 },
});
