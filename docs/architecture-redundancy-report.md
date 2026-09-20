# Redundancy review: `docs/architecture.md`

Review of the shared architecture guidelines (177 lines). Scope: repeated principles, overlapping maps vs layer detail, and what should stay as-is. This is an audit, not a replacement for the guidelines.

## Context

`docs/architecture.md` is the target architecture for both the API and the Expo mobile app. It is self-contained, written in English, and lives at the repository root under `docs/`. It is not a description of the current scaffolds.

The contract it encodes:

- Business features under `src/features` with `domain`, `application`, `infrastructure`, and `presentation`.
- Composition supplies concrete adapters to application operations.
- Framework entry points differ by platform; domain and application stay independent of HTTP and UI.
- Create only required layers and files. A shared architecture does not require a shared package.

The document is written to be opened by section while planning, implementing, or refactoring. That consult-by-jump style explains most of the repetition: each block restates the global contract so a reader who lands on Presentation or Infrastructure still sees the same rules.

## Verdict

There is real redundancy. It is concentrated in **five principles restated across sections**, not in duplicated sections. The unique rules (feature naming, presentation file shapes, validation/security, workflow) are not redundant.

A pass that states each principle once and keeps only operational “owns / must not” in each layer would cut roughly 30–40 lines without dropping a norm.

## Repeated principles

### 1. Do not create unused structure

| Location | What it says |
| --- | --- |
| Repository Hierarchy (~L32) | Create folders only when they contain required code. |
| Feature Hierarchy (~L59) | Filenames illustrate responsibilities, not mandatory boilerplate. Omit unused files and layers. |
| Infrastructure (~L93) | Separate adapter files only when multiple real sources require them. |
| Composition (~L126) | Use a separate composition file only if setup grows enough. |
| Implementation Workflow (~L177) | Do not add empty layers, forwarding services, generic frameworks, or shared packages for hypothetical needs. |

Same YAGNI rule: do not invent folders, files, or indirection ahead of a real need. Repeating it next to a concrete example is useful; repeating it as a global mantra in five places is not.

### 2. Same architecture, different platform

Purpose already closes this twice:

- Guidelines apply equally to the API and the Expo app.
- Both follow the same dependency rules and feature hierarchy; adapters and entry points differ; business logic stays independent.

That idea returns as two repository trees, two `order-repository.ts` comments, two presentation trees, and another note that framework entry points differ.

The useful remainder is **how** presentation and infrastructure differ per platform. The fact that the rules are shared does not need to be restated in every section.

### 3. Composition and dependency injection

The same runtime vs source-dependency story appears three times:

- **Application:** dependencies are supplied through parameters or ordinary composition; application code must not construct concrete repositories (~L75–78).
- **Entry points:** composition creates adapters, supplies them to use cases, and exposes operations to presentation. Wiring belongs at startup, root setup, or feature registration (~L126–127).
- **Dependency Direction:** diagram plus “the use case must not import the concrete adapter” (~L131–138).

One canonical statement of composition, plus the diagram, would cover it. Application and entry points only need the local consequence (do not construct adapters here / wire them here).

### 4. Dependency direction (“must not”)

Each layer ends with a prohibition list (domain: no UI/DB/frameworks; application: no HTTP/hooks/clients; infrastructure: no business policy, UI, navigation, or HTTP responses; presentation: no DB queries, direct business endpoints, or domain rules). **Dependency Direction** then rewrites those rules as bullets (~L140–147).

Keep the diagram and a short allowed-dependency list as the index. Keep in each layer only the prohibitions that are specific to that layer’s typical mistakes.

### 5. Shared code is not a shared package

| Location | What it says |
| --- | --- |
| Repository Hierarchy (~L32) | Shared folders are local to each app; common architecture does not require a shared package. |
| Shared Code (~L151–155) | Move to `shared/` only with multiple features and no business owner; sharing API/mobile contracts is optional and must not couple frameworks or persistence models. |
| Workflow (~L177) | Do not add shared packages for hypothetical future needs. |

Three warnings against the same failure: treating `shared/` as a junk drawer or extracting a package too early. Shared Code is the right home; the other two can point at it or drop the restatement.

## Map vs detail overlap

The `features/orders/` tree (~L41–57) already labels each folder (business types, use cases, adapters, platform I/O). **Layers and File Ownership** opens each subsection with the same one-liner, then expands it.

The extra value in the layer sections is operational, not the label:

- Domain: pure/deterministic rules; plain data by default; no classes unless needed.
- Application: ports are optional; no DI framework required.
- Infrastructure: feature adapter vs application-wide `src/infrastructure/`.
- Presentation: screens/hooks/handlers invoke use cases; UI-only behavior stays in presentation.

`order-repository.ts` appears in the feature tree, again in the API vs mobile infrastructure example, and as a port in `application/ports/`. The infrastructure dual example is especially thin: only the comment changes (“Database access” vs “API access or local persistence”). That can be one line under the shared tree.

## What is not redundant

These sections add rules that do not exist elsewhere:

| Section | Distinct contribution |
| --- | --- |
| Repository Hierarchy | Where each app lives; `shared/` is per-application. |
| Feature naming | Use business names (`orders`, `inventory`); do not group under `services` or `managers`. |
| Presentation trees | The only place that shows API `routes.ts` / `schemas.ts` vs mobile `screens` / `hooks` / feature components. |
| Validation, Security, and Failures | Trust-boundary validation; API as security boundary; no secrets on mobile; application failures without HTTP/UI; atomicity and retries. |
| Implementation Workflow | Order of work and where to test (domain/use cases without server or UI). |

Failures are mentioned in domain, application, and infrastructure, then again in Validation. That is an echo, but Validation still adds mapping to HTTP/UI and “unknown failures must remain observable.”

## Why the repetition exists

The doc is a checklist for someone who opens one section, not a linear essay. Restating the contract in each layer reduces the chance of implementing Presentation without the dependency rules.

Cost in 177 lines is low. The downsides of leaving it as-is:

- Fatigue if the document is read end to end.
- One canonical rule living in four places, so a later edit can drift.

## Recommended compaction

Keep the document self-contained and dual-app. Do not split it or point at a removed draft.

1. Add a short **Principles** block after Purpose: same rules for API and mobile; create folders only when needed; composition at the edge; no shared package by default.
2. In each layer, keep only **owns**, typical files, and layer-specific **must not**. Drop restated global principles.
3. Leave **Dependency Direction** as the diagram plus a short allowed-dependency list.
4. Keep **Shared Code** as the single home for sharing rules; delete the duplicate warnings in Hierarchy and Workflow, or replace them with a one-line pointer.
5. Merge the API vs mobile `order-repository.ts` trees into one note: same filename, different data source.
6. Leave Validation/Security and Workflow intact.

Expected result: about 30–40 fewer lines, one source of truth per principle, no loss of the decisions the repository already treats as binding.

## Conclusion

`docs/architecture.md` is internally consistent and already short. The redundancy is pedagogical restatement of five principles (YAGNI structure, dual-app sameness, composition, dependency direction, no shared package), plus label overlap between the feature tree and the layer sections.

Compacting those estribillos is optional. It is worth doing if the doc will be edited often or read in full; it is not required for correctness.
