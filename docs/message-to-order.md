# Órdenes desde mensajes con código QR

Estado: diseño cerrado, pendiente de implementación. Ningún código, migración ni prueba se ha implementado todavía.

Tareas de implementación: [`message-to-order-tasks.md`](message-to-order-tasks.md).

## 1. Objetivo

Cuando core persiste un mensaje recibido desde la app móvil, publica el evento **`message_created`**. El módulo de órdenes lo escucha y, si la imagen del mensaje contiene QR de productos:

1. Lee los códigos QR de la imagen.
2. Busca las variantes con esos códigos dentro de la empresa.
3. Añade las variantes a la **orden abierta del chat** o, si no hay una, crea una orden asociada al **Customer** del contacto y al **chat** del mensaje.

```text
Customer 1 ── * Contact 1 ── 1 Chat 1 ── * ChatMessage
    │                           │                │
    └──────────── * Order ──────┘ (chatId)       └── OrderMessage (mensajes que alimentaron la orden)
```

### 1.1 Decisiones

| Tema | Decisión |
| --- | --- |
| Base de la rama | `origin/main` ya integrado (`a499dbd`, PR #64): contiene `POST /api/messages`, el productor móvil (`apps/mobile/src/features/whatsapp`) y mensajes sin fecha. |
| Alcance | Core y mobile en esta rama. |
| Imagen | Mobile descarga la imagen, la sube con `POST /api/images` y envía `imageId` en `POST /api/messages`. `imageId` es obligatorio en mensajes de imagen. |
| Privacidad de imágenes | Fuera de alcance; tarea de Todoist «Separar imágenes en buckets R2 privado y público». |
| Evento | Renombrar `whatsapp_message_recorded` a `message_created`. Se mantiene el bus pg-boss y la publicación después del commit. |
| Reintento de publicación | Solo el reintento del POST desde mobile; sin republicador ni encolado transaccional. |
| Fallos del handler | 8 reintentos (~21 min), log de fallo y reproceso manual documentado. |
| Customer | Vive en `features/contacts`. Se crea automáticamente (sin nombre ni teléfono) si el contacto no tiene uno. Órdenes manuales sin customer; sin backfill. |
| Comprador | `OrderBuyer.phone` pasa a ser nullable; la orden de chat siempre crea `OrderBuyer` con el `contactId`. |
| Origen en UI | Las órdenes de chat muestran un icono de WhatsApp (web y mobile). Sin enlace al chat. |
| Vendedor | `sellerId = ChatMessage.uploadedByUserId`; no cambia al añadir ítems. |
| Dirección | Solo mensajes entrantes alimentan órdenes. |
| Códigos | Solo `ProductVariant.qrCode` (lo que imprimen las etiquetas). |
| Varios productos en la foto | Un ítem por variante distinta. |
| Agrupación | Siempre se añade a la orden abierta del chat (§3.5); variante repetida suma 1. |
| Stock | Se añade aunque el stock sea 0. |
| Visibilidad de omisiones y fallos | Solo logs. |
| WhatsApp Cloud API (webhook) | Fuera de alcance; ese camino no publica `message_created`. |
| Lector QR | `zxing-wasm@3.1.5` con el `.wasm` local. |
| Worker en producción | Añadir las variables `R2_*` al servicio `worker` de `compose.prod.yaml`. |

## 2. Estado actual (`a499dbd`)

### 2.1 Lo que existe

| Pieza | Ubicación | Estado |
| --- | --- | --- |
| Registro de mensajes | `POST /api/messages`; `apps/core/src/features/chats/application/register-mobile-message.ts`, `presentation/mobile-message-routes.ts`, `infrastructure/mobile-message-repository.ts` | El repositorio valida cada fila leída con un esquema Zod (`storedRowSchema`, `imageId: z.null()`, imagen solo `metadata_only`) y vuelve a validar la identidad reconstruyendo el request del contrato en `mapMobileMessage`. Persiste el mensaje (`ensureContact` → `ensureChat` → `insertAndRead` con `ON CONFLICT DO NOTHING`), publica después del commit y marca `eventDispatchedAt`. 201 nuevo, 200 duplicado, 503 si falla la persistencia o el bus. |
| Evento | `chats/application/events.ts`, `infrastructure/mobile-message-dispatch.ts` | `whatsapp_message_recorded: { companyId, messageId }`, `eventId` = ID del mensaje. **Sin suscriptores.** |
| Bus | `shared/events/`, `composition/event-bus.ts`, `composition/event-handlers.ts`, `src/worker.ts` | pg-boss; una cola por `subscription.id`; sin suscriptor no se crean jobs. Handlers dentro de `withTenantIsolation`. Único handler: `restore-cancelled-order-stock`. |
| Contrato | `shared/contracts/whatsapp-messages.ts` | Imagen `{ type: "image", caption?, mimeType?, size? }`; `timestamp` opcional. Se guarda `imageStatus = 'metadata_only'`, `imageId = NULL` (CHECK de `20261008064129_adapt_chats_for_mobile_whatsapp`); `sentAt` es nullable para mensajes móviles (`20261010150428_allow_unknown_mobile_message_date`). |
| Productor móvil | `apps/mobile/src/features/whatsapp/` (`infrastructure/message-api.ts`, `application/sync-messages.ts`, `domain/sync-policy.ts`, `infrastructure/local-database.ts`, `application/view-image.ts`) | Outbox SQLite (esquema v2) con reintentos y backoff. `MessageApi.register(message: InboundMessage)`; `classifyFailure` solo recibe `code` y `httpStatus`. Envía `mimeType`/`size`; no sube la imagen (se descarga a demanda para verla). El cliente HTTP no conoce `IMAGE_NOT_FOUND`: llega como `API_ERROR` 404. |
| API de imágenes | `POST /api/images` → `201 { id, url }`; `shared/images/`; cliente móvil en `apps/mobile/src/features/products/infrastructure/product-api.ts` (`uploadImage`) | Guarda en el bucket público (`visibility = public`, `sourceKey = null`; `repository.find` las devuelve). `ImageStorage` solo lee bytes del bucket privado. El cliente móvil fuerza `image/jpeg`. |
| Órdenes | `features/orders/application/create-order.ts`, `domain/order.ts`, `domain/order-state-machine.ts`, `infrastructure/order-repository.ts` | Todas las operaciones que mutan una orden la bloquean con `findOrderForUpdate`. No existe ningún caso de uso que añada ítems a una orden existente. |
| Comprador | `OrderBuyer { contactId?, name?, phone NOT NULL }` | Instantánea al crear; el checkout la sobrescribe con los datos del comprador. Sin buyer → «Público general». |
| Productos | `ProductVariant.qrCode String @unique`, `findSellableVariant(id)` en `products/infrastructure/order-stock.ts` | Las etiquetas codifican el UUID de la variante (QR versión 3, corrección M). No hay búsqueda por `qrCode`. Alcance por RLS. |
| Checkout | `orders/application/checkout.ts` | Bloquea la orden y compara `expectedTotal`; si cambió devuelve `TOTAL_CHANGED` y la página muestra el nuevo total. |

### 2.2 Brechas que cierra este diseño

1. El mensaje no referencia la imagen (`metadata_only`, sin bytes en core).
2. Core no puede leer bytes de imágenes públicas.
3. No existe `Customer` ni `Contact.customerId`.
4. `OrderBuyer.phone` es obligatorio y los contactos de WhatsApp móvil llegan sin nombre ni teléfono.
5. `Order` no tiene relación con `Chat`.
6. No existe un caso de uso para añadir ítems a una orden.
7. El evento lleva el nombre del canal.
8. El worker de producción no tiene las variables `R2_*`.

## 3. Diseño

### 3.1 Evento `message_created`

```ts
// features/chats/application/events.ts
export type MessageCreated = Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>;

declare module "@core/src/shared/events/application/app-events" {
  interface AppEvents {
    message_created: MessageCreated;
  }
}
```

- Renombrar la cadena y el tipo; `dispatchMessageRecorded` conserva su nombre. No hay jobs ni colas que migrar: las colas se nombran por `subscription.id`.
- Parser Zod estricto en `features/chats/infrastructure/event-payloads.ts` (patrón `parseOrderCancelled`):

```ts
const messageCreatedSchema = z.strictObject({ companyId: z.uuid(), messageId: z.uuid() });

export function parseMessageCreated(input: unknown): Result<MessageCreated, EventBusError> {
  const parsed = messageCreatedSchema.safeParse(input);
  return parsed.success
    ? ok({ companyId: parsed.data.companyId as CompanyId, messageId: parsed.data.messageId as ChatMessageId })
    : err({ code: "INVALID_EVENT", message: "Invalid message created payload" });
}
```

#### Entrega y reintento de publicación

| Ventana de fallo | Qué ocurre | Efecto para el vendedor |
| --- | --- | --- |
| Caída del proceso entre commit y publicación | Fila con `eventDispatchedAt = NULL`, sin log. Mobile recibe error de red y reintenta; el duplicado publica y responde 200. | Retraso. |
| Bus caído | Log `mobile_message_event_dispatch_failed`, 503, mobile reintenta. | Retraso. |
| Publica pero falla `markEventDispatched` | 503; el reintento crea un segundo job con el mismo `eventId`, que termina en `already_processed` por la PK de `OrderMessage`. | Nada. |
| Publicación duplicada (dos POST simultáneos) | Dos jobs; uno termina en `already_processed`. | Nada. |
| Mobile pierde su cola local | El evento no se publica. | Añade el producto a mano. |

Decisión: solo reintento del POST desde mobile, que ya reintenta errores de red y 5xx con la misma identidad. Se descartan:

- Republicador periódico: `ChatMessage` tiene `FORCE ROW LEVEL SECURITY`; listar pendientes de todas las empresas exige una función `SECURITY DEFINER` o un rol con privilegios, además de un cron que hoy no existe.
- Encolar el job en la transacción del mensaje: pg-boss lo permite (`send(..., { db })`), pero contradice `docs/event-bus-architecture.md` (el puerto no expone transacciones; la base de jobs puede separarse; el outbox está descartado).

### 3.2 Imagen del mensaje

```text
Mobile (sync worker)
  ├─ ¿mensaje de imagen sin coreImageId?
  │    ├─ downloadImage (WhatsApp) ──→ archivo local
  │    ├─ POST /api/images (multipart, mimeType real) ──→ 201 { id }
  │    ├─ guardar core_image_id en SQLite
  │    └─ deleteDownloadedImage
  └─ POST /api/messages { content: { type: "image", imageId, caption? } }
        └─ core valida la imagen, persiste (imageStatus = ready) y publica message_created
```

Contrato (`shared/contracts/whatsapp-messages.ts`, `version: 1` modificada; no hay builds desplegados):

```ts
z.strictObject({
  type: z.literal("image"),
  imageId: uuidSchema,
  caption: messageTextSchema.optional(),
})
```

`mimeType` y `size` se eliminan del contrato: el registro `Image` conoce el archivo validado. Las columnas `imageMimeType`/`imageSize` se conservan para las filas antiguas. El archivo y los nombres del contrato conservan `whatsapp` porque el cuerpo es específico del canal (LID, `whatsappMessageId`).

Registro en core:

- Antes de insertar, `findImage(imageId)` con el repositorio de imágenes (alcance RLS). Si no existe → **404 `IMAGE_NOT_FOUND`**, igual que productos (`products/application/create.ts`). La FK compuesta `[companyId, imageId]` queda como respaldo.
- Inserta `imageId` con `imageStatus = 'ready'` e `imageMimeType`/`imageSize` en `NULL`.
- `mobile-message-repository.ts`:
  - `storedRowSchema`: `imageId` sale de la base común. Texto: `imageId: z.null()`. Imagen: `metadata_only` con `imageId: z.null()` (filas antiguas) o `ready` con `imageId: z.uuid()` e `imageMimeType`/`imageSize` nulos.
  - `mapMobileMessage` ya no reconstruye el request completo, porque una fila `metadata_only` no cumple el contrato nuevo. El contrato exporta `whatsAppMessageIdentitySchema` (sobre del mensaje sin `content`, con el `superRefine` de identidad) y el mapper valida solo eso; el contenido ya lo valida `storedRowSchema`.
  - `MobileMessage.content` de imagen pasa a `{ type: "image"; caption: string | null; imageId: ImageId | null }`.
- Reintento con otro `imageId`: `ON CONFLICT DO NOTHING` conserva el primero; la imagen nueva queda huérfana (aceptado).

Lectura de bytes para el QR: `ImageStorage.read(key)` (nuevo, `GetObjectCommand` sobre `config.bucket`) y `readImageBytes` en `shared/images/application/images.ts`:

```ts
export type ImageReadError = Readonly<{
  code: "IMAGE_NOT_FOUND" | "IMAGE_STORAGE_UNAVAILABLE" | "PERSISTENCE_UNAVAILABLE";
  message: string;
}>;

/** Lee los bytes de una imagen de la empresa, del bucket público o privado según su visibilidad. */
export async function readImageBytes(
  imageId: string,
  storage: ImageStorage,
  repository: ImageRepository,
): Promise<Result<Readonly<{ bytes: Uint8Array; contentType: string }>, ImageReadError>>;
```

`IMAGE_STORAGE_CONFIG_ERROR` se traduce a `IMAGE_STORAGE_UNAVAILABLE` (reintentable), para que un despliegue mal configurado no descarte mensajes.

### 3.3 Mobile

Cambios en `apps/mobile/src/features/whatsapp`:

| Archivo | Cambio |
| --- | --- |
| `infrastructure/local-database.ts` (+ `.web.ts`, `node-sqlite-database.ts`) | Migración SQLite v3 incremental: v2 → v3 con `ALTER TABLE whatsapp_messages ADD COLUMN core_image_id TEXT` en su propia transacción, sin borrar datos (v1 → v2 sigue igual). `migrateWhatsAppDatabase` acepta 0–3. |
| `infrastructure/sqlite-message-store.ts`, `application/ports.ts` | `saveCoreImageId(id, imageId)`, `clearCoreImageId(id)`; `StoredMessage` expone `coreImageId`. |
| `application/sync-messages.ts` | `SyncWorkerDeps` añade `images: Pick<WhatsAppGateway, "downloadImage" \| "deleteDownloadedImage">` y `uploadImage`. Antes de `api.register`, si es imagen sin `coreImageId`: descargar, subir con `DownloadedImage.mimeType`, guardar `core_image_id`, borrar el archivo local (también si la subida falla). |
| `application/ports.ts`, `infrastructure/message-api.ts` | `register(message: StoredMessage)`; `toRegisterRequest` envía `coreImageId` como `imageId` y deja de enviar `mimeType`/`size` (siguen en SQLite). Imagen sin `coreImageId` → `INVALID_MESSAGE` sin petición. |
| `domain/sync-policy.ts` | `RejectCode` añade `IMAGE_UNAVAILABLE`; `SyncDecision` añade `{ action: "reupload" }` para `API_ERROR` 404 (único 404 de `POST /api/messages`). |
| `composition.ts` | Pasa `deps.gateway` y el cliente de imágenes al sync worker. |

Cliente de imágenes: extraer `uploadImage(request, uri, mimeType)` de `products/infrastructure/product-api.ts` a `apps/mobile/src/shared/infrastructure/image-api.ts` y usarlo desde products y whatsapp, pasando el `mimeType` real de `DownloadedImage` (hoy fuerza `image/jpeg`).

Reglas de reintento:

| Situación | Decisión |
| --- | --- |
| Sin `coreImageId` | Descargar y subir; nunca volver a subir si ya existe. |
| Descarga de WhatsApp expirada o inexistente | `reject` con código nuevo `IMAGE_UNAVAILABLE`. |
| WhatsApp desconectado u otro error de descarga | `retry` con backoff. |
| Subida rechazada (`INVALID_IMAGE` 400, `IMAGE_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415) | `reject`. |
| Error de red o 5xx en subida o registro | `retry` con el mismo payload e `imageId`, con backoff. |
| `404` en el registro (`IMAGE_NOT_FOUND`) | `reupload`: `clearCoreImageId` y `retry`; la siguiente vuelta vuelve a subir. |
| 2xx | `markSynced`. |

Todas las imágenes (entrantes y salientes) se suben, porque el contrato exige `imageId`; solo las entrantes alimentan órdenes. En `docs/whatsapp-mobile-message-processing.md`: D5 sigue vigente (se suben bytes, la referencia nunca sale del teléfono); se quita «Subir los bytes de imágenes a core» de fuera de alcance (línea 27), se añade una decisión nueva (la sincronización descarga cada imagen una vez para subirla) y se actualizan la tabla de mapeo del contrato y los nombres de pruebas.

### 3.4 Lectura del QR

`zxing-wasm@3.1.5` (MIT), importando solo `zxing-wasm/reader`. Es la única opción que lee varios QR por foto sin trucos (`jsqr` lee uno; `@zxing/library` no expone lector múltiple en su API documentada).

- Por defecto descarga el `.wasm` desde jsDelivr: se carga el binario local con `prepareZXingModule({ overrides: { wasmBinary } })`.
- El worker corre con `tsx` y Docker instala `node_modules` completo: no hay que cambiar el Dockerfile. En desarrollo, reconstruir con `docker compose up --build -V` (volumen anónimo de `node_modules`).
- Se decodifica antes con `sharp` a RGBA (el decodificador interno no lee WebP, que `POST /api/images` sí acepta). ZXing lee cualquier orientación y calcula la luminancia: sin `rotate` ni escala de grises.
- Inicialización perezosa: `web` nunca carga el WASM.

```ts
// features/orders/infrastructure/qr-code-reader.ts
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

export type QrCodeReadError = Readonly<{ code: "UNREADABLE_IMAGE" | "QR_READER_UNAVAILABLE"; message: string }>;
export type ReadQrCodes = (
  image: Readonly<{ bytes: Uint8Array; contentType: string }>,
) => Promise<Result<readonly string[], QrCodeReadError>>;

let ready: Promise<unknown> | undefined;
const init = () => (ready ??= readFile(createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm"))
  .then((binary) => prepareZXingModule({
    overrides: { wasmBinary: binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) },
    fireImmediately: true,
  }))
  .catch((cause) => { ready = undefined; throw cause; }));

export const readQrCodes: ReadQrCodes = async ({ bytes }) => {
  try { await init(); } catch { return err({ code: "QR_READER_UNAVAILABLE", message: "QR reader unavailable" }); }
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 24_000_000 })
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const found = await readBarcodes(
      { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height },
      { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 20 },
    );
    return ok(found.filter((result) => result.isValid).map((result) => result.text));
  } catch {
    return err({ code: "UNREADABLE_IMAGE", message: "Unreadable image" });
  }
};
```

### 3.5 Dominio puro

`features/orders/domain/message-order.ts`:

```ts
export type VariantQrCode = string & { readonly __brand: "VariantQrCode" };

