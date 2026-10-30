import { imageManifest } from "@core/evals/cases";
import { defineModelSuite } from "@core/evals/lib/model-suite";
import { runMessageCase } from "@core/evals/lib/run-case";

// The whole message path: real photo identification, reader and the order transaction of apply-chat-message.
// Without a photo manifest only its text cases run, against a catalog without photos.
defineModelSuite("end to end", "end_to_end", runMessageCase, { indexPhotos: imageManifest !== null });
