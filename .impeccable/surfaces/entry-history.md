---
version: 1
slug: entry-history
primary_target: apps/mobile/src/app/index.tsx
related_targets: [apps/mobile/src/features/users/presentation/access-screen.tsx, apps/mobile/src/features/orders/presentation/order-history-screen.tsx]
---

# Entry and order history

Mode: Operate. Scope: Inicio, all access states, order history. Existing Caramelo sobrio world remains authoritative; global PRODUCT/DESIGN and shared primitives are unchanged.

## Approval and direction

2026-10-08: coordinator explicitly approved B after inspecting all three complete group mocks. Approved comp: `.impeccable/mocks/entry-history/option-b.png`; exact generation prompt and approval stored in adjacent JSON and embedded in PNG. A favors grouped buttons; C spends more vertical space on the primary action. B preserves useful list density with grouped navigation rows, recovery beside the password field, and independent payment/delivery lines.

First viewport: real company/user identity followed by Pedidos and catalog groups; access keeps labeled credentials, contextual recovery, one primary sign-in, secondary registration and separated verification; orders keeps title/new, search, named advanced filters, wrapping quick filters, chronological rows. Customer/amount lead each row; textual statuses and native symbols follow. Signature interaction is direct entry to an existing task, with native pressed feedback and navigation. No decorative animation.

| Ingredient | Native implementation |
| --- | --- |
| Home task groups | Existing ListRow with native symbols, flat surfaces and separators |
| Access | Existing Field/Input/Button, scroll/keyboard avoidance, unchanged operations and errors |
| Order filters | Pressable controls; selected checkmark, visible Filtros, native advanced modal |
| Order rows | SectionList; customer/amount, metadata, two status lines with text and symbols |
| Chrome | Existing native tabs/status/system navigation |
| Build raster assets | None, independently reviewed by assets_entry_history |

Grammar: Inter 24/32 page heading on entry/access, existing 30/36 orders title, 20/28 section heading, 16/24 body and 14/20 metadata/status. Flat white/charcoal theme surfaces, subtle separator, 8dp grouped row corners, shared 6dp button corners, existing orders filter/action pills. No shadows or device bezel. Use established semantic theme tokens in both appearances; generated comp noise/gradients and phone chrome are not product material. Sample records are design examples, never seeded data. Controls retain at least 48dp, wrap and scroll with large text. Global font identity remains Inter.

## Contracts and validation

Preserve account registration/onboarding/verification/recovery/error states, navigation, search/debounce, date/customer/view filters, pending-order verification, refresh and pagination. Spanish and Portuguese remain supported. Only new home navigation copy added to home-translations.ts. Header belongs to scrollable orders list so enlarged text cannot consume the entire fixed viewport. Tests exercise actual actions and existing screen behavior rather than style snapshots.

Native evidence and finish review pending; no device used before coordinator allocation. SDK57 SymbolView documentation checked at https://docs.expo.dev/versions/v57.0.0/sdk/symbols/; Context7 latest confirms per-platform names. apps/mobile/AGENTS.md referenced by implementation skill is absent in this checkout.

Comp pixel samples (option B): interior canvas rgb(246,245,239) at 70,210; raised surface rgb(250,250,250) at 100,340; caramel action rgb(139,83,41) at 580,600. Native implementation retains approved global semantic tokens (#F7F4EF/#FFFFFF/#8C552D) rather than baking generated raster color noise into local overrides. The approval preserves the incumbent world and specifically excludes phone bezel.

Checks completed on 2026-10-08: configured mobile lint exit 0 (three pre-existing warnings in option-selector.test.tsx and temporary-documents.test.ts); Node24 mobile typecheck exit 0; configured `pnpm --silent --dir apps/mobile test` exit 0, `Todo OK`, using the default Jest timeout. Focused 15 tests also passed with a temporary CLI timeout during machine contention; that override is not in repository configuration. Initial runs before shared dependency setup failed resolution/timeouts and are not counted as validation. `shared/node_modules` is an ignored symlink to verified existing zod4.6.5/decimal.js10.6.0 dependencies; frozen install was blocked by the pre-existing multi-document shared lockfile. No manifests or lockfiles changed. Later user instruction requires coordinator approval before any new test run; no tests remain active.
