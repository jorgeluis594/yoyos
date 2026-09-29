import type { Result } from "@shared/result";
import type { AdapterId, CopyCount, LabelFormat, Printer, PrinterSelection, RenderedDocument, RenderProfile, ResolvedPrinter, PrintReceipt } from "@mobile/features/printing/domain/printing";

export type CodedError<C extends string> = Readonly<{ code: C; message: string }>;
export type PreferenceReadError = CodedError<"PREFERENCE_READ_FAILED" | "INVALID_PREFERENCE">;
export type PreferenceWriteError = CodedError<"PREFERENCE_WRITE_FAILED">;
export type DiscoveryError = CodedError<"PRINTING_UNAVAILABLE" | "PERMISSION_DENIED" | "DISCOVERY_FAILED">;
export type ResolveError = CodedError<"PRINTING_UNAVAILABLE" | "PERMISSION_DENIED" | "PRINTER_NOT_FOUND" | "PRINTER_IDENTITY_MISMATCH" | "CONNECTION_FAILED" | "UNSUPPORTED_FORMAT" | "INVALID_NATIVE_RESPONSE">;
export type RenderError = CodedError<"LABEL_CONTENT_OVERFLOW" | "RENDER_FAILED" | "UNSUPPORTED_FORMAT">;
export type SendError = CodedError<"INVALID_COPIES" | "PAPER_EMPTY" | "PAPER_MISMATCH" | "COVER_OPEN" | "PRINTER_REJECTED" | "DEVICE_ERROR" | "CONNECTION_FAILED" | "COMMUNICATION_FAILED" | "INVALID_NATIVE_RESPONSE"> & Readonly<{ outcome: "not-sent" | "unknown" }>;
export type PrintFailure = (PreferenceReadError | ResolveError | RenderError | CodedError<"INVALID_COPIES" | "OPERATION_CANCELLED">) & Readonly<{ outcome: "not-sent" }> | SendError;
export type PrinterPreferenceStore = Readonly<{
  read: () => Promise<Result<PrinterSelection | null, PreferenceReadError>>;
  write: (selection: PrinterSelection) => Promise<Result<void, PreferenceWriteError>>;
}>;
export type PrinterAdapter = Readonly<{
  id: AdapterId;
  maxCopies: number;
  validateSelection: (selection: PrinterSelection) => Result<void, ResolveError>;
  discover: () => Promise<Result<readonly PrinterSelection[], DiscoveryError>>;
  resolve: (selection: PrinterSelection, format: LabelFormat) => Promise<Result<ResolvedPrinter, ResolveError>>;
  send: (input: Readonly<{ printer: ResolvedPrinter; document: RenderedDocument; copies: CopyCount }>) => Promise<Result<PrintReceipt, SendError>>;
}>;
export type TemporaryDocuments = Readonly<{
  remove: (document: RenderedDocument) => Promise<Result<void, CodedError<"CLEANUP_FAILED">>>;
}>;
export type PrintStage = "resolving" | "rendering" | "sending";
export type PrintExecution = Readonly<{ isSessionCurrent: () => boolean; onStage: (stage: PrintStage) => void }>;
export type RenderDocument = (profile: RenderProfile) => Promise<Result<RenderedDocument, RenderError>>;
export type PrintRequest = Readonly<{ format: LabelFormat; copies: CopyCount; render: RenderDocument }>;
export type PrintOutcome = Readonly<{ status: "selection-required" }> | Readonly<{ status: "completed"; printer: Printer; receipt: PrintReceipt }>;
export type SelectionResult = Readonly<{ selection: PrinterSelection; persistence: Readonly<{ status: "saved" }> | Readonly<{ status: "session-only"; error: PreferenceWriteError }> }>;
export type PrintingDependencies = Readonly<{
  adapters: readonly PrinterAdapter[];
  preferences: PrinterPreferenceStore;
  temporaryDocuments: TemporaryDocuments;
  reportDiagnostic: (error: Readonly<{ code: string; message: string }>) => void;
}>;
