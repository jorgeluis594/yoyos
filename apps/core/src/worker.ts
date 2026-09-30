import { createEventBusRuntime } from "@core/src/composition/event-bus";
import { bootstrapEventHandlers, eventHandlers } from "@core/src/composition/event-handlers";

const { provider } = createEventBusRuntime(true);
await provider.start();
const bootstrap = bootstrapEventHandlers(provider, eventHandlers);
const registered = await bootstrap();
if (!registered.success) {
  await provider.stop();
  throw new Error(registered.error.message);
}
console.log("Event worker ready");

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => {
  if (stopping) return;
  stopping = true;
  try {
    const result = await registered.data();
    if (!result.success) throw new Error(result.error.message);
    await provider.stop();
    process.exit(0);
  } catch (cause) {
    console.error("Event worker shutdown failed", cause);
    process.exit(1);
  }
});
