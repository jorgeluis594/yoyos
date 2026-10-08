---
version: 1
slug: "apps-core-app-routes-checkout-tsx"
primary_target: "apps/core/app/routes/checkout.tsx"
related_targets: ["apps/core/app/routes/buyer-payment.tsx", "apps/core/src/features/orders/presentation/checkout-form.tsx", "apps/core/src/features/orders/presentation/buyer-payment-content.tsx", "apps/core/src/features/orders/presentation/checkout-delivery-quote.tsx"]
---

# Checkout: revisar y completar
Mode: Operate. Extend Caramelo sobrio. Seed: dac33d81. User approved option 3.
Approved comps: `.impeccable/mocks/decision/checkout-review-desktop.png`, `.impeccable/mocks/decision/checkout-review-mobile.png`.

## Direction contract
THESIS: Review seller-prepared details, edit only what needs changing, then complete payment.
OWN-WORLD: Inter, cream background, caramel actions, white flat surfaces, quiet rules; existing dark tokens.
STORY: Buyer reviews contact and delivery, confirms, waits for seller quote if delivery changes, then pays and sends evidence.
FIRST VIEWPORT: Desktop 1040px, 620px review and 320px summary; mobile compact expandable products, editable rows and full-width action.
FORM: Review-first, option 3, seed dac33d81.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Grammar and inventory
| Ingredient | Implementation |
| --- | --- |
| Store identity / order number | Semantic text, real company data; no invented shop navigation |
| Review rows and inline editing | HTML sections, quiet separators, existing Input/Button; 6px controls and 12px surfaces |
| Type ramp | Inter 24px mobile / 30px desktop title, 18–20px section, 14–16px body; 12px supporting captions |
| Desktop summary | White bordered aside, sticky; products and authoritative totals |
| Mobile summary | Native expandable details, full-width action; compact review rows |
| Delivery | Native radios; enabled home/store/agency only; conditional recipient/address fields |
| Primary action | Caramel filled Button; explicit pending quote or confirmation copy |
| Payment | Configured wallet and bank methods; one instruction set at a time |
| QR / instructions | Actual seller uploaded image only, object-contain; never generated comp QR |
| Evidence upload | Native file input, JPG/PNG/WEBP, 10 MB; no PDF claim |
| Icons | Existing lucide library, 18–20px |

The desktop comp depicts pre-confirmation; mobile depicts payment after confirmation. Demo amounts are not tariff defaults. User requires the store to confirm delivery cost before payment is enabled; show pending cost and no final total when quote is pending. No account, buyer cart editing, navigation or security claims. Asset producer reviewed both comps and found no raster production necessary.


## Built surface rules

This recipe extends the incumbent [Caramelo sobrio system](../../DESIGN.md); the direction contract above preserves the approved comp intent. The implementation uses a centered 1080px maximum outer container, 20px small-screen gutters and 32px gutters from 640px. At 768px it becomes a flexible review column plus a 320px summary with a 32px gap. The summary sticks 24px below the viewport top. These measurements describe this surface, not new shared tokens.

**Review before editing.** Prefilled buyer and delivery data render as readable rows. “Editar” reveals buyer fields; “Cambiar” reveals enabled delivery methods and their conditional fields. Missing buyer data opens editing immediately. Native radios, selects and a recipient checkbox keep selection explicit. “Conservar entrega” restores the existing delivery choice. Field errors remain beside their controls, and request errors remain visible.

**Amount beside commitment.** There is one confirmation submit button, associated with `checkout-form` through the HTML `form` attribute. Desktop places it below the authoritative amount in the summary. Mobile orders the page as product disclosure, review form, then cost and confirmation; the delivery charge and final total stay outside the disclosure. During payment, the balance due sits directly above “Ya pagué”. Product subtotal, final total and outstanding balance remain distinct values.

**Responsive disclosure.** Mobile collapses only the product rows under a native details/summary element. Desktop keeps those rows visible. After confirmation, mobile replaces the separate cost summary with the payment amount or waiting state in the main flow. The full-width action scrolls with its region; it is not a viewport overlay.

**Store confirms changed delivery.** A new or changed delivery shows “Por confirmar” and suppresses the final total. Confirmation requests the delivery cost; the confirmed waiting state explains that the store must quote it and provides “Actualizar estado”. Payment instructions and receipt submission are unavailable until the quote is ready. The seller quote section shows the requested delivery, accepts a cost and whether to charge it to the buyer, and displays save errors in place.

**One payment instruction set.** Configured wallet (Yape or Plin) and transfer options use native radios with a selected border and caramel-tinted surface. Render only the selected method's holder, provider/bank and account details. Copy actions use the primary text color in both themes and announce success or a manual-copy fallback. Long account values can wrap. Display an actual seller-uploaded instruction/QR image only when supplied; preserve its proportions and allow opening it. No comp QR becomes a production payment asset.

**Receipt is evidence.** The native file input accepts JPG, PNG and WEBP up to 10 MB. Show upload progress, filename, retry and ready state; enable “Ya pagué” only after upload succeeds. Reporting shows “Pago pendiente de revisión”; only the seller's confirmation means paid. Preserve separate cancelled, not-confirmed, waiting-quote, no-methods and paid states. PDFs are not supported.

## Finish evidence and limits

The finish reviewer closed the four scored findings and returned **ship at scored-fixes scope**:

| Finding | Recorded resolution |
| --- | --- |
| Desktop cost and action disconnected | Final amount and the single confirmation action share the right-hand summary. |
| Mobile final cost hidden / payment amount remote | Final cost sits outside product disclosure; payment balance sits beside receipt submission. |
| Dark copy-action contrast | Copy actions use primary text; the reported contrast check meets at least 4.5:1. |
| Product scope omitted buyer journey | PRODUCT.md now records public review, delivery quote gating, configured payments and seller verification. |

Rendered review evidence: `.impeccable/review/checkout-review-desktop.png` and `checkout-review-mobile.png` cover review-first confirmation; `desktop.png` and `mobile.png` cover payment; `mobile-dark.png` covers dark payment; `hero-repro.png` records the reproduced desktop composition. These are implementation captures, distinct from the approved comps. Demo shops, products and amounts are fixtures, not product defaults. No new production raster asset was required.

This documentation pass inspected the listed sources and captures; it does not claim a full accessibility audit or independent re-execution of the reviewer's checks. Pending quote and seller quoting behavior are evidenced by source rather than those payment screenshots. Global DESIGN.md remains the visual authority; checkout-specific widths, spacing and control-height overrides are not promoted to reusable system tokens.
