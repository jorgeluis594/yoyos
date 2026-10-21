---
name: architecture
description: Defines the architecture of a Yoyos feature (use cases, data structure, persistence, strong typing, contracts, transactions, observability and test titles) and writes the complete technical draft in docs/drafts/ following the founder's architecture guide, deciding what is routine and grouping into one block the few questions that need the founder's answer. Use when asked to define, design or document the technical side of a feature, a refactor or an integration already defined at the behavior level. Do not use to define product, implement code or write executable tests.
---

# Architecture

Paths are relative to this skill. The agent designs the complete architecture of the feature following the guide and delivers the finished technical document; it does not iterate one decision per turn, does not ask for confirmation between sections and does not write code.

This skill contains only the method. The current state of the system (what exists in the code, what was decided, which conventions govern, which constraints are not up for discussion) lives in the repository memory, in `docs/architecture.md`, `docs/domain.md`, `docs/persistence.md`, `docs/programming-style.md`, `docs/logging-conventions.md` and in the current documents in `docs/`; it is consulted on every use and never copied into this skill.

## Input

A behavior definition: a product draft in `docs/drafts/<concept>.md`, a Todoist task or a description from the founder. If the input does not say what each actor sees and does nor what happens when something fails, the agent designs with explicit assumptions marked as such; it does not define product.

## References

| File | What it contains | When to read it |
| --- | --- | --- |
| [architecture-guide.md](architecture-guide.md) | Rules for starting from the code, designing use cases, typing, layers, persistence, integration, tests and observability, with illustrative examples and what the agent decides alone versus what requires the founder | Always, in full, before designing |
| [technical-document-template.md](technical-document-template.md) | Skeleton of the technical document, including its implementation plan, style and per-section guide | When writing the document |

## Steps

1. **Gather context before proposing anything.**
   - Use [Happy Memory Recall](../happy-memory-recall/SKILL.md) with the feature as the goal. That yields the current conventions, closed decisions, what was discarded and the non-negotiable constraints. Memory prevails over the task description.
   - Read `docs/architecture.md`, `docs/domain.md`, `docs/persistence.md` and `docs/programming-style.md` in full, and `docs/logging-conventions.md` and the [Testing](../testing/SKILL.md) skill for the sections that need them.
   - Read the input behavior definition and the current technical documents of the features it touches.
   - Verify the current state in the code: features, use cases, repositories, contracts in `shared/contracts`, tables and migrations, events and compositions the feature reuses or modifies. Launch a code-exploration subagent without conversation history when the scope crosses more than one feature or application; ask it for affected files, use cases and repositories, not opinions.
   - Summarize in three lines what the feature asks for, what already exists and what is left out because it belongs to another. If the request admits two readings that lead to different designs, ask which one before continuing; it is the only question asked before writing.

2. **Design by walking through the guide.** For each intention, a use case with input, access context, dependencies, output and errors. For each piece of data with rules, a validated type. For each write, its transaction and its lock if needed. For each integration between features, the event or public capability that connects them. For each new concept, one line saying why an existing one does not work; if there is none, it is not created. Never re-propose what memory or a current document records as discarded or deferred.

3. **Write the complete technical document** as a draft in `docs/drafts/<concept>-technical.md` using [technical-document-template.md](technical-document-template.md) and following the [Documentation](../documentation/SKILL.md) skill. If a technical draft on the concept exists, update it without losing detail instead of creating another. Include the test titles per level and the observability per event. Do not implement, do not create migrations or code files, do not commit during definition.

4. **Write the implementation plan** as the "Implementation plan" section of the same draft (no separate tasks document; tasks live in Todoist): non-atomic slices that cover a probable flow, parallelizable, with blockers isolated in small tasks, each with scope, out of scope and acceptance criteria.

5. **Deliver in the chat** the absolute path of the draft, the "Questions" block in the guide's format (numbered, recommended option first, consequence of each alternative) and the "Decided unless objected" list with the routine decisions the founder should see. Nothing else: the content is in the documents.

6. **Close with the answers.** On receiving the founder's adjustments, update the draft, remove the resolved questions, or, when the answers come from a review gate of the implement-task skill instead of the founder, keep every question in a "Questions decided by the review gate" section with the answer, who decided it (reviewer or coordinator), the reason and the discarded alternatives, so the founder can confirm them in the final pull request, set the status to "design closed, pending implementation", list the deferred items with real risk so the founder can ask for their Todoist tasks (they are created only if the founder asks) and record with [Happy Memory Maintainer](../happy-memory-maintainer/SKILL.md) the architecture decisions and conventions that should govern future features. If an answer contradicts a rule in the guide, apply it and propose to the founder updating the rule in [architecture-guide.md](architecture-guide.md).

## Guardrails

- A founder question like "what does X do?", "what is X for?" or "why so much protection?" is an objection: answer in two lines and offer the version without X.
- A short message with two readings is rephrased in one sentence and the agent asks which one it is; it does not pick one.
- The document describes only the current design. Reorganizing never removes detail. No history of previous decisions.
- What belongs to another feature or branch does not go in, but the meeting contract is defined so the other only adds.
- A code fact or a convention learned during definition is recorded in the repository memory, not in this skill.
- If a necessary product decision appears during design (what the user sees, what a button means), it is noted as an assumption in the document and taken to the questions block; it is not developed.

## After this skill

Code, migrations, executable tests and commits are produced with the [Implementation](../implementation/SKILL.md) skill, which takes the technical draft and its implementation plan as the definition. Validation evidence goes in the pull request description. When the feature is merged, the draft is promoted into the permanent doc of the concept and deleted, following the [Documentation](../documentation/SKILL.md) skill.
