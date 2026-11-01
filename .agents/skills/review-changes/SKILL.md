---
name: review-changes
description: Reviews a Yoyos code change and delivers a verdict with an approach to fix every blocker - runs Claude Code's code-review skill for bugs, checks the change against its task, design and repository rules, then has the approach-planner agent turn the blockers into a fix plan. Use when asked to review a branch, a pull request or a diff, and by reviewer workers of implement-task. Do not use to review product or technical drafts (implement-task review gates) or to apply fixes.
---

# Review changes

The reviewer validates and plans; it does not edit, commit or push. The fix is applied by whoever owns the change, following the approach this review delivers.

## Steps

1. **Fix the scope.** Identify the change (`git diff <base>...HEAD`, a branch or a PR), the task it implements (task in the implementation plan of `docs/drafts/<topic>-technical.md`, Todoist task or PR description) and the deviations the author declared. Use [Happy Memory Recall](../happy-memory-recall/SKILL.md) with the change as the goal.

2. **Find bugs with Claude Code.** Invoke the `code-review` skill (Claude Code's built-in, `/code-review`) at level `high` on the change. Verify each finding against the code before keeping it; drop the ones that do not hold.

3. **Check the change against Yoyos.** On the same diff:
   - Scope: it does what the task asks and nothing outside it; every acceptance criterion is met.
   - Correctness and failure cases the task implies, including money, stock and concurrent requests.
   - Security: company isolation, RLS and restricted database roles, Zod validation at JSON boundaries.
   - Declared deviations: each one is justified or is a finding.
   - Design: [docs/architecture.md](../../../docs/architecture.md) and [docs/programming-style.md](../../../docs/programming-style.md) (pure domain, explicit dependencies, infrastructure adapters, `Result`); contracts between web and mobile live in `shared/`; transactions and idempotency.
   - Performance: N+1 queries, missing indexes for each filter, join, sort and uniqueness rule, unbounded lists, work that holds locks inside transactions.
   - Migrations, when present, per the [Database Migrations](../database-migrations/SKILL.md) skill.
   - Tests: they cover the task's test titles and the meaningful failures, per the [Testing](../testing/SKILL.md) skill.

   Run lint, typecheck and the tests of every app the change touches yourself.

4. **Classify.** A finding is a **blocker** when it breaks an acceptance criterion or expected behavior, leaves a failure case unhandled, weakens security or company isolation, risks data loss or a locking migration, violates a rule of the docs above, introduces a measurable performance problem, or leaves a listed test missing or a check red. Everything else is a **suggestion**. Mark a blocker as a **design finding** when fixing it changes the technical design, not only the code.

5. **Plan the approach.** When there is at least one blocker, start the `approach-planner` agent (Agent tool, `subagent_type: approach-planner`) with the change scope, the task and its design sections, and the numbered blockers with `file:line` and why each matters. Validate what it returns: every blocker has an approach, the plan stays inside the task's scope and contradicts neither the design nor the memory. Send it back once with the gaps if it does not; drop anything it adds beyond the blockers.

6. **Report.** Write the report (the file the caller names, or the chat when there is none) with:
   1. Verdict: **APPROVED** when there are no blockers, otherwise **REJECTED**.
   2. Numbered findings: `file:line`, blocker or suggestion, design finding or not, what is wrong and why it matters.
   3. Approach (when rejected): per blocker, the direction of the fix; then the plan in order with the checks that prove it.
   4. Checks run with their exact command and result.
