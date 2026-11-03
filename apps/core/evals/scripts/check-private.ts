import { loadPrivateData } from "@core/evals/cases/private";
import { privateSummaryText } from "@core/evals/lib/private-summary";

/**
 * `pnpm exec tsx evals/scripts/check-private.ts <dir>`: validates `catalog.json` and `cases.json` of a private folder with `loadPrivateData`
 * and prints counts. No model call, and no case id, text or product name (the errors are the loader's, which name fields only).
 */
const dir = process.argv[2];
if (!dir) {
  console.error("Usage: tsx evals/scripts/check-private.ts <absolute path of the private folder>");
  process.exit(2);
}
try {
  console.log(privateSummaryText(loadPrivateData(dir)));
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : "The private folder could not be loaded");
  process.exit(1);
}
