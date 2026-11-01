import { createEventBusRuntime } from "@core/src/composition/event-bus";
import { recoverStockDeductionsJob } from "@core/src/features/orders/composition";
import { bootstrapEventHandlers, eventHandlers } from "@core/src/composition/event-handlers";
import { readMessageTraceSettings } from "@core/src/features/orders/infrastructure/message-trace-env";
import { catalogOrderTtlDays, deleteExpiredMessageTracesJob, orderedHandlerIds, registerScheduledJobs, scheduledJobs } from "@core/src/composition/scheduled-jobs";

const ttlDays = catalogOrderTtlDays();
if (!ttlDays.success) throw new Error(ttlDays.error.message);
const traceSettings = readMessageTraceSettings(process.env);
const { provider } = createEventBusRuntime(true);
await provider.start();
const bootstrap = bootstrapEventHandlers(provider, eventHandlers);
const registered = await bootstrap();
if (!registered.success) {
  await provider.stop();
  throw new Error(registered.error.message);
}
const scheduled = await registerScheduledJobs(provider, scheduledJobs(ttlDays.data, { reader: provider, handlerIds: orderedHandlerIds(eventHandlers) }, recoverStockDeductionsJob,
  deleteExpiredMessageTracesJob(undefined, undefined, traceSettings.deleteBatch)));
if (!scheduled.success) {
  await registered.data();
  await provider.stop();
  throw new Error(scheduled.error.message);
}
console.log("Event worker ready");

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => {
  if (stopping) return;
  stopping = true;
  try {
    for (const result of [await scheduled.data(), await registered.data()]) {
      if (!result.success) throw new Error(result.error.message);
    }
    await provider.stop();
    process.exit(0);
  } catch (cause) {
    console.error("Event worker shutdown failed", cause);
    process.exit(1);
  }
});
