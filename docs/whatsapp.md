# WhatsApp

Yoyos reads the seller's WhatsApp conversations on the seller's phone. The mobile app links a WhatsApp account by QR, receives text and image messages, keeps them in an encrypted local database and registers each one in core, where other features (for example message-to-order) consume them.

Where each part is documented:

- Native module API, configuration, guarantees and build: [`apps/mobile/modules/whatsapp/README.md`](../apps/mobile/modules/whatsapp/README.md).
- Internal architecture of the Go library and its native storage: [`whatsapp-go-library-architecture.md`](whatsapp-go-library-architecture.md).
- Contracts: [`shared/contracts/whatsapp-messages.ts`](../shared/contracts/whatsapp-messages.ts) (core API), [`apps/mobile/modules/whatsapp/types.ts`](../apps/mobile/modules/whatsapp/types.ts) (native module).

## Flow

```text
WhatsApp ⇄ whatsmeow (Go) ⇄ Kotlin/Swift (state.db, Android foreground service) ⇄ client.ts (Zod, Result)
                                   │ messageReceived { deliveryId, message }
                                   ▼
apps/mobile/src/features/whatsapp: store once in SQLite → confirmMessageStored(deliveryId) → wake sync
                                   ▼
sync worker: upload image (POST /api/images) → POST /api/messages → mark synced
                                   ▼
core (features/chats): Contact → Chat → ChatMessage, then dispatch message_created
```

## Decisions

| Decision | Reason |
| --- | --- |
| The WhatsApp session, decryption and reception live only on the phone. Core never receives WhatsApp on the phone's behalf, and Yoyos sends no push to wake the app. | The seller's credentials and conversations stay in the seller's custody. |
| The library is receive-only: no sending, no groups, no audio, video, documents or stickers. | The product needs to read sales conversations, not to write them. |
| Linking is by QR only. One active WhatsApp account and one native client per installation. | Keeps one session and one durable queue per phone; changing account is `logout()` then a new QR. |
| Reception does not require the app to be visible ("Live mode" with the screen on was rejected). Android keeps the client in a `remoteMessaging` foreground service. iOS does not receive while suspended. | Sellers keep using their phone; iOS offers no equivalent without a server receiver, which is excluded by the first decision. |
| Delivery to the app is at-least-once and confirmed: a message is acknowledged to WhatsApp only after the app committed it locally and called `confirmMessageStored`. The app deduplicates by `message.id`. | A crash at any point never loses a message; duplicates are cheap to drop. |
| Local custody and core sync are independent states. `confirmMessageStored` never waits for the network. | If confirmation depended on core, the native recovery buffer would fill (`RECOVERY_BUFFER_FULL`) whenever the phone is offline. |
| The initial sync delivers everything WhatsApp offers, with no age filter. History and live messages share the same identity and path. | Old conversations may contain open sales. |
| The canonical identity is the LID. Phone numbers and usernames never identify a chat or a contact. | WhatsApp addresses users by LID; a phone number is not always available and must not be invented. |
| Messages are registered in core through `POST /api/messages`, a Yoyos API route named after the concept, not after the channel. | The message is created through the Yoyos API, not through a channel webhook. |

## Message content

| WhatsApp content | What the app receives |
| --- | --- |
| Text | The full text, never trimmed or modified. |
| Image, with or without caption | An image reference; the caption, if any, in `text`. MIME type and size may be missing. |
| Quoted or forwarded message | Its own content only, without the quoted message or forwarding metadata. |
| Edit or deletion event | Excluded. An earlier delivery is never replaced or deleted. |
| Disappearing message | Kept as a normal text or image; Yoyos does not delete it later. |
| View-once image, reaction or any other type | Excluded. |

An empty text without an image is never delivered.

**Unknown dates.** When WhatsApp's own timestamp is missing or invalid (zero, negative, beyond year 9999), the message has an unknown date: it is stored, delivered, confirmed and registered without `timestamp`. It is never replaced by `0` or by the reception time. Messages are ordered by arrival, not by date, and the app shows "Fecha desconocida".

## Identities

| Field | Rule |
| --- | --- |
| `accountId` | LID of the linked account (`<digits>@lid`), without device component. Kept with every pending message even after logout or an account change. |
| `chatId` | LID of the other party of the individual chat. A message whose chat LID is not yet known is kept and delivered once WhatsApp provides a verified PN→LID mapping (`IDENTITY_UNAVAILABLE` meanwhile). |
| `whatsappMessageId` | Protocol message ID, unchanged. |
| `message.id` | `wa-message:v1:` + Base64url of `[accountId, chatId, whatsappMessageId]`. Deterministic; the deduplication key on the phone. |
| `deliveryId` | `wa-delivery:v1:` + 32 random hex characters. Identifies one pending delivery to confirm, never the message. |

The image reference (`wa-image:v1:…`) contains the media decryption key. It is sensitive: it stays in the phone's encrypted database, is never logged and is never sent to core.

## Mobile app (`apps/mobile/src/features/whatsapp`)

The feature receives the native client as a `WhatsAppGateway` port and never imports the module directly; `src/composition/whatsapp.ts` is the only place that creates the client.