export type MessageOrderSkipReason =
  | "not_image"
  | "outgoing_message"
  | "no_qr_code"
  | "unrecognized_qr_code"
  | "product_not_found";

export type ScanSelection =
  | Readonly<{ kind: "codes"; codes: readonly [VariantQrCode, ...VariantQrCode[]] }>
  | Readonly<{ kind: "skip"; reason: "no_qr_code" | "unrecognized_qr_code" }>;

const productCodeSchema = z.uuid(); // QR de pago (Yape/Plin) o URLs no son productos

export function selectProductCode(decoded: readonly string[]): ScanSelection {
  if (!decoded.length) return { kind: "skip", reason: "no_qr_code" };
  const codes = [...new Set(decoded.filter((value) => productCodeSchema.safeParse(value).success))];
  const [first, ...rest] = codes as VariantQrCode[];
  return first ? { kind: "codes", codes: [first, ...rest] } : { kind: "skip", reason: "unrecognized_qr_code" };
}

export function isOpenForMessageItems(order: OrderAggregate, chatId: ChatId): boolean;
```

**Orden abierta** (`isOpenForMessageItems`), definición confirmada:

| Condición | Motivo |
| --- | --- |
| `chatId` es el del mensaje | Las órdenes manuales no reciben ítems automáticos. |
| `status = active` (no cancelada ni completada) | — |
| Sin pagos confirmados ni reportados | Añadir ítems cambiaría un total ya cubierto o reportado. |
| `checkoutConfirmedAt = null` | El cliente ya confirmó otro total. |
| `deliveryStatus = pending` y `stockDeducted = false` | La orden no se preparó ni despachó. |

Una orden con checkout habilitado pero no confirmado sigue abierta: si el total cambia, la confirmación lo detecta bajo bloqueo (`TOTAL_CHANGED`) y la página muestra el nuevo total.

`appendItems(order, variants, newItemId)` en `domain/order-state-machine.ts`:

- Variante ya presente: `quantity + 1` (respeta el único `[companyId, orderId, variantId]`).
- Variante nueva: ítem con cantidad 1 y precio vigente; los ítems existentes conservan su precio.
- Recalcula `itemsTotal` y `total` con las reglas de `buildOrder` (`CURRENCY_MISMATCH`, `INVALID_ORDER`).
- No exige stock.

### 3.6 Caso de uso `addMessageProductsToOrder`

`features/orders/application/add-message-products-to-order.ts`. Las omisiones de negocio son resultados exitosos (el job termina sin reintento); los errores son técnicos o de datos.

```ts
export type OrderSourceMessage = Readonly<{
  id: ChatMessageId;
  companyId: CompanyId;
  chatId: ChatId;
  contactId: ContactId;
  direction: "incoming" | "outgoing";
  uploadedByUserId: UserId;
  imageId: ImageId | null; // null en texto y en filas antiguas metadata_only
}>;

