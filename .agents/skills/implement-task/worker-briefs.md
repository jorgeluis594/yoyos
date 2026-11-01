# Worker briefs

Each spec is self-contained: the worker has no conversation history. Replace `<...>`. Write in English or Spanish, as the documents are written. Keep the common block identical across workers of a run.

## Common block (prepend to every spec)

```text
CONTEXT: Yoyos monorepo. Read AGENTS.md and follow it (happy-memory-recall before designing; happy-memory-maintainer before reporting when business rules or contracts change; database-migrations skill for schema changes; Implementation and Testing skills). Documents: docs/drafts/<topic>.md (product), docs/drafts/<topic>-technical.md (design and implementation plan, normative). Integration branch: jorgeluis594/<topic>.
CONSTRAINTS: Work only in your worktree and branch. Do only your task; sibling tasks run in parallel on other branches, so keep edits to shared files minimal and say which ones you touched. Do not merge, rebase, push, use git stash or open PRs. Do not edit AGENTS.md, skills or unrelated files. Do not commit generated artifacts (.impeccable/review/*.png, logs, Playwright output). Never delete Docker networks, volumes or containers; if Docker fails, report it with `ask`.
QUESTIONS: If the design is ambiguous or wrong, or you are blocked after two attempts, ask the coordinator with the `ask` command of your preamble instead of guessing.
TEST ISOLATION: Always export CORE_TEST_PORT=556N0 MAILPIT_SMTP_PORT=116N0 MAILPIT_UI_PORT=186N0 CORE_E2E_PORT=46N0 before tests. When finished run `docker compose -f compose.yaml --profile test down` from apps/core.
```

## Product writer

Use only CONTEXT and the first two sentences of CONSTRAINTS from the common block; this worker writes documents, not code.

```text
TASK: define <task, or Todoist task id> at the product level following the Product skill (.agents/skills/product/SKILL.md), and write docs/drafts/<topic>.md. Do not implement.
KNOWN CONTEXT: <three-line summary of what the task asks, what exists and what is out of scope>.
REPORT (worker_done): document path, the "Questions" block and the "Decided unless objected" list exactly as the skill delivers them. Do not ask the founder anything yourself; the coordinator takes the questions to the review gate.
```

Later rounds: `ROUND <K>: address these observations from the coordinator: <numbered list>. Report as before.` Closing: `REVIEW ANSWERS (approved by the review gate, act on them as the founder's answers): <answers and accepted suggestions>. Close the document as in step 6 of the Product skill (skip Todoist; the coordinator updates it), keeping every question in "Questions decided by the review gate" with its answer, who decided it, the reason and the discarded alternatives, and commit it. Report the commit.`

## Architecture writer

Same restrictions as the product writer.

```text
TASK: design docs/drafts/<topic>.md (closed product definition) following the Architecture skill (.agents/skills/architecture/SKILL.md), and write docs/drafts/<topic>-technical.md including its implementation plan. Do not write a tasks document. Do not implement, create migrations or code files.
The implementation plan must show the waves (which tasks run in parallel after which) and give each task scope, out of scope, acceptance criteria, test titles and dependencies.
REPORT (worker_done): the path, the "Questions" block and the "Decided unless objected" list. Do not ask the founder anything yourself.
```

Rounds and closing as for the product writer, following step 6 of the Architecture skill.

## Gate reviewers

All four use the same frame with their own FOCUS. Use only CONTEXT and the first two sentences of CONSTRAINTS from the common block.

```text
REVIEW-ONLY TASK: you are the <role> reviewer of <docs/drafts/<topic>.md | docs/drafts/<topic>-technical.md>. You replace the founder's approval, so review as the person accountable for the result. Do not edit or commit.
Read the draft in full, the guide of its skill (<.agents/skills/product/product-guide.md | the Architecture skill and its guide>), the documents it builds on<, docs/drafts/<topic>.md for architecture> and the code it touches. Use happy-memory-recall for prior decisions.
CHANGE MAP: <coordinator's change map>.
QUESTIONS FROM THE WRITER: <block>. DECIDED UNLESS OBJECTED: <list>.
FOCUS: <role focus below>.
REPORT: write gate-<product|architecture>-<role>-rK.md with (1) numbered findings: section, blocker or suggestion, what is wrong or missing and why it matters, never the rewording; (2) per question: your answer and reason; (3) objections to the decided list. worker_done --outcome succeeded with "APPROVED" when there are no blockers, otherwise --outcome failed with "REJECTED"; --report-path <file>.
```

FOCUS per role:

