import type { Result } from "@shared/result";
import type { ExtractedRequest } from "@core/src/features/orders/domain/reader/readings";
import { parseExtractionAnswer, type ExtractionStageInput } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction-parser";
import { extractionJsonSchema } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction-schema";
import { extractionInstructions } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction.v1";
import { extractionConfirmInstructions } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction_confirm.v1";
import { renderExtractionInput } from "@core/src/features/orders/infrastructure/reader/stages/extraction/render-extraction-input";

/**
 * Structurally the registry's `StageVersion` of the extraction stage, which the registry's assignment of `extractionVersions` checks. It is
 * declared here because importing the registry from the file the registry imports would make a dependency cycle.
 */
type ExtractionVersion = Readonly<{
  stage: "extraction"; version: string; instructions: string; schemaName: string; jsonSchema: Readonly<Record<string, unknown>>;
  reasoningEffort: "none"; maxOutputTokens: number;
  renderInput: (input: ExtractionStageInput) => string;
  parse: (answer: unknown, input: ExtractionStageInput) => Result<readonly ExtractedRequest[]>;
}>;

/** Same schema, parser, rendering and settings; only the phrasing of the instructions differs between the primary and the confirming reading. */
const extractionVersion = (version: string, instructions: string): ExtractionVersion => ({
  stage: "extraction", version, instructions, schemaName: "extraction_answer", jsonSchema: extractionJsonSchema,
  reasoningEffort: "none", maxOutputTokens: 3000,
  renderInput: (input) => renderExtractionInput(input),
  parse: parseExtractionAnswer,
});

/**
 * The prompt versions of the extraction stage, keyed by version. A confirming reading names `extraction_confirm-v1` in
 * `READER_EXTRACTION_CONFIRM_PROMPT`; without it, it uses the primary's version.
 */
export const extractionVersions: Readonly<Record<string, ExtractionVersion>> = {
  "extraction-v1": extractionVersion("extraction-v1", extractionInstructions),
  "extraction_confirm-v1": extractionVersion("extraction_confirm-v1", extractionConfirmInstructions),
};
