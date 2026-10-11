# Procesamiento de mensajes de WhatsApp en mobile

Diseño técnico para conectar el módulo `@yoyos/whatsapp` (Go + whatsmeow, Expo Module Kotlin/Swift) con la app Expo: vincular la cuenta, recibir mensajes, persistirlos localmente de forma durable e idempotente, confirmarlos a la librería y sincronizarlos con core mediante `POST /api/messages`.

> Estado: **implementado salvo el paso 9** (artefactos de Go, development build y validación en dispositivo). Los pasos 1 a 8 del plan están en la rama `jorgeluis594/process-messages`. La librería sigue sin ejecutarse en dispositivo ni contra WhatsApp real (`apps/mobile/modules/whatsapp/README.md`, *Status*).
>
> Paso 9, avance (2026-10-10): `scripts/build-go.sh android` genera `WhatsAppGo.aar` con Go 1.26.5 y NDK 27.1.12297006. El módulo Kotlin compila contra ese AAR (`:yoyos-whatsapp:compileDebugKotlin`) y pasan sus 11 pruebas JVM (`:yoyos-whatsapp:testDebugUnitTest`). El APK completo no se pudo armar porque falta `BrotherPrintLibrary.aar` del módulo `brother-printer`, ajeno a esta feature. Falta iOS (`build-go.sh ios`, Xcode) y la validación en dispositivo con una cuenta real.
>
> Resolución de A1: se aceptó la recomendación. Core admite `timestamp` opcional y `sentAt` nulo solo en filas móviles (migración `allow_unknown_mobile_message_date`, restricción `ChatMessage_sentAt_required_outside_mobile_check`). Por eso el estado `held_unknown_date` no existe en el móvil: un mensaje sin fecha se envía sin `timestamp`.
>
> Desviaciones respecto al diseño: `toRegisterRequest` vive en `infrastructure/message-api.ts` (el dominio no depende de DTOs de transporte); `whatsapp_messages` tiene una columna `rejected_at`; UC-08 no tiene caso de uso propio (las pantallas leen de `MessageStore`); `LinkStore.start` recibe el identificador de un generador inyectado.

## 1. Alcance

### Incluye (v1)

- Vincular una cuenta de WhatsApp por QR desde la app y mostrar el estado de conexión.
- Consumir `messageReceived`, guardar el mensaje en SQLite cifrado y llamar `confirmMessageStored(deliveryId)` solo después del commit local.
- Sincronizar cada mensaje con core mediante una cola local (outbox) con reintentos, deduplicación e aislamiento por empresa.
- Listar conversaciones y mensajes desde la base local.
- Ver imágenes bajo demanda con `downloadImage` y liberar el archivo con `deleteDownloadedImage`.
- Desvincular la cuenta (`logout`) y reaccionar al cierre de sesión de Yoyos.

### No incluye

- Enviar mensajes, grupos, audio, vídeo o documentos. La librería no los soporta (`README.md`, IT-API-07).
- Subir los bytes de imágenes a core. El endpoint solo registra metadatos (`imageStatus = metadata_only`) y no existe una API de subida.
- Vincular mensajes con pedidos, clientes o productos. Se habilita después, consumiendo el evento `whatsapp_message_recorded` de core.
- Recepción en iOS con la app en segundo plano. Sigue sin resolver (memoria `ced2ef34`, memoria `978e1f51`).
- Varias cuentas de WhatsApp a la vez. Hay una cuenta activa por instalación (memoria `dfe3179a`).

## 2. Punto de partida

| Pieza | Ubicación | Estado |
|---|---|---|
| Librería Go | `apps/mobile/modules/whatsapp/go/` (`bridge/` público, `internal/` privado) | Probada con `-race` y dobles. Sin dispositivo. |
| Módulo Expo | `apps/mobile/modules/whatsapp/` (`WhatsAppModule.kt`, `WhatsAppModule.swift`) | Escrito. No compilado. |
| Fachada TS | `modules/whatsapp/client.ts`, `types.ts` | Validada con Zod. Devuelve `Result`. |
| Composición | `src/composition/whatsapp.ts` → `{ client, initialize }` | Cableada, pero sin consumidor. |
| SQLite cifrado | `src/features/whatsapp/infrastructure/local-database.ts` | Abre SQLCipher en `_layout.tsx`. Esquema v1 sin uso (`whatsapp_auth_entries`, `whatsapp_outbox`). |
| API de core | `apps/core/src/features/chats/presentation/mobile-message-routes.ts` | Implementada como `POST /api/whatsapp/messages`. Se renombra a `POST /api/messages` (sección 2.1). |
| Contrato compartido | `main`: `shared/contracts/whatsapp-messages.ts` | Implementado en `main`. Esta rama no lo tiene. |

`main` ya está integrado en esta rama (`e7b5bb0`), así que el contrato `registerWhatsAppMessageRequestSchema`, el cliente HTTP actualizado y la migración `20261008064129_adapt_chats_for_mobile_whatsapp` están disponibles.

### 2.1 Refactor de core: `POST /api/messages`

El mensaje se crea por la API de Yoyos, no por un webhook del canal, así que la ruta no debe llevar el nombre del canal. `POST /api/whatsapp/messages` pasa a ser `POST /api/messages`, sin alias ni redirección. Ningún cliente la usa todavía: mobile aún no la llama.

**Qué cambia:**

| Archivo | Cambio |
|---|---|
| `apps/core/src/app.ts:54` | `app.post("/api/messages", mobileMessageParser)`. Sigue antes del `express.json` genérico de `/api`. |
| `apps/core/src/app.ts:91` | `app.use("/api/messages", mobileMessageRoutes(registerMobileMessage))`. Sigue después de `loadApiAccess` y `requireApiCompany`. |
| `apps/core/src/features/chats/presentation/mobile-message-routes.test.ts` | El montaje y las URLs pasan a `/api/messages`. |
| `apps/core/tests/e2e/mobile-whatsapp-messages.spec.ts` | Las URLs pasan a `/api/messages`. Se renombra a `tests/e2e/mobile-messages.spec.ts`. |
| `docs/whatsapp-mobile-message-api-implementation.md`, `docs/whatsapp-mobile-message-api-tasks.md` | Se actualiza la ruta. |
| `docs/whatsapp-mobile-message-api-validation.md` | Se actualiza el nombre del spec en E01. |

**Qué no cambia:**

- El cuerpo (`version: 1`, `message` con identidad LID), las respuestas 201/200, los códigos de error, el parser estricto (`Cache-Control: no-store`, 100 KiB, sin claves duplicadas) y la deduplicación.
- El evento `whatsapp_message_recorded`, la feature `chats` y las tablas.
- Los nombres `registerWhatsAppMessage*Schema` y `shared/contracts/whatsapp-messages.ts`. Describen la forma de un mensaje de WhatsApp, no la ruta.

**Comprobaciones:** ninguna otra ruta usa `/api/messages`. Un `GET /api/messages` sigue cayendo en el 404 genérico de `/api`. Un `POST /api/whatsapp/messages` también devuelve 404, y conviene cubrirlo con un test de ruta para que no quede montada por error.

