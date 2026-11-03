# Notifications

Yoyos sends push notices to the seller's phone when a chat message needs them ([message-to-order](message-to-order.md#notices) decides which notice and its text). The notice kinds are those of the choice order in [message-to-order](message-to-order.md#notices), including the payment request («Revisa el chat») and «Pedido #N cambió» (non-urgent, [order-review](order-review.md#after-the-link-was-taken)); a problem notice ends with the first suggested question and, when the order changed after the link was taken, with «El pedido cambió después de enviar el enlace.». Notices are standard alert pushes drawn by the operating system; they only display information.

Sources of truth:

- Core feature: `apps/core/src/features/notifications/` (devices, sending, Expo adapter, routes). Queue policy: `application/send-chat-message-notice-policy.ts`.
- Notice claim, description and destination route: `apps/core/src/features/orders/application/describe-chat-message-notice.ts`, `find-seller-notice-target.ts`, `orders/presentation/seller-notice-routes.ts`.
- Mobile feature: `apps/mobile/src/features/notifications/`; locating the notice's message: `apps/mobile/src/features/whatsapp/application/locate-notice-message.ts`.
- Contracts: `shared/contracts/push-devices.ts`, `shared/contracts/seller-notices.ts`. Schema: `PushDevice` in `apps/core/prisma/schema.prisma`.

## Flow

```text
orders: chat_message_processed { companyId, messageId } (only when a notice is due)
   ▼
send-chat-message-notice: claim (orders) → device of the registering session → describe in the device locale (orders) → Expo Push → FCM / APNs → phone
   ▼
mobile: system banner and notification list → tap → chat on the message, or the order
```

Notifications calls three orders capabilities (claim, describe, release); orders never imports notifications.

## Recipient

| Aspect | Rule | Reason |
| --- | --- | --- |
| Recipient | Only the device of the Yoyos session that registered the message (`ChatMessage.registeredBySessionId`, first write wins), while that session is unexpired and its user belongs to the message's company. | The chat lives on that phone, and no notice may reach another company. |
| Other devices | The same user's other phones, the web and other users of the company receive nothing. Notices on the web are not offered. | WhatsApp lives only on the phone. |
| Another user signs in on that phone | They receive the notices of the messages the phone registers from then on, because those messages sync under their session. | — |
| Sign-out | The session's device row is deleted and the Yoyos notices on the phone, including those in the system list, are dismissed. Notices produced while signed out are never sent later. | — |
| Sign-out without connection | Sign-out finishes on the phone; the token is stored as a pending unregister and sent when the phone is online. A notice of a company other than the current session's that reaches the app in the foreground is not shown and queues an unregister. | — |
| Reinstall or new phone | Notices resume after signing in with permission granted. Linking WhatsApp on a new phone moves notices to it. | — |

**Accepted risk:** a notice already queued at FCM or APNs while the phone was offline after sign-out can show once in the background when it reconnects. Data-only pushes drawn by the app after a session check were rejected: they wake the app's JavaScript on every push, against "notices never wake the app", and cost a background task, battery and CPU on Android only. The 10-minute TTL bounds the gap.

## Devices

- `PushDevice` is a global table without RLS, like `session`: one row per Better Auth session (`sessionId` unique, cascade from `session` and `user`), Expo token unique, platform (`ios`, `android`) and locale (`es`, `pt-BR`). The company is read at send time from `session → user.companyId`, never copied. Reason: auth tables are global and read through `systemPrisma` ([RLS with Prisma](rls-with-prisma.md)); the token can move between companies in one statement, and every read is by a unique key. Rejected: a tenant RLS table plus a `SECURITY DEFINER` token-claim function.
- `PUT /api/push-devices/current` (bearer session) registers the phone: rows holding the same token under another session are deleted and the session's row is upserted, in one transaction. 204, `400 INVALID_INPUT`, `401`, `503`.
- `POST /api/push-devices/unregister` deletes a device by token. It is unauthenticated (the token is the proof) and always answers 204 for valid input.
- Mobile registers on sign-in, on returning to the foreground and on token change, only when the fingerprint (token, locale, session) differs from the last successful registration or after a failure. A failed registration is retried on the next foreground or sign-in.

## Sending

