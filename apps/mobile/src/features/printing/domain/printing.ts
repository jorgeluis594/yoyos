import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type AdapterId = string & { readonly __brand: "AdapterId" };
export type PrinterId = string & { readonly __brand: "PrinterId" };
export type PrinterLocator = string & { readonly __brand: "PrinterLocator" };
export type PrintAttemptId = string & { readonly __brand: "PrintAttemptId" };
export type CopyCount = number & { readonly __brand: "CopyCount" };
export type Printer = Readonly<{ id: PrinterId; adapterId: AdapterId; displayName: string; model: string }>;
export type PrinterSelection = Readonly<{ printer: Printer; locator: PrinterLocator }>;
export type LabelFormat = Readonly<{ widthMm: 62; heightMm: 29 }>;
export const productLabelFormat: LabelFormat = { widthMm: 62, heightMm: 29 };
export type RenderProfile = Readonly<{ widthPx: number; heightPx: number; dpiX: number; dpiY: number }>;
export type RenderedDocument = Readonly<{ uri: string; widthPx: number; heightPx: number }>;
export type ResolvedPrinter = Readonly<{ selection: PrinterSelection; profile: RenderProfile }>;
export type PrintReceipt = Readonly<{ confirmation: "sdk" }>;
export type InvalidCopiesError = Readonly<{ code: "INVALID_COPIES"; message: string }>;

export function makeCopyCount(value: number): Result<CopyCount, InvalidCopiesError> {
  return Number.isSafeInteger(value) && value > 0
    ? ok(value as CopyCount)
    : err({ code: "INVALID_COPIES", message: "Copies must be a positive safe integer" });
}
