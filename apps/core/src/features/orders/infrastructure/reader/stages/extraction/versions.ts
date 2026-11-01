import type { ExtractedRequest } from "@core/src/features/orders/domain/reader/readings";
import { parseExtractionAnswer } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction-parser";
import type { PromptRegistry, StageVersion, ExtractionInput } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import { extractionJsonSchema } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction-schema";
import { extractionInstructions } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction.v1";
import { extractionConfirmInstructions } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction_confirm.v1";
import { renderExtractionInput } from "@core/src/features/orders/infrastructure/reader/stages/extraction/render-extraction-input";

/** Same schema, parser, rendering and settings; only the phrasing of the instructions differs between the primary and the confirming reading. */
const extractionVersion = (version: string, instructions: string, maxChars: number): StageVersion<ExtractionInput, readonly ExtractedRequest[]> => ({
  stage: "extraction", version, instructions, schemaName: "extraction_answer", jsonSchema: extractionJsonSchema,
  reasoningEffort: "none", maxOutputTokens: 3000,
  renderInput: (input) => renderExtractionInput(input, maxChars),
  parse: parseExtractionAnswer,
});

/**
 * The prompt versions of the extraction stage, keyed by version. A confirming reading names `extraction_confirm-v1` in
 * `READER_EXTRACTION_CONFIRM_PROMPT`; without it, it uses the primary's version.
 */
export const createExtractionVersions = (maxChars: number): PromptRegistry["extraction"] => ({
  "extraction-v1": extractionVersion("extraction-v1", extractionInstructions, maxChars),
  "extraction_confirm-v1": extractionVersion("extraction_confirm-v1", extractionConfirmInstructions, maxChars),
});
