import { printing, dispatchPaperProfile } from "@mobile/features/printing/composition";
import { createDispatchLabelFit, renderDispatchLabel } from "@mobile/features/orders/infrastructure/dispatch-label-renderer";

export const dispatchPrinting = {
  reserve: printing.withPrinter,
  render: renderDispatchLabel,
  createFit: () => createDispatchLabelFit(dispatchPaperProfile),
};
