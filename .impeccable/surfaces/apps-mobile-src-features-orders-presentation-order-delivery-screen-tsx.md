---
version: 1
slug: "ures-orders-presentation-order-delivery-screen-tsx"
primary_target: "apps/mobile/src/features/orders/presentation/order-delivery-screen.tsx"
related_targets: ["apps/mobile/src/features/orders/presentation/order-detail-screen.tsx"]
---

# Native delivery assignment

Operate; inherits compact caramel and native conventions. Active pending orders choose enabled home/store/agency methods; agency-only settings default to agency. Home requires address/district, with optional instructions. Shared recipient/identity/charge and per-method drafts persist across choices, distinct from buyer data. Agency offers active couriers only; an inactive historical ID stays unselected without automatic replacement. Agency destination is required (max500), along with national_id/passport/foreign_id and a document preserving leading zeros. Identity remains optional for home/store. Server-authored destination snapshots and cost display separately from customer charge on detail.

Unavailable cost preserves drafts. Focus refresh updates settings while preserving home/recipient edits; disabled methods cannot save. Pending submissions prevent duplicates; server race responses lock changes. COURIER_UNAVAILABLE refreshes options without erasing drafts or navigating. Historical courier/agency snapshots remain visible on detail; shipped orders expose no editor. Successful save returns to refetched detail, hiding stale content on error with retry.

Spanish/Portuguese and tests cover behavior. Full mobile Jest passed after source changes; focused screen tests passed after the extra draft test. Typecheck passed; lint had zero errors and three baseline warnings. Final reviewer `/root/native_delivery_finish`: ship only for reviewed Android phone interfaces/journeys on Samsung A56 in Expo Go; no material UI fixes. Earlier RECAPTURE is superseded within this scope. Light/dark, text scale1.3, keyboard, scrolled regions, selectors, and recovery were reviewed without requiring a Cartesian matrix. Evidence includes `.impeccable/review/android-delivery-editor-light.png`, `android-delivery-editor-dark.png`, `android-delivery-editor-large-text.png`, `android-agency-document-keyboard-dark.png`, `android-courier-unavailable-dark.png`, and current recaptures b1e6e08/c263bfe plus original `android-*.png` captures. Native detector was skipped.

The user explicitly deferred iOS: “no es necesario probar en IOs por ahra”. Approval excludes iOS, tablet, and distributed runtime stability. One NativeRNScreens incident remains open: six tab changes and three background cycles did not reproduce it, with no fix applied. Runtime stability is not resolved.

## Order-delivery refinement — 2026-10-08

Mode: Operate. Coordinator explicitly approved option A: `.impeccable/mocks/order-delivery/01-destino-footer.png`; its sidecar records approval. The three inspected raster alternatives, exact embedded prompts and [direction contract](../mocks/order-delivery/brief.md) are retained.

Current implementation uses rated-delivery contracts (district and quoted rate), superseding the historical courier/agency-input description above. Destination and recipient use flat groups and a subtle separator. A selected district becomes an accessible summary button showing district/province/department; reopening preserves recipient and rate until the destination changes. Geographic selectors, address, instructions and identity remain native controls with their existing validation. Products, customer delivery charge, total and save sit in a normal-layout footer outside the scroll region. The footer reserves its height rather than overlaying fields. Android retains NativeTabs bottom insets; iOS gets a native safe-area container and keyboard avoidance. Errors scroll into view. Documents remain stacked, text scales, amounts wrap, and light/dark use existing tokens. Two new headings are translated in Spanish and Portuguese.

Final standard mobile Jest suite, lint and typecheck passed serially under coordinator authorization with Node 24.21.0; lint retained three existing warnings. Earlier concurrent timeout results are superseded. No tokens, shared controls, dependencies, routes or business contracts changed.

The user explicitly ended further phone QA, exhaustive validation and reviewer/subagent work on 2026-10-08. Closure therefore uses the inspected references/mocks and a brief final diff review; no new native rendering evidence or independent finish verdict is claimed. Android dark/large-text/keyboard and iOS footer rendering remain unverified for this change. The device was never touched; Metro was stopped. Global DESIGN.md remains authoritative and unchanged. [Final report](../review/order-delivery/report.md).
