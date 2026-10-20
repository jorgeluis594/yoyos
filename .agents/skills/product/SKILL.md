---
name: product
description: Defines a Yoyos feature at the product level and writes its draft in docs/drafts/ following the founder's product guide, deciding only what is routine and grouping into one block the few questions that need the founder's answer. Use when asked to define, design or document a feature, a flow or a screen at the product level, or when a Todoist task needs definition before implementation. Do not use for architecture, data, technical contracts, implementation or executable tests.
---

# Product

Paths are relative to this skill. The agent designs the whole feature at the product level following the guide and delivers the finished document; it does not iterate one decision per turn and does not make construction decisions.

This skill contains only the method. The current state of the product (what exists, what was decided, fixed values, non-negotiable constraints) lives in the repository memory and in the current documents in `docs/`; it is consulted on every use and never copied into this skill.

## References

| File | What it contains | When to read it |
| --- | --- | --- |
| [product-guide.md](product-guide.md) | Twelve steps for defining product, with rules, illustrative examples and what the agent decides alone versus what requires the founder | Always, in full, before designing |
| [document-template.md](document-template.md) | Document skeleton, style and per-section guide | When writing the document |
| [best-practices.md](best-practices.md) | Per-screen usability checklist, questions the agent asks itself, common mistakes, product cycle | When writing "Problem and situation", "Screens" and "Goal" |

## Steps

1. **Gather context before proposing anything.**
   - Use [Happy Memory Recall](../happy-memory-recall/SKILL.md) with the feature as the goal. That yields the business facts, what already exists, closed decisions, values already fixed and the constraints that are not up for discussion. Memory prevails over the task description.
   - If there is a Todoist task, read it and read its sibling tasks in the same project to know what belongs to another feature.
   - Read the current product documents in `docs/` that the feature touches and check in the application (screens, flows, texts) what already exists. A fact that is neither in memory nor in a document is verified in the application; if it cannot be verified, it is marked as an assumption.
   - Summarize in three lines what the task asks for, what already exists and what is left out because it belongs to another feature. If the request admits two readings that lead to different documents, ask which one before continuing; it is the only question asked before writing.

2. **Answer the product questions with the context.** Go through the questions in [best-practices.md](best-practices.md) (problem, user, scope, solution, experience, risks, success). What the context answers is written into the document. What it does not answer is classified with Step 11 of the guide: routine, decided and noted; about scope, money, what is kept, priorities between features or contrary to a previous decision, goes into the questions block.

3. **Design by walking through the twelve steps of the guide.** For each screen, apply the usability checklist. For each rule, an example with real data. For each action with effect, the four possible outcomes. For each new concept, one line saying why an existing one does not work; if there is none, it is not created. Never re-propose what memory or a current document records as discarded or deferred.

4. **Write the complete document** as a draft in `docs/drafts/<concept>.md` using [document-template.md](document-template.md) and following the [Documentation](../documentation/SKILL.md) skill. If a draft on the concept exists, update it without losing detail instead of creating another; the permanent doc of the concept in `docs/` is the current state and changes only when the feature is merged. The document describes behavior: what each actor sees and does, rules, states, failures, what is kept. It does not describe data structure, technical contracts, code organization or executable tests. Do not implement or commit during definition.

5. **Deliver in the chat** the absolute path of the document, the "Questions" block in the format of Step 12 of the guide (numbered, recommended option first, consequence of each alternative) and the "Decided unless objected" list with the routine decisions the founder should see. Nothing else: the content is in the document.

6. **Close with the answers.** On receiving the answers, update the document, remove the resolved questions from "Open items and questions", set the status to "definition ready to implement", update the Todoist task with what was agreed, list the deferred items with real risk so the founder can ask for their Todoist tasks (they are created only if the founder asks), and record with [Happy Memory Maintainer](../happy-memory-maintainer/SKILL.md) the business facts, fixed values and decisions that should govern future features. If an answer contradicts a rule in the guide, apply it and propose to the founder updating the rule in [product-guide.md](product-guide.md).

## Guardrails

- A founder question like "what is X for?" or "why so much protection?" is an objection: answer in two lines and offer the version without X.
- A short message with two readings is rephrased in one sentence and the agent asks which one it is; it does not pick one.
- The document describes only the current design. Reorganizing never removes detail.
- What belongs to another feature does not go in, but the meeting point is defined so that feature only adds.
- If a necessary technical decision appears during definition (where something is stored, how mobile talks to the web), it is noted in one line as "to be resolved in implementation" and not developed.
- A product fact learned during definition is recorded in the repository memory, not in this skill.

## After this skill

Architecture, data structure, contracts between web and mobile, code organization, tests and observability are defined with the [Implementation](../implementation/SKILL.md) skill, which takes this draft as the behavior definition. When the feature is merged, the draft is promoted into the permanent doc of the concept and deleted, following the [Documentation](../documentation/SKILL.md) skill.
