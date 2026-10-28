import type { DecisionRequestText } from "@core/src/shared/ai-tools/application/orchestrate";

/** The fixed wording of every Decision request; the feature's tools bring their own descriptions and questions. */
export const decisionRequestText: DecisionRequestText = {
  actionInstructions: "Choose the one action the buyer's message asks for. A request for several things through the same action is that one action. "
    + "Choose several only when the message asks for two or more different actions of the list.",
  several: "The message asks for two or more different actions of the list, not for several things through one action",
  predicate: (toolDescription) => `Does the buyer's message ask for this action, alone or next to another request? ${toolDescription}`,
};
