---
version: 1
slug: "order-detail"
primary_target: "apps/mobile/src/features/orders/presentation/order-detail-screen.tsx"
related_targets: []
---

# Order detail — contextual delivery

Mode: Operate. Scope: `apps/mobile/src/features/orders/presentation/order-detail-screen.tsx`, tests and the authorized `viewCheckoutLink` i18n key. Preserve the approved commercial summary, independent business states, payments, cancellation, historical delivery snapshots, native navigation and Spanish/Portuguese behavior.

## Current approved direction — round 2

The user selected `.impeccable/mocks/order-detail/round2-a-resumen-conectado.png` on 2026-10-08 after inspecting all three whole-view raster proposals. Its JSON records direct approval. User rationale: A groups fields/data; the other options have too much text. Favor grouped information and concise contextual actions across the entire screen. Preserve the existing visual world and all functional rules.

This selection is now implemented and supersedes the previous composition below. Buyer identity sits with the date and order state in the heading. Products and payment share one commercial surface, with the payment state beside its heading and received/balance amounts paired in wrapping columns. Existing text-only product rows remain; generated thumbnails are outside scope.

Delivery information and its assign/edit action share a compact wrapping row. Explicit user clarification: manual assignment/editing does not require payment and remains available for active, non-cancelled orders with pending delivery, including unpaid or partially paid orders. This is separate from shipment/delivery fulfillment; the payment explanation applies only to those operations. Source inspection confirmed no payment gate in the detail action, delivery editor or backend canSetDelivery guard. The detail now labels manual actions Asignar datos / Editar datos, shows a short editable-before-payment hint only while payment is pending, and separates the fulfillment blocker with a divider. These strings are localized in Spanish and Portuguese. This clarification changes presentation only; user requested no tests or exhaustive QA for it. Only eligible ship/deliver actions appear as contextual rows; eligibility still comes from `fulfillmentBlock`. Payment-required or stock-not-deducted blockers appear once as shared explanatory text. Eligible actions retain busy/disabled semantics, a loading indicator, focus feedback and minimum 48dp targets. Cancellation keeps its confirmation and state guards, with its quiet action moved to the bottom of the screen.

Payment history, delivery details, buyer confirmation and internal details retain their disclosures. Checkout uses compact obtain/copy rows; Ver enlace reveals the full selectable URL, and clipboard failure still exposes it for recovery. Receipt navigation accounts for the payment section's new position inside the commercial group. The paid state retains the full payment breakdown and paired balances, a nonblocking difference from the mock's more condensed paid summary. Global PRODUCT.md, DESIGN.md, tokens and shared components remain unchanged; no app raster assets were added.

## Round 2 verification — current

A fresh source reviewer returned a source-level pass with no material functional regression; the stale proposal-only documentation was the remaining correction. Review compared the source diff with the approved A raster and approval sidecar. It does not establish rendered parity.

The implementation thread ran checks with Node 24.21.0 and pnpm 12.5.1: mobile typecheck passed; lint passed with three existing warnings (two require imports in `option-selector.test`, one import-first warning in `temporary-documents.test`); `pnpm --silent --dir apps/mobile test --testPathPattern=order-detail-screen.test.tsx` passed. An earlier positional test invocation was interpreted as a reporter and failed before tests; the corrected flag invocation passed. The historical full-suite result below is not a full-suite run for round 2.

No native phone session or new device captures were used in this round. Dark mode, large text and compact-device rendering have no current device proof. No web detector ran for this native surface. The bounded documenter inspected source and the approved mock, and did not rerun checks. See `.impeccable/review/order-detail/round2-report.md` for the current closeout and evidence limits.

## Previous implemented composition (historical)

Coordinator explicitly selected A on 2026-10-08 after inspecting exactly three newly generated raster alternatives: `a-unified.png`, `b-ledger.png`, `c-paired.png` under `.impeccable/mocks/order-detail/`. A's JSON records approval and the exact prompt is embedded in its PNG. Earlier `a-commercial`, `b-fulfillment`, `c-compact` files predate this task and are unchanged.

