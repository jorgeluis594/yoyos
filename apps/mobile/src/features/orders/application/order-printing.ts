import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { AppError, Result } from "@shared/result";
import { prepareOrderDispatchLabel } from "@shared/dispatch-label/build";
import type { DispatchLabel, DispatchLabelPreparation, DispatchLabelSender } from "@shared/dispatch-label/types";

export type PrepareDispatchLabelsDependencies<ReadError extends AppError> = Readonly<{
  /** Existing order detail endpoint; a failure is a read error, never missing data. */
  readOrder: (orderId: string) => Promise<Result<OrderAggregateResponse, ReadError>>;
  /** Effective sender of the label. Wired in `dispatchPrinting.senderFor`. */
  sender: DispatchLabelSender;
  /** True when the label content fits the roll (provided by the renderer). */
  fits: (label: DispatchLabel) => boolean;
}>;

const readConcurrency = 4;

export async function prepareDispatchLabels<ReadError extends AppError>(
  orderIds: readonly string[], deps: PrepareDispatchLabelsDependencies<ReadError>,
): Promise<DispatchLabelPreparation<ReadError>[]> {
  const prepareOne = async (orderId: string): Promise<DispatchLabelPreparation<ReadError>> => {
    const read = await deps.readOrder(orderId);
    if (!read.success) return { status: "read-error", orderId, error: read.error };
    return { orderId, ...prepareOrderDispatchLabel(read.data, deps.sender, deps.fits) };
  };
  const results: DispatchLabelPreparation<ReadError>[] = new Array(orderIds.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < orderIds.length; index = next++) results[index] = await prepareOne(orderIds[index]);
  };
  await Promise.all(Array.from({ length: Math.min(readConcurrency, orderIds.length) }, worker));
  return results;
}