**Pendiente (A5):** si en el futuro la ruta recibe otros canales, el cuerpo necesitará un discriminador (por ejemplo `channel: "whatsapp"` en `version: 2`). Hoy no hace falta, porque `version: 1` solo admite WhatsApp.

## 3. Decisiones

### Heredadas (no se reabren)

| Decisión | Fuente |
|---|---|
| La sesión, la recepción y el descifrado se quedan en el teléfono. Core no recibe WhatsApp en nombre del móvil. | memoria `69a2ce5e`, memoria `4011286c` |
| La entrega es at-least-once. El consumidor deduplica por `message.id` y confirma después de su commit, también cuando reconoce una entrega repetida. | `whatsmeow-go-expo-implementation.md` §864, memoria `9795793e` |
| La identidad canónica es el LID: `accountId` y `chatId` tienen la forma `<n>@lid`. `message.id = wa-message:v1:` + base64url de `[accountId, chatId, whatsappMessageId]`. | memoria `ca55d861` |
| La fecha puede ser desconocida: si falta `timestamp`, no se inventa ni se usa la hora de recepción. Se ordena por llegada. | IT-MSG-07, decisión del 2026-10-10 |
| Los mensajes y la cola hacia core viven en SQLite de Expo cifrado. | memoria `d24306f0` |
| La fachada devuelve `Promise<Result<T, E>>` y valida con Zod. Los consumidores deciden por `code`. | memoria `dd1b9fd7`, `docs/programming-style.md` |
| Una feature solo llama casos de uso de otra. La persistencia no decide reglas de negocio. | memoria `e11e852a`, memoria `6b7ddbe8` |
| La sincronización inicial entrega todo lo disponible, sin filtrar por antigüedad. | memoria `d60ddeae` |
| Los contactos de WhatsApp no son clientes. | memoria `aee0e899` |

### Nuevas (este documento)

| # | Decisión | Motivo |
|---|---|---|
| D1 | El esquema local v1 se reemplaza por v2 mediante migración. Se eliminan las tablas de v1 porque nunca se escribieron. | v1 se diseñó para Baileys, con cifrado propio por fila y estados de subida de media que ya no aplican. SQLCipher ya cifra el archivo completo. |
| D2 | Hay dos estados independientes por mensaje: **custodia** (guardado y confirmado a la librería) y **sincronización** (registrado en core). | `confirmMessageStored` no puede depender de la red. Si dependiera, el buffer nativo se llenaría (`RECOVERY_BUFFER_FULL`) cada vez que no haya conexión. |
| D3 | Cada vinculación pertenece a una empresa y a un usuario (`whatsapp_links`). La cuenta se asigna con el primer mensaje que llega. | La API de la librería no expone `accountId` al conectar, solo dentro de cada mensaje. Core asigna la empresa desde la sesión, así que el móvil debe garantizar que nunca envía mensajes de la empresa A con la sesión de la empresa B. |
| D4 | Solo se conecta WhatsApp si existe un vínculo activo cuya `companyId` coincide con la sesión de Yoyos. Al cerrar sesión en Yoyos se llama `disconnect()`, no `logout()`. | Respeta el aislamiento por empresa y no destruye la vinculación por cerrar sesión. |
| D5 | La referencia de imagen (`wa-image:v1:…`) se guarda en SQLite y nunca sale del teléfono. | El descriptor contiene la media key. Core no lo acepta (`whatsapp-mobile-message-api-implementation.md` §3). |

### Abiertas (requieren decisión)

| # | Pregunta | Recomendación |
|---|---|---|
| A1 | ✅ Resuelto (ver Estado). **Conflicto de contrato.** Core exige `timestamp` (`unixMillisecondsSchema`, y `ChatMessage.sentAt` no admite nulos), pero la librería lo omite cuando la fecha es desconocida. | Volver opcional `timestamp` en `shared/contracts/whatsapp-messages.ts` y hacer `sentAt` nullable para filas móviles, con migración y check. Mientras tanto, el móvil retiene esos mensajes en `held_unknown_date`: los guarda y confirma, pero no los envía. No se fabrica ninguna fecha. |
| A2 | ¿Qué hacer con un mensaje de una cuenta que no corresponde a ningún vínculo? Pasa, por ejemplo, con pendientes de una cuenta anterior tras volver a vincular sin `logout` limpio. | Guardarlo y confirmarlo con `sync_state = orphaned`, sin enviarlo nunca, y mostrar un contador de diagnóstico. Confirmar evita bloquear la cola nativa. |
| A3 | ¿Se borran los datos locales de la empresa al desvincular? | No borrar en v1. Ocultarlos (las consultas filtran por vínculo activo) y conservar los pendientes de sincronizar hasta enviarlos. La purga es una opción explícita en v2. |
| A4 | Android: si el runtime JS muere con el servicio vivo, `OnDelivery` falla y la recepción se detiene hasta que vuelva un consumidor (README, IT-SUB-06). | Aceptarlo en v1, porque no se pierde nada: los mensajes quedan en el buffer nativo. Medirlo en dispositivo antes de decidir si hace falta Headless JS. |
| A5 | ¿El cuerpo de `POST /api/messages` llevará un discriminador de canal? | No en v1. Añadirlo en `version: 2` cuando exista un segundo canal (sección 2.1). |

## 4. Arquitectura

```text
WhatsApp ⇄ whatsmeow (Go) ⇄ Kotlin/Swift (state.bin, FGS) ⇄ client.ts (Zod, Result)
                                                              │ messageReceived {deliveryId, message}
                                                              ▼
                     features/whatsapp/application/receive-message.ts
                       1. parse → dominio (InboundMessage)
                       2. resolveLink(accountId) → companyId
                       3. store.saveOnce(...)        ← transacción SQLite
                       4. client.confirmMessageStored(deliveryId)
                       5. sync.wake()
                                                              ▼
                     features/whatsapp/application/sync-messages.ts
                       outbox (SQLite) → POST /api/messages → marca synced
```

### Integración React Native ⇄ Go

La app no llama a Go directamente. Hay cuatro capas, y cada una solo habla con la siguiente. Todas existen ya, salvo la feature.

```text
features/whatsapp (casos de uso, sección 8)
        │  WhatsAppGateway (sección 7)
src/composition/whatsapp.ts                 ← crea el único cliente
        │
modules/whatsapp/client.ts                  ← fachada TS: Zod + Result
        │  requireOptionalNativeModule("WhatsApp")
WhatsAppModule.kt / WhatsAppModule.swift    ← Expo Module
        │  funciones generadas por gomobile
WhatsAppGo.aar / WhatsAppGo.xcframework     ← go/bridge compilado
        │
go/internal/* + whatsmeow  ⇄  WhatsApp
```

#### 1. Go → nativo: gomobile

`modules/whatsapp/scripts/build-go.sh` compila solo el paquete `go/bridge` con `gomobile bind`:

| Plataforma | Artefacto | Nombres generados | Consumo |
|---|---|---|---|
| Android | `android/libs/WhatsAppGo.aar` | Paquete Java `expo.modules.whatsapp.go.bridge` (`Bridge`, `ConnectionSession`, `DeliverySession`, `ImageSession`…) | `android/build.gradle`, que falla si falta el AAR |
| iOS | `ios/Frameworks/WhatsAppGo.xcframework` | Prefijo `YYWhatsAppGo` (`YYWhatsAppGoBridgeOpenDelivery`…) | `WhatsApp.podspec` (`vendored_frameworks`) |

