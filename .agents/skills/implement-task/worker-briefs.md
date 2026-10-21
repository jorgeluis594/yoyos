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
REPORT (worker_done): document path, the "Questions" block and the "Decided unless objected" list exactly as the skill delivers them. Do not ask the founder anything yourself; the coordinator relays the questions.
```

Later rounds: `ROUND <K>: address these observations from the coordinator: <numbered list>. Report as before.` Closing: `FOUNDER ANSWERS: <answers>. Close the document as in step 6 of the Product skill (skip Todoist; the coordinator updates it) and commit it. Report the commit.`

## Architecture writer

Same restrictions as the product writer.

```text
TASK: design docs/drafts/<topic>.md (closed product definition) following the Architecture skill (.agents/skills/architecture/SKILL.md), and write docs/drafts/<topic>-technical.md including its implementation plan. Do not write a tasks document. Do not implement, create migrations or code files.
The implementation plan must show the waves (which tasks run in parallel after which) and give each task scope, out of scope, acceptance criteria, test titles and dependencies.
REPORT (worker_done): the path, the "Questions" block and the "Decided unless objected" list. Do not ask the founder anything yourself.
```

Rounds and closing as for the product writer, following step 6 of the Architecture skill.

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
Review `git diff jorgeluis594/<topic>...HEAD` against T<N> in the implementation plan of docs/drafts/<topic>-technical.md and the design:
(a) scope and every acceptance criterion; (b) correctness and failure cases; (c) security: company isolation, RLS, validation at boundaries; (d) declared deviations; (e) docs/programming-style.md and docs/architecture.md; (f) tests cover the listed titles and meaningful failures.
Run lint, typecheck and the task's tests yourself with your ports.
COORDINATOR NOTES — deviations declared by the implementer: <list>.
REPORT: write review-tN-rK.md with numbered findings (file:line, blocker or suggestion, and whether it is a design finding). worker_done --outcome succeeded with "APPROVED" when there are no blockers, otherwise --outcome failed with "REJECTED"; --report-path review-tN-rK.md.
```

## Fix round

```text
ROUND <K> for T<N>. Apply only these findings from review-tN-r<K-1>.md, verifying each against the current code first: <numbered list>. Do exactly this and nothing more.
<If the base moved:> First run `git merge jorgeluis594/<topic>`.
Then rerun: <exact commands>. REPORT as in the implementer task, per finding: fixed or why not.
```

## Final verifier

```text
VERIFY the integration branch jorgeluis594/<topic> in this worktree. Do not edit application code.
Run lint, typecheck and unit tests in core and mobile, `sh scripts/run-tests.sh integration` and `sh scripts/run-tests.sh e2e` in apps/core. Then walk every acceptance criterion of docs/drafts/<topic>.md (web and mobile) and say for each where it is satisfied or that it is missing.
REPORT: each command with its result, each criterion with its evidence, and the failures with file:line, written so the coordinator can paste it into the PR description. --outcome failed if anything fails or is missing.
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
