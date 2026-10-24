import { defineModelSuite } from "@core/evals/lib/model-suite";
import { runImageCase } from "@core/evals/lib/run-case";

// Criteria 2 and 5: the photo cascade (QR, local embedding, vision chooser) on the manifest photos against the indexed eval catalog.
defineModelSuite("identification: image", "image", runImageCase, { indexPhotos: true, photosRequired: true });