Los artefactos no se versionan. Se regeneran antes de cada build nativo.

#### 2. Nativo ⇄ Go: llamadas en las dos direcciones

**Nativo → Go.** Kotlin y Swift abren las sesiones y luego las usan:

- `Bridge.openProtocolStore`, `openDelivery`, `openConnectionWithDelivery` y `openImages` (`WhatsAppModule.kt:33-172`, `WhatsAppModule.swift:37-183`).
- Las sesiones abiertas exponen `Connect()`, `Logout()`, `Confirm(deliveryId)`, `BeginDownload()`, etc.

**Go → nativo.** Go llama a interfaces que la capa nativa implementa:

| Interfaz Go | Implementación | Responsabilidad |
|---|---|---|
| `ProtocolStorage`, `DeliveryStorage` | `NativeStateStore` (Kotlin/Swift) | Leer y escribir `state.bin` (AES-256-GCM, clave en Keystore o Keychain). Go nunca toca el disco ni las claves. |
| `ConnectionEvents` | `PublicConnectionEvents` / `NativeConnectionEvents` | Avisar de QR, estado de conexión y errores. |
| `DeliveryEvents` | `PublicDeliveryEvents` / `NativeDeliveryEvents` | Entregar cada mensaje pendiente (`OnDelivery`). |

Todo cruza la frontera como strings JSON versionados (`contractVersion: 1`) o tipos escalares, porque gomobile no admite estructuras complejas.

#### 3. Nativo → JS: Expo Module

`WhatsAppModule` registra el módulo con `Name("WhatsApp")`:

- **Funciones:** `initialize`, `connect`, `disconnect`, `logout`, `confirmMessageStored`, `setMessageConsumer`, `removeMessageConsumer`, `downloadImage`, `deleteDownloadedImage`. Todas devuelven `{ success, data }` o `{ success: false, error: { code } }`.
- **Eventos:** `Events("qr", "connectionChanged", "messageReceived", "error")`. Los callbacks de Go se reenvían con `sendEvent` (`WhatsAppModule.kt:378`, `WhatsAppModule.swift:259`).
- **Android:** el servicio en primer plano `WhatsAppService` mantiene vivo el cliente Go. Las descargas de imagen usan `Coroutine` (`ImageOperations.kt`) para no bloquear la cola serial del módulo.

#### 4. JS: fachada tipada

`client.ts` obtiene el módulo con `requireOptionalNativeModule("WhatsApp")`. Valida cada respuesta y cada evento con Zod, y lo convierte en `Result<T, WhatsAppError>` con los tipos de `types.ts`. Además:

- Garantiza un único consumidor de `messageReceived` mediante `setMessageConsumer(token)` y descarta eventos dirigidos a suscripciones reemplazadas.
- Si el módulo nativo no existe (Expo Go, web), devuelve `MODULE_UNAVAILABLE` en vez de lanzar.

`src/composition/whatsapp.ts` crea ese cliente una sola vez, junto con `initialize()`, que aplica `EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB`.

#### 5. Feature: lo que falta

La feature recibe el cliente como `WhatsAppGateway` y nunca importa `@mobile/modules/whatsapp` directamente. Así los casos de uso se prueban con fakes:

```ts
// features/whatsapp/composition.ts
import { whatsapp } from "@mobile/composition/whatsapp";

const gateway: WhatsAppGateway = { ...whatsapp.client, initialize: whatsapp.initialize };
export const reception = createReceptionLifecycle({ whatsapp: gateway, store, links, session, now });
```

Recorrido de un mensaje (UC-03):

```text
whatsmeow descifra
→ Go guarda el pendiente en state.bin (ProtocolStorage → NativeStateStore)
→ Go: DeliveryEvents.OnDelivery(json) → nativo: sendEvent("messageReceived")
→ client.ts: Zod → listener → receiveMessage(): saveOnce en SQLite
→ client.confirmMessageStored(deliveryId) → nativo → DeliverySession.Confirm
→ Go retira el pendiente → recién entonces envía el ACK a WhatsApp
```

Si la app muere en cualquier punto antes de `confirmMessageStored`, el mensaje sigue en `state.bin` y se vuelve a entregar al reconectar. Por eso UC-03 deduplica por `message.id`.

#### Requisitos de ejecución

- Ejecutar `modules/whatsapp/scripts/build-go.sh android|ios` y hacer un development build (`expo run:android`, `expo run:ios`). No funciona en Expo Go ni en web.
- Nada de esta cadena se ha compilado ni ejecutado aún en dispositivo: los tests de Kotlin y Swift están escritos pero no se han corrido. La validación es el paso 9 del plan.

### Estructura de archivos

```text
apps/mobile/src/features/whatsapp/
  domain/
    ids.ts                    # tipos de marca y parsers puros
    inbound-message.ts        # InboundMessage, fromReceivedMessage, toRegisterRequest
    sync-policy.ts            # backoff, clasificación de errores de sync
    link.ts                   # WhatsAppLink y reglas de asignación
  application/
    ports.ts                  # MessageStore, LinkStore, MessageApi, Clock, WhatsAppGateway
    receive-message.ts        # UC-03
    sync-messages.ts          # UC-04
    link-account.ts           # UC-01, UC-06
    reception-lifecycle.ts    # UC-02, UC-07
    read-conversations.ts     # UC-08
    view-image.ts             # UC-05
  infrastructure/
    local-database.ts         # existente: añade la migración v1 → v2
    local-database.web.ts     # existente: stub web
    sqlite-message-store.ts
    sqlite-link-store.ts
    message-api.ts            # POST /api/messages con Zod
  presentation/
    whatsapp-link-screen.tsx  # QR + estado
    conversations-screen.tsx
    conversation-screen.tsx
    use-whatsapp-status.ts
    translations.ts
  composition.ts              # cablea con @mobile/composition/whatsapp y auth
```

`src/composition/whatsapp.ts` sigue siendo el único punto que crea el cliente nativo. La feature lo recibe como dependencia (`WhatsAppGateway`). Las rutas de Expo Router solo importan pantallas desde `presentation/` (memoria `5fa5ef5a`).

## 5. Modelo de dominio

### Identificadores con marca

Siguen el patrón de `apps/core/src/features/chats/domain/mobile-message.ts`. Se crean solo con parsers que devuelven `Result`, nunca con `as` fuera de `ids.ts`.

```ts
// domain/ids.ts
export type NativeMessageId = string & { readonly __brand: "NativeMessageId" };   // wa-message:v1:…
export type DeliveryId = string & { readonly __brand: "DeliveryId" };             // wa-delivery:v1:<32 hex>
export type WhatsAppAccountId = string & { readonly __brand: "WhatsAppAccountId" }; // <n>@lid
export type WhatsAppChatId = string & { readonly __brand: "WhatsAppChatId" };       // <n>@lid
export type ProtocolMessageId = string & { readonly __brand: "ProtocolMessageId" };
export type ImageDownloadReference = string & { readonly __brand: "ImageDownloadReference" }; // wa-image:v1:… (sensible)
export type CompanyId = string & { readonly __brand: "CompanyId" };
export type UserId = string & { readonly __brand: "UserId" };
export type LinkId = string & { readonly __brand: "LinkId" };
export type CoreMessageId = string & { readonly __brand: "CoreMessageId" };          // UUID de ChatMessage en core

export type IdError = Readonly<{ code: "INVALID_ID"; message: string; field: string }>;
export function parseLid(value: string, field: string): Result<string & { readonly __brand: string }, IdError>;
```

