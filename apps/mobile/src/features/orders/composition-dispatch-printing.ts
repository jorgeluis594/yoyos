import type { DispatchLabelSender } from "@shared/dispatch-label/types";
import { printing, dispatchPaperProfile } from "@mobile/features/printing/composition";
import { createDispatchLabelFit, renderDispatchLabel } from "@mobile/features/orders/infrastructure/dispatch-label-renderer";

/** Single wiring point of the label sender; the configured sender (name and phone) replaces this company-name fallback. */
const senderFor = (companyName: string): DispatchLabelSender => ({ name: companyName, phone: null });

export const dispatchPrinting = {
  senderFor,
  reserve: printing.withPrinter,
  render: renderDispatchLabel,
  createFit: () => createDispatchLabelFit(dispatchPaperProfile),
};