export type MessageCustomer = Readonly<{
  customerId: CustomerId;
  contactId: ContactId;
  name: string | null;  // del contacto
  phone: string | null; // del contacto
}>;

export type AddMessageProductsOutcome =
  | Readonly<{ kind: "order_created"; orderId: OrderId; variantIds: readonly VariantId[]; unknownCodes: readonly VariantQrCode[] }>
  | Readonly<{ kind: "items_added"; orderId: OrderId; variantIds: readonly VariantId[]; unknownCodes: readonly VariantQrCode[] }>
  | Readonly<{ kind: "already_processed"; orderId: OrderId }>
  | Readonly<{ kind: "skipped"; reason: MessageOrderSkipReason }>;

export type AddMessageProductsError = Readonly<{
  code:
    | "PERSISTENCE_UNAVAILABLE"
    | "IMAGE_STORAGE_UNAVAILABLE"
    | "QR_READER_UNAVAILABLE"
    | "MESSAGE_NOT_FOUND"
    | "IMAGE_NOT_FOUND"
    | "CONTACT_NOT_FOUND"
    | "SELLER_UNAVAILABLE"
    | "CURRENCY_MISMATCH"
    | "INVALID_ORDER";
  message: string;
}>;

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type ContactNotFound = Readonly<{ code: "CONTACT_NOT_FOUND"; message: string }>;
type MessageAlreadyProcessed = Readonly<{ code: "MESSAGE_ALREADY_PROCESSED"; message: string }>;

