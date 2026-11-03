import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ShadowConfig } from "@core/src/features/orders/application/reader/trace-ports";

type Env = Readonly<Record<string, string | undefined>>;
export type ShadowConfigError = Readonly<{ code: "INVALID_SHADOW_ENV"; message: string }>;

const flag = z.enum(["true", "false"]).transform((value) => value === "true");
const shadowSchema = z.object({
  READER_SHADOW_LEGACY: flag.default(true),
  READER_SHADOW_WAIT_MS: z.coerce.number().int().min(0).default(3000),
});

/** `READER_SHADOW_LEGACY` (default true) and `READER_SHADOW_WAIT_MS` (default 3000); empty values count as unset. Invalid values are an error the composition turns into a startup failure. */
export function readShadowConfig(env: Env): Result<ShadowConfig, ShadowConfigError> {
  const parsed = shadowSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  if (parsed.success) return ok({ legacy: parsed.data.READER_SHADOW_LEGACY, waitMs: parsed.data.READER_SHADOW_WAIT_MS });
  const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  return err({ code: "INVALID_SHADOW_ENV", message: `Invalid configuration of the legacy shadow reader: ${names.join(", ")}` });
}
