---
version: 1
slug: new-order
primary_target: apps/mobile/src/features/orders/presentation/new-order-screen.tsx
related_targets:
  - apps/mobile/src/features/orders/presentation/new-order-screen.test.tsx
  - apps/mobile/src/features/orders/presentation/translations.ts
---

# Nueva venta — action dock

Mode: Operate. Sellers review merchandise, customer, payments and delivery before saving. Preserve Caramelo sobrio, Inter, native navigation, Spanish/Portuguese, existing money/domain operations and pending-attempt recovery.

Exactly three raster composition mocks were generated with image_gen using the two supplied native screenshots, then opened and inspected: `a-dock.png`, `b-receipt.png`, `c-overview.png` in `.impeccable/mocks/new-order/`. Each carries its exact embedded prompt and JSON sidecar. Coordinator explicitly approved **A** via Orca on 2026-10-08: it keeps step, merchandise amount and save together during review. B hides actions during scrolling; C separates amount from confirmation. Approved comp: `.impeccable/mocks/new-order/a-dock.png`.

## Direction contract

Compact back/title followed by a numbered two-stage indicator, with current stage identified by number, text and caramel selection. Flat, separated content groups retain all existing fields and callbacks. A white/dark raised-surface dock sits in layout below the scroll view, above native tabs, with merchandise amount, primary Save and secondary Edit products. Amount is explicitly labeled Products (estimated), never presented as the definitive order total; existing server-price disclaimer remains. On short available height, keyboard or large text, keep the dock in the scrolling document so fields and errors stay reachable. No absolute overlay. No rigid text heights. Existing platform controls and 48dp touch targets govern.

## Fidelity inventory

| Ingredient | Native implementation |
| --- | --- |
| Status/tab/system chrome | Existing native navigation; no raster or reconstruction |
| Header and step strip | ThemedText, numbered circular Views, theme roles, wrapping labels |
| Payment/delivery groups | Existing fields, Button, Switch; flat spacing and separators |
| Summary | ThemedText amounts, tabular figures; preserve calculations and disclaimer |
| Main action | Existing primary Button, full width, loading and validation unchanged |
| Dock | Non-overlay View on backgroundElement with top border; adaptive inline flow |

Implemented geometry: centered column capped at 640 logical units; 16-unit gutters and dock padding; 12-unit action gaps; 32-unit minimum numbered markers; 48-unit minimum action/switch rows through existing controls. Section boundaries use 1-unit theme borders and 16 units above headings. Docked composition is used only when measured available height divided by system font scale is at least 600; shorter usable viewports place the same actions in the scroll content. Stage transitions reset scroll to the top; review errors scroll to their message and announce it politely.

Type: existing title/section/body/small hierarchy and real static Inter weights. Controls retain 6-unit corners, flat surfaces, no shadow. Generated shading and slightly off-palette colors are not literalized: coordinator explicitly requires actual theme tokens. Asset producer independently classified every region as semantic; produce/direct raster buckets empty.

Pixel samples from approved A: canvas `(248,247,242)` / `#F8F7F2`, dock `(253,254,253)` / `#FDFEFD`, action `(139,83,46)` / `#8B532E`; coordinator explicitly preserves existing flat tokens rather than generated shade drift.

## Evidence and limits

The two source screenshots show current review and payment/delivery, including save obscured by tabs. Symlink resolves to `/Users/jorgegonzalez/orca/projects/yoyos/artifacts/mobile-screenshots`; reference files untouched. No new native screenshots were captured; configured checks are recorded below. `apps/mobile/AGENTS.md` does not exist in this checkout; existing architecture, programming and test conventions were read. Expo SDK 57 native-tabs documentation was retrieved from the official `sdk-57` branch, with Context7 used to resolve and query Expo first.

Coordinator also authorized exactly one Spanish/Portuguese key in `orders/presentation/translations.ts`: `estimatedProductsLabel` (Productos (referencial) / Produtos (estimativa)); it clarifies the dock without changing money rules or other translations.

## Final validation and scope

- Node 24.21.0 / pnpm 12.5.1: TypeScript passed; lint passed with three pre-existing warnings.
- Initial simultaneous runners hit 5-second test timeouts. A full run with a temporary CLI timeout of 30 seconds passed 323/324 tests; the remaining delivery wait passed in isolation without code changes. This is not recorded as a green complete suite. Detailed focal log: `/tmp/new-order-jest.log`.
- User subsequently required exclusive coordinator-assigned test slots and default timeouts. Under the next explicitly assigned exclusive slot, the full configured mobile suite passed (`pnpm --silent --dir apps/mobile test`, 57 suites / 324 tests), followed by successful TypeScript and lint (only the same three pre-existing warnings). Slot released; no further runs unless code changes.
- On 2026-10-08 at 15:04 UTC the coordinator relayed the user’s explicit scope reduction: stop native/exhaustive QA, launch no further reviewers/subagents/tests, finish with a brief mock/diff review and commit. This supersedes the original native-capture and independent finish-review/documenter requirements.
- Brief final review compared the implementation with approved A: two-stage progress, existing flat native fields, separated groups, merchandise amount clearly marked referential, primary save plus secondary edit in a non-overlay dock, with adaptive inline placement. All callbacks and validation conditions remain. Native controls reuse the existing theme and Inter; no new dependencies or global design changes.
- Evidence is the three inspected generated mocks and code diff, not a screenshot of the final runtime. Android/iOS rendering, dark mode, large text, keyboard clearance and real-device dock positioning remain unverified. Responsive behavior is covered by a screen interaction test, which does not prove visual layout.
- This worker never touched the Samsung, created no orders and changed no phone settings. Metro was stopped for handoff. No further independent finish review/documenter ran after the user reduced scope; this brief records the actual implementation directly.