### Links and company isolation

- Each link belongs to one Yoyos company and to the user who linked it (`whatsapp_links`). At most one link is active per installation. The account is assigned to the link with its first message, because the library exposes `accountId` only inside messages.
- WhatsApp connects only if the active link belongs to the company of the current Yoyos session. Reason: core assigns the company from the session, so the phone must never send company A's messages with company B's session.
- A message is placed under the link already assigned to its account (even an ended one), otherwise under the active link without account. A message of an account with no link is stored and confirmed as `orphaned` and never sent.
- Signing out of Yoyos stops sync and reception and calls `disconnect()`, never `logout()`, and deletes nothing local. Signing in with another company does not connect and only offers unlinking.
- Unlinking calls `logout()` and ends the link. Pending messages of that link keep syncing while the session belongs to the same company. `REMOTE_LOGOUT_UNCONFIRMED` still ends the link and warns that the phone may still list the device.

### Receiving a message

1. Map the native message to the domain. A message with neither text nor image is confirmed without storing it, so it cannot block the native queue.
2. Store it once by `message.id` (a repeated delivery is a duplicate), claiming the link in the same transaction.
3. If storing fails, do not confirm: the library redelivers it.
4. Confirm the delivery, for new messages and for duplicates. If confirmation fails, the redelivery arrives as a duplicate and is confirmed then.
5. Wake the sync worker.

This path makes no network call and never logs text, image references or full LIDs.

### Syncing with core

Each stored message has a sync state: `pending`, `synced`, `rejected` or `orphaned` (the last three are terminal).

- One run at a time; up to 20 due messages of the session's company, sent one by one in arrival order. Before each request the worker checks that the message belongs to the session's company and that the session did not change.
- An image is downloaded from WhatsApp once, uploaded to core with its real MIME type (`POST /api/images`), and its core image ID is stored; the local file is deleted afterwards. The message is then registered with that `imageId`. A 404 on registration (the image is unknown to core) clears the stored image ID so the next run uploads it again.
- Classification (`domain/sync-policy.ts`): `201 stored` and `200 duplicate` → `synced`; invalid input, payload too large, unsupported media type or an expired WhatsApp image → `rejected`; authentication or company errors stop the worker without touching messages; network, rate-limit, server and invalid-response errors retry with backoff `min(2^attempts, 300)` seconds and ±20 % jitter. Network and rate-limit errors also stop the current run.
- Retrying is safe because core deduplicates by company, chat and protocol message ID.

### Local database

`yoyos-whatsapp.db` is SQLCipher-encrypted; its key is in `expo-secure-store`. The schema and migrations are in [`local-database.ts`](../apps/mobile/src/features/whatsapp/infrastructure/local-database.ts). Conversations are derived from messages; there is no local chat table because core owns `Contact` and `Chat`. The web build has no WhatsApp feature.

### Screens

The link screen shows the connection state, the QR with its expiry (a new `connect()` requests a new QR), and non-blocking notices for `RECOVERY_BUFFER_FULL`, `HISTORY_LIMIT_REACHED` and `IDENTITY_UNAVAILABLE`. Conversations and messages are read from the local database, ordered by arrival. A chat is shown by its abbreviated LID because the library provides neither push name nor phone. Images are downloaded on demand and released when leaving the screen.

## Core: registering a message

`POST /api/messages` ([`mobile-message-routes.ts`](../apps/core/src/features/chats/presentation/mobile-message-routes.ts), use case [`register-mobile-message.ts`](../apps/core/src/features/chats/application/register-mobile-message.ts)). Request and response shapes and limits are in [`shared/contracts/whatsapp-messages.ts`](../shared/contracts/whatsapp-messages.ts).

- One message per request, authenticated with the Yoyos session. `companyId` and the uploading user come only from the session; the body cannot choose them. `accountId` is declared provenance, not proof of control of the WhatsApp account.
- The body is strict JSON of at most 100 KiB: unknown fields, duplicate keys and compressed bodies are rejected; `message.id` must decode to exactly its three identity fields. Responses use `Cache-Control: no-store`.
- An image message must reference an image already uploaded to core (`imageId`); otherwise the response is 404 `IMAGE_NOT_FOUND`.
- The message is stored as `Contact` (unique per company, account LID and chat LID) → `Chat` → `ChatMessage` (unique per company, chat and protocol message ID) in one transaction. The first write wins: a repetition never changes content, direction or dates. A `Contact` is not a customer; it may reference one.
- After the commit, core dispatches `message_created` (`{ companyId, messageId }`, event ID = message ID, occurred at = first reception in core) and records `eventDispatchedAt`. `201 stored` means this request created the row; `200 duplicate` means it already existed. If the dispatch or its marker fails, the response is 503 and the row is kept; repeating the same POST completes the dispatch with the same event ID. Without another POST a pending dispatch is not recovered (no relay). Reason: no extra worker or outbox for this flow; the phone already retries until it gets 200/201.
- Error responses carry only codes and static field paths, never received values or content.

## Security

- Credentials, decrypted content and image references never leave the phone except the message content and image bytes registered in core.
- Every local read and sync filters by the company of the current session; the company is never inferred from content.
