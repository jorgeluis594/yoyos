# Dispatch preparation

How a seller schedules, finds, labels and ships orders. Delivery data itself is described in [delivery.md](delivery.md). The work happens in **Sales in the mobile app**, reusing the order list and detail; there is no separate Dispatch section. Reason: sellers already find and open orders there.

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
- The label uses the order's stored delivery snapshot, never recomputed data. It is not an official courier waybill and does not list products.

| Block | Content |
| --- | --- |
| Sender | Company name. |
| Recipient | Name, phone, and document when present. |
| Destination | Home: buyer's address, department, province and district. Agency: the chosen agency's name, address and district. Reference when present. |
| Footer | Courier (agency) and scheduled dispatch date when set. |

Required data per method (missing optional data is omitted):

| Data | Home | Agency |
| --- | --- | --- |
| Recipient name and phone | Required | Required |
| Document | Optional | Required |
| Department, province, district | Required | Required |
| Address | Required (buyer) | Required (agency) |
| Courier and agency | Not applicable | Required |
| Reference | Optional | Optional |

- If the content does not fit after wrapping lines and shrinking the font to a legible minimum, the order is excluded with "content exceeds the label space"; information is never truncated.
- A pending order can complete its delivery data from its detail and become ready; after dispatch the destination stays locked.

## Selection and print review

1. The seller filters Sales and selects one or more orders. The selection survives paging and clears when filters or the company change; Select all affects only the visible page.
2. Before printing, a review lists ready orders and excluded ones with what is missing (for example "8 labels ready; 2 orders need data"), each with a link to the order.
3. Only ready orders print; incomplete ones do not block the rest.

## Printer and batch

- Printer: Brother QL-810W over Wi-Fi, Android only. Formats: 62 × 100 mm (DK-11202) for dispatch labels and 62 × 29 mm (DK-1209) for product QR labels. The app tells which roll to load; it does not detect the roll.
- Only one print operation runs at a time across the app, QR included; another request fails as busy instead of queueing. The rest of the app stays usable.
- A batch sends labels one at a time. Stop finishes the label in flight and does not start the next.
- A failed label stops the batch; continuing skips confirmed labels. An uncertain result is never resent automatically: the seller checks the output and either marks it printed or resends it accepting a possible duplicate.
- Batch progress lives in memory for the session. Closing the app loses it; the seller reselects pending orders. There is no persistent queue or background printing.

## Not supported

Web or iOS printing, official courier waybills or courier integrations, courier upload spreadsheets, batch status changes, products on the label and multiple packages per order.
