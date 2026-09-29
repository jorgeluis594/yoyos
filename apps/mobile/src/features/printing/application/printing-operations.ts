import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { makeCopyCount } from "@mobile/features/printing/domain/printing";
import type { PrinterSelection } from "@mobile/features/printing/domain/printing";
import type { DiscoveryError, PrintExecution, PrintFailure, PrintOutcome, PrintRequest, PrinterAdapter, PrintingDependencies, PreferenceReadError, ResolveError, SelectionResult } from "@mobile/features/printing/application/contracts";

const cancelled: PrintFailure = { code: "OPERATION_CANCELLED", message: "Printing session ended", outcome: "not-sent" };

export function createPrintingOperations({ adapters, preferences, temporaryDocuments, reportDiagnostic }: PrintingDependencies) {
  if (new Set(adapters.map((adapter) => adapter.id)).size !== adapters.length) throw new Error("Duplicate printer adapter ID");
  let selection: PrinterSelection | null = null;
  let loaded = false;
  let revision = 0;
  let writeTail: Promise<void> = Promise.resolve();
  const writePreference = (value: PrinterSelection) => {
    const result = writeTail.then(() => preferences.write(value));
    writeTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const adapterFor = (value: PrinterSelection): PrinterAdapter | undefined => adapters.find((adapter) => adapter.id === value.printer.adapterId);
  const diagnostic = (error: Readonly<{ code: string; message: string }>) => {
    try { reportDiagnostic(error); } catch { /* Diagnostics cannot change a print outcome. */ }
  };
  const stage = (execution: PrintExecution, value: "resolving" | "rendering" | "sending") => {
    try { execution.onStage(value); } catch (cause) { diagnostic({ code: "PROGRESS_OBSERVER_FAILED", message: String(cause) }); }
  };

  const loadPrinterPreference = async (): Promise<Result<PrinterSelection | null, PreferenceReadError>> => {
    const startedAt = revision;
    const result = await preferences.read();
    if (result.success && revision === startedAt) {
      selection = result.data;
      loaded = true;
    }
    return result;
  };

  const discoverPrinters = async (): Promise<Result<readonly PrinterSelection[], DiscoveryError>> => {
    if (!adapters.length) return err({ code: "PRINTING_UNAVAILABLE", message: "Printing is unavailable on this platform" });
    const found: PrinterSelection[] = [];
    for (const adapter of adapters) {
      const result = await adapter.discover();
      if (!result.success) return result;
      found.push(...result.data);
    }
    return ok(found);
  };

  const selectPrinter = async (value: PrinterSelection): Promise<Result<SelectionResult, ResolveError>> => {
    const adapter = adapterFor(value);
    if (!adapter) return err({ code: "PRINTING_UNAVAILABLE", message: "Printer adapter is unavailable" });
    const validated = adapter.validateSelection(value);
    if (!validated.success) return validated;
    selection = value;
    loaded = true;
    revision++;
    const saved = await writePreference(value);
    return ok({ selection: value, persistence: saved.success ? { status: "saved" } : { status: "session-only", error: saved.error } });
  };

  const printDocument = async (request: PrintRequest, execution: PrintExecution): Promise<Result<PrintOutcome, PrintFailure>> => {
    if (!execution.isSessionCurrent()) return err(cancelled);
    if (!adapters.length) return err({ code: "PRINTING_UNAVAILABLE", message: "Printing is unavailable on this platform", outcome: "not-sent" });
    const copies = makeCopyCount(request.copies);
    if (!copies.success) return err({ ...copies.error, outcome: "not-sent" });
    if (!loaded) {
      const stored = await loadPrinterPreference();
      if (!stored.success && !loaded) return err({ ...stored.error, outcome: "not-sent" });
    }
    if (!execution.isSessionCurrent()) return err(cancelled);
    const chosen = selection;
    if (!chosen) return ok({ status: "selection-required" });
    const adapter = adapterFor(chosen);
    if (!adapter) return err({ code: "PRINTING_UNAVAILABLE", message: "Printer adapter is unavailable", outcome: "not-sent" });
    const startingRevision = revision;
    stage(execution, "resolving");
    const resolved = await adapter.resolve(chosen, request.format);
    if (!resolved.success) return err({ ...resolved.error, outcome: "not-sent" });
    const { profile } = resolved.data;
    if (![profile.widthPx, profile.heightPx].every((value) => Number.isSafeInteger(value) && value > 0) ||
      ![profile.dpiX, profile.dpiY].every((value) => Number.isFinite(value) && value > 0)) {
      return err({ code: "INVALID_NATIVE_RESPONSE", message: "Printer returned an invalid render profile", outcome: "not-sent" });
    }
    if (revision === startingRevision && resolved.data.selection.locator !== chosen.locator) {
      selection = resolved.data.selection;
      revision++;
      const saved = await writePreference(selection);
      if (!saved.success) diagnostic(saved.error);
    }
    if (!execution.isSessionCurrent()) return err(cancelled);
    stage(execution, "rendering");
    const rendered = await request.render(profile);
    if (!rendered.success) return err({ ...rendered.error, outcome: "not-sent" });
    const document = rendered.data;
    try {
      if (!document.uri.startsWith("file://") || document.widthPx !== profile.widthPx || document.heightPx !== profile.heightPx) {
        return err({ code: "RENDER_FAILED", message: "Renderer returned an invalid document", outcome: "not-sent" });
      }
      if (!execution.isSessionCurrent()) return err(cancelled);
      stage(execution, "sending");
      const sent = await adapter.send({ printer: resolved.data, document, copies: copies.data });
      return sent.success ? ok({ status: "completed", printer: resolved.data.selection.printer, receipt: sent.data }) : sent;
    } finally {
      const removed = await temporaryDocuments.remove(document);
      if (!removed.success) diagnostic(removed.error);
    }
  };

  return { loadPrinterPreference, discoverPrinters, selectPrinter, printDocument };
}