A reunites delivery data and editing with vertically stacked fulfillment actions in one surface. Keep the commercial summary above it. Keep checkout confirmation separate from payment; once generated, put Copy first and hide the raw URL under Ver enlace. Obtener enlace only generates a missing URL. Failed copy automatically exposes selectable full text for manual recovery. Internal metadata stays behind its existing disclosure; the full seller ID remains selectable but uses secondary text.

| Ingredient | Implementation | Commitment |
| --- | --- | --- |
| Header, commercial summary and navigation | Existing native components | Preserve existing order and hierarchy |
| Unified delivery surface | Native View/ThemedText/Disclosure/Button | Details, assignment, divider, stacked ship/deliver; unchanged eligibility and reasons |
| Main delivery action | Existing native Button | Caramel full width, minimum 48dp, height grows with text |
| Checkout | Existing native Button/Disclosure and selectable text | Copy then explicit URL reveal; no lost clipboard failure recovery |
| Internal metadata | Existing native disclosure and secondary text | Full ID on request, no truncation or data loss |
| Raster assets in app | None | Comps are decision artifacts only |

Existing grammar: Inter with native weight adapter, flat 8dp cards/hairline border, 6dp controls, 16dp gutters/padding, 12dp section separation, standard body and small secondary text. Maintain theme roles, safe areas and scrolling. The generated A samples are canvas rgb(246,245,240), card rgb(254,254,254), primary rgb(144,88,47), secondary rgb(235,230,222). These corroborate the incumbent palette; generated sheen and a captured accessibility overlay are rendering defects, not assets to reproduce. Coordinator explicitly retains global tokens and commercial summary; the payment tail in the mock does not authorize a new payment accordion. Real state labels/expanded content adapt the illustrated pending empty-delivery case.

## Previous verification and final scope (historical; before round 2)

The user explicitly ended further phone QA, exhaustive validation and additional reviewers on 2026-10-08 (coordinator message msg_40c570ae15ce). Final review is limited to the three inspected mocks, the two original reference screenshots and the code diff. There are no new device captures and no claim of verified dark-mode, large-text, compact-size, iOS or tablet rendering. No device settings were changed by this worker. No independent final visual reviewer or documenter was launched after the scope reduction; this surface record documents the built source. The independent asset-producer inspection had already confirmed that no build raster assets are needed. No web detector ran because this is native UI.

The unified delivery region and link/internal disclosures follow A's composition while retaining the existing commercial summary, native components and theme roles. Functional state rules and error handling remain in the existing operations. Copy failure reveals the complete selectable link; tests cover successful copying, explicit reveal/collapse and failure recovery. New Ver enlace / Ver link labels are localized.

Final checks used Node 24.21.0 and pnpm 12.5.1: typecheck passed; lint passed with three pre-existing warnings (two require imports in option-selector tests, one import-order warning in temporary-documents tests); complete Jest suite passed in the coordinator's exclusive slot with the default timeout. Logs are under `.impeccable/review/order-detail/`. Earlier parallel execution hit timeouts and two unsupported test matchers; matchers were corrected and the final standard-timeout serial run supersedes that result. No further tests ran after the user's stop instruction.

Frozen installs were blocked by the existing shared multi-document lockfile and mobile patchedDependencies mismatch. Authorized ignored local symlinks reuse base node_modules; no dependency or lockfile changed. Android bundling returned HTTP 200, which is not device rendering evidence. Metro 8084 was stopped at closure.

Expo SDK 57 clipboard documentation was read at https://docs.expo.dev/versions/v57.0.0/sdk/clipboard/ after Context7 lookup; native copy resolves true, while defensive failure recovery remains for exceptions and web. Global PRODUCT.md, DESIGN.md, tokens and shared components were preserved.
