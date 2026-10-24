# Dispatch preparation

How a seller schedules, finds, labels and ships orders. Delivery data itself is described in [delivery.md](delivery.md). The work happens in **Sales in the mobile app** and, for labels, also in the **orders of the web panel**, reusing the order list and detail; there is no separate Dispatch section. Reason: sellers already find and open orders there.

## Dispatch status and dates

An order's delivery status is `pending`, `shipped` or `delivered`. It carries three dates:

| Date | Meaning |
| --- | --- |
| Sale date | When the order was created. |
| Scheduled dispatch date | Calendar day the order is planned to ship. Optional at creation; can be set, changed or cleared while the order is pending dispatch and not cancelled. |
| Real dispatch date (`shippedAt`) | Recorded by the server clock when the order is marked shipped. |

- A scheduled date earlier than today is accepted, at creation and when rescheduling, to represent overdue orders. An overdue order keeps its date until the seller reschedules it.
- A pending order delivered directly gets a delivery date and no dispatch date. Reason: the system does not infer an event that was not recorded.
- Requesting the current status again keeps its original dates; concurrent shipments record the dispatch date once.
- `PATCH /api/orders/:id/shipping` accepts a scheduled date, a status (`shipped` or `delivered`, no going back) or both; `null` clears the schedule and omitted fields are kept. When both are sent, the schedule is applied first and the transition second, in one transaction; any failure reverts both. Changing only the date does not recalculate delivery, payments or stock. Clients cannot send `shippedAt`, `deliveredAt` or the derived order status. Contract: [`shared/contracts/orders.ts`](../shared/contracts/orders.ts).
- Shipping keeps its existing payment, stock and transition validations.

## Cancellation

- An order can be cancelled only before it ships. Cancelling keeps its payments.
- After the cancellation commits, an `order_cancelled` event is published; a transactional listener restores the stock if it was deducted, once per order. Repeating a cancellation does not publish again.
- There is no outbox: an event lost after the commit is an accepted limitation.
- Cancelled orders are excluded from the "to collect" and "to deliver" views.

## Finding orders to prepare

Sales keeps its customer and sale-date filters and adds:

- delivery status (cancelled orders never count as pending);
- courier, including disabled couriers of existing orders;
- scheduled date range, or **Unscheduled** (cannot be combined with a scheduled range);
- real dispatch date range (upper bound exclusive).

Filters combine, stay within the current company and paginate in a stable order. The courier filter matches agency orders only, because home options have no courier.

## Labels

Each order gets **one** label; there are no copies or multi-package numbering.

- Only home and agency orders get labels. Store pickup, orders without delivery and cancelled orders are excluded with a visible reason.
- Payment status does not matter: orders with pending payments can be printed.
- Printing never changes order status or dates, and nothing about printing is stored on the order. Shipped and delivered orders can be reprinted.
- The label uses the order's stored delivery snapshot, never recomputed data. Only the sender is company data, read when the label is prepared. It is not an official courier waybill and does not list products, QR codes or a logo. Reason: a QR would confuse the courier, which uses its own codes.
- Web and mobile print the same label: building, classification and layout live in one shared module, [`shared/dispatch-label`](../shared/dispatch-label), with the text measurement injected by each platform (Skia on Android, the PDF font on the server). Both measure with the Inter font, so "content exceeds the label space" excludes the same orders on both.
- The label's fixed text (`Cel.`, `Ref:`, document names, `Pedido #`) is always in Spanish, whatever the interface language. Reason: labels exist only for Peruvian home and agency delivery.

| Block | Content |
| --- | --- |
| Sender | The company's dispatch sender: name, and `Cel. <phone>` on a second line when a phone is set. |
| Recipient | Name, phone, and document when present. |
| Destination | Home: buyer's address, department, province and district. Agency: the chosen agency's name, address and district. Reference when present. |
| Footer | Courier (agency only), then a small line `Pedido #<number>`, followed by ` · dd/mm/yyyy` when a dispatch date is scheduled. |

- Block order, line sizes and gaps follow the app format: there are no block headings or extra rules. The order number line and the sender phone use the smallest scale the label already uses, so nothing prints below the minimum font size. Reason: sender, recipient and address stay the main content.

### Sender

