import type { ReaderStage, Reading } from "@core/src/features/orders/domain/reader/readings";
import type { ReaderStages } from "@core/src/features/orders/application/reader/stages";
import { log } from "@core/src/shared/infrastructure/logger";
import type { PromptRegistry, StageIO } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";
import { createStageAdapter, type StageRunner } from "@core/src/features/orders/infrastructure/reader/runtime/stage-adapter";
import { readStageConfig, type ReaderStageConfig } from "@core/src/features/orders/infrastructure/reader/runtime/stage-config-env";
import type { Provider, StructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";

type Env = Readonly<Record<string, string | undefined>>;
/** One structured model per provider; null when the provider is not configured (no OPENAI_API_KEY, no fake). */
export type ClientsByProvider = Readonly<Record<Provider, StructuredModel | null>>;

const stages: readonly ReaderStage[] = ["intent", "extraction", "resolution"];

/** The runner of one stage and reading, or null when its provider has no client. The version was validated by `readStageConfig`. */
export function createStage<S extends ReaderStage>(config: ReaderStageConfig & Readonly<{ stage: S }>, registry: PromptRegistry, clients: ClientsByProvider): StageRunner<StageIO[S]["input"], StageIO[S]["output"]> | null {
  const model = clients[config.provider];
  if (!model) return null;
  return createStageAdapter({ config, version: registry[config.stage][config.promptVersion] as never, model }) as never;
}

/**
 * The three stage ports from the env, one configuration each. Throws at startup on an invalid configuration; null when a needed provider has
 * no client. A confirming reading without its own configuration uses the stage's primary runner, and `confirms` says which have one.
 */
export function createReaderStages(env: Env, registry: PromptRegistry, clients: ClientsByProvider): ReaderStages | null {
  const runners = {} as Record<ReaderStage, Record<Reading, StageRunner<never, unknown> | null>>;
  const confirms = {} as Record<ReaderStage, boolean>;
  for (const stage of stages) {
    const built = (["primary", "confirming"] as const).map((reading) => {
      const config = readStageConfig(env, stage, reading, registry);
      if (!config.success) throw new Error(config.error.message);
      return config.data;
    });
    const [primary, confirming] = built;
    runners[stage] = { primary: primary && (createStage(primary, registry, clients) as StageRunner<never, unknown> | null), confirming: confirming && (createStage(confirming, registry, clients) as StageRunner<never, unknown> | null) };
    confirms[stage] = confirming !== null;
    if (!runners[stage].primary || (confirming && !runners[stage].confirming)) {
      log.info({ event: "reader_stages_disabled", stage, reason: "missing_provider_client" }, "reader_stages_disabled");
      return null;
    }
  }
  const run = <S extends ReaderStage>(stage: S, reading: Reading) => (runners[stage][confirms[stage] ? reading : "primary"] as unknown) as StageRunner<StageIO[S]["input"], StageIO[S]["output"]>;
  return {
    readIntent: (input, reading, signal) => run("intent", reading)(input, signal),
    extractRequests: (input, intents, reading, signal) => run("extraction", reading)({ input, intents }, signal),
    chooseProducts: (mentions, candidates, reading, signal) => run("resolution", reading)({ mentions, candidates }, signal),
    confirms,
  };
}