export type OrderChatSource = Readonly<{ chatId: ChatId; customerId: CustomerId }>;

export type AddMessageProductsDependencies = Readonly<{
  findSourceMessage: (id: ChatMessageId) => Promise<Result<OrderSourceMessage | null, PersistenceError>>;
  readImage: (imageId: ImageId) => Promise<Result<Readonly<{ bytes: Uint8Array; contentType: string }>, ImageReadError>>;
  readQrCodes: ReadQrCodes;
  findVariantsByCodes: (codes: readonly VariantQrCode[]) => Promise<Result<readonly (CatalogItem & { qrCode: VariantQrCode })[], PersistenceError>>;
  findProcessedMessage: (messageId: ChatMessageId) => Promise<Result<OrderId | null, PersistenceError>>;
  transaction: <T>(
    companyId: CompanyId,
    work: () => Promise<Result<T, AddMessageProductsError>>,
  ) => Promise<Result<T, AddMessageProductsError>>;
  // Las siguientes requieren transacción activa.
  ensureCustomerForContact: (contactId: ContactId) => Promise<Result<MessageCustomer, PersistenceError | ContactNotFound>>;
  findOpenChatOrderCandidate: (chatId: ChatId) => Promise<Result<OrderId | null, PersistenceError>>;
  findOrderForUpdate: (orderId: OrderId) => Promise<Result<OrderAggregate | null, PersistenceError>>;
  allocateNumber: (companyId: CompanyId) => Promise<Result<OrderNumber, PersistenceError>>;
  saveNewOrder: (order: OrderAggregate, source: OrderChatSource) => Promise<Result<null, PersistenceError>>;
  saveAddedItems: (order: OrderAggregate, previous: OrderAggregate) => Promise<Result<null, PersistenceError>>;
  recordProcessedMessage: (orderId: OrderId, messageId: ChatMessageId) => Promise<Result<null, PersistenceError | MessageAlreadyProcessed>>;
  newOrderId: () => OrderId;
  newItemId: () => OrderItemId;
  clock: () => Date;
}>;

export async function addMessageProductsToOrder(
  input: Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>,
  deps: AddMessageProductsDependencies,
): Promise<Result<AddMessageProductsOutcome, AddMessageProductsError>>;
```

Flujo:

1. Mensaje ya procesado (`findProcessedMessage`) → `already_processed`.
2. Cargar el mensaje. Sin `imageId` → `not_image`; saliente → `outgoing_message`.
3. **Fuera de la transacción:** leer bytes, decodificar QR, `selectProductCode`, `findVariantsByCodes` (una consulta). Ninguna variante → `product_not_found`; códigos no encontrados → `unknownCodes` en el log.
4. **Dentro de la transacción** (orden de bloqueo siempre contacto → orden; ninguna operación existente bloquea en sentido inverso):
   1. `ensureCustomerForContact`: bloquea el contacto (serializa los mensajes del chat), devuelve su customer o crea uno vacío y actualiza `Contact.customerId`.
   2. Repetir `findProcessedMessage`.
   3. `findOpenChatOrderCandidate(chatId)` → `findOrderForUpdate(id)` (serializa frente a pagos, entrega, stock, cancelación y checkout) → `isOpenForMessageItems`.
      - Abierta → `appendItems` → `saveAddedItems`.
      - Sin candidata o ya no abierta → `allocateNumber` → `buildPendingOrder` (un ítem por variante, `sellerId = uploadedByUserId`, comprador = contacto con `phone` nullable) → `saveNewOrder`.
   4. `recordProcessedMessage`; `MESSAGE_ALREADY_PROCESSED` → revertir y `already_processed`.

Si se anula el pago de una orden antigua, pueden quedar dos órdenes abiertas en el chat: se usa la más reciente.

Comprador: `OrderCustomer.contact.phone` pasa a `string | null` y `buildOrder` acepta `null` (sin variante nueva). La orden de chat siempre crea `OrderBuyer { contactId, name, phone }` con los datos del contacto (normalmente nulos). El checkout ya exige un teléfono válido al confirmar y completa la instantánea. `findContactById` y `searchSaleContacts` mantienen su filtro de teléfono, así los contactos sin datos no aparecen en ventas manuales.

Adaptador de handler: `PERSISTENCE_UNAVAILABLE`, `IMAGE_STORAGE_UNAVAILABLE` y `QR_READER_UNAVAILABLE` son `retryable`; el resto es permanente.

### 3.7 Registro del handler y dependencias

```ts
// apps/core/src/composition/event-handlers.ts
const addMessageProductsToOrder = defineEventHandler<AppEvents, "message_created">(
  "message_created",
  (payload, metadata, context) => addMessageProductsHandler(payload, metadata, context),
  { id: "add-message-products-to-order", parsePayload: parseMessageCreated, policy: { concurrency: 2, retries: 8 } },
);