### Mensaje entrante

```ts
// domain/inbound-message.ts
export type InboundContent =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "image"; caption: string | null; mimeType: string | null; size: number | null;
               reference: ImageDownloadReference }>;

export type InboundMessage = Readonly<{
  id: NativeMessageId;
  accountId: WhatsAppAccountId;
  chatId: WhatsAppChatId;
  whatsappMessageId: ProtocolMessageId;
  direction: "incoming" | "outgoing";
  sentAt: Date | null;          // null = fecha desconocida (IT-MSG-07); nunca la hora de recepción
  content: InboundContent;
}>;

export type InboundMessageError = Readonly<{ code: "EMPTY_MESSAGE" | "INVALID_ID"; message: string }>;

/** Pura. `text` pasa a `caption` si hay imagen; sin texto ni imagen → EMPTY_MESSAGE (no se fabrica contenido). */
export function fromReceivedMessage(message: ReceivedMessage): Result<InboundMessage, InboundMessageError>;

/** Pura. Construye el cuerpo exacto del contrato de core, sin spread del objeto nativo.
 *  `reference`, `deliveryId` y URIs locales nunca se incluyen. */
export function toRegisterRequest(message: InboundMessage): Result<RegisterWhatsAppMessageRequest, SyncHoldReason>;
export type SyncHoldReason = Readonly<{ code: "UNKNOWN_DATE"; message: string }>; // desaparece si se acepta A1
```

El mapeo sigue `whatsapp-mobile-message-api-implementation.md` §3, *Adaptación desde `ReceivedMessage`*:

| `ReceivedMessage` | `InboundMessage` | Request a core |
|---|---|---|
| `id`, `accountId`, `chatId`, `whatsappMessageId`, `direction` | igual, con marca | igual |
| `timestamp?` | `sentAt: Date \| null` | `timestamp: sentAt.getTime()` o retención (A1) |
| `text`, sin `image` | `{type:"text", text}` | igual |
| `image` + `text?` | `{type:"image", caption: text ?? null, …}` | `{type:"image", caption?, mimeType?, size?}` |
| `image.reference.downloadReference` | `reference` | **no se envía** |

### Estado local del mensaje

```ts
export type SyncState =
  | Readonly<{ state: "pending"; attempts: number; nextAttemptAt: Date }>
  | Readonly<{ state: "synced"; coreMessageId: CoreMessageId; syncedAt: Date }>
  | Readonly<{ state: "rejected"; code: "INVALID_INPUT" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE"; at: Date }>
  | Readonly<{ state: "held_unknown_date" }>   // A1
  | Readonly<{ state: "orphaned" }>;           // A2

export type StoredMessage = InboundMessage & Readonly<{
  linkId: LinkId | null;      // null ⇔ orphaned
  companyId: CompanyId | null;
  arrivalSeq: number;         // orden de llegada, monotónico local; base del orden cuando sentAt es null
  storedAt: Date;
  sync: SyncState;
}>;
```

Transiciones permitidas, validadas en `domain/sync-policy.ts`:

```text
(nuevo) ──► pending ──► synced
   │          │  └────► rejected        (4xx permanente)
   │          └───────► pending         (reintento con backoff)
   ├──────► held_unknown_date ──► pending   (si core acepta fechas desconocidas, A1)
   └──────► orphaned                        (terminal)
```

`synced`, `rejected` y `orphaned` son estados terminales. Un duplicado (`saveOnce` sobre un `id` que ya existe) no cambia el estado.

### Vínculo

```ts
// domain/link.ts
export type WhatsAppLink = Readonly<{
  id: LinkId;
  companyId: CompanyId;
  linkedByUserId: UserId;
  accountId: WhatsAppAccountId | null;  // se fija con el primer mensaje
  startedAt: Date;
  endedAt: Date | null;                 // null ⇔ activo; como máximo uno activo por instalación
}>;

/** Pura. Busca primero el vínculo de esa cuenta, aunque haya terminado. Si no existe, toma el activo
 *  sin cuenta y lo reclama. Si no hay ninguno, devuelve orphan. */
export function assignLink(links: readonly WhatsAppLink[], accountId: WhatsAppAccountId):
  | Readonly<{ kind: "existing"; link: WhatsAppLink }>
  | Readonly<{ kind: "claim"; link: WhatsAppLink }>
  | Readonly<{ kind: "orphan" }>;
```

## 6. Esquema SQLite v2

Las tablas se crean dentro de la base SQLCipher existente. Sin columnas de cifrado por fila. La migración v1 → v2 corre dentro de `BEGIN IMMEDIATE … COMMIT` en `local-database.ts`, siguiendo el patrón actual de `user_version`.

```sql
DROP TABLE IF EXISTS whatsapp_outbox;
DROP TABLE IF EXISTS whatsapp_auth_entries;

CREATE TABLE whatsapp_links (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  linked_by_user_id TEXT NOT NULL,
  account_id TEXT CHECK (account_id IS NULL OR account_id GLOB '[0-9]*@lid'),
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE UNIQUE INDEX whatsapp_links_one_active ON whatsapp_links ((1)) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX whatsapp_links_account ON whatsapp_links (account_id) WHERE account_id IS NOT NULL;

CREATE TABLE whatsapp_messages (
  id TEXT PRIMARY KEY,                       -- NativeMessageId: clave de idempotencia
  link_id TEXT REFERENCES whatsapp_links(id),
  company_id TEXT,
  account_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  whatsapp_message_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  sent_at INTEGER,                           -- ms Unix; NULL = desconocida
  arrival_seq INTEGER NOT NULL UNIQUE,
  stored_at INTEGER NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('text','image')),
  text TEXT,                                 -- texto o caption
  image_mime_type TEXT,
  image_size INTEGER,
  image_reference TEXT,                      -- sensible: nunca se loguea ni se envía
  sync_state TEXT NOT NULL CHECK (sync_state IN ('pending','synced','rejected','held_unknown_date','orphaned')),
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  core_message_id TEXT,
  sync_error_code TEXT,
  synced_at INTEGER,
  CHECK ((content_type = 'text' AND text IS NOT NULL AND image_reference IS NULL)
      OR (content_type = 'image' AND image_reference IS NOT NULL)),
  CHECK ((link_id IS NULL) = (company_id IS NULL)),
  CHECK (sync_state <> 'orphaned' OR link_id IS NULL),
  CHECK (sync_state <> 'synced' OR core_message_id IS NOT NULL),
  UNIQUE (account_id, chat_id, whatsapp_message_id)
);
CREATE INDEX whatsapp_messages_outbox ON whatsapp_messages (company_id, sync_state, next_attempt_at)
  WHERE sync_state = 'pending';
CREATE INDEX whatsapp_messages_chat ON whatsapp_messages (company_id, chat_id, arrival_seq);

PRAGMA user_version = 2;
```

