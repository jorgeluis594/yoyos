---
version: 1
slug: "atures-orders-presentation-order-detail-screen-tsx"
primary_target: "apps/mobile/src/features/orders/presentation/order-detail-screen.tsx"
related_targets: []
---

# Native order detail — approved commercial summary

Operate. Native mobile sellers inspect a sale, review reported receipts, record received payments and consult delivery. Preserve Yoyos Caramelo sobrio, compact density, shared typography, both themes and platform navigation.

The user approved option 1 / A, Resumen comercial, in chat: “esta bien la opcion 1”, and authorized implementation. Approved comp: `.impeccable/mocks/native-order-detail/a-commercial.png`; prompt and approval recorded in the adjacent JSON. Implementation and device evidence are recorded below separately from the generated comp.

Composition: compact back/order header and creation date; independent order, payment and delivery statuses; buyer row; conditional receipt-review notice; product rows with variant, quantity, unit price and aligned subtotal; payment breakdown with merchandise, customer delivery charge, total, received and balance; contextual Register payment and payment history; delivery summary with explicit editing; buyer confirmation; disclosed internal details. One continuous vertical scroll. Payment forms open only on explicit action. Reported receipts require seller review of actual received amounts.

Keep buyer separate from recipient, internal delivery cost separate from customer charge, and buyer confirmation separate from payment. Preserve existing eligibility, cancellation, stock, overpayment, historical snapshots, payment voiding, validation and Spanish/Portuguese behavior. Delivery editing follows the existing native delivery surface brief and stays locked after dispatch. Show available actions only; do not invent dispatch actions, notes, product photos or courier tracking.

The comp demonstrates dark mode with illustrative data. Preserve the composition, hierarchy, grouping, discreet borders, modest corners and caramel primary action. Use actual theme tokens with flat surfaces rather than generated sheen. Generated iOS-like status icons are not a specification for Android; retain system chrome and safe areas. Scale text and controls for accessibility; retain comfortable touch targets instead of squeezing all content into one viewport. Design the corresponding light appearance with existing tokens. No new global visual identity.

## Implementation and verification status

The native detail now implements this composition using the existing themed text, buttons, fields, option selector and Expo symbols. Payment registration/review opens a focused native modal with keyboard avoidance; successful confirmation closes it and refreshes the visible balance/history. History, saved delivery details, buyer confirmation and internal data use explicit disclosures. The screen preserves existing application operations and business rules. New labels cover Spanish and Portuguese.

The surface uses a centered single column capped at 640 logical units, 16-unit content gutters and card padding, 12-unit gaps between groups, and flat cards with 8-unit corners and hairline borders. The header is 20/28 semibold. Products and money rows wrap; numeric values use tabular figures and right alignment. Back and disclosure controls have a 48-unit minimum target, and the receipt notice has a 56-unit minimum height. These measurements describe this surface rather than introducing shared tokens.

Typecheck and lint passed (three pre-existing warnings). The complete mobile Jest suite passed on the final code, including the receipt accessibility label. Screen tests cover reported partial payments, manual validation/success, closing without saving, cancelled-order restrictions, historical delivery details, locked delivery, checkout links and refresh failures.

Android device inspection on Samsung A56 (1080×2340) verified the top in light/dark, expanded payment history, delivery snapshot, buyer confirmation and internal disclosures, and the payment modal with the decimal keyboard open. Font scale 1.3 wraps the product name without clipping. Original font scale 1.0 and light appearance were restored. Evidence: `.impeccable/review/native-detail-{fixture-dark,light-top,payments-dark,delivery-dark,internal-dark,payment-keyboard,large-text}.png`. The scoped hero checkpoint is `native-detail-hero-repro.png`; the generic `hero-repro.png` belongs to a concurrent order-list task. Captures retain physical device dimensions rather than rescaling or simulating system chrome to match the generated comp.

The latest user message grants use of the shared phone whenever needed, superseding the earlier requirement to ask first. The fixture in core_test used order ID `76091941-12e4-4801-9ae0-189714734991` (number 90001); its synthetic reported receipt intentionally had no uploaded image, so captures do not claim successful receipt viewing. Cleanup removed only this fixture's two payments, buyer, item and order in a transaction, with zero matching orders remaining. Device settings were verified restored to font scale 1.0 and light appearance. iOS/tablet visual acceptance is outside this Android verification.

The independent finish reviewer requested a visible semibold hierarchy and accurate verification notes. SDK 57 Android runtime font loading did not select weights from the variable Inter file. Static medium/semibold/bold cuts (500/600/700, optical size 14) were extracted from the same bundled OFL font and resolved through `constants/typography.ts` by shared text and form components; no typeface or token redesign was introduced. New captures show section headings, product subtotals, total and balance in actual semibold. Full Jest, TypeScript and lint were rerun with Node 24.21.0 and pnpm 12.5.1; tests/typecheck passed, lint retains only its three existing warnings. The final independent review disposition is ship for the scored fixes, with no material regressions found within the inspected scope.