export const eventHandlers: AnyEventSubscription<AppEvents>[] = [restoreCancelledStock, addMessageProductsToOrder];
```

- Importar el parser desde `features/chats/infrastructure/event-payloads.ts`, no desde `chats/index.ts` (evita el ciclo `event-handlers → chats/index → mobile-message-dispatch → composition/event-bus → event-handlers`).
- Dependencias: `orders → chats, products, contacts, shared/images`. `chats` nunca importa `orders`.

### 3.8 Funciones de repositorio

| Feature | Función | Notas |
| --- | --- | --- |
| chats | `findOrderSourceMessage(messageId)` | Mensaje + chat + `contactId`. Exportada en `chats/index.ts`. |
| chats | `insertAndRead` (modificada) | Inserta `imageId` con `ready`; la comprobación previa de la imagen está en la aplicación. |
| products | `findSellableVariantsByQrCodes(codes)` | `where: { qrCode: { in }, status: "active", product: { status: "active" } }`, alcance por RLS como `findSellableVariant`; mapper `toCatalogItem` compartido; devuelve `qrCode`. |
| contacts | `ensureCustomerForContact(contactId)` | `withLockedForUpdate` sobre `Contact`; crea `Customer` vacío si falta y actualiza `customerId`. |
| orders | `findProcessedMessage(messageId)` | `OrderMessage` por `[companyId, messageId]`. |
| orders | `findOpenChatOrderCandidate(chatId)` | ID de la orden más reciente del chat que pasa el filtro SQL de §3.5. |
| orders | `findOrderForUpdate(orderId)` | Existente; se reutiliza. |
| orders | `saveAddedItems(order, previous)` | Inserta ítems nuevos, actualiza cantidades, subtotales, `itemsTotal` y `total`. |
| orders | `savePendingOrder(order, source?)` | Escribe también `customerId` y `chatId`. |
| orders | `recordProcessedMessage(orderId, messageId)` | Mapea la violación de la PK de `OrderMessage` a `MESSAGE_ALREADY_PROCESSED`. |
| orders | `findOrderAggregates` | Quita el guard `!row.buyer.phone`; la búsqueda funciona con `phone` NULL. |

### 3.9 Icono de WhatsApp en la orden

- `orderAggregateSchema` y `orderSchema` (`shared/contracts/orders.ts`) añaden `source: "manual" | "whatsapp"`, derivado de `chatId != null`.
- `orderBuyerSchema.phone` y la variante `contact` del customer de orden (`shared/contracts/orders.ts`, líneas 15 y 17) pasan a `z.string().nullable()`; también `buyer.phone` en `shared/contracts/order-checkout.ts`. `orderContactsSchema` no cambia (los contactos sin teléfono no se listan).
- Web (`apps/core/app/routes/order-list.tsx`, `order-detail.tsx`) y mobile (`order-history-screen.tsx`, `order-detail-screen.tsx`): icono de WhatsApp con etiqueta accesible «WhatsApp» cuando `source = "whatsapp"`. El comprador se muestra como `name ?? phone`; si ambos son nulos solo se ve el icono. «Público general» queda reservado a órdenes sin `OrderBuyer`. Ocultar el teléfono cuando es `null`.
- Sin enlace al chat (no existe pantalla de chat en web).

## 4. Cambios en Prisma

```prisma
model Customer {
  id        String    @id @db.Uuid
  companyId String    @default(dbgenerated("(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid")) @db.Uuid
  company   Company   @relation(fields: [companyId], references: [id])
  createdAt DateTime
  contacts  Contact[]
  orders    Order[]

  @@unique([companyId, id])
}

model Contact {
  customerId String?   @db.Uuid
  customer   Customer? @relation(fields: [companyId, customerId], references: [companyId, id], onDelete: Restrict, onUpdate: NoAction)

  @@index([companyId, customerId])
}

model Order {
  customerId String?        @db.Uuid
  customer   Customer?      @relation(fields: [companyId, customerId], references: [companyId, id], onDelete: Restrict, onUpdate: NoAction)
  chatId     String?        @db.Uuid
  chat       Chat?          @relation(fields: [companyId, chatId], references: [companyId, id], onDelete: Restrict, onUpdate: NoAction)
  messages   OrderMessage[]

  @@index([companyId, chatId])
}

model OrderMessage {
  companyId String      @default(dbgenerated("(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid")) @db.Uuid
  orderId   String      @db.Uuid
  order     Order       @relation(fields: [companyId, orderId], references: [companyId, id], onDelete: Cascade, onUpdate: NoAction)
  messageId String      @db.Uuid
  message   ChatMessage @relation(fields: [companyId, messageId], references: [companyId, id], onDelete: Restrict, onUpdate: NoAction)
  createdAt DateTime

  @@id([companyId, messageId])
  @@index([companyId, orderId])
}

model OrderBuyer {
  phone String? // antes obligatorio
}

