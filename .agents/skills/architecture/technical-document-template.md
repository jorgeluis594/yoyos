# Template for the technical document

The technical document is a draft in `docs/drafts/<concept>-technical.md`, written in English following the [Documentation](../documentation/SKILL.md) skill, and describes only the current design. Sections marked as constant always go in; optional ones only when the feature needs them. No content is invented to fill a section: if it does not apply, it is omitted.

It contains no product definition (what the user sees, screen texts, visible business rules): that is in `docs/drafts/<concept>.md` and is linked. It contains no implemented code: the snippets are design contracts.

## Style

- Title with the pattern "<Topic>: technical design".
- Below the title, one **Status** line ("design closed, pending implementation" or "draft with open questions"), the product document it starts from and the base branch or commit.
- Impersonal voice, declarative present. Subjects: "core", "mobile", "the use case", "the repository".
- Each decision asserts and closes the alternative: "The event carries `messageId`. It does not carry the image bytes."
- Code names in backticks: `reportPayment`, `OrderBuyer`, `POST /api/messages`. File paths relative to the repo.
- TypeScript snippets only for contracts: input types, dependencies, errors, unions, Zod schemas. No function bodies unless the algorithm is the decision.
- Tables for decisions (`| Topic | Decision |`), current state (`| Piece | Location | State |`), changes per file (`| File | Change |`), retries (`| Situation | Decision |`) and observability (`| Event | Level | Fields |`).
- Decisions are asserted without a marker. Assumptions are marked: "Assumption: …". What depends on the founder goes in the questions block, never disguised as a decision.
- No history of discarded decisions. Reorganizing never loses detail.

## Technical document skeleton

```markdown
# <Topic>: technical design

**Status:** <design closed, pending implementation | draft with open questions>. Based on `docs/drafts/<concept>.md`. Base: <branch or commit>.

## 1. Technical goal                   (constant)
## 2. Decisions                        (constant)
## 3. Verified current state           (constant)
## 4. Gaps this design closes          (constant)
## 5. Use cases                        (constant)
## 6. Domain and typing                (constant)
## 7. Persistence                      (when the schema or data access changes)
## 8. Contracts between applications   (when mobile and core exchange JSON)
## 9. Events and cross-feature integration (when there is an event or cross-feature capability)
## 10. Mobile                          (when the mobile app changes)
## 11. Transactions and concurrency    (when there are writes with effect)
## 12. Code organization               (constant)
## 13. Observability                   (constant)
## 14. Tests                           (constant)
## 15. Limits and checks during implementation (constant)
## 16. Implementation plan            (constant)
## 17. Open items and questions        (only while they exist; removed when closed)
```

## Section guide

### 1. Technical goal
Five lines: what the system does when done, from which input to which effect. A `text` diagram of entities or of the flow between applications when there are more than two pieces.

### 2. Decisions
Table `| Topic | Decision |` with everything the founder might want to change: technical scope, which branch resolves what, what is deferred (with its Todoist link if the founder had one created), chosen libraries, initial values. It is the section read first.

### 3. Verified current state
Table `| Piece | Location | State |` of what exists and is reused or modified: use cases, repositories, contracts, tables, migrations, events, screens. With file paths and, when it matters, the commit. What was not verified in the code is marked as an assumption.

### 4. Gaps this design closes
Numbered list of what the code lacks to meet the defined behavior. Each gap is referenced from the section that closes it.

### 5. Use cases
One entry per use case, new or modified, with: name, owning feature, `input`, `access`, `deps` (each with its `Result` signature), output, errors with `code`, and the flow as a numbered list (load, verify, apply rule, write, return). Existing ones that change are listed separately with the exact change.

### 6. Domain and typing
New or modified types with their justification in one line. Branded types with their parser. Discriminated unions. State machine or transitions if there is a lifecycle. Table `| Layer | Types and authority |` when the feature crosses layers.

### 7. Persistence
New or modified tables and columns, `CHECK` constraints, unique indexes, composite foreign keys with `companyId`, row-level isolation policies, and the migration name. What development data is deleted if there is no production. Zod schemas for rows read.

### 8. Contracts between applications
Schemas in `shared/contracts/<topic>.ts` with version, fields and what changes relative to the current contract. What each side validates. Error codes and HTTP statuses.

### 9. Events and cross-feature integration
Event name, payload with ids, strict parser, who publishes (after commit), who listens and from where, handler retries and what happens in each failure window (table `| Failure window | What happens | Effect for the user |`).

### 10. Mobile
Table `| File | Change |` per layer (domain, application, infrastructure, presentation, composition). Local SQLite migrations. Sync retry rules in a `| Situation | Decision |` table.

### 11. Transactions and concurrency
Numbered list of the transaction step by step: company scope, lock, checks, writes, commit. What each lock guarantees and what happens with two simultaneous operations. Duplicate policy.

### 12. Code organization
What goes in `domain/`, `application/`, `infrastructure/`, `presentation/` and `composition.ts` of each feature touched. Map of new and modified files. Capabilities one feature exposes to another.

### 13. Observability
Table `| Event | Level | Where | Fields |`. Fields as a JSON list of names. What is never logged.

### 14. Tests
`test("…")` titles grouped by level and application: unit (rules, use cases with fakes), core integration, mobile integration, web E2E (happy path only). At the end, pending manual checks.

### 15. Limits and checks during implementation
What the design explicitly leaves out and why; what must be verified when implementing (a library version, a database behavior, a device limit).

### 16. Implementation plan
The slices implementation agents take, in the format of the skeleton below. There is no separate tasks document.

### 17. Open items and questions
Only the open questions with the founder, in the format of Step 11 of the guide. Removed when closed.

---

## Implementation plan skeleton

Section 16 of the technical draft. Implementation agents take it with the Implementation skill.

```markdown
## 16. Implementation plan

### Order and parallelism
Diagram or list: which task blocks which; the rest in parallel.

### T0. <Minimal blocker: schema, type or shared contract>
**Scope:** …
**Out of scope:** …
**Acceptance criteria:**
1. <scenario with data and observable result>
**Depends on:** nothing.

### T1. <Complete verifiable flow>
**Scope:** …
**Out of scope:** …
**Acceptance criteria:** …
**Depends on:** T0.

### Final verification
Manual or on-device tests that close the feature. Their results go in the pull request description, not in the draft.
```

Rules: a task covers a probable end-to-end flow, not a file or a layer; blockers are isolated in the smallest possible task; each task names the tests from the technical document it must leave green; deferred items with risk link their Todoist task when the founder had one created.
