import { defineModelSuite } from "@core/evals/lib/model-suite";
import { runConversationCase } from "@core/evals/lib/run-case";

// Conversations: one chat with 2 to 4 messages and events between them on a simulated clock; one record per message.
// Photos are identified by the case, as in the interpretation pass.
defineModelSuite("conversations", "conversation", runConversationCase, { indexPhotos: false });
