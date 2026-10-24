import { defineModelSuite } from "@core/evals/lib/model-suite";
import { runTextCase } from "@core/evals/lib/run-case";

// Criterion 3: text identification (SQL candidates, Decision chooser with the price hint) on the buyer's product words.
defineModelSuite("identification: text", "text", runTextCase, { indexPhotos: false });
