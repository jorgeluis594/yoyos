import type { Result } from "@shared/result";
import { dispatchLabelFormat, makeCopyCount } from "@mobile/features/printing/domain/printing";
import type { PrintReceipt } from "@mobile/features/printing/domain/printing";
import type { PrintExecution, PrintFailure, PrinterSession, RenderDocument, SendError } from "@mobile/features/printing/application/contracts";
import type { DispatchLabel } from "@shared/dispatch-label/types";

type NotSent = PrintFailure & Readonly<{ outcome: "not-sent" }>;
type Unknown = SendError & Readonly<{ outcome: "unknown" }>;

export type DispatchPrintState =
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "sending" }>
  | Readonly<{ status: "confirmed"; receipt: PrintReceipt }>
  | Readonly<{ status: "not-sent"; error: NotSent }>
  | Readonly<{ status: "unknown"; error: Unknown }>
  | Readonly<{ status: "confirmed-by-user" }>;

/** The prepared label is kept so a retry never rebuilds it from the order. */
export type DispatchPrintEntry = Readonly<{ orderId: string; label: DispatchLabel; state: DispatchPrintState }>;

export type PrinterReservation = <T>(run: (session: PrinterSession) => Promise<T>) => Promise<Result<T, PrintFailure>>;
export type RenderDispatchLabel = (label: DispatchLabel, ...args: Parameters<RenderDocument>) => ReturnType<RenderDocument>;

export type DispatchBatchEnd = "completed" | "stopped" | "failed" | "selection-required" | "needs-review" | "busy";

const one = makeCopyCount(1);
const done = (state: DispatchPrintState) => state.status === "confirmed" || state.status === "confirmed-by-user";

/** Resolves an uncertain entry: the user either saw it printed or accepts a possible duplicate. */
export function resolveUnknown(entries: readonly DispatchPrintEntry[], orderId: string, printed: boolean): DispatchPrintEntry[] {
  return entries.map((entry) => entry.orderId === orderId && entry.state.status === "unknown"
    ? { ...entry, state: printed ? { status: "confirmed-by-user" } : { status: "pending" } } : entry);
}

/**
 * Sends the pending entries one at a time inside a single printer reservation. A failure stops the batch;
 * confirmed entries are skipped; an uncertain one blocks continuing until the user decides.
 */
export async function runDispatchBatch(input: Readonly<{
  entries: readonly DispatchPrintEntry[];
  reserve: PrinterReservation;
  render: RenderDispatchLabel;
  execution: PrintExecution;
  shouldStop: () => boolean;
  onChange: (entries: readonly DispatchPrintEntry[]) => void;
}>): Promise<Readonly<{ entries: readonly DispatchPrintEntry[]; end: DispatchBatchEnd }>> {
  if (!one.success) throw new Error("Invalid copy count");
  const copies = one.data;
  let entries = [...input.entries];
  if (entries.some((entry) => entry.state.status === "unknown")) return { entries, end: "needs-review" };
  const set = (index: number, state: DispatchPrintState) => {
    entries = entries.map((entry, i) => (i === index ? { ...entry, state } : entry));
    input.onChange(entries);
  };
  const reserved = await input.reserve(async (session): Promise<DispatchBatchEnd> => {
    for (let index = 0; index < entries.length; index++) {
      if (done(entries[index].state)) continue;
      if (input.shouldStop()) return "stopped";
      set(index, { status: "sending" });
      const { label } = entries[index];
      let sent: Awaited<ReturnType<PrinterSession["printDocument"]>>;
      try {
        sent = await session.printDocument({ format: dispatchLabelFormat, copies, render: (profile) => input.render(label, profile) }, input.execution);
      } catch {
        set(index, { status: "unknown", error: { code: "COMMUNICATION_FAILED", message: "Printing failed unexpectedly", outcome: "unknown" } });
        return "failed";
      }
      if (!sent.success) {
        set(index, sent.error.outcome === "unknown" ? { status: "unknown", error: sent.error as Unknown } : { status: "not-sent", error: sent.error as NotSent });
        return "failed";
      }
      if (sent.data.status === "selection-required") { set(index, { status: "pending" }); return "selection-required"; }
      set(index, { status: "confirmed", receipt: sent.data.receipt });
    }
    return "completed";
  });
  return reserved.success ? { entries, end: reserved.data } : { entries, end: "busy" };
}
