import type { PromptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";

/** The prompt versions of the extraction stage, keyed by version («extraction-v1»). Filled by the stage's own task. */
export const extractionVersions: PromptRegistry["extraction"] = {};
