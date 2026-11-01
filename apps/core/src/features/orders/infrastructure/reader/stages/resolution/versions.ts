import type { PromptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";

/** The prompt versions of the resolution stage, keyed by version («resolution-v1»). Filled by the stage's own task. */
export const resolutionVersions: PromptRegistry["resolution"] = {};
