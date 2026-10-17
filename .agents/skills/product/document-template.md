# Product document template

The document lives in `docs/<topic>.md`, written in English, and describes only the current product-level design. Sections marked as constant always go in; optional ones only when the feature needs them. No content is invented to fill a section: if it does not apply, it is omitted.

It contains no construction decisions: no data structure, no technical contracts, no code organization, no executable tests. Those are defined in the next phase, taking this document as the behavior definition.

## Style

- Title with the pattern "<Topic>: product definition" or "<Topic> on <platform>: product definition".
- Below the title, one **Status** line with the date, what already exists, which document it complements or replaces and the Todoist task.
- Impersonal voice, declarative present, no first or second person. Subjects: "the seller", "the buyer", "the screen", "Yoyos".
- Each rule asserts and closes the alternative: "The sale is blocked if stock is missing. Stock is not reserved in the cart."
- Always concrete values: quantities, times, ranges, the business time zone. An example with real data wherever there is ambiguity: S/ 120.00, "Order #1001", 28/09/2026.
- Angle quotes «» for text visible in the interface, in the language the interface uses; bold for controls and actions (**Save and print**).
- Two-column tables for rules (`| Aspect | Behavior |`), numbered lists for flows, `text` blocks for diagrams.
- Decisions are asserted without a marker. Assumptions are marked: "Assumption: …". What depends on the founder goes in the questions block, never disguised as a decision.
- No history of discarded decisions nor "it had previously been decided". Reorganizing never loses detail.

## Skeleton

```markdown
# <Topic>: product definition

**Status:** <definition ready to implement | draft with open questions>. <What already exists, source document, Todoist task, date>.

## Problem and situation               (constant)
## Goal                                (constant)
## Users and surfaces                  (constant when there is more than one actor or platform)
## First-version scope                 (constant)
## Out of this version                 (constant)
## Flow                                (constant in features with an interface)
## Screens                             (constant in features with an interface)
## Rules                               (constant)
## States                              (when there is a lifecycle)
## When something fails                (constant)
## Who sees and does what              (when there is more than one actor or sensitive data)
## Information that is kept            (when the order, the business or the phone stores something new)
## Vocabulary                          (when a new term appears, or two that get confused)
## Closed decisions                    (constant)
## Acceptance criteria                 (constant)
## Open items and questions            (only while they exist; removed when closed)
```

## Section guide

### Problem and situation
One paragraph. What the seller or buyer does today without this feature, when it happens (in the chat with the customer waiting, in the store, at night closing the register), what they solve it with today (notebook, Excel, memory, another app) and what goes wrong. A concrete story, not a category. If the feature is parity with the web, say so: "The web already solves it; the seller operates from mobile and today has to open the web to…".

### Goal
One or two sentences with what the user will be able to do when done. If there is an outcome hypothesis (more confirmations, fewer abandoned orders), write it as a hypothesis and say how it would show.

### Users and surfaces
Table `| User | Need | Surface |`. Users by situation, not demographics: "seller recording an in-store sale with the customer in front of them", "buyer who received a link on WhatsApp and has no account".

### First-version scope
List of what goes in, bounded by types, channels, platforms and geography rather than by reliability. State what belongs to another task and which meeting point is left defined so that task only adds. If there are several slices, their order.

### Out of this version
List of what is deferred, each item with its trigger: "when send-frequency control exists", "when rates are defined". Anything with real risk is recorded as a Todoist task and linked.

### Flow
Numbered list of the usual end-to-end path, with the main action of each step and the default values. Then the alternative paths that matter (rejection, uncertain outcome, abandoning midway) as short sublists.

### Screens
One entry per screen, with the name in bold followed by a colon and:
- Main action and controls (**Load more**, **Save**).
- States: no data yet, loading, no results for these filters, load error, too many. Each state with its visible text in «».
- Button texts and messages the user sees, with the remedy in every error.
- What is kept when navigating (search, list, position) and what asks for confirmation on discard.
- Navigation with text arrows: Settings → Deliveries.

### Rules
Table `| Aspect | Behavior |`. Each rule with concrete values and, when not obvious, an example with real data.

### States
Table `| State | Meaning | What triggers it | What can be done | What the seller sees | What the buyer sees |` (drop columns that do not apply), plus a list of allowed transitions. State what happens to records that existed before this state.

### When something fails
Table `| Situation | What the user sees | What they can do |` that distinguishes the four outcomes of every action with effect: success, known rejection (returns to correct with work intact and the affected element marked), not sent (retry), uncertain outcome (verified before repeating; never presented as success). What is blocked while an action is in doubt. What happens if the user abandons midway and comes back.

### Who sees and does what
Table `| Actor | Can see | Can do | Cannot |`. For each protection layer, the concrete risk it closes. Which business data the buyer does not see. Whether the response to a public action is the same whether or not the resource exists.

### Information that is kept
What is copied into the order and stays fixed (what was agreed), what is always shown current (instructions to act now), what is a phone preference and what is account data, what is not stored because it is ephemeral, and what happens to what already existed. No data structure: only which information, whose, and until when.

### Vocabulary
List `term: definition` for each new concept or pair of terms that get confused, with the text the user sees in «».

### Closed decisions
Table `| Decision | Why |` with this feature's decisions that must not be reopened, one line each. No history or alternatives: only what is current and its reason. It exists so a future agent does not re-propose what was discarded.

### Acceptance criteria
Numbered list of concrete scenarios: situation with data and observable result. Each must be convertible into a test in the next phase, but here neither the type nor the location is stated. Cover the usual path, each known rejection, the uncertain outcome and abandoning midway.

### Open items and questions
Only while they exist. The questions block follows Step 12 of the product guide: numbered, recommended option first with its reason, consequence of each alternative, and separately the "Decided unless objected" list. When the founder answers, the document is updated and the resolved questions disappear from this section.
