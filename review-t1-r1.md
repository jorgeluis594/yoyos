# Review T1 (web fixes) — round 1

Change: `git diff jorgeluis594/pedidos-corregir-los-hallazgos-de-la-rev...HEAD` (7 commits, 105bfd1c..0b705158) against T1 of `docs/drafts/pedidos-hallazgos-ux-technical.md` (sections 2, 12, 14, 16, 18) and Todoist 6j3CMGXwFj5GrQfV.

## 1. Verdict

**REJECTED.** There are 4 blockers. Lint, typecheck and unit tests are green, and every T1 criterion holds in the browser except two edge cases (blockers 1 and 2). The core E2E is red in two specs (blockers 3 and 4).

## 2. Findings

### Blockers

1. **`apps/core/src/features/orders/presentation/product-picker-keyboard.ts:13`** (with `product-picker-dialog.tsx:44-72`) — blocker, not a design finding.
   - **What is wrong:** with nothing highlighted, Enter adds the only row. Those rows are still the previous query's results while the next search waits out its 250 ms debounce. In that window `status` stays `ready`, and `products` keeps the old results.
   - **Reproduced in the Orca browser:** I searched «Bolso» (1 result), changed the text to «Bolso rojo» and pressed Enter right away. «Bolso tejido» was added («Agregado: Bolso tejido. 1 en el pedido.»), then «No encontramos "Bolso rojo"» appeared. Capture: `picker-carrera-enter.png`.
   - **Why it matters:** a keyboard-first seller types and presses Enter, and the picker adds a product that does not match what they searched. This breaks criterion T1.4 and §18 item 3 («Enter adds the only result» means the result of the typed search).

2. **`apps/core/src/features/orders/presentation/payment-fields.tsx:23`** — blocker, not a design finding. This is the implementer's declared deviation (2), and I do not accept it.
   - **What is wrong:** with `type="number"`, any non-numeric text the browser keeps reaches `checkPaymentAmount` as `""`.
   - **Seen in the browser:** with «12e» typed, the register dialog shows «Escribe el monto del pago.» under a field that visibly says «12e» (capture `ac1-12e-dice-vacio.png`). Chrome rejects the «abc» keystrokes, so «abc» also gets the empty reason, never the not-numeric one. The not-numeric reason does appear for «-5» and «1.234».
   - **Why it matters:** criterion T1.1 and §18 item 12 require «abc» to show its own reason, and a message that calls a non-empty field empty is false. The button stays disabled, so no wrong data gets in.
   - **Where it applies:** register, approve and new-sale rows, since all three use `PaymentFields`.

3. **`apps/core/tests/e2e/store-delivery.spec.ts:58`** — blocker (red check), not a design finding. This is the implementer's known debt, deviation (4).
   - **What is wrong:** `expect(await apiAssigned.json()).toEqual(assigned)` compares a PUT `/delivery` answer with a GET `/aggregate`. Since T0, the GET carries `checkoutLink`, which only that route sends (§2).
   - **Why it matters:** core E2E is red, and T1 owns it.

