# Redundancy review: `docs/domain.md`

Review of the domain conventions (132 lines). Scope: repeated principles inside the document, overlap with `docs/architecture.md`, and what should stay as-is. This is an audit, not a replacement for the guidelines.

## Context

`docs/domain.md` defines domain conventions for the API and the Expo app: business rules are deterministic functions owned by their feature, with explicit inputs and no external reads, writes, or mutation of caller data. Application use cases coordinate supplied capabilities and those rules. Expected outcomes are explicit; no `response<T>` helper library is assumed. Tests verify observable rules and outcomes rather than private calls.

Purpose tells the reader to follow [Application Architecture](architecture.md), keep adapters in [Persistence Conventions](persistence.md), and verify behavior in [Testing Conventions](testing-conventions.md). That makes cross-document restatement more costly here than in `architecture.md`: the file both defers to architecture and recopies large parts of it.

The document is written to be opened by section while implementing rules or use cases. That consult-by-jump style explains some internal repetition.

## Verdict

There is real redundancy, in two layers:

1. **Internal:** a few principles restated across Purpose, Feature Ownership, Pure Domain, Application, Validation, Testing, and Workflow.
2. **Cross-document (the larger issue):** the feature tree, YAGNI-of-files, composition, cross-feature access, `shared/`, API-vs-mobile sameness, “no HTTP/UI in failures,” tests without server/UI, and the six-step workflow already live in `architecture.md`.

The unique payload is operational domain guidance: purity details, use-case flow, the validation table, searches, outcome composition, and how to test rules vs use cases.

A pass that keeps those unique rules and replaces recopied architecture with pointers would cut roughly 35–50 lines, and would stop the two docs from drifting.

## Repeated principles (inside `domain.md`)

### 1. Rules are pure; technical I/O stays at the boundary

| Location | What it says |
| --- | --- |
| Purpose (~L5) | Keep rules pure; leave data access and platform interaction at their boundaries. |
| Pure Domain Rules (~L49–55) | Same result for same inputs; no external resources, clocks, globals, or mutation. |
| Application (~L62, L74) | Coordinate pure rules; do not construct clients or pass UI/HTTP/navigation. |
| Testing (~L121) | Control time explicitly; no server, UI, network, or database. |

Purpose already states the principle. Pure Domain Rules is the right expansion (inputs, time, mutation, normalization vs mapping). Application and Testing only need the local consequence.

### 2. Feature ownership and no private cross-imports

| Location | What it says |
| --- | --- |
| Purpose (~L5) | Rules belong to the feature that owns the business concept. |
| Feature Ownership (~L37–43) | Choose by the concept that changes; no private imports; acyclic deps; `shared/` only without an owner. |
| Application (~L78) | Do not bypass ownership by modifying another feature’s storage. |
| Workflow (~L125, L132) | Identify the owning feature; add exports/shared helpers only when needed. |

Feature Ownership is the canonical section. Application’s “do not write another feature’s storage” is a distinct, useful special case. The rest is restatement.

### 3. Do not create unused structure

| Location | What it says |
| --- | --- |
| File Hierarchy (~L33) | Filenames illustrate ownership, not boilerplate. Omit unused files. Small ops may live in `application/service.ts`; contracts may be inline. |
| Application (~L78) | Introduce workflow machinery only when the operation requires it. |
| Outcomes (~L105) | Do not introduce a functional utility library just to express a sequence. |
| Workflow (~L132) | Add public exports, contracts, shared helpers, or files only when current behavior needs them. |

Same YAGNI rule. Hierarchy already covers files; Outcomes’ “no `pipeAsync` library” is a distinct anti-pattern and should stay.

### 4. Presentation is not the business authority

| Location | What it says |
| --- | --- |
| Validation and Authority (~L89–91) | Use cases enforce independently of the entry point; presentation is not the only protection; API auth is independent of mobile. |
| Searches (~L96–99) | Presentation parses transport; domain/application own meaning; repositories must not invent defaults. |
| Outcomes (~L109) | Presentation translates outcomes into API responses or mobile feedback. |

The validation table plus L89–91 is enough for authority. Searches and Outcomes add layer-specific consequences and are not redundant with each other.

### 5. API and mobile share the model, not runtime code

Stated in Purpose (~L7) and again in Feature Ownership (~L45), including “share pure rules only when both apps genuinely need the same semantics.” The second sentence is the only new rule; the first is a copy of architecture.

## Map vs detail overlap

The file hierarchy tree (~L13–31) already labels `order.ts`, `rules.ts`, `errors.ts`, use cases, ports, adapters, `schemas.ts`, and `index.ts`. Later sections reopen those labels:

- Pure Domain Rules ≈ comments on `domain/`
- Application Use Cases ≈ comments on `application/`
- Validation table ≈ comments on `presentation/schemas.ts` vs domain vs infrastructure

The tree is a map. The sections should keep only operational rules that the comments cannot carry (purity constraints, the load → rules → persist flow, the validation matrix).

