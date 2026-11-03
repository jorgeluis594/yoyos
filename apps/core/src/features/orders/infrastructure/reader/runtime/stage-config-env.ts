import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ReaderStage, Reading } from "@core/src/features/orders/domain/reader/readings";
import { priceOf } from "@core/src/shared/infrastructure/model-prices";
import type { PromptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";
import type { Provider } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";

type Env = Readonly<Record<string, string | undefined>>;

/** The key of a stage's version in its `versions.ts`, e.g. «intent-v1». Only `parsePromptVersion` makes one. */
export type PromptVersion = string & { readonly __brand: "PromptVersion" };
export type ReaderStageConfig = Readonly<{
  stage: ReaderStage;
  reading: Reading;
  provider: Provider;
  /** Must have a price in `modelPrices` when the provider is openai. */
  model: string;
  promptVersion: PromptVersion;
  /** `READER_STAGE_TIMEOUT_MS`; the adapter caps it by what is left of the reading budget. */
  timeoutMs: number;
}>;
export type StageConfigError = Readonly<{ code: "INVALID_STAGE_ENV" | "FAKE_IN_PRODUCTION" | "UNKNOWN_PROMPT_VERSION" | "UNPRICED_MODEL"; message: string }>;

const DEFAULT_MODEL = "gpt-6-luna";
const valueOf = (env: Env, key: string) => (env[key] === "" ? undefined : env[key]);
const prefixOf = (stage: ReaderStage, reading: Reading) => `READER_${stage.toUpperCase()}${reading === "confirming" ? "_CONFIRM" : ""}`;

export function parsePromptVersion(stage: ReaderStage, value: string, registry: PromptRegistry): Result<PromptVersion, StageConfigError> {
  return Object.hasOwn(registry[stage], value) ? ok(value as PromptVersion)
    : err({ code: "UNKNOWN_PROMPT_VERSION", message: `The ${stage} stage names the unknown prompt version ${value}` });
}

const settingsSchema = z.object({
  provider: z.enum(["openai", "fake"]),
  timeoutMs: z.coerce.number().int().positive(),
});
const readingBudgetSchema = z.coerce.number().int().positive().default(60_000);

/** `READER_READING_BUDGET_MS`: what a whole reading may take, under the attempt deadline. Invalid values are an error the composition turns into a startup failure. */
export function readReadingBudgetMs(env: Env): Result<number, StageConfigError> {
  const parsed = readingBudgetSchema.safeParse(valueOf(env, "READER_READING_BUDGET_MS"));
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_STAGE_ENV", message: "Invalid configuration of the reading budget: READER_READING_BUDGET_MS" });
}

/**
 * The configuration of one stage and reading from `READER_<STAGE>[_CONFIRM]_PROVIDER|_MODEL|_PROMPT` and `READER_STAGE_TIMEOUT_MS`.
 * A confirming reading has a configuration (otherwise null) once any of its three variables is set; what it leaves unset it takes from the
 * stage's primary configuration. Startup fails (an error here) on an unknown prompt version, an unpriced OpenAI model or the fake provider in production.
 */
export function readStageConfig(env: Env, stage: ReaderStage, reading: Reading, registry: PromptRegistry): Result<ReaderStageConfig | null, StageConfigError> {
  const own = (key: string, from: Reading) => valueOf(env, `${prefixOf(stage, from)}_${key}`);
  if (reading === "confirming" && !["PROVIDER", "MODEL", "PROMPT"].some((key) => own(key, "confirming") !== undefined)) return ok(null);
  const pick = (key: string) => own(key, reading) ?? (reading === "confirming" ? own(key, "primary") : undefined);

  const settings = settingsSchema.safeParse({ provider: pick("PROVIDER") ?? "openai", timeoutMs: valueOf(env, "READER_STAGE_TIMEOUT_MS") ?? 10_000 });
  if (!settings.success) {
    const names = [...new Set(settings.error.issues.map(({ path }) => (path[0] === "timeoutMs" ? "READER_STAGE_TIMEOUT_MS" : `${prefixOf(stage, reading)}_PROVIDER`)))];
    return err({ code: "INVALID_STAGE_ENV", message: `Invalid configuration of the ${stage} stage: ${names.join(", ")}` });
  }
  const { provider, timeoutMs } = settings.data;
  if (provider === "fake" && env.NODE_ENV === "production") return err({ code: "FAKE_IN_PRODUCTION", message: `The ${stage} stage cannot use the fake provider in production` });
  const promptVersion = parsePromptVersion(stage, pick("PROMPT") ?? `${stage}-v1`, registry);
  if (!promptVersion.success) return promptVersion;
  const model = pick("MODEL") ?? DEFAULT_MODEL;
  if (provider === "openai" && priceOf(model) === null) return err({ code: "UNPRICED_MODEL", message: `The ${stage} stage names the model ${model}, which has no price in model-prices.ts` });
  return ok({ stage, reading, provider, model, promptVersion: promptVersion.data, timeoutMs });
}