4. **`apps/core/tests/e2e/mobile-order-creation.spec.ts`** (runs `apps/mobile/src/features/orders/presentation/new-order-screen.integration.tsx:363-392`) — blocker (red check), not a design finding. It was not declared.
   - **What is wrong:** «restarted stock rejection of a paid delivered sale keeps the attempt editable and resends its original identities» queues a sale with a S/ 40 payment, lowers the quantity 4→1 (total S/ 10), and expects the save to succeed with `overpaidAmount` S/ 30. T0's rule now refuses that new sale with `PAYMENT_EXCEEDS_BALANCE`, so `mockReplace('/orders/<id>')` is never called.
   - **Reproducible:** it fails the same way in the full run and alone (`--maxWorkers 1`).
   - **Why it matters:** core E2E is red. The fixture belongs to apps/mobile (T2's scope).

### Suggestions

5. **Deviation (1)** (`order-view-state.ts:345-353`, `order-payments-panel.tsx:176`) — accepted.
   - **Behavior:** on the web new sale, a row over the limit does not disable «Guardar venta». The save is refused with «No se guardó: revisa 1 campo marcado.» and focus goes to the row.
   - **Why accepted:** the row says «Este pago supera lo que falta cobrar de la venta: S/ 15.00.» while the seller types, before they press Guardar. Every other invalid field on that screen follows this same refuse-and-focus pattern. Disabling only for this case would mix two behaviors in one form, and it would bring back a disabled button with no reason, which is finding 13.
   - **Outcome checked in the browser:** nothing is saved and the reason is visible. No memory contradicts this, and `docs/orders.md` («Web sales flow») records it with its reason.
   - **Still to do:** the PR should list it as a deviation from the literal wording of scope item 1 so the founder sees it. The test titled «a new-sale payment above what is left to collect shows the amount left and disables saving» never asserts that the save is refused; add an `invalidFields` assertion.

6. **`order-payments-panel.tsx:258` and `receipt-dialog.tsx:77`:** with a zero balance, **Aprobar** is hard-`disabled` and points to the «Este pedido ya está pagado…» note through `aria-describedby`.
   - **Why it matters:** a disabled button cannot take focus, so a keyboard user never hears that note. The note is visible text, and the same panel already uses `aria-disabled` for `blockedNote`. Consider that pattern here.

7. **`order-payments-panel.tsx:129`:** a new-sale row shows «Escribe el monto del pago.» as `role="alert"` as soon as its prefilled amount is cleared. Before this change it showed only after a save attempt. The saved-order dialogs behave the same way, so this is a choice, not a bug.

8. **`order-payments-panel.tsx:278`:** opening `VoidPaymentDialog` does not call `setDismissedVoid`. A previous «Pago actualizado.» stays next to the new confirmation, which goes against the comment at :201.

9. **`order-payments-panel.tsx:289`:** `onVoid` submits without checking that the router is idle. The trigger is gated, but an already-open dialog is not.

10. **`payment-amount-text.ts:18`:** `paymentAmountProblem` is never used. `typedPaymentAmount` (:24) checks against a fake 1e9 balance, and `order-view-state.ts:217` keeps its own `isValidAmount` regex. §2 says neither client keeps its own copy. One exported shape check in `shared/orders-payment.ts` (a T0/shared change) would remove both.

11. **`app/routes/order-new.tsx:62`:** the Spanish sentence for `PAYMENT_EXCEEDS_BALANCE` is hardcoded and duplicates `orders.saleExceedsTotal`. It follows the existing pattern of that action, and the screen shows the locale key through `saleOutcome`.

12. **Two dialog messages on a server refusal:** after core refuses a payment, the register dialog shows «Supera el saldo pendiente de S/ 10.00» twice. Once under the field (the revalidated balance) and once in the alert. The content is correct; the alert could be left out when the inline reason already says the same.

13. **«Exceso recibido» on a new sale:** while a new-sale row is over the limit, the summary still reads «Pagado · Exceso recibido: S/ 5.00» next to the row error. It is an estimate of the draft and the save is refused, so it is cosmetic only.

14. **Deviation (3), accepted:** changing `orderLink.subdomainRequired` in place is what the design's new copy needs. No key was reordered.

15. **Deviation (5), out of T1 scope:** `orderListLoaderSchema` still redeclares `balanceDue`. That schema is in `shared/`; leave it for T0 or a later cleanup.

16. **Dropped finding:** code-review reported that «Confirmado por el comprador» is hidden when the link is `subdomain_required`. §12 asks for «With `subdomain_required`, no confirmation-state line», so this is the intended behavior.

## 3. Approach

### Per blocker

1. **Blocker 1 (picker):**
   - In `use-catalog-search.ts`, set `status` to `"loading"` as soon as non-empty text changes, before the debounce timer starts. After that, `ready` means the products on screen answer the current text and filter.
   - `pickerKey` takes a `resultsCurrent` flag. With no highlight and stale results, Enter does nothing and calls `preventDefault`. Highlighted Enter and the arrows do not change.
   - `product-picker-dialog.tsx:69` passes `status === "ready"`. The old list stays visible while loading, as today.
   - Rejected alternative: storing the query that produced the products and comparing it in the dialog. It adds a second source of truth.

2. **Blocker 2 (amount field):**
   - Change the amount input to `type="text" inputMode="decimal"` and drop `min` and `step`. Keep `required`, `aria-invalid` and the error line.
   - The typed text then reaches `checkPaymentAmount` as is, and «abc» or «12e» get «Escribe un importe mayor a 0 con hasta 2 decimales.».
   - Precedent: `apps/core/app/components/delivery-zones-section.tsx:188`.
   - Add the «abc» and «12e» cases to the table in `order-payments-panel.test.tsx:263`.

3. **Blocker 3 (store-delivery):**
   - Compare the PUT answer with the aggregate without the link: `const { checkoutLink: _link, ...assignedOrder } = assigned; expect(await apiAssigned.json()).toEqual(assignedOrder);`.
   - Do not make the PUT send `checkoutLink`: §2 forbids it, and `api-routes.ts` is outside T1.

4. **Blocker 4 (mobile journey):**
   - In `new-order-screen.integration.tsx:370-391`, queue the payment at S/ 10 on quantity 4 (total S/ 40).
   - The first attempt is still refused with `INSUFFICIENT_STOCK`: a partial payment does not deduct stock, and `deliver` then fails on stock.
   - Lowering to 1 unit (S/ 10) is fully paid, with the same `orderId` and `paymentId`.
   - Assertions change: `overpaidAmount: 30` becomes `paymentStatus: "paid"`, and the expected payment becomes `amount: 10`.
   - In `mobile-order-creation.spec.ts:58`, the order lookup by the S/ 40 payment becomes a check on both orders with a S/ 10 payment. The totals the spec checks (10 orders, 2 completed, 4 payments, final stock 2) stay the same.
   - **Decision for the coordinator:** the mobile file is in T2's scope. I recommend T1 makes both edits in one commit (the E2E only turns green with both) and tells T2.

### Ordered plan

All commands run from `apps/core` after `export CORE_TEST_PORT=55620 MAILPIT_SMTP_PORT=11620 MAILPIT_UI_PORT=18620 CORE_E2E_PORT=4620`.

1. **«Ignore Enter without a highlight until the picker results match the typed text».**
   - Tests: `use-catalog-search.test.ts` («marks the search loading as soon as the text changes»), `product-picker-keyboard.test.ts` («Enter without a highlight does nothing while the results are not for the typed text»), `product-picker-dialog.test.tsx` (`status: "loading"` with one row: Enter does not call `onAdd`).
   - Check: `pnpm test:unit src/features/orders/presentation/use-catalog-search.test.ts src/features/orders/presentation/product-picker-keyboard.test.ts src/features/orders/presentation/product-picker-dialog.test.tsx --maxWorkers 2`.
   - Then repeat «Bolso» → «Bolso rojo» → Enter in the Orca browser: nothing is added.
2. **«Let the payment amount field keep any typed text so non-numeric amounts get their reason».**
   - Check: `pnpm test:unit src/features/orders/presentation/order-payments-panel.test.tsx src/features/orders/presentation/payment-decision-form.test.tsx --maxWorkers 2`.
   - Then `sh scripts/run-tests.sh e2e tests/e2e/orders.spec.ts --maxWorkers 2` and `sh scripts/run-tests.sh e2e tests/e2e/buyer-payment.spec.ts --maxWorkers 2`.
3. **«Compare the delivery PUT answer with the aggregate without its checkout link».**
   - Check: `sh scripts/run-tests.sh e2e tests/e2e/store-delivery.spec.ts --maxWorkers 2`.
4. **«Keep the restarted stock rejection journey within the payment balance».**
   - The mobile integration test and the core spec go in the same commit.
   - Check: `sh scripts/run-tests.sh e2e tests/e2e/mobile-order-creation.spec.ts --maxWorkers 2`.
5. **Final check:** `pnpm lint`, `pnpm typecheck`, `pnpm test:unit --maxWorkers 2`, then `sh scripts/run-tests.sh e2e --maxWorkers 2`, which must be fully green.
   - `checkout.spec.ts` failed once with `ERR_CONNECTION_REFUSED` and passed alone; rerun it alone if it flakes again.
   - Optionally address suggestions 5 (test assertion), 6 and 8, which are small and inside T1.

## 4. Checks run

| Command (ports: CORE_TEST_PORT=55620 MAILPIT_SMTP_PORT=11620 MAILPIT_UI_PORT=18620 CORE_E2E_PORT=4620) | Result |
| --- | --- |
| `pnpm --dir apps/core lint` | green (exit 0) |
| `pnpm --dir apps/core typecheck` | green (exit 0) |
| `pnpm --dir apps/core test:unit --maxWorkers 2` | green («Todo OK») |
| `sh scripts/run-tests.sh e2e --maxWorkers 2` (first run, apps/core) | stopped by a signal (exit 144) with no output; rerun with the same script and Vitest output visible |
| same e2e, verbose copy of the script (`--maxWorkers 2`) | **red**: 3 failed / 39 passed / 1 skipped files; 3 failed / 163 passed tests. Failures: `store-delivery.spec.ts:58` (blocker 3), `mobile-order-creation.spec.ts` (blocker 4), `checkout.spec.ts` (`ERR_CONNECTION_REFUSED` on `*.localhost:4620`) |
| e2e `checkout.spec.ts` + `mobile-order-creation.spec.ts`, `--maxWorkers 1` | `checkout.spec.ts` green (flake); `mobile-order-creation.spec.ts` red again (same mobile test) |
| `/code-review high` | 9 findings; 8 kept (1 as a blocker, 7 as suggestions), 1 dropped (finding 16) |
| happy-memory-recall | 4 memories (over-balance rule, recipient PhoneField, link copy, void rules); none contradicts the design, and none covers deviation (1) |

The E2E rewrites tracked `.impeccable/review/*.png`; I restored them with `git checkout -- .impeccable/review`. The worktree is clean apart from this report.

### Visible validation in the Orca browser (web app of this worktree, `localhost:3005`, account `review-t1@example.test`)

Captures are in `~/yoyos-landing-capturas/pedidos-hallazgos-ux-review-t1/`. Data: #1001 is S/ 20 of S/ 55 with buyer Ana Pérez, #1002 is S/ 60 with a report, #1003 is paid with a report, and #1004 is S/ 20 of S/ 30 with no buyer.

| Criterion | What I saw |
| --- | --- |
| 1 | **Mostly met:** 999 shows «Supera el saldo pendiente de S/ 60.00», with a gap for «abc»/«12e» (blocker 2). <br>• #1002 «Registrar pago», 999: «Supera el saldo pendiente de S/ 60.00», Confirmar disabled. <br>• Empty: «Escribe el monto del pago.». 0: «El monto debe ser mayor que cero.». «-5» and «1.234»: «Escribe un importe mayor a 0 con hasta 2 decimales.». All disabled. <br>• Typing «abc» leaves the field empty with the empty reason, and «12e» shows the empty reason (blocker 2). <br>• **Aprobar** with 999: «Supera el saldo pendiente de S/ 10.00», disabled. <br>• Server refusal: I opened the dialog with 60, recorded S/ 50 by API, then sent it. The dialog shows «Supera el saldo pendiente de S/ 10.00» (the server balance). |
| 2 | **Met.** #1003 (paid) with a report: «Aprobar» `disabled` and the note «Este pedido ya está pagado. Si el comprobante repite un pago…». **Rechazar** with a reason marks the report «Rechazado». |
| 3 | **Met.** #1001: «¿Anular el pago de S/ 20.00?» / «Pedido #1001 · Ana Pérez. El monto vuelve al saldo pendiente.». **Mantener pago** keeps the payment `confirmed` in the database and the card stays «Pago parcial · falta S/ 35.00». #1004 with no buyer: «Pedido #1004. El monto vuelve al saldo pendiente.»; **Anular pago** marks it «Anulado» with «Pago actualizado.». |
| 4 | **Mostly met.** «Polo» (1 result) + Enter adds it. «o» (several results) + Enter adds nothing; ↓ + Enter adds the highlighted one. «Zapatilla» (one product with options): the first Enter highlights «38» (`aria-activedescendant`), the second adds it. Race: Enter on a changed search adds the previous result (blocker 1). |
| 5 | **Met.** List at 1280 and 390 px: #1001 reads «Pago parcial · falta S/ 35.00» and «Entrega pendiente» as text with icons, #1003 reads «Pagado». The #1001 detail badge and the «Pagos» card read «Pago parcial · falta S/ 35.00». The #1003 badge and card read «Pagado». |
| 6 | **Met.** Domicilio, Lima/Lima/Miraflores: the rate shows «Motorizado · S/ 10.00» with no click. Saving #1005 gives «Cambios guardados.», no «Selecciona una tarifa». |
| 7 | **Met.** Home (#1001) and agency (new sale): «PE +51» + «987654321», same as the customer. Store pickup (#1003): free text «+51955511122». The phone is saved as `+51912345678`. |
| 8 | **Met.** New sale, Domicilio with nothing filled, Guardar: Departamento gets `aria-invalid=true` with the same border as Dirección, Nombre and Teléfono. With Departamento and Provincia filled, Distrito is marked. |
| 9 | **Met.** No subdomain: «Para compartir este pedido, elige primero el link de tu tienda en Apariencia de la tienda.» + «Ir a Apariencia de la tienda», no «Pendiente de confirmación». |
| 10 | **Met; the disabled-button wording is deviation (1), accepted (finding 5).** S/ 55 sale, rows S/ 40 + S/ 20: the second row reads «Este pago supera lo que falta cobrar de la venta: S/ 15.00.». Guardar is refused («revisa 1 campo marcado»), with focus on the row and no order created. Core refusal (I dropped the price to S/ 30 in the database with the page open, rows 40+15): «Los pagos suman más que el total de la venta. Revisa los montos de los pagos.», no 500, and the order count does not change. |
| 11 | **Met.** With `catalogSubdomain` set, the card shows the URL `http://tienda-revision-t1.localhost:3005/checkout/<id>` with copy and open buttons. Without it, finding 9. The failed read is only covered by `order-detail.test.ts` (not reproducible by hand). |

Note: twice the Orca click left a stray «e» in the auto-focused field («60.00e»). It did not happen again with a JavaScript click or with orca click, so it is a tool artifact, not the app.