- The sender is configured per company in the web panel (see [delivery.md](delivery.md#settings-screen)). It has a name and an optional phone; there is no sender address or document. Reason: couriers register the sender at drop-off, and each extra line takes space from the recipient and the address.
- Both fields are trimmed free text: name up to 120 characters, phone up to 30 with no format rule. Reason: sellers write phones in many ways.
- The effective sender is the stored name, or the company's current name when the stored name is empty, plus the stored phone if any. Saving an empty name is valid and means "use the company name". Reason: an unconfigured sender never blocks printing.
- The sender is read live when labels are prepared and never stored on the order, so a change is reflected on the next label, on web and mobile.

Required data per method (missing optional data is omitted):

| Data | Home | Agency |
| --- | --- | --- |
| Recipient name and phone | Required | Required |
| Document | Optional | Required |
| Department, province, district | Required | Required |
| Address | Required (buyer) | Required (agency) |
| Courier and agency | Not applicable | Required |
| Reference | Optional | Optional |

- If the content does not fit after wrapping lines at word boundaries (a word longer than the line breaks by character, without hyphens) and shrinking the font to a legible minimum, the order is excluded with "content exceeds the label space"; information is never truncated. Lines break only at spaces, explicit line breaks in the address or reference are kept, and the printed characters are exactly the data's. Reason: words split at random («Lim / a») are misread by couriers. Product QR labels keep character wrapping.
- A pending order can complete its delivery data from its detail and become ready; after dispatch the destination stays locked.

## Selection and print review

### Mobile

1. The seller filters Sales and selects one or more orders. The selection survives paging and clears when filters or the company change; Select all affects only the visible page.
2. Before printing, a review lists ready orders and excluded ones with what is missing (for example "8 labels ready; 2 orders need data"), each with a link to the order.
3. Only ready orders print; incomplete ones do not block the rest.
4. The review reads the effective sender every time it opens, never a value cached at login. If the read fails, it shows an error with **Reintentar**, reads no orders and prints nothing; it never falls back to the company name. Reason: the fallback applies only when the sender is not configured, so a configured sender is never replaced by a wrong one.

### Web panel

The web panel prints labels as a PDF generated on the server; it does not talk to the printer.

- **One order:** **Imprimir rótulo** in the order detail opens the print dialog for that order.
- **In bulk:** the order list has a checkbox per row and one to select the visible page. The selection survives paging and clears when filters, search, view or company change.
  - Each selected order the list already knows will be skipped shows its reason in its row: «Falta dirección · se omitirá» (no delivery assigned), «Recojo en tienda · se omitirá» or «Cancelado · se omitirá». A cancelled order shows only the cancellation.
  - A bar shows the selected count and the skipped ones by reason (for example «3 pedidos seleccionados · 1 sin dirección no se imprimirá»), **Cancelar** and **Imprimir rótulos (N)**, where N excludes the skipped orders. The button is disabled when nothing is printable.
  - At most **100 orders** per print. With more selected, the bar says «Puedes imprimir hasta 100 rótulos a la vez» and printing is disabled; the server rejects larger requests. Reason: it bounds server time and PDF size while covering a seller's daily volume many times over.
- **Print dialog:** it shows the PDF preview, a size selector (**Etiqueta 62 × 100 mm** by default, or **A4**), the hint to print at 100 % without fitting to the page, a **Cambiar remitente** link to the sender settings, **Descargar PDF** and **Imprimir** (the browser's print dialog).
  - Changing the size regenerates the PDF with the same ready and excluded orders. The size is not remembered: every opening starts on 62 × 100 mm.
  - Orders the server excluded are listed under the preview with their number and reason, including those the list cannot predict ("missing data", "content exceeds the label space") and orders not found in the company; the PDF then has fewer labels than requested. When no order is ready, there is no PDF and only the reasons are shown.
  - Where the browser cannot show a PDF inline (phones and browsers without a PDF viewer), the dialog offers to open the PDF in a new tab instead of the preview, and **Imprimir** opens it there.
- **PDF formats:** every label is exactly 62 × 100 mm, portrait, with the same layout, fit check and exclusions in both sizes.
  - 62 × 100 mm: one label per page, for the Brother roll.
  - A4: portrait sheets with a centered grid of 3 columns × 2 rows (6 labels), filled left to right and top to bottom in the order of the selection, with dashed cut lines; the last sheet may be partly empty. Reason: sellers without a label printer print on plain paper, and keeping the label size fixed keeps content and rules identical.
- Generating a PDF is read-only and keeps every rule in [Labels](#labels): it never changes the order.

## Printer and batch

- This section is about the mobile app; the web panel prints the PDF through the browser.
- Printer: Brother QL-810W over Wi-Fi, Android only. Formats: 62 × 100 mm (DK-11202) for dispatch labels and 62 × 29 mm (DK-1209) for product QR labels. The app tells which roll to load; it does not detect the roll.
- Only one print operation runs at a time across the app, QR included; another request fails as busy instead of queueing. The rest of the app stays usable.
- A batch sends labels one at a time. Stop finishes the label in flight and does not start the next.
- A failed label stops the batch; continuing skips confirmed labels. An uncertain result is never resent automatically: the seller checks the output and either marks it printed or resends it accepting a possible duplicate.
- Batch progress lives in memory for the session. Closing the app loses it; the seller reselects pending orders. There is no persistent queue or background printing.

## Not supported

iOS printing, direct printing from the web panel to the Brother printer (it prints the PDF through the browser), editing the sender in the mobile app, official courier waybills or courier integrations, courier upload spreadsheets, batch status changes, products on the label and multiple packages per order.