## Overlap with `docs/architecture.md`

This is the main redundancy. Purpose already says to follow architecture, then recopies it.

| `domain.md` | Already in `architecture.md` |
| --- | --- |
| Feature tree (~L13–31) | Feature Hierarchy tree; domain.md only adds `*.test.ts` comments. |
| Omit unused files; `service.ts`; inline ports (~L33) | Same paragraph in Feature Hierarchy. |
| Cross-feature via `index.ts`; acyclic deps (~L41–42) | Dependency Direction bullets. |
| `shared/` only with no business owner (~L43) | Shared Code. |
| Same model, no shared runtime (~L45) | Purpose + Shared Code. |
| No HTTP/UI/DB imports in domain (~L52) | Domain layer. |
| Explicit deps; do not construct adapters (~L74) | Application + composition. |
| API authoritative; mobile is not a security boundary (~L91) | Validation, Security, and Failures. |
| Failures without HTTP/navigation/UI copy (~L103) | Application failures. |
| Tests next to behavior; no server/UI for domain/app (~L113, L121) | Implementation Workflow testing notes. |
| Six-step workflow (~L125–131) | Almost the same six steps. |

What architecture does **not** cover, and `domain.md` should keep:

- Purity details: no mutation of caller inputs; time/IDs as arguments; units, precision, rounding.
- Business normalization vs technical mapping.
- Use-case flow: load through capabilities → rules → effects → outcome.
- Validate invariants before writes; consistency deferred to the persistence guide.
- Validation responsibility table (more precise than architecture’s prose).
- Identity acquisition stays outside pure rules.
- Entire **Searches and Listings** section.
- Outcome composition: no assumed `response<T>` / `pipeAsync`; stop on failure; collection-level vs per-item failure; do not disguise unexpected exceptions.
- Testing specifics: fakes, unchanged state on rejection, do not assert private helpers, do not repeat rule cases through adapters and screens.
- “A rule does not become generic merely because several callers need it.”
- Share pure rules across API/mobile only when both need the same semantics.

## What is not redundant

| Section | Distinct contribution |
| --- | --- |
| Pure Domain Rules | Operational purity: inputs, time, mutation, precision, normalization vs mapping. |
| Application flow (~L65–76) | Ordered use-case steps; reject-before-write; pointer to persistence for consistency. |
| Validation table | Who owns shape vs policy vs integrity. |
| Searches and Listings | Filters, defaults, pagination, repo must not repair invalid input, empty vs failed. |
| Outcomes | Explicit result contract, no helper-library assumption, collection failure policy. |
| Testing | How to test rules vs use cases vs searches; what not to assert. |

## Why the repetition exists

Same consult-by-jump style as architecture: a reader opening “Searches” still sees that presentation does not own business meaning.

On top of that, `domain.md` tries to be usable without flipping back to `architecture.md`, so it inlines the feature tree and the dependency rules. That fights its own Purpose sentence (“Follow Application Architecture”).

Cost in 132 lines is moderate. The downsides of leaving it as-is:

- Fatigue if read after `architecture.md`.
- Two sources for the same tree, composition rules, and workflow; edits can drift.
- The unique domain rules are harder to see next to recopied architecture.

## Recommended compaction

Keep the document as domain conventions, not a second architecture guide.

1. Purpose: keep the one-paragraph contract (owned pure rules, use cases coordinate, I/O at boundaries) and the links to architecture, persistence, and testing.
2. Replace the full feature tree with a short pointer to architecture’s Feature Hierarchy, plus the two domain-specific notes: tests live next to rules/use cases, and unused files are omitted.
3. Keep **Feature Ownership** but drop bullets that duplicate architecture (acyclic deps, `index.ts`, `shared/` junk-drawer). Keep: choose by the concept that changes; a rule is not generic just because it has many callers; share pure rules across apps only with shared semantics.
4. Keep **Pure Domain Rules** almost intact; it is the core of the file.
5. Keep the use-case flow, reject-before-write, and the persistence pointer. Drop the second copy of “do not construct adapters / do not pass HTTP/UI.”
6. Keep the validation table, searches, and outcomes. One line can point at architecture for “API is the security boundary.”
7. Keep Testing’s domain-specific bullets; drop “tests next to files” and “no server/UI” if those stay in architecture / testing conventions.
8. Drop or shrink Implementation Workflow to “implement rules, then the use case; do not move rules into adapters or presentation.”

Expected result: about 35–50 fewer lines, domain-only rules easier to find, one source of truth for structure and composition.

## Conclusion

`docs/domain.md` is consistent with the stored domain decision (pure, feature-owned rules; use cases coordinate; explicit outcomes; no helper-library requirement). Internally it restates purity, ownership, YAGNI, and authority. The larger redundancy is that it recopies `architecture.md` after telling the reader to follow it.

Compacting the architecture echo is the high-value edit. The purity, search, outcome, and testing-detail sections should stay.