- **Idempotencia:** `INSERT … ON CONFLICT(id) DO NOTHING`, seguido de `SELECT` de la fila. `saveOnce` responde `stored` o `duplicate`.
- **`arrival_seq`:** se calcula como `COALESCE(MAX(arrival_seq), 0) + 1` dentro de la misma transacción. Basta porque hay un solo escritor (el consumidor es único y entrega de uno en uno).
- **Conversaciones:** se derivan con `GROUP BY chat_id` sobre `whatsapp_messages`, filtrando por la `company_id` de la sesión. No hay tabla propia de chats, porque core es dueño de `Contact` y `Chat`.
- **Web:** `local-database.web.ts` sigue sin SQLite (memoria `915d3e89`). La feature no se monta en web.

## 7. Puertos

```ts
// application/ports.ts
export type StoreError = Readonly<{ code: "LOCAL_STORAGE_FAILED"; message: string }>;

export type MessageStore = Readonly<{
  saveOnce(message: InboundMessage, placement: Placement, now: Date): Promise<Result<SaveOutcome, StoreError>>;
  nextPending(companyId: CompanyId, now: Date, limit: number): Promise<Result<readonly StoredMessage[], StoreError>>;
  markSynced(id: NativeMessageId, coreMessageId: CoreMessageId, at: Date): Promise<Result<void, StoreError>>;
  markRetry(id: NativeMessageId, attempts: number, nextAttemptAt: Date): Promise<Result<void, StoreError>>;
  markRejected(id: NativeMessageId, code: RejectCode, at: Date): Promise<Result<void, StoreError>>;
  listConversations(companyId: CompanyId): Promise<Result<readonly ConversationSummary[], StoreError>>;
  listMessages(companyId: CompanyId, chatId: WhatsAppChatId, page: Page): Promise<Result<readonly StoredMessage[], StoreError>>;
  findImage(companyId: CompanyId, id: NativeMessageId): Promise<Result<ImageReference | null, StoreError>>;
}>;
export type Placement =
  | Readonly<{ kind: "linked"; link: WhatsAppLink; claim: boolean; initial: "pending" | "held_unknown_date" }>
  | Readonly<{ kind: "orphan" }>;
export type SaveOutcome = Readonly<{ status: "stored" | "duplicate"; message: StoredMessage }>;

export type LinkStore = Readonly<{
  all(): Promise<Result<readonly WhatsAppLink[], StoreError>>;
  active(): Promise<Result<WhatsAppLink | null, StoreError>>;
  start(companyId: CompanyId, userId: UserId, now: Date): Promise<Result<WhatsAppLink, StoreError>>; // falla si ya hay uno activo
  end(id: LinkId, now: Date): Promise<Result<void, StoreError>>;
}>;

export type MessageApiError = TransportError; // de @mobile/shared/application/transport-error
export type MessageApi = Readonly<{
  register(request: RegisterWhatsAppMessageRequest): Promise<Result<RegisterWhatsAppMessageResponse, MessageApiError>>;
}>;

/** El subconjunto de WhatsAppClient que la feature necesita (facilita los fakes). */
export type WhatsAppGateway = Pick<WhatsAppClient,
  "connect" | "disconnect" | "logout" | "confirmMessageStored" | "downloadImage" | "deleteDownloadedImage" | "addListener">
  & Readonly<{ initialize: WhatsAppComposition["initialize"] }>;

export type Session = Readonly<{ companyId: CompanyId; userId: UserId; generation: number }>;
export type Clock = () => Date;
```

`saveOnce` hace en **una sola transacción** la reclamación del vínculo (`UPDATE whatsapp_links SET account_id = ? WHERE id = ? AND account_id IS NULL`) y el insert del mensaje. Si falla cualquiera de los dos, no se confirma la entrega.

## 8. Casos de uso

### UC-01 Vincular cuenta

```ts
export type LinkAccountError =
  | Readonly<{ code: "ALREADY_LINKED" | "NO_SESSION"; message: string }>
  | StoreError | WhatsAppError | WhatsAppConfigurationError;
export function linkAccount(deps: { links: LinkStore; whatsapp: WhatsAppGateway; session: () => Session | null; now: Clock }):
  () => Promise<Result<WhatsAppLink, LinkAccountError>>;
```

1. Exige una sesión de Yoyos y que no haya vínculo activo.
2. Crea `links.start(companyId, userId)`, inicializa con `whatsapp.initialize()` y conecta con `whatsapp.connect()`.
3. La UI se suscribe a `qr` y muestra el valor hasta `expiresAt`. Si el QR vence, pide uno nuevo con otra llamada a `connect()` (memoria `2afe8938`).
4. Al recibir `connectionChanged: connected` se muestra éxito. `accountId` se fija cuando llega el primer mensaje (D3).
5. Si `connect` falla, se cierra el vínculo con `links.end` para que pueda reintentarse.

### UC-02 Iniciar o reanudar la recepción

Se ejecuta al arrancar la app con sesión, al iniciar sesión y al volver a primer plano.

```ts
export function startReception(deps): () => Promise<Result<ReceptionHandle, StartError>>;
export type ReceptionHandle = Readonly<{ stop(): void }>;
export type StartError = Readonly<{ code: "NO_ACTIVE_LINK" | "LINK_OF_OTHER_COMPANY"; message: string }> | WhatsAppError | StoreError;
```

1. Si `links.active()` es null o su `companyId` no coincide con la de la sesión, no se conecta (D4).
2. **Primero** registra el consumidor `addListener("messageReceived", …)`, y **después** `initialize()` y `connect()`. Así los pendientes recuperados encuentran consumidor.
3. Se suscribe a `connectionChanged` y `error` para alimentar el estado de UI (`use-whatsapp-status`).
4. Un `connect()` de un usuario ya vinculado no produce QR. Si el estado pasa a `sessionExpired`, la UI ofrece volver a vincular (UC-06 y luego UC-01).

### UC-03 Recibir y guardar un mensaje (camino crítico)

```ts
export type ReceiveOutcome = Readonly<{ status: "stored" | "duplicate" | "orphaned" | "invalid" }>;
export type ReceiveError = StoreError | WhatsAppError;
export function receiveMessage(deps: { store: MessageStore; links: LinkStore; whatsapp: WhatsAppGateway; now: Clock; wakeSync: () => void }):
  (event: WhatsAppEvents["messageReceived"]) => Promise<Result<ReceiveOutcome, ReceiveError>>;
```

1. `fromReceivedMessage(event.message)`. Si falla (`EMPTY_MESSAGE`), confirma igual y devuelve `invalid`. La librería ya solo entrega contenido soportado, y no confirmar dejaría la cola nativa bloqueada para siempre.
2. `assignLink(links.all(), accountId)` define el `Placement`: `initial = sentAt === null ? "held_unknown_date" : "pending"`.
3. `store.saveOnce(...)`. **Si falla, no se confirma.** Se devuelve el error, se emite un error de UI y la librería volverá a entregar el mensaje.
4. `whatsapp.confirmMessageStored(deliveryId)`, tanto en `stored` como en `duplicate`. Si la confirmación falla, el mensaje ya está guardado: la repetición llegará como `duplicate` y se confirmará entonces.
5. `wakeSync()` cuando el resultado es `stored` y el estado es `pending`.