model ChatMessage {
  orderMessages OrderMessage[] // relación inversa; imageId e image (FK compuesta) ya existen
}
```

Nuevo CHECK de la rama móvil (desde la línea 52 de `20261008064129_adapt_chats_for_mobile_whatsapp/migration.sql`; la rama Cloud API se copia sin cambios). `"imageId" IS NULL` sale de la parte común y pasa a cada rama. Las comparaciones de `sentAt` aceptan `NULL` (un CHECK solo falla con `false`) y `ChatMessage_sentAt_required_outside_mobile_check` de `20261010150428` no se toca:

```sql
  ) OR (
    "whatsappMessageId" IS NOT NULL AND octet_length("whatsappMessageId") BETWEEN 1 AND 512
    AND octet_length("externalId") BETWEEN 1 AND 4096
    AND "uploadedByUserId" IS NOT NULL AND "uploadedByUserId" <> ''
    AND "userId" IS NULL AND "whatsappMediaId" IS NULL
    AND "imageFailureCode" IS NULL AND "imageFailureMessage" IS NULL
    AND "sentAt" >= TIMESTAMP '1970-01-01' AND "sentAt" <= TIMESTAMP '9999-12-31 23:59:59.999'
    AND ("imageSize" IS NULL OR "imageSize" BETWEEN 0 AND 9007199254740991)
    AND ("imageMimeType" IS NULL OR "imageMimeType" ~ '^image/[A-Za-z0-9!#$&^_.+-]+$')
    AND (
      ("type" = 'text' AND "text" IS NOT NULL AND octet_length("text") BETWEEN 1 AND 65536
        AND "caption" IS NULL AND "imageId" IS NULL AND "imageStatus" IS NULL AND "imageMimeType" IS NULL AND "imageSize" IS NULL)
      OR ("type" = 'image' AND "text" IS NULL AND ("caption" IS NULL OR octet_length("caption") BETWEEN 1 AND 65536)
        AND (
          ("imageStatus" = 'metadata_only' AND "imageId" IS NULL)
          OR ("imageStatus" = 'ready' AND "imageId" IS NOT NULL AND "imageMimeType" IS NULL AND "imageSize" IS NULL)
        ))
    )
  )
