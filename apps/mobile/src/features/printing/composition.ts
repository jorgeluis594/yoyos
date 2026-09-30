import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createPrintingOperations } from "@mobile/features/printing/application/printing-operations";
import { brotherAdapter, parseBrotherSelection } from "@mobile/features/printing/infrastructure/brother-adapter";
import { createPrinterPreference } from "@mobile/features/printing/infrastructure/printer-preference";
import { temporaryDocuments } from "@mobile/features/printing/infrastructure/temporary-documents";

export const printing = createPrintingOperations({
  adapters: Platform.OS === "android" ? [brotherAdapter] : [],
  preferences: createPrinterPreference(SecureStore, (selection) => parseBrotherSelection(selection) !== null),
  temporaryDocuments,
  reportDiagnostic: (error) => console.warn(`[printing] ${error.code}: ${error.message}`),
});

export const cleanOldPrintDocuments = temporaryDocuments.removeOrphans;
export type { PrintExecution, PrintFailure, PrintOutcome, PrintStage } from "@mobile/features/printing/application/contracts";
export type { CopyCount, PrinterSelection, PrintReceipt } from "@mobile/features/printing/domain/printing";
export { makeCopyCount } from "@mobile/features/printing/domain/printing";
