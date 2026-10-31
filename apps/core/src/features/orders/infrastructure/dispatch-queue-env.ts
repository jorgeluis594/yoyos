import { z } from "zod";

type Env = Readonly<Record<string, string | undefined>>;

const schema = z.object({ ASSISTANT_DISPATCH_QUEUE_MAX: z.coerce.number().int().min(1).default(5000) });

/** Safety ceiling of dispatch candidates per read. An invalid value fails at startup; an empty one counts as unset. */
export function readDispatchQueueMax(env: Env): number {
  return schema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""))).ASSISTANT_DISPATCH_QUEUE_MAX;
}
