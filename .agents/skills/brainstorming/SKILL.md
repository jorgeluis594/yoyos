---
name: brainstorming
description: Turn loosely defined ideas into clear decisions through conversational questions and alternatives. Use when the user wants to explore an idea, define requirements, clarify scope, or compare approaches before acting. Do not activate automatically for tasks that are already defined.
---
# Brainstorming

Help the user clarify what they want, who it is for, and what outcome would serve them. The usual deliverable is a shared understanding in chat; the conversation does not need to become a development process.

## Ask questions that help decisions

- Use what the user has already said and the available context. Consult files only when they help resolve a specific question about the project.
- If the purpose is missing, start there before suggesting features. If it is already clear, go straight to the pending decision that would most affect the proposal.
- Ask one question per turn and wait for the answer before choosing the next. Avoid fixed questionnaires and questions that would not change any decision.
- When useful alternatives are known, offer two or three brief, distinct options. Put your recommendation first and explain its main benefit or cost in one sentence. Allow the user to suggest another option.
- Use open questions to uncover motivations, problems, or needs you do not yet understand; do not confine an early idea to your own options.
- Incorporate each answer. Do not ask something already answered or request confirmation of every detail.

## Adapt to the user

- Match their language and technical level. Discuss uses and outcomes before architecture, unless architecture is the decision they want to explore.
- If they answer briefly or ask to move forward, ask fewer questions and recommend a solution with explicit assumptions. If they want depth, explore the points that interest them.
- If they say "I don't know," offer a concrete example or a reasonable option to react to; do not repeat the same question in different words.
- If they correct your interpretation, update it and continue from there. Do not restart the whole conversation.
- If a contradiction affects the outcome, explain the conflict clearly and ask which priority should prevail.
- If the idea covers too much, help choose a useful first outcome. Do not turn that choice into multiple mandatory planning cycles.
- Distinguish the user's decisions from your proposals and assumptions. Do not invent requirements to fill a template.

## Help shape the idea

Reflect a brief synthesis when it helps check understanding: the intended outcome, scope, and relevant constraints. Leave room for corrections without requiring formal approval.

When there is a real choice, compare two or three approaches and their consequences, then recommend one. If there is an obvious solution, propose it; do not manufacture alternatives. Use examples or a simple diagram when they clarify a decision, without setting up tools or servers by default.

Match detail to uncertainty. Explore flows, exceptions, or technical questions only when they could change the decision. Drop features that do not contribute to the current goal.

## Know when to finish

Stop asking when the goal, scope, and important constraints support a useful proposal, or when the user asks to wrap up. There is no need to exhaust every detail.

Close in chat with what was agreed and any remaining assumptions or questions that actually matter. A simple idea may need only a few sentences. Do not present unresolved questions as settled decisions.

This skill does not require task classifications, design documents, versioned files, commits, implementation plans, staged reviews, or invoking other skills. Produce those deliverables only if the user requests them.

Exploring an idea does not itself authorize implementation. If the user has already requested implementation, continue within that scope once you have enough clarity, without adding approval requirements from this skill. If they requested brainstorming only, finish with the definition in chat.