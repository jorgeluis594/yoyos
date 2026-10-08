---
version: 1
slug: products
primary_target: apps/mobile/src/features/products/presentation/product-form.tsx
related_targets: []
---

# Products — native form actions

Mode: Operate. Scope: creation and editing action overflow only. Inherit PRODUCT.md and DESIGN.md, Caramelo sobrio, Inter and the existing native controls. The shared form is consumed by CreateProductScreen and ProductManagementScreen; their handlers, validation, data contracts, copies field, conflict recovery, navigation and accessibility remain intact.

## Direction and approval

Exactly three raster comps were generated with image_gen using the supplied Android captures as visual references, then opened and inspected. Prompts are embedded in PNG metadata and preserved in JSON sidecars under `.impeccable/mocks/products/`.

- A: full-width stacked actions; robust at compact widths and enlarged type.
- B: full-width primary plus paired secondary actions; shorter but narrower labels.
- C: separate saving and printing regions; changes the existing sequence more.

The coordinator explicitly selected A via Orca ask on 2026-10-08 after opening all three images. Approved comp: `.impeccable/mocks/products/option-a.png`; its sidecar records `approved: true`. Applies to both creation and editing, retaining each state's actual action labels and order.

Direction contract: Put every existing action on its own full-width line in the form's scroll flow, with 8dp gaps. Reuse the native Button's minimum 48dp height, wrapping text, Inter semibold and theme adaptation. Retain form gutters aligned with the existing header, fields and bottom padding. Preserve tabs, safe-area ownership and keyboard behavior. No new toolbar, icons, content, breakpoints or shared component changes. The comp's raster noise, captured accessibility overlay and slight artificial gradients are not design commitments.

## Fidelity inventory

| Ingredient | Implementation |
| --- | --- |
| Primary and secondary actions | Existing native Button/Pressable, stacked by the local View |
| Form content and copies | Existing native Field/Input, unchanged |
| Corners, borders, text ramp | Existing theme: 6dp control radius, Inter label semibold, token touch size |
| Navigation and safe areas | Existing screen/native tabs, unchanged |
| Photography and decorative rasters | None required; decision mocks are not shipped UI assets |

The final implementation is one local style change: remove the horizontal end-aligned row and use the default stretch-aligned column with 8dp gaps. Existing shared buttons retain real native interaction, theme colors, disabled/loading states and accessibility names. No new logic or static-style snapshot test is warranted; existing creation and management behavioral tests are included in full mobile checks.

Native styling recipe: `styles.actions: { gap: 8 }` relies on the View's default column direction and stretch alignment. Keep it inside the existing ScrollView with `keyboardShouldPersistTaps="handled"`; the page retains 20dp padding, 24dp section gaps and 48dp bottom padding. The approved mock's prompt mentions 16dp gutters, but the scoped contract preserves the implemented 20dp gutters. The shared Button retains intrinsic wrapping label height, its token-based minimum touch height, pressed/focus feedback, disabled opacity and a loading spinner over the retained label space. These are source-observed behaviors; native captures validate the action layout on the 384dp Android phone in light/dark themes, at font scales 1.0/1.3, and with the numeric keyboard open, as detailed below.

Sampled approved-comp pixels: canvas (20,500) `#F6F5F0`, input (150,360) `#F8F8F9`, primary (200,1310) `#8F562B`, secondary (150,1430) `#EEE8DF`. These record the render, including its small raster variation; the explicitly fixed identity and existing semantic theme tokens govern implementation rather than new color literals. Independent asset review `/root/products_asset_review` confirmed an empty required-raster manifest: native controls, existing navigation and runtime product photographs supply all media.

## Documentation consulted

Architecture, programming style and testing conventions; Impeccable new-work, visualize, craft-floor and Android/iOS guidance; implementation and React Native skills. The referenced `apps/mobile/AGENTS.md` does not exist in this checkout. Context7 returned current Expo docs including SDK57 keyboard guidance; official SDK57 safe-area docs confirm SafeAreaView applies inset padding. Existing screen SafeAreaView ownership is preserved.

## Validation

Final independent review `/root/products_finish_review`: **ship** for the Android compact-phone action region, with no material fixes. Full report: `.impeccable/review/products/review.md`. Independent documenter reconciled this brief against source and the final evidence; global design documents were not changed.

Configured lint and typecheck passed under Node24; lint retains three existing warnings in option-selector.test.tsx and temporary-documents.test.ts. Full mobile Jest passed under Node24 in the coordinator-authorized exclusive test slot, with normal timeouts (`tests-serial.log`: Todo OK, exit0). Earlier concurrent Node24 runs suffered timeouts in unrelated order screens; final serial execution supersedes those checks. No tests were changed. Device allocated by coordinator: Samsung R5CY32G04RW (1080×2340 physical pixels, density450, 384dp width, font_scale1.0, light theme). No web screenshot counts as native evidence. Detector skipped because it only analyzes HTML/CSS.

Native evidence captured and opened under `.impeccable/review/products/`: `create-light.png`, `create-dark.png`, `create-large-text.png`, `create-keyboard.png`, `edit-light.png`, `edit-dark.png`, `edit-large-text.png`. Normal captures use font_scale1.0; large-text and keyboard captures use1.3. All action labels are complete in the 384dp compact viewport. Native accessibility bounds put every action at x56..1024 physical pixels, 135px high (48dp), with approximately23px gaps (8dp). The numeric keyboard capture shows the scrollable action group fully above the IME. No horizontal clipping or tab-bar occlusion was observed in these action regions.

Initial password/API blockers were resolved with coordinator assistance. The initial invalid delivery-error screenshot was discarded; the first reviewer **recapture** is superseded by a full review of these seven valid product captures. Orca Android attach failed with emulator_simctl_unavailable, so directed adb supplied the evidence. Theme was restored to light, font_scale1.0, original screen timeout; density450 was unchanged. Samsung was released to coordinator after capture. QA used isolated API3001 and product8828673a-f6c5-4bbf-8bfc-3813726dc1e6 (stock8). No iOS or tablet capture, physical printer exercise or new backend-contract test is claimed.