Invariantes:

- Nunca se confirma antes del commit local.
- La operación es idempotente por `message.id`, nunca por `deliveryId`.
- No hay llamadas de red en este camino.
- No se registran en logs el texto, la referencia de imagen ni los LID completos.

### UC-04 Sincronizar con core

```ts
export type SyncSummary = Readonly<{ synced: number; retried: number; rejected: number }>;
export type SyncError = StoreError | Readonly<{ code: "NO_SESSION" | "SESSION_BLOCKED"; message: string }>;
export function createSyncWorker(deps: { store: MessageStore; api: MessageApi; session: () => Session | null; now: Clock; schedule: (ms: number, run: () => void) => () => void }):
  Readonly<{ wake(): void; stop(): void; runOnce(): Promise<Result<SyncSummary, SyncError>> }>;
```

- **Un solo vuelo:** si ya hay una ejecución en curso, `wake()` solo marca que debe volver a correr al terminar.
- **Selección:** `nextPending(session.companyId, now, 20)`, envío **secuencial** por orden de `arrival_seq`.
- **Aislamiento:** antes de cada POST se comprueba que `message.companyId === session.companyId` y que la generación de sesión no cambió. `OPERATION_CANCELLED` deja el mensaje en `pending` sin sumar intentos.
- **Disparadores:** después de UC-03, al volver a primer plano, al iniciar sesión y con un temporizador de backoff mientras la app está activa.

Clasificación, pura en `domain/sync-policy.ts`:

| Resultado | Acción |
|---|---|
| `ok` con `stored` (201) o `duplicate` (200) | `markSynced(coreMessageId = messageId)` |
| `INVALID_INPUT` (400), `413`, `UNSUPPORTED_MEDIA_TYPE` (415) | `markRejected`. Es terminal y se cuenta en el diagnóstico. |
| `UNAUTHENTICATED` tras la renovación del cliente, `COMPANY_REQUIRED`, `INVALID_COMPANY`, `403 EMAIL_VERIFICATION_REQUIRED` | Detiene el worker (`SESSION_BLOCKED`) sin tocar los mensajes. |
| `NETWORK_ERROR`, `SERVICE_UNAVAILABLE` (503), `SERVER_ERROR` (500), `RATE_LIMITED` (429), `INVALID_RESPONSE` | `markRetry` con backoff `min(2^attempts, 300) s` y jitter de ±20 %. El worker sigue con el siguiente mensaje solo si el error no es de red ni de límite de tasa. |

El reintento es seguro porque core deduplica por `(companyId, chatId, whatsappMessageId)` y vuelve a despachar el evento si quedó pendiente (`register-mobile-message.ts`).

`MessageApi.register` valida la respuesta con `registerWhatsAppMessageResponseSchema`. Una respuesta que no pasa la validación se trata como `INVALID_RESPONSE`.

### UC-05 Ver una imagen

```ts
export function viewImage(deps): (companyId: CompanyId, id: NativeMessageId) =>
  Promise<Result<DownloadedImage, StoreError | WhatsAppError | Readonly<{ code: "NOT_FOUND"; message: string }>>>;
export function releaseImage(deps): (id: NativeMessageId) => Promise<Result<void, WhatsAppError>>;
```

`findImage` (filtrado por empresa) → `downloadImage(reference)` → `file://` privado. Al salir de la pantalla se llama `deleteDownloadedImage`. Los errores de la UI son `IMAGE_UNAVAILABLE` (la media expiró en WhatsApp), `IMAGE_DOWNLOAD_FAILED` (se puede reintentar) y `STORAGE_LIMIT_REACHED`.

### UC-06 Desvincular

`whatsapp.logout()`, después `links.end(active.id)`.

- `REMOTE_LOGOUT_UNCONFIRMED`: el vínculo se cierra igual y se avisa que puede quedar visible en "Dispositivos vinculados" del teléfono.
- Los mensajes `pending` de ese vínculo siguen sincronizándose mientras la sesión sea de la misma empresa.
- Los pendientes nativos de la cuenta anterior siguen siendo confirmables y llegan por UC-03 (memoria `947ee8f6`).

### UC-07 Cambios de sesión en Yoyos

| Evento | Acción |
|---|---|
| `signOut` | `sync.stop()`, `reception.stop()` (quita el consumidor), `whatsapp.disconnect()`. No se llama `logout()` ni se borra nada local. |
| `signIn` con la misma empresa del vínculo activo | UC-02 y `sync.wake()` |
| `signIn` con otra empresa | No se conecta. La UI indica que hay un WhatsApp vinculado a otra empresa y solo ofrece desvincular, si el rol lo permite. |

### UC-08 Leer conversaciones y mensajes

```ts
export type ConversationSummary = Readonly<{
  chatId: WhatsAppChatId;
  lastMessage: Readonly<{ preview: string | null; type: "text" | "image"; sentAt: Date | null; direction: "incoming" | "outgoing" }>;
  messageCount: number;
  unsynced: number;
}>;
export type Page = Readonly<{ beforeArrivalSeq: number | null; limit: number }>;
```

- El orden es por `arrival_seq` descendente y **nunca** por `sentAt`, porque la fecha puede faltar.
- Un `sentAt` nulo se muestra como "Fecha desconocida".
- El nombre visible del chat en v1 es el LID abreviado, porque la librería no entrega push name ni teléfono. Una vez sincronizado, se puede enriquecer con el `Contact` de core (fuera de v1).

### UC-09 Errores informativos de la librería

`RECOVERY_BUFFER_FULL`, `HISTORY_LIMIT_REACHED` e `IDENTITY_UNAVAILABLE` llegan por el evento `error` sin cortar la conexión. Se muestran como un aviso no bloqueante en el estado. El resto de errores pasa a `use-whatsapp-status` con `{ state, lastError }`.

## 9. Errores tipados por capa

| Capa | Tipo | Códigos |
|---|---|---|
| Librería | `WhatsAppError` | Los 19 de `types.ts` |
| Composición | `WhatsAppConfigurationError` | El de `whatsapp-options.ts` |
| Dominio | `InboundMessageError`, `SyncHoldReason`, `IdError` | `EMPTY_MESSAGE`, `INVALID_ID`, `UNKNOWN_DATE` |
| Persistencia local | `StoreError` | `LOCAL_STORAGE_FAILED` |
| Red | `TransportError` | Los de `shared/application/transport-error.ts` |
| Casos de uso | Uniones explícitas por caso (sección 8) | No se usan strings libres, y nada se lanza para fallos esperados. |

Las excepciones de `expo-sqlite` se capturan en el adaptador y se traducen a `LOCAL_STORAGE_FAILED`. Los datos originales del error no se propagan, para no filtrar contenido.

## 10. Concurrencia y orden

- La librería entrega **un mensaje a la vez** y espera la confirmación antes del siguiente. UC-03 no necesita cola propia, pero debe resolver siempre (éxito o error) para no frenar la recepción.
- El worker de sincronización y UC-03 escriben filas distintas o columnas distintas de la misma fila. SQLite serializa las transacciones, y `markSynced` usa `WHERE sync_state = 'pending'` para no pisar estados terminales.
- `addListener("messageReceived")` reemplaza al consumidor anterior. Solo `reception-lifecycle.ts` puede registrarlo, y lo hace una sola vez por runtime.

