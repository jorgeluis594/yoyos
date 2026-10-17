import { createEventBusRuntime } from "@core/src/composition/event-bus";
import { bootstrapEventHandlers, eventHandlers } from "@core/src/composition/event-handlers";
import { catalogOrderTtlDays, registerScheduledJobs, scheduledJobs } from "@core/src/composition/scheduled-jobs";

const ttlDays = catalogOrderTtlDays();
if (!ttlDays.success) throw new Error(ttlDays.error.message);
const { provider } = createEventBusRuntime(true);
await provider.start();
const bootstrap = bootstrapEventHandlers(provider, eventHandlers);
const registered = await bootstrap();
if (!registered.success) {
  await provider.stop();
  throw new Error(registered.error.message);
}
const scheduled = await registerScheduledJobs(provider, scheduledJobs(ttlDays.data));
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
