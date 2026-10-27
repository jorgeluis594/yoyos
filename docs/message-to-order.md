# Message to order

When a buyer sends a product photo in a chat, core identifies the products in the image and adds them to an order of that chat. Sellers do not type the order by hand.

Sources of truth:

- Use case: `apps/core/src/features/orders/application/add-message-products-to-order.ts`.
- Open-order rule and skip reasons: `apps/core/src/features/orders/domain/message-order.ts`.
- Handler registration and retry policy: `apps/core/src/composition/event-handlers.ts`, `apps/core/src/features/orders/application/message-order-policy.ts`.
- Message contract: `shared/contracts/whatsapp-messages.ts`.

```text
Customer 1 ── * Contact 1 ── 1 Chat 1 ── * ChatMessage
    │                           │                │
    └──────────── * Order ──────┘ (chatId)       └── OrderMessage (messages that fed the order)
```

## Flow

1. Mobile downloads each image message from WhatsApp, uploads it with `POST /api/images` and registers the message with `POST /api/messages` carrying its `imageId`. Core checks the image exists in the company; otherwise it returns `404 IMAGE_NOT_FOUND` and mobile uploads the image again.
2. After committing the message, core publishes `message_created` (`{ companyId, messageId }`, with the message ID as `eventId`). The event name does not carry the channel name.
3. The `add-message-products-to-order` handler identifies the products in the image (QR codes first, then visual search) and adds them to the chat's open order, or creates a new order.

## Rules

| Topic | Rule | Reason |
| --- | --- | --- |
| Direction | Only incoming messages feed orders. | — |
| Text messages | Skipped (`not_image`). | Nothing to identify. |
| Product code | A QR code is a product code only when it is a variant UUID (`ProductVariant.qrCode`, what labels print). Other QR codes (payment wallets, URLs) are ignored, and so is the QR of a deactivated or deleted variant (it is reported as product not found). | Avoid treating payment QR codes as products. |
| Several products in one photo | One item per distinct variant. | — |
| Variant already in the open order | Quantity + 1. | An order holds each variant once (unique per order). |
| Price | New items use the current catalog price; existing items keep theirs. | — |
| Stock | Items are added even with zero stock. | Creating or growing an order never reserves or deducts stock. |
| Seller | The user who uploaded the message (`uploadedByUserId`); it does not change when items are added. | — |
| Customer | If the contact has no customer, one is created empty and linked in the same transaction. Manual orders have no customer. | Contacts from mobile WhatsApp arrive without name or phone. |
| Buyer | The chat order always has a buyer with the `contactId` and no name or phone; checkout asks for the phone. | — |
| Visibility of skips and failures | Logs only. | — |

### Open order

Items go to the most recent order of the chat that is still open (`isOpenForMessageItems`). Otherwise a new order is created. An order is open when all of these hold:

| Condition | Reason |
| --- | --- |
| Its `chatId` is the message's chat. | Manual orders never receive automatic items. |
| Not cancelled and not completed. | — |
| No confirmed or reported payment (only voided ones). | Adding items would change a total already covered or reported. |
| Checkout not confirmed. | The buyer already confirmed another total. |
| Delivery `pending` and stock not deducted. | The order was not prepared or dispatched. |

An order with checkout enabled but not confirmed stays open. If its total changes, checkout confirmation detects it under lock and returns `TOTAL_CHANGED`.

## Consistency

- Each processed message is recorded in `OrderMessage`, keyed by company and message. A duplicate event or a reprocess ends as `already_processed` and never adds items twice.
- Image reading and identification run outside the transaction. Inside it, the contact is locked first and then the order (`findOrderForUpdate`). Reason: locking the contact serializes photos of the same chat, so two concurrent photos create one customer and one order; locking the order serializes against payments, delivery, stock, cancellation and checkout.
- No unique index enforces "one open order per chat": openness depends on payments and checkout in other tables, so the locks guarantee it. If an older order's payment is voided, the chat can have two open orders; the most recent one is used.
- Publishing is retried only by mobile resending `POST /api/messages` with the same identity. Rejected alternatives: a periodic republisher (needs cross-company access to RLS-protected messages and a scheduler) and enqueueing the job inside the message transaction (the event bus port exposes no transactions).

## Failures and operation

- Business skips (`not_image`, `outgoing_message`, `unreadable_image`, `unrecognized_qr_code`, `product_not_found` and the visual-search misses) finish the job without retry.
- `PERSISTENCE_UNAVAILABLE`, `IMAGE_STORAGE_UNAVAILABLE`, `QR_READER_UNAVAILABLE`, `EMBEDDER_UNAVAILABLE` and `PRODUCT_MATCHER_UNAVAILABLE` are retryable (8 retries, concurrency 2). Every other error is permanent: the job stays failed.
- Log events: `orders_message_order_created`, `orders_message_order_items_added`, `orders_message_order_skipped`, `orders_message_order_failed`, with company, message, event and order IDs, reason or code, and match method. Logs never contain image bytes, phone numbers, WhatsApp IDs or decoded text other than the code.
- To reprocess a failed job, find it in pg-boss and retry it there; resending the message does not work because the event is already marked as dispatched. Reprocessing is safe because of `OrderMessage`, but a late reprocess may land in a different open order. Permanent errors need the data fixed first.

```sql
SELECT id, data->'metadata'->>'eventId' AS message_id, output->>'message', completed_on
FROM pgboss.job
WHERE name = 'add-message-products-to-order' AND state = 'failed';
```

Then call `boss.retry('add-message-products-to-order', jobId)`.

## Display

Orders from chats have `source: "whatsapp"`. Core web and mobile show a WhatsApp icon labelled "WhatsApp" and no link to the chat. The buyer is shown as name, else phone; "Público general" is reserved for orders without a buyer.