| Topic | Rule | Reason |
| --- | --- | --- |
| Provider | Expo Push Service (FCM v1 on Android, APNs on iOS, credentials in EAS) through `expo-server-sdk`; `PUSH_PROVIDER` is `expo` or `none` (default). Android uses the channel `chat-notices`. Receipts are not polled. | One API for both platforms. |
| Once | Before sending, orders claims the notice by setting `ChatMessageOutcome.noticeSentAt` under a row lock. A claim returns nothing, and writes nothing, when the notice was already claimed, none is due, or no session registered the message. | A repeated event or job sends nothing. |
| At most once | The claim is released only on a retryable failure before or during sending (device lookup, rendering, provider unavailable). A send that gets no answer within 10 s keeps the claim and drops the notice, because it may have been delivered. A crash after the claim and before sending loses that notice. | A duplicate notice is worse than a lost one; the miss stays visible in the chat. |
| Retries | Queue `send-chat-message-notice`, no ordering key: 5 retries from 15 s, exponential, capped at 150 s, attempts expire at 15 s, concurrency 4. A provider that stays down ends the job after 6 to 10 minutes and the notice is dropped. The Expo SDK's own backoff on 429 can exceed the 10 s send timeout, so a rate limit can end as a dropped notice. | A notice never holds a chat, and it is useless after the sale moved on. |
| Device not registered | Expo's `DeviceNotRegistered` deletes the device and drops the notice. | The phone registers again on its next sign-in with permission. |
| No device, permission off, provider rejection | The notice is dropped. | — |
| Dropped notices | Never stored or sent later; a notice never triggers «No pudimos revisar un mensaje» and never undoes or repeats the order change. | The notice is a secondary effect of the message. |
| TTL | `PUSH_NOTICE_TTL_SECONDS`, default 600. | Bounds late delivery. |
| Grouping | The group key is the core chat ID (a UUID, not a WhatsApp ID). Expo forwards it to APNs as `threadId`, so iOS groups a chat's notices. Expo has no Android grouping field, so Android groups Yoyos notices by app. | — |
| Payload | `data = { v: 1, companyId, messageId, target: "message" \| "order" }`, never `orderId`. The order is resolved on tap with `GET /api/seller-notices/:messageId`. | `companyId` plus `orderId` is the checkout credential ([checkout](checkout.md)). |
| Content | Title and body in the device's locale (`es` or `pt-BR`). Never the buyer's text, phone or WhatsApp ID; it may name a catalog product and an order number. | — |
| Display only | Notices never wake the app, start WhatsApp reception or receive messages. On iOS, WhatsApp receives only while Yoyos is open, so notices follow only those messages. | WhatsApp reception stays on the phone ([whatsapp](whatsapp.md)). |

`GET /api/seller-notices/:messageId` (session, `no-store`) answers `{ version: 1, target: { kind: "message" } | { kind: "order", orderId } }`, or `404 NOTICE_NOT_FOUND` for a message of another company, a message without a notice, or an order that no longer exists.

## Mobile

### Permission

- Asked once per installation, the first time the WhatsApp link becomes connected (not after a failed or expired QR): «Te avisaremos cuando un mensaje de un cliente necesite tu revisión» with **Activar avisos** and **Ahora no**, using the app's two-button confirmation. **Activar avisos** shows the system dialog.
- While permission is off, the WhatsApp link screen shows a non-blocking banner «Los avisos están desactivados…» with **Activar avisos**: it shows the system dialog if it was never shown, and opens the phone's settings for Yoyos after a denial. Once granted, the banner disappears the next time the screen is shown.

### Foreground

A notice that arrives while the app is open is presented by the system exactly as when the app is closed: banner, sound or vibration per the phone's settings, and an entry in the notification list that stays until the seller opens it, dismisses it or signs out. Yoyos draws no banner of its own. Reasons: iOS notices arrive almost only while Yoyos is open and the system list is the only place a notice remains; consecutive notices stack instead of replacing each other; screen readers announce system notifications and let the seller reach them later.

- On the destination chat, the message gets the «Aviso» mark at once, without moving the scroll position. Only notices received in the foreground mark in place.
- Any notice for that chat's open order refreshes a focused order detail, at most once every 2 s for a burst.

### Opening a notice

- **Signed out:** the destination is kept in memory and the sign-in screen opens. After signing in to the notice's company, the app opens the destination; after signing in to another company, it opens Home and shows nothing of the notice.
- **Unsaved draft** (a product being edited or a new sale with changes): the same discard confirmation as switching tabs. Keeping stays on the draft.
- **Message:** the WhatsApp tab opens the chat on that message, found by its core message ID in the local database. Messages from it to the newest load in one query of at most 1,000 rows; an older target loads in pages of 500 until it is shown. Meanwhile «Buscando el mensaje del aviso…» shows where older messages load and the manual «Cargar mensajes anteriores» is hidden. The message is marked with the «Aviso» label and a tint distinct from incoming and outgoing bubbles, announced as «Mensaje del aviso», until the seller leaves the chat.
  - A page that fails to load shows «No se pudo cargar el mensaje del aviso» with **Reintentar**, which continues the search.
  - A message no longer on the phone, even when its chat still exists, opens the chats list with «Este chat ya no está en este teléfono», the same as a missing chat, because the message is looked up before its chat. A search inside the chat that loads every page without the message shows «Ese mensaje ya no está en este teléfono».
  - If the local WhatsApp database cannot be opened, the notice stays held without a message and opens nothing.
- **Order:** the Pedidos tab opens that order's detail, loaded fresh; a cancelled or paid order opens in its current state.

## Configuration

Core: `PUSH_PROVIDER`, `EXPO_ACCESS_TOKEN`, `PUSH_NOTICE_TTL_SECONDS` (`features/notifications/infrastructure/notifications-env.ts`); invalid values fail at startup. Mobile: `expo-notifications` with its config plugin, the EAS project ID and the Android `googleServicesFile` from the EAS secret `GOOGLE_SERVICES_JSON`; `google-services.json` stays out of Git.

Log events: `notifications_push_device_registered`, `notifications_push_device_removed`, `notifications_push_device_invalid`, `notifications_notice_sent`, `notifications_notice_dropped` (reason: already sent, no device, device not registered, provider rejected, timeout), `notifications_push_provider_failed`. Never logged: Expo tokens, session IDs, notice texts, product names or WhatsApp IDs.
