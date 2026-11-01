import type { PromptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";

/** The prompt versions of the intent stage, keyed by version («intent-v1»). Filled by the stage's own task. */
export const intentVersions: PromptRegistry["intent"] = {};