```

Notas de migración (`.agents/skills/database-migrations/SKILL.md`):

- Generar con `pnpm --dir apps/core exec prisma migrate dev --create-only --name order_message_source`.
- `BEGIN; SET LOCAL lock_timeout = '5s'; … COMMIT;`.
- Columnas nuevas nulas y `OrderBuyer.phone DROP NOT NULL`: solo metadatos.
- FK con `NOT VALID` y `VALIDATE CONSTRAINT` aparte.
- `Customer` y `OrderMessage`: tabla, default de `companyId`, `ENABLE`/`FORCE ROW LEVEL SECURITY` y política de aislamiento en la misma transacción.
- CHECK: `DROP CONSTRAINT` + `ADD CONSTRAINT … NOT VALID`; `VALIDATE` aparte.
- Sin backfill: las filas `metadata_only` se conservan y se omiten (`not_image`); órdenes y contactos existentes quedan sin customer.
- No hay índice único de «una orden abierta por chat»: depende de pagos y checkout en otras tablas; lo garantizan los bloqueos.

## 5. Archivos

### Crear

- `apps/core/src/features/orders/domain/message-order.ts` + test
- `apps/core/src/features/orders/application/add-message-products-to-order.ts` + `.test.ts` + `.integration.test.ts`
- `apps/core/src/features/orders/infrastructure/qr-code-reader.ts` + test + fixtures JPEG y WebP (un QR, dos QR, ninguno, QR no UUID, etiqueta real)
- `apps/core/src/features/chats/infrastructure/event-payloads.ts`
- `apps/mobile/src/shared/infrastructure/image-api.ts` + test
- Migración Prisma generada por la CLI
- Pruebas nuevas de §7: `chats/infrastructure/event-payloads.test.ts`, `orders/composition.test.ts`, `composition/event-handlers.integration.test.ts`, `apps/core/tests/e2e/message-to-order.spec.ts`

### Modificar — core

- `apps/core/prisma/schema.prisma`
- `shared/contracts/whatsapp-messages.ts` (`imageId`, `whatsAppMessageIdentitySchema`), `shared/contracts/orders.ts` (`source`, `phone` nullable), `shared/contracts/order-checkout.ts`
- `chats`: `application/events.ts`, `register-mobile-message.ts` (comprobación de imagen), `store-mobile-message.ts`, `domain/message.ts`, `domain/mobile-message.ts`, `infrastructure/mobile-message-dispatch.ts`, `mobile-message-repository.ts` (`storedRowSchema`, `mapMobileMessage`) + integración, `chat-repository.ts`, `presentation/mobile-message-routes.ts` (404 `IMAGE_NOT_FOUND`), `mobile-message-schemas.ts`, `index.ts` y pruebas (`mobile-message-types.test.ts`, `mobile-message-dispatch(.integration).test.ts`)
- `contacts`: `domain/contact.ts` (`CustomerId`), `infrastructure/contact-repository.ts` + integración, `index.ts`
- `orders`: `domain/order.ts` (`phone` nullable), `domain/order-state-machine.ts` (`appendItems`) + tests, `domain/checkout.ts`, `application/read-orders.ts`, `infrastructure/order-repository.ts` + integración, `composition.ts`, `index.ts`
- `products`: `infrastructure/order-stock.ts`, `index.ts`
- `shared/images`: `application/images.ts` (`read`, `readImageBytes`) + `images.test.ts` (fake), `infrastructure/r2-image-storage.ts` + test, `index.ts`
- `composition/event-handlers.ts` + test; `composition/event-bus.ts` (log de publicación con `messageId`)
- `apps/core/app/routes/order-list.tsx`, `order-detail.tsx`, `apps/core/app/locales.ts`
- `apps/core/package.json` + lockfile (`zxing-wasm@3.1.5`)
- `compose.prod.yaml`: variables `R2_*` en el servicio `worker`

### Modificar — mobile

- `features/whatsapp`: `infrastructure/local-database.ts` (+ `.web.ts`, `node-sqlite-database.ts`), `sqlite-message-store.ts`, `message-api.ts`, `application/ports.ts`, `sync-messages.ts`, `domain/sync-policy.ts`, `domain/stored-message.ts`, `composition.ts` y sus tests, incluidos `message-processing.integration.test.ts` y `sqlite-message-store.integration.test.ts`
- `features/products/infrastructure/product-api.ts` (usa el cliente compartido)
- `features/orders/presentation/order-history-screen.tsx`, `order-detail-screen.tsx`, traducciones

### Documentación

- `docs/whatsapp-mobile-message-processing.md` (fuera de alcance, decisión nueva, mapeo del contrato; D5 sin cambios)
- `docs/event-bus-quick-start.md` (ya hay eventos de negocio)
- Runbook de §6.1

## 6. Casos borde

| Caso | Comportamiento |
| --- | --- |
| Mensaje de texto o fila antigua `metadata_only` | `not_image`. |
| Mensaje saliente | `outgoing_message`. |
| `imageId` inexistente o de otra empresa en el POST | 404 `IMAGE_NOT_FOUND`, sin evento; mobile vuelve a subir. |
| Imagen inaccesible al procesar | `IMAGE_NOT_FOUND`, permanente, log de fallo. |
| Sin QR / QR no UUID (Yape, Plin, URL) | `no_qr_code` / `unrecognized_qr_code`. |
| Mismo código repetido en la foto | Un ítem, cantidad 1. |
| Varios productos | Un ítem por variante. |
| Algunos códigos existen y otros no | Se añaden los encontrados; `unknownCodes` en el log. |
| Ningún código existe, inactivo o de otra empresa | `product_not_found` (RLS oculta lo ajeno). |
| Variante ya en la orden abierta | `quantity + 1`. |
| Orden con pago, checkout confirmado, stock descontado, despachada o cancelada | No está abierta: orden nueva. |
| Checkout habilitado y no confirmado | Se añaden ítems; la confirmación devuelve `TOTAL_CHANGED` si el total cambió. |
| Pago, cancelación o confirmación simultáneos | Bloqueo de la orden: la operación que llega después ve el estado final. |
| Moneda distinta a la orden abierta | `CURRENCY_MISMATCH`, permanente. |
| Precio cambió desde el último ítem | Ítems existentes conservan su precio. |
| Sin stock | Se añade igual. |
| Contacto sin customer | Se crea y vincula en la misma transacción. |
| Dos fotos del mismo chat a la vez | Bloqueo del contacto: un customer, una orden, ambos productos. |
| Evento duplicado o reproceso | PK de `OrderMessage` → `already_processed`; no suma dos veces. |
| `uploadedByUserId` ya no pertenece a la empresa | `SELLER_UNAVAILABLE`, permanente. |
| R2, base de datos o WASM caídos | Reintentable; 8 reintentos con backoff (~21 min). |
| Orden con ítems añadidos | No se reordena en la lista; sigue visible en «Por cobrar». |
| Descarga de WhatsApp expirada en mobile | `reject` `IMAGE_UNAVAILABLE`; el mensaje no llega a core. |
| Se pierde la respuesta del upload | Imagen huérfana, aceptada. |
| Payload inválido en la cola | Falla permanente. |

### 6.1 Logs y operación

Logs (`docs/logging-conventions.md`): `orders_message_order_created`, `orders_message_order_items_added`, `orders_message_order_skipped` y `orders_message_order_failed`, con `{ companyId, messageId, eventId, orderId?, reason | code, retryable?, attempt, durationMs }`. Sin bytes, teléfonos, IDs de WhatsApp ni texto decodificado distinto del código.

Reproceso de jobs fallidos (seguro por la PK de `OrderMessage`; los errores permanentes requieren corregir antes los datos; un reproceso tardío puede ir a otra orden abierta):

```sql
SELECT id, data->'metadata'->>'eventId' AS message_id, output->>'message', completed_on
FROM pgboss.job
WHERE name = 'add-message-products-to-order' AND state = 'failed';
```

Luego `boss.retry('add-message-products-to-order', jobId)` (`docs/event-bus-architecture.md`). Repetir el POST no sirve porque `eventDispatchedAt` ya está marcado.

## 7. Plan de pruebas

Títulos de las pruebas, escritas antes de implementar (TDD). Siguen el estilo del repositorio: en inglés y colocadas junto al archivo que prueban.

### 7.1 Unitarias — core (Vitest)

`features/chats/infrastructure/event-payloads.test.ts`

- parses a message_created payload with company and message ids
- rejects a payload with extra fields, missing ids or non-UUID ids as INVALID_EVENT

`features/chats/presentation/mobile-message-schemas.test.ts`

- accepts an image message with imageId and an optional caption
- rejects an image message without imageId or with a non-UUID imageId
- rejects mimeType and size in image content
- whatsAppMessageIdentitySchema validates the message identity without content

`features/chats/application/register-mobile-message.test.ts`

- registers an image message after confirming its imageId exists
- returns IMAGE_NOT_FOUND without storing or publishing when the image does not exist
- does not look up images for text messages
- publishes message_created with the message id as eventId

`features/chats/presentation/mobile-message-routes.test.ts`

- responds 404 IMAGE_NOT_FOUND with no-store when the image does not exist

`features/chats/infrastructure/mobile-message-dispatch.test.ts`

- publishes message_created after the commit and then marks the message dispatched

`shared/images/application/images.test.ts`

- readImageBytes returns the bytes and content type of a public image
- readImageBytes reads a private image from its storage key
- returns IMAGE_NOT_FOUND when the company has no such image
- returns IMAGE_NOT_FOUND when the stored object is missing
- maps storage configuration errors to IMAGE_STORAGE_UNAVAILABLE
- maps repository failures to PERSISTENCE_UNAVAILABLE

`shared/images/infrastructure/r2-image-storage.test.ts`

- read gets the object from the public bucket with its bytes and content type
- read reports a missing key as not found and network failures as unavailable

`features/orders/infrastructure/qr-code-reader.test.ts`

- reads the variant UUID from a printed label photo
- reads two QR codes from one photo
- reads a QR code from a WebP image
- returns no codes for a photo without QR codes
- returns non-UUID QR text unchanged
- returns UNREADABLE_IMAGE for bytes that are not an image or exceed the pixel limit
- returns QR_READER_UNAVAILABLE when the WASM module cannot load and retries loading on the next call

`features/orders/domain/message-order.test.ts`

- selectProductCode skips with no_qr_code when nothing was decoded
- selectProductCode skips with unrecognized_qr_code when no decoded value is a UUID
- selectProductCode keeps only UUID codes without duplicates in reading order
- an active pending order of the message chat without payments is open
- a manual order or an order of another chat is not open
- cancelled and completed orders are not open
- an order with a confirmed or reported payment is not open
- an order with a confirmed checkout is not open
- a dispatched order or one with deducted stock is not open
- an order with checkout enabled but not confirmed is still open

`features/orders/domain/order-state-machine.test.ts`

- appendItems adds a new variant with quantity 1 at its current price
- appendItems increments the quantity of a variant already in the order
- appendItems keeps the price of existing items when the catalog price changed
- appendItems recalculates items total and total including delivery
- appendItems rejects a variant in another currency with CURRENCY_MISMATCH
- appendItems rejects totals beyond the money limit with INVALID_ORDER
- appendItems adds variants without stock

`features/orders/domain/order.test.ts`

- builds an order whose contact buyer has no name or phone

`features/orders/application/add-message-products-to-order.test.ts`

- creates an order for the contact's customer and chat with one item per variant and the uploader as seller
- adds the scanned variants to the chat's open order
- increments the quantity of a variant already in the open order
- creates a new order when the candidate is no longer open after locking it
- creates the customer when the contact has none
- adds the codes found and reports the unknown ones
- skips text and metadata_only messages as not_image without reading images
- skips outgoing messages as outgoing_message
- skips photos without QR codes as no_qr_code
- skips photos with only non-product QR codes as unrecognized_qr_code
- skips as product_not_found when no code matches a sellable variant
- returns already_processed before reading the image
- returns already_processed when the message was processed while waiting for the lock
- rolls back and returns already_processed when recording the message hits its key
- reads the image and QR codes before opening the transaction
- fails with MESSAGE_NOT_FOUND, IMAGE_NOT_FOUND, CONTACT_NOT_FOUND or SELLER_UNAVAILABLE without writing
- propagates PERSISTENCE_UNAVAILABLE, IMAGE_STORAGE_UNAVAILABLE and QR_READER_UNAVAILABLE

`features/orders/composition.test.ts` (handler adapter)

- treats persistence, image storage and QR reader failures as retryable
- treats every other error as permanent
- logs created, items added, skipped and failed outcomes with ids and without bytes, phones or decoded text

`composition/event-handlers.test.ts`

- registers add-message-products-to-order for message_created with concurrency 2 and 8 retries
- parses its payload with parseMessageCreated

`features/orders/presentation/order-contracts.test.ts` and `checkout-contracts.test.ts`

- accepts orders whose buyer and contact customer have a null phone
- derives source whatsapp for chat orders and manual otherwise
- accepts a checkout buyer with a null phone

### 7.2 Unitarias — mobile (Jest)

`features/whatsapp/domain/sync-policy.test.ts`

- decides reupload for API_ERROR 404 on registration
- rejects an expired or missing WhatsApp image with IMAGE_UNAVAILABLE
- retries with backoff when WhatsApp is disconnected or the download fails
- rejects uploads refused with INVALID_IMAGE, IMAGE_TOO_LARGE or UNSUPPORTED_MEDIA_TYPE
- retries with backoff on network errors and 5xx during upload

`features/whatsapp/application/sync-messages.test.ts`

- downloads, uploads with the real mimeType, saves coreImageId and registers an image message
- does not download or upload again when coreImageId exists
- deletes the downloaded file after a successful upload and after a failed one
- registers text messages without touching images
- uploads outgoing images too
- clears coreImageId on 404 so the next run uploads again
- rejects an expired WhatsApp image without registering it
- leaves the message pending when WhatsApp is disconnected
- retries a failed registration with the same imageId

`features/whatsapp/infrastructure/message-api.test.ts`

- sends coreImageId as imageId without mimeType or size
- returns INVALID_MESSAGE without a request for an image without coreImageId

`shared/infrastructure/image-api.test.ts`

- uploads the file as multipart with the given mimeType and returns the image id
- maps 400, 413 and 415 to INVALID_IMAGE, IMAGE_TOO_LARGE and UNSUPPORTED_MEDIA_TYPE

`features/products/infrastructure/product-api.test.ts`

- uploads product photos through the shared image client

`features/whatsapp/infrastructure/local-database.test.ts`

- migrates v2 to v3 adding core_image_id without dropping tables
- creates v3 from an empty database
- rejects versions above 3

`features/orders/presentation/order-history-screen.test.tsx` and `order-detail-screen.test.tsx`

- shows the WhatsApp icon with the accessible label "WhatsApp" for chat orders
- shows the buyer as name or phone and hides a missing phone
- shows only the icon when the buyer has no name or phone

### 7.3 Integración

Core (PostgreSQL, rol `core_app`). El caso de uso usa la base real con fakes para la lectura de imagen y QR.

`features/chats/infrastructure/mobile-message-repository.integration.test.ts`

- stores an image message with its imageId as ready without mimeType or size
- reads legacy metadata_only rows with and without sentAt
- rejects a ready image without imageId and a text message with imageId
- a repeated registration with another imageId keeps the first image

`features/chats/infrastructure/mobile-message-dispatch.integration.test.ts`

- an image of another company is IMAGE_NOT_FOUND and publishes nothing
- a registered image message publishes message_created once with the message id as eventId

`features/products/infrastructure/repository.integration.test.ts`

- findSellableVariantsByQrCodes returns active variants with price, currency and qrCode
- findSellableVariantsByQrCodes omits inactive variants and variants of inactive products
- findSellableVariantsByQrCodes does not see variants of another company

`features/contacts/infrastructure/contact-repository.integration.test.ts`

- ensureCustomerForContact creates and links an empty customer
- ensureCustomerForContact returns the existing customer without creating another
- two concurrent calls create one customer
- returns CONTACT_NOT_FOUND for a contact of another company

`features/orders/infrastructure/order-repository.integration.test.ts`

- saves a chat order with customerId, chatId and a buyer without phone
- findOpenChatOrderCandidate returns the most recent open order of the chat
- findOpenChatOrderCandidate ignores manual orders, other chats and orders that are not open
- saveAddedItems inserts new items and updates quantities and totals
- findProcessedMessage returns the order of a processed message
- recordProcessedMessage maps a repeated message to MESSAGE_ALREADY_PROCESSED
- lists, filters and searches orders whose buyer has no phone
- composite foreign keys reject a chat, customer or message of another company
- tenant isolation hides customers and order messages of another company

`features/orders/application/add-message-products-to-order.integration.test.ts`

- an incoming label photo creates an order for the contact's new customer linked to the chat
- a second photo in the same chat adds its variant to the same order
- the same variant photographed twice increments its quantity
- a photo after a payment creates a new order
- two concurrent photos of the same chat create one customer and one order with both products
- the same message processed twice or concurrently does not duplicate quantities
- a payment concurrent with a photo never adds items to a paid order
- a cancellation concurrent with a photo puts the items in a new order
- confirming checkout with the old total after items were added returns TOTAL_CHANGED
- a seller removed from the company fails with SELLER_UNAVAILABLE and writes nothing
- a failure inside the transaction rolls back customer, order and items

`composition/event-handlers.integration.test.ts`

- a published message_created runs add-message-products-to-order with tenant isolation
- a retryable failure is retried and a permanent failure leaves the job failed

Mobile (Jest con SQLite real):

`features/whatsapp/application/message-processing.integration.test.ts`

- a received image is downloaded, uploaded and registered with its imageId
- an image uploaded before a restart is registered without uploading again
- a 404 on registration uploads the image again and then syncs
- an expired WhatsApp image is rejected and never registered

`features/whatsapp/infrastructure/sqlite-message-store.integration.test.ts`

- saves and clears coreImageId

`features/whatsapp/infrastructure/local-database.integration.test.ts`

- a v2 database with pending messages opens as v3 without losing them

### 7.4 E2E — happy path

`apps/core/tests/e2e/message-to-order.spec.ts`. Usa el bus real y el lector QR real con la foto de una etiqueta impresa.

- an incoming label photo from mobile creates a WhatsApp order with the variant, visible in the order list and detail
- a second label photo in the same chat adds its variant to the same order and updates the total
- mobile order history shows the WhatsApp order with its icon

### 7.5 Pruebas existentes a actualizar

- `tests/e2e/mobile-messages.spec.ts` (E01–E03) y `mobile-message-repository.integration.test.ts`: los mensajes de imagen ahora envían `imageId`.
- Pruebas que esperan `whatsapp_message_recorded`: pasan a `message_created`.
- No se prueban los archivos de migración.

Comandos: `pnpm --dir apps/core test:unit`, `sh scripts/run-tests.sh integration` y `e2e` (desde `apps/core`), `pnpm --dir apps/mobile test`, y `lint` y `typecheck` en ambas apps.

## 8. Preguntas abiertas

Ninguna.
