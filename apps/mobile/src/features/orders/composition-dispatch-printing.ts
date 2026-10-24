import { orders } from "@mobile/features/orders/composition";
import { printing, dispatchPaperProfile } from "@mobile/features/printing/composition";
import { createDispatchLabelFit, renderDispatchLabel } from "@mobile/features/orders/infrastructure/dispatch-label-renderer";

export const dispatchPrinting = {
  /** Fresh read of the configured sender on every call; a failure is never replaced by the company name. */
  readSender: orders.getDispatchSender,
  reserve: printing.withPrinter,
  render: renderDispatchLabel,
  createFit: () => createDispatchLabelFit(dispatchPaperProfile),
};