## 11. Seguridad y aislamiento

- **Empresa:** toda consulta de lectura y de sincronización filtra por la `companyId` de la sesión actual. La empresa nunca se deduce del contenido.
- **Datos sensibles:** `image_reference`, el texto y los LID solo existen en SQLCipher. Nunca van a logs, a Sentry ni a core. La clave de la base vive en `expo-secure-store` (memoria `b694155d`).
- **Respaldos:** confirmar que `yoyos-whatsapp.db` queda excluida del backup de Android e iOS, igual que el contenedor nativo. Hoy no está verificado.
- **iOS bloqueado:** la clave de SQLite no se puede leer con el dispositivo bloqueado (memoria `dd8dddf0`). Si UC-03 falla por eso, no confirma y el mensaje se reintenta al desbloquear. Es aceptable en v1, porque iOS no recibe en segundo plano.

## 12. Presentación

| Pantalla | Contenido |
|---|---|
| `whatsapp-link-screen` | Estado de conexión, QR con su cuenta regresiva, botones Vincular, Reintentar y Desvincular, y avisos de UC-09. |
| `conversations-screen` | Lista de `ConversationSummary` con un indicador de "sin sincronizar". |
| `conversation-screen` | Mensajes paginados por `arrival_seq`, imágenes bajo demanda (UC-05) y fecha desconocida visible. |

El hook `use-whatsapp-status()` devuelve:

```ts
type WhatsAppStatus = Readonly<{
  link: "none" | "otherCompany" | "linked";
  connection: ConnectionState;
  qr: Readonly<{ value: string; expiresAt: number }> | null;
  notice: WhatsAppErrorCode | null;
  unsynced: number;
}>;
```

Los estilos usan NativeWind (memoria `c87e38f0`). Los textos van en `translations.ts`.

## 13. Pruebas

Siguen `docs/testing-conventions.md`: cada test va junto al archivo que verifica, con `test("…")` y títulos en inglés como el resto del repositorio. Mobile usa Jest y React Native Testing Library. Core usa Vitest.

- **Unitarias:** dominio con entradas planas, casos de uso con fakes pequeños de los puertos (memoria `bd31d77f`), adaptadores con una frontera HTTP controlada y pantallas con operaciones controladas.
- **Integración:** infraestructura real y aislada. En mobile, SQLite real sobre un archivo temporal por test, porque un fake en memoria no prueba checks, índices únicos ni rollbacks. En core, PostgreSQL de `scripts/run-tests.sh integration`.

Hoy Jest no tiene un SQLite real para los tests de integración de mobile. Prepararlo es parte del paso 4 del plan. Una prueba de mobile con respuestas falsas de core no demuestra el flujo completo mobile → core: eso lo cubre T19.

### 13.1 Unitarias

**T01 · `domain/ids.test.ts` e `inbound-message.test.ts` — identificadores y `fromReceivedMessage`**

- `parseLid accepts <n>@lid and rejects phone JIDs, empty values and other suffixes`
- `native message, delivery and image ids are accepted only with their versioned prefix`
- `maps a text message to text content with branded ids and direction`
- `maps an image with text to image content using the text as caption`
- `maps an image without text to a null caption`
- `keeps null mime type and size when the image omits them`
- `sets sentAt to null when the timestamp is missing instead of using the arrival time`
- `returns EMPTY_MESSAGE when there is neither text nor image`
- `returns INVALID_ID when accountId or chatId is not a LID`

**T02 · `domain/inbound-message.test.ts` — `toRegisterRequest`**

- `builds a text request that passes registerWhatsAppMessageRequestSchema`
- `builds an image request with only caption, mimeType and size`
- `never includes the image download reference, deliveryId or local URIs`
- `sends sentAt as Unix milliseconds`
- `returns UNKNOWN_DATE when sentAt is null`

**T03 · `domain/link.test.ts` — `assignLink`**

- `returns the existing link already assigned to the account`
- `prefers an ended link of the same account over claiming the active one`
- `claims the active link that has no account yet`
- `returns orphan when the active link belongs to another account`
- `returns orphan when there are no links`

**T04 · `domain/sync-policy.test.ts` — clasificación, backoff y transiciones**

- `classifies stored and duplicate responses as synced with the core message id`
- `classifies INVALID_INPUT, PAYLOAD_TOO_LARGE and UNSUPPORTED_MEDIA_TYPE as rejected`
- `classifies UNAUTHENTICATED, COMPANY_REQUIRED, INVALID_COMPANY and EMAIL_VERIFICATION_REQUIRED as session blocked`
- `classifies NETWORK_ERROR, SERVICE_UNAVAILABLE, SERVER_ERROR, RATE_LIMITED and INVALID_RESPONSE as retry`
- `keeps OPERATION_CANCELLED pending without counting an attempt`
- `continues the batch after server errors and stops it after network or rate-limit errors`
- `classifies every TransportError code`
- `doubles the backoff per attempt and caps it at 300 seconds`
- `keeps the jitter within 20 percent of the backoff`
- `allows pending to synced, rejected or pending and held_unknown_date to pending`
- `rejects any transition out of synced, rejected or orphaned`

**T05 · `application/receive-message.test.ts` — UC-03**

- `confirms the delivery only after saveOnce stores the message`
- `does not confirm and returns LOCAL_STORAGE_FAILED when saveOnce fails`
- `does not confirm when the links cannot be read`
- `confirms a duplicate again with its new deliveryId without waking sync`
- `stores once and confirms the redelivery after a failed confirmation`
- `confirms an EMPTY_MESSAGE delivery as invalid without storing it`
- `stores a message of an unknown account as orphaned, confirms it and does not wake sync`
- `stores a message without timestamp as held_unknown_date and does not wake sync`
- `claims the active link with the account of the first message`
- `wakes sync once after storing a pending message`
- `does not log text, image references or full LIDs`

**T06 · `application/sync-messages.test.ts` — UC-04**

- `sends pending messages one at a time in arrival order`
- `marks stored and duplicate responses as synced with the core message id`
- `marks permanent rejections and continues with the next message`
- `schedules a retry with backoff for retryable errors`
- `stops the batch after a network or rate-limit error`
- `never sends messages of another company`
- `leaves the message pending without an attempt when the session generation changes mid-run`
- `stops with SESSION_BLOCKED without changing any message`
- `returns NO_SESSION and sends nothing without a session`
- `runs exactly once more when woken during a run`
- `starts a single run for several wakes while idle`
- `keeps syncing pending messages of an ended link of the same company`
- `stop cancels the scheduled retry`
- `reports synced, retried and rejected counts`

**T07 · `application/reception-lifecycle.test.ts` — UC-02 y UC-07**

- `registers the message consumer before initialize and connect`
- `does not connect without an active link`
- `does not connect when the active link belongs to another company`
- `registers the message consumer only once per runtime across restarts`
- `publishes connectionChanged and error events as status`
- `keeps the connection for informational errors`
- `sign-out stops sync, removes the consumer and disconnects without logout or local deletion`
- `sign-in with the company of the active link starts reception and wakes sync`
- `sign-in with another company does not connect`

**T08 · `application/link-account.test.ts` — UC-01 y UC-06**

