---
name: documentation
description: Yoyos documentation policy approved by the founder - where each kind of content lives (docs/, docs/drafts/, docs/research/, Todoist, pull requests, Git) and the rules for permanent documents. Use whenever writing, editing, moving, renaming, deleting or reviewing anything under docs/, when deciding where a document or a piece of information belongs, or when promoting a feature draft into permanent documentation on merge.
---

# Documentation

This skill is the single source of the documentation policy. Other skills reference it instead of repeating it.

## Where each kind of content lives

| Content | Location |
| --- | --- |
| Architecture, conventions, current business rules, decisions with their reason, domain glossary, stable contracts, how-to procedures for tools | `docs/` (permanent) |
| Design of a feature not yet built (product or technical) | `docs/drafts/`. On merge, its still-valid rules are rewritten into the permanent doc of that concept in `docs/` and the draft is deleted |
| Research (competitors, prospective customers, couriers, market) | `docs/research/` |
| Tasks | Todoist only. Tasks are created by an agent only when the founder asks; no skill or workflow generates task documents or Todoist tasks on its own |
| Validation evidence (test runs, screenshots, physical-device results) | Pull request description |
| History (what changed, when, who approved) | Git |

## Rules for permanent documentation

Applies to `docs/` outside `drafts/` and `research/`.

1. Only facts and decisions taken. No assumptions, guesses or hypotheses.
2. Describes the system as it is today. No "Status: pending", plans, backlogs or checkboxes.
3. No history: no session dates, "the user confirmed", "previously it was X", commit hashes or PR numbers.
4. No implementation details. Architecture definitions, well-defined business logic and how to use a tool are allowed. Code blocks only to illustrate a convention, never copied implementation.
5. Each decision states its reason in one line (and the rejected alternative when relevant).
6. One source of truth per topic, named after the concept (e.g. `checkout.md`), never after a task or project (`refactor-...`, `retirada-...`, `-tasks`, `-validation`). Do not copy what code, Prisma schema or Zod schemas already state; link to them.
7. Updated in the same PR that changes the behavior it describes.
8. No sensitive data (device serials, personal data, credentials).
9. Written in English.

## Promoting a draft on merge

In the PR that implements the feature: rewrite the draft's still-valid rules and decisions into the permanent doc of that concept (update the existing one without losing detail instead of creating another), leave out statuses, open questions, assumptions, plans and implementation detail, then delete the draft.

## Checklist before saving a doc

- The content type matches its location in the table above; nothing in it belongs in Todoist, the PR description or Git instead.
- The file name is the concept, and no other permanent doc already covers that topic (if one does, edit it).
- Permanent docs: no status line, plan, checkbox, date, PR number, "previously", assumption, or copied code or schema.
- Every decision has its one-line reason.
- No sensitive data. Written in English.
- If behavior changed, the doc change is in the same PR.
