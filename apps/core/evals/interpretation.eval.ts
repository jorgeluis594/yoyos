import { defineModelSuite } from "@core/evals/lib/model-suite";
import { runMessageCase } from "@core/evals/lib/run-case";

// Criteria 1 and 4: the reader's actions and arguments through apply-chat-message; photos are identified by hand so only the reading is measured.
defineModelSuite("interpretation", "interpretation", runMessageCase, { indexPhotos: false });