- **UX/UI:** every flow is complete for web and mobile, with entry points, empty, loading, error and success states; the user always knows what happened and what to do next; copy is clear and consistent with existing screens; reuses existing components and patterns; accessibility (labels, contrast, touch targets); nothing asks for more steps or data than the goal needs.
- **Product:** the definition solves the task's problem for the business selling through social media; every actor, permission, state and failure has its behavior; acceptance criteria are verifiable; scope is the smallest that delivers value, with what is left out and its meeting point; no contradiction with memory, current docs or business rules; edge cases with money, stock and company isolation.
- **Design:** every product behavior and acceptance criterion maps to a use case, test title and plan task; layering per docs/architecture.md and docs/programming-style.md (pure domain, explicit dependencies, infrastructure adapters, Zod at JSON boundaries, Result); contracts between web and mobile in shared/; transactions and idempotency; company isolation and RLS; migrations safe per the database-migrations skill; observability; the plan's waves and dependencies let tasks run in parallel without touching the same files.
- **Performance:** for every read and write path, the queries it issues: N+1 patterns (queries inside loops, per-row lookups, lazy relations in lists), missing or wrong indexes for each filter, join, sort and uniqueness rule, including company_id leading composite indexes; unbounded lists without pagination; over-fetching; work inside transactions that holds locks; locking migrations on large tables; mobile payload size and request count per screen.

## Implementer

```text
TASK: T<N> "<title>" of the implementation plan in docs/drafts/<topic>-technical.md. Read its Scope, Out of scope, Acceptance criteria, Tests and the design sections it references, and implement exactly that.
ALREADY MERGED IN YOUR BASE: <tasks and commits, or "nothing">.
RUNNING IN PARALLEL: <sibling tasks and the files they own>.
METHOD: write the listed tests first, then the code. Commit per logical unit (Implementation skill).
ACCEPTANCE: lint, typecheck and unit tests of every app you touched pass; integration tests pass when persistence or contracts changed; E2E when the task lists it.
REPORT (worker_done): branch, commits, each check command with its result, deviations from the design with the reason, known debt. Use --files-modified.
```

## Reviewer

```text
REVIEW-ONLY TASK for T<N> in this worktree (branch <topic>-tN). Validate, do not edit or commit.
Review `git diff jorgeluis594/<topic>...HEAD` with the review-changes skill against T<N> in the implementation plan of docs/drafts/<topic>-technical.md and the design. Run the checks with your ports.
COORDINATOR NOTES — deviations declared by the implementer: <list>.
REPORT: write review-tN-rK.md in the skill's report format (verdict, numbered findings, approach and plan when rejected, checks run). worker_done --outcome succeeded with "APPROVED" when there are no blockers, otherwise --outcome failed with "REJECTED"; --report-path review-tN-rK.md.
```

## Fix round

```text
ROUND <K> for T<N>. Apply only these findings from review-tN-r<K-1>.md, verifying each against the current code first and following the reviewer's approach and plan in that file: <numbered list>. Do exactly this and nothing more; if the approach does not hold against the code, say why and what you did instead.
<If the base moved:> First run `git merge jorgeluis594/<topic>`.
Then rerun: <exact commands>. REPORT as in the implementer task, per finding: fixed or why not.
```

## Final verifier

```text
VERIFY the integration branch jorgeluis594/<topic> in this worktree. Do not edit application code.
Run lint, typecheck and unit tests in core and mobile, `sh scripts/run-tests.sh integration` and `sh scripts/run-tests.sh e2e` in apps/core. Then walk every acceptance criterion of docs/drafts/<topic>.md (web and mobile) and say for each where it is satisfied or that it is missing.
<If the branch touches UI:> SCREENSHOTS: run the app with test data (docker compose for web, with the playwright-cli skill; Expo for mobile) and capture every new or changed screen and state (empty, error and success included), web and mobile, as PNG into <scratchpad>/screenshots/ named <platform>-<screen>-<state>.png. Do not commit them. Never show real customer data.
REPORT: each command with its result, each criterion with its evidence, the screenshot files with a one-line caption each, and the failures with file:line, written so the coordinator can paste it into the PR description. --outcome failed if anything fails or is missing.
```

## Documentation

Use only CONTEXT and the first two sentences of CONSTRAINTS from the common block.

```text
TASK: promote docs/drafts/<topic>.md and docs/drafts/<topic>-technical.md following the Documentation skill (.agents/skills/documentation/SKILL.md): rewrite their still-valid rules and decisions, as implemented on this branch, into the permanent doc of the concept in docs/ (update the existing one without losing detail), then delete both drafts. Commit. Do not edit application code.
REPORT (worker_done): permanent doc path, what was rewritten and what was left out and why, the commit.
```

## CI fixer

```text
CI FAILED on PR #<n> (branch jorgeluis594/<topic>). Read `gh run view <run-id> --log-failed`, reproduce locally with your ports, fix the cause (not the test, unless the test is wrong, which you must justify), and commit. Do not push.
REPORT: cause, fix, commits and the commands that now pass.
```