- `starts a link for the session company and user and connects`
- `returns NO_SESSION without a session`
- `returns ALREADY_LINKED when an active link exists`
- `ends the new link when initialize or connect fails so linking can be retried`
- `logs out and then ends the active link`
- `ends the link and reports REMOTE_LOGOUT_UNCONFIRMED when remote logout is not confirmed`

**T09 · `application/view-image.test.ts` — UC-05**

- `downloads the image reference found for the session company`
- `returns NOT_FOUND for another company's message or a text message`
- `propagates IMAGE_UNAVAILABLE, IMAGE_DOWNLOAD_FAILED and STORAGE_LIMIT_REACHED`
- `releaseImage deletes the downloaded file`

**T10 · `infrastructure/message-api.test.ts`**

- `posts the request to /api/messages`
- `returns stored for 201 and duplicate for 200 responses`
- `returns INVALID_RESPONSE when the body fails registerWhatsAppMessageResponseSchema`
- `maps 400, 401, 403, 413, 415, 429, 500 and 503 to their TransportError codes`
- `returns NETWORK_ERROR when the request cannot be sent`

**T11 · `presentation/whatsapp-link-screen.test.tsx` y `use-whatsapp-status.test.ts`**

- `shows the QR with its countdown while linking`
- `requests a new QR when the current one expires`
- `shows success when the connection becomes connected`
- `offers relinking when the session expires`
- `shows the other-company notice and offers only unlinking`
- `shows non-blocking notices for RECOVERY_BUFFER_FULL, HISTORY_LIMIT_REACHED and IDENTITY_UNAVAILABLE`
- `shows LOCAL_STORAGE_FAILED as a visible error`
- `warns that the device may stay linked after REMOTE_LOGOUT_UNCONFIRMED`
- `reports none, otherCompany or linked from the active link and the session company`

**T12 · `presentation/conversations-screen.test.tsx` y `conversation-screen.test.tsx` — UC-05 y UC-08**

- `lists conversations with their unsynced indicator`
- `shows the abbreviated LID as the chat name`
- `shows "Fecha desconocida" for a message without date`
- `loads older messages by arrival sequence`
- `loads an image on demand and releases it when leaving the screen`
- `offers retry for IMAGE_DOWNLOAD_FAILED and shows IMAGE_UNAVAILABLE as final`

**T13 · core: `src/features/chats/presentation/mobile-message-routes.test.ts` — sección 2.1**

- `full app parses POST /api/messages before authentication`
- `POST /api/whatsapp/messages returns 404`
- `GET /api/messages falls through to the generic /api 404`

Si se acepta A1, `mobile-message-schemas.test.ts` suma `accepts a request without timestamp` y `still rejects an invalid timestamp`.

### 13.2 Integración

**T14 · `infrastructure/local-database.integration.test.ts` (SQLite real)**

- `upgrades a v1 database to v2 and drops the unused v1 tables`
- `opens an existing v2 database without changes`
- `refuses to open a database with an unknown user_version`
- `rolls back a failed upgrade and leaves user_version at 1`

**T15 · `infrastructure/sqlite-message-store.integration.test.ts` (SQLite real)**

- `saveOnce stores a new message and returns stored`
- `saveOnce returns duplicate with the original row and keeps its sync state`
- `saveOnce claims the link and inserts the message in one transaction`
- `saveOnce leaves the link unclaimed when the insert fails`
- `assigns increasing arrival sequences`
- `rejects text rows without text and image rows without reference`
- `rejects orphaned rows with a link, synced rows without core id and links without company`
- `nextPending returns due pending messages of the company in arrival order up to the limit`
- `markSynced does not overwrite a terminal state`
- `markRetry and markRejected persist attempts, next attempt and error code`
- `listConversations groups by chat for the company with last message, count and unsynced`
- `listMessages pages by arrival sequence and ignores other companies`
- `findImage returns null for another company's message`
- `translates SQLite failures into LOCAL_STORAGE_FAILED without the original data`

**T16 · `infrastructure/sqlite-link-store.integration.test.ts` (SQLite real)**

- `start fails while another link is active`
- `end closes the active link and allows starting a new one`
- `rejects assigning the same account to two links`
- `rejects an account id that is not a LID`

**T17 · `application/message-processing.integration.test.ts` (UC-03 + UC-04 con SQLite real, API y gateway falsos)**

- `a redelivered message after a restart is stored once and sent once`
- `a message received offline is synced once the API recovers`
- `a message received during a rejected sync is not retried`
- `a sign-out during sync leaves the message pending for the next session`

**T18 · core: `src/features/chats/infrastructure/mobile-message-repository.integration.test.ts` (A1)**

Solo si se acepta A1. Verifica el comportamiento del repositorio, no la migración:

- `stores a mobile message without sentAt`
- `rejects a message without sentAt outside mobile rows`
- `deduplicates a mobile message without sentAt by company, chat and WhatsApp id`

**T19 · core: `tests/e2e/mobile-messages.spec.ts`**

- `registers a message with 201 and returns 200 for the duplicate`
- `assigns the company from the session and isolates it from other companies`
- `rejects an image download reference in the body`
- `accepts the request produced by toRegisterRequest`

## 14. Plan de implementación

Un commit por unidad lógica, cada uno con sus pruebas pasando (memoria `4176391a`):

1. Core: renombrar la ruta a `POST /api/messages` con sus tests y docs (sección 2.1, T13 y T19).
2. Resolver A1 en core: `timestamp` opcional y `sentAt` nullable para filas móviles, con su migración (T18). Si se decide posponerlo, se usa `held_unknown_date`.
3. Dominio: `ids.ts`, `inbound-message.ts`, `link.ts`, `sync-policy.ts` (T01–T04).
4. Migración SQLite v2 y adaptadores `sqlite-message-store` y `sqlite-link-store` (T14–T16).
5. UC-03 y `reception-lifecycle` (T05, T07).
6. `message-api` y el worker UC-04 (T06, T10, T17).
7. UC-01 y UC-06 con la pantalla de vinculación y `use-whatsapp-status` (T08, T11).
8. UC-05 y UC-08 con las pantallas de conversaciones (T09, T12, T15).
9. Construir los artefactos (`scripts/build-go.sh android`), hacer un development build y validar en dispositivo.

## 15. Riesgos

| Riesgo | Mitigación |
|---|---|
| La librería nunca corrió en dispositivo. | El paso 9 es requisito antes de dar la feature por terminada. Diseñar la UI con fakes desde el paso 5. |
| Conflicto de `timestamp` con core (A1). | Usar `held_unknown_date` sin pérdida hasta resolverlo. |
| El buffer nativo se llena si UC-03 falla repetidamente. | La custodia es independiente de la red (D2). `LOCAL_STORAGE_FAILED` se muestra en la UI. |
| El runtime JS muere con el servicio vivo en Android (A4). | No se pierden mensajes. Se mide en dispositivo. |
| Push name y teléfono no disponibles. | Se muestra el LID en v1. El contacto se enriquece después desde core. |
| Webhook de Meta Cloud y móvil en paralelo para la misma empresa. | Core ya mantiene identidades separadas (memoria `6e761725`). Unificar los chats es una decisión de producto aparte. |
