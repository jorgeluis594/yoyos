# API para registrar mensajes de WhatsApp recibidos desde el móvil

Estado: especificación de implementación; API, migración y pruebas todavía pendientes de ejecución. Este entregable es exclusivamente documental.

## 1. Objetivo y decisiones

Implementar `POST /api/whatsapp/messages` en core para recibir un mensaje individual de la app móvil, validarlo, persistirlo bajo la empresa autenticada y hacer dispatch de `whatsapp_message_recorded` después del commit. El éxito HTTP confirma persistencia y aceptación del dispatch por el bus. No confirma ejecución de un consumidor.

Incluye texto, imágenes con o sin caption, ambas direcciones, mensajes históricos y repeticiones. La imagen se registra como contenido de tipo imagen con sus metadatos disponibles: este endpoint no sube ni descarga su archivo. La referencia de descarga, que contiene material de descifrado, permanece en el móvil. Una respuesta exitosa no autoriza al móvil a eliminar esa referencia o el archivo pendiente de subida.

Quedan fuera la implementación del consumidor Expo, la cola móvil, el módulo Go, vinculación de cuentas, descarga/subida de archivos, asociación de contactos a clientes comerciales, análisis de conversaciones, ventas, pantallas y cualquier handler del evento. Tampoco se implementará sincronización bidireccional, edición, eliminación, grupos ni recepción de otros contenidos.

Decisiones de esta propuesta:

- Un mensaje por petición; sin lotes ni confirmaciones parciales.
- Identidad por empresa + cuenta LID + chat LID + ID del protocolo. `deliveryId` no identifica el mensaje.
- Reutilizar `Contact` → `Chat` → `ChatMessage`. Ampliar `Contact` para identificar al interlocutor por cuenta/LID sin exigir teléfono, y `ChatMessage` para el origen móvil y su imagen aún no subida.
- Publicación con el bus existente y metadatos estables. Los reintentos pueden repetir el dispatch del mismo evento; no se promete entrega exactamente una vez.
- Recuperación de dispatch pendiente mediante repetición del POST. No se añade worker, outbox genérico ni consumidor para este flujo.

## 2. Fuentes y contraste con el repositorio

Documento analizado: [whatsmeow-go-expo-implementation.md](../../add-bailyes/docs/whatsmeow-go-expo-implementation.md), ubicado originalmente en `/Users/jorgegonzalez/orca/workspaces/yoyos/add-bailyes/docs/whatsmeow-go-expo-implementation.md`. La ruta relativa requiere ambos worktrees como hermanos; el documento fuente no existe en el `docs/` de este worktree.

La especificación fuente establece:

- `ReceivedMessage` contiene `id`, `accountId`, `whatsappMessageId`, `chatId`, `direction`, `timestamp`, `text?`, `image?`.
- Cuenta y chat son JID LID completos sin dispositivo; nunca números JavaScript ni teléfonos inventados.
- `id` usa `wa-message:v1:` + Base64url sin padding de la tupla JSON UTF-8 `[accountId, chatId, whatsappMessageId]`. Go construye el ID; el consumidor móvil lo conserva.
- Historial y mensajes nuevos usan la misma identidad. Texto y caption se conservan sin recortar.
- La imagen puede carecer de MIME y tamaño. Su descriptor sirve para descargarla en el móvil y contiene datos sensibles.
- `confirmMessageStored(deliveryId)` confirma SQLite local, no core. El ACK nativo y el ACK HTTP tienen ciclos de vida diferentes.
- La librería todavía es una propuesta; no se requiere convertir identificadores históricos ni borrar datos anteriores.

Evidencia de código revisada en este worktree:

| Fuente | Consecuencia para esta implementación |
| --- | --- |
| [record-message.ts](../apps/core/src/features/chats/application/record-message.ts), [message.ts](../apps/core/src/features/chats/domain/message.ts) | El flujo Cloud API exige `contactPhone` y `mediaId`; no acepta directamente el contrato LID móvil. |
| [schema.prisma](../apps/core/prisma/schema.prisma) | `Chat` exige `Contact`; `Contact` exige teléfono; `ChatMessage` exige chat y estados de imagen propios de Cloud API. |
| [chat-repository.ts](../apps/core/src/features/chats/infrastructure/chat-repository.ts) | La deduplicación actual por `externalId` no demuestra la nueva identidad por cuenta/chat. |
| [app.ts](../apps/core/src/app.ts), [api-auth-middleware.ts](../apps/core/src/shared/infrastructure/api-auth-middleware.ts) | Ya existen autenticación, empresa autorizada, errores HTTP y límite JSON de 100 KiB. |
| [persistance.ts](../apps/core/src/shared/infrastructure/persistance.ts) | Reutilizar `withTenantIsolation`, `prisma` y `withinTransaction`; el `Result` fallido aborta la transacción. |
| [pg-boss-provider.ts](../apps/core/src/shared/events/infrastructure/pg-boss-provider.ts) | Publica con conexión propia; no comparte la transacción de mensajes. Sin suscriptores devuelve éxito sin crear jobs. |
| [event-bus.ts](../apps/core/src/composition/event-bus.ts) | `createPublishEvent` genera metadatos nuevos por llamada; no sirve directamente para reintentar un evento con ID estable. Su log de excepciones presupone `orderId`. |
| [vitest.config.ts](../apps/core/vitest.config.ts) | Suites unit, integration y e2e separadas; los tests nuevos deben entrar en sus patrones reales. |

Los tres modelos existentes son la base de esta implementación. La primera recepción móvil asegura un `Contact` por empresa/cuenta/LID, reutiliza o crea su `Chat` y guarda el mensaje en `ChatMessage`, todo en una transacción. No se añade otra tabla de mensajes. Un LID es una identidad válida del contacto; su teléfono puede ser desconocido, sin reemplazarlo con el LID o una cadena ficticia.

No habrá deduplicación automática entre Cloud API y whatsmeow: no existe una correspondencia verificada entre sus identidades. Un contacto identificado solo por LID no se fusiona con uno identificado por teléfono. Esta restricción no impide compartir los modelos; la vinculación posterior de identidades queda fuera del alcance.

El directorio móvil `src/features/whatsapp` mencionado por la fuente no está presente en este worktree. Esta propuesta no presupone que su consumidor ya esté implementado. Algunas memorias y `event-bus-architecture.md` describen un registro inicialmente vacío; el código actual ya registra `order_cancelled`.

## 3. Contrato HTTP de entrada

### Autenticación y ruta

`POST /api/whatsapp/messages`, `Content-Type: application/json`, autenticado mediante el mecanismo existente de sesión de Yoyos. Montar después de `loadApiAccess` y `requireApiCompany`, antes del fallback `/api`. Usar `Cache-Control: no-store` en éxitos y errores de esta ruta.

El servidor toma `companyId` y `user.id` exclusivamente de `response.locals.auth` validado. Se admite cualquier usuario con acceso `ready`, igual que las APIs privadas actuales. No se aceptan `companyId`, `userId`, `source`, teléfonos ni credenciales de WhatsApp en el body, query o headers como sustitutos de autorización.

`accountId` expresa procedencia declarada por el usuario autenticado. No prueba que controle esa cuenta WhatsApp: esta versión no tiene un registro de cuentas vinculadas ni una verificación criptográfica del emisor. No se inferirá una empresa a partir del LID, ni se permitirá consultar mensajes de otra empresa aunque tengan la misma identidad WhatsApp. El cliente futuro debe mantener sus pendientes asociados a la empresa de origen y no reenviarlos bajo otra sesión empresarial.

### Forma y tipos de transporte

Definir los schemas en `shared/contracts/whatsapp-messages.ts`. Exportar sus tipos exclusivamente mediante `z.infer`, sin interfaces DTO paralelas. El siguiente bloque expresa la forma normativa; los validadores de escalares deben implementar la tabla posterior.

```ts
import { z } from "zod";

const identityShape = {
  id: nativeMessageIdSchema,
  accountId: lidSchema,
  chatId: lidSchema,
  whatsappMessageId: protocolMessageIdSchema,
  direction: z.enum(["incoming", "outgoing"]),
  timestamp: unixMillisecondsSchema,
};

export const registerWhatsAppMessageRequestSchema = z.strictObject({
  version: z.literal(1),
  message: z.strictObject({
    ...identityShape,
    content: z.discriminatedUnion("type", [
      z.strictObject({ type: z.literal("text"), text: messageTextSchema }),
      z.strictObject({
        type: z.literal("image"),
        caption: messageTextSchema.optional(),
        mimeType: imageMimeTypeSchema.optional(),
        size: imageSizeSchema.optional(),
      }),
    ]),
  }),
});

export type RegisterWhatsAppMessageRequest =
  z.infer<typeof registerWhatsAppMessageRequestSchema>;
```

Agregar la validación cruzada de identidad antes de invocar el caso de uso. Los schemas escalares del bloque son nombres propuestos, no exports existentes. Todos los objetos son estrictos: un campo desconocido, `null` en un opcional o un tipo coercible pero incorrecto se rechaza. No convertir cadenas a números, no aplicar defaults al contenido y no recortar cadenas.

| Campo/límite | Regla exacta de v1 |
| --- | --- |
| Body | Máximo 102400 bytes JSON, incluido escape de caracteres; una petición no es un array. Deshabilitar inflación de cuerpos comprimidos para esta ruta y rechazar `Content-Encoding` distinto de ausente/`identity` con 415. |
| `version` | Número literal `1`; otra versión devuelve 400. |
| `accountId`, `chatId` | Cadena ASCII que cumple `^[0-9]+@lid$`, máximo 128 bytes cada una; sin espacio, dispositivo, PN, grupo ni username. Conservar dígitos exactamente. |
| `whatsappMessageId` | Cadena UTF-8 válida de 1 a 512 bytes, sin U+0000; conservar mayúsculas, caracteres y espacios del protocolo. No exigir formato hexadecimal. |
| `id` | Prefijo `wa-message:v1:`, máximo 4096 bytes; sufijo Base64url no vacío, sin padding. Decodificar con límites y UTF-8 estricto; validar un array JSON de exactamente tres strings iguales a los tres campos de identidad. Rechazar Base64 no canónico, bytes UTF-8 inválidos, tuplas incompletas y valores ajenos. No fabricar otro ID ni cambiar el recibido. |
| `timestamp` | Número entero seguro, desde 0 hasta 253402300799999 inclusive (9999-12-31 UTC). Unix en milisegundos, no string ni segundos convertidos automáticamente. Se aceptan fechas históricas y futuras válidas; no filtrar antigüedad ni usar el reloj móvil como fecha de recepción del servidor. |
| `content.type` | Solo `text` o `image`. |
| `text`, `caption` | UTF-8 válido, sin U+0000 ni sustitutos UTF-16 aislados; de 1 a 65536 bytes. Conservar espacios, saltos y Unicode, sin normalización. `" "` es válido; `""` no. El caption ausente permanece ausente. |
| `mimeType` | Opcional, máximo 127 bytes ASCII, formato `^image/[A-Za-z0-9!#$&^_.+-]+$`, sin parámetros ni espacios. Es metadata declarada, no certificación del archivo. |
| `size` | Opcional, número entero seguro entre 0 y 9007199254740991 inclusive. Es metadata declarada; no se usa para reservar memoria ni aprobar archivos. |

Los máximos son límites de admisión elegidos para esta API, no límites verificados del protocolo WhatsApp. Si el módulo entrega más, el cliente conservará el pendiente y mostrará un fallo de sincronización; no truncará contenido ni lo marcará sincronizado.

Rechazar claves JSON duplicadas, incluso anidadas, antes de que el parser pierda información. Extraer el helper existente `hasDuplicateJsonKeys` de órdenes a una utilidad compartida de presentación, actualizar sus callers y conservar sus pruebas. No hacer que chats importe la presentación de órdenes. Colocar el parser específico antes del parser general `/api`, con el mismo límite de bytes.

El servidor verifica la tupla decodificada; no exige que su propia serialización JSON reproduzca los escapes elegidos por Go. La clave de deduplicación es la tupla, no la representación Base64. El móvil trata `id` como opaco y no tiene que decodificarlo.

### Adaptación desde `ReceivedMessage`

| Fuente móvil | Request |
| --- | --- |
| `id`, `accountId`, `chatId`, `whatsappMessageId`, `direction`, `timestamp` | Copiar sin cambios. |
| Sin `image`, con `text` no vacío | `content: { type: "text", text }`. |
| Con `image` | `content.type = "image"`; `text`, si existe, pasa a `caption`; copiar MIME y tamaño presentes. |
| Sin texto ni imagen | Entrada inválida, no fabricar texto. |
| `image.reference`, `deliveryId`, URI local | Permanecen locales; no enviarlos a esta API. |

No enviar el objeto nativo completo por spread. Una imagen con metadata desconocida se representa como `{ "type": "image" }` y se persiste correctamente. Su registro no implica que sus bytes estén guardados en core, ni que el adjunto haya fallado o expirado.

Ejemplo válido de texto (`id` codifica `["1@lid","2@lid","ABC"]`):

```json
{
  "version": 1,
  "message": {
    "id": "wa-message:v1:WyIxQGxpZCIsIjJAbGlkIiwiQUJDIl0",
    "accountId": "1@lid",
    "chatId": "2@lid",
    "whatsappMessageId": "ABC",
    "direction": "incoming",
    "timestamp": 1791417600000,
    "content": { "type": "text", "text": " Hola 👋\n" }
  }
}
```

## 4. Salida, errores e idempotencia

Definir y validar también la salida compartida:

```ts
export const registerWhatsAppMessageResponseSchema = z.strictObject({
  status: z.enum(["stored", "duplicate"]),
  messageId: z.uuid(),
  eventId: z.uuid(),
  receivedAt: z.iso.datetime({ offset: false }),
});
export type RegisterWhatsAppMessageResponse =
  z.infer<typeof registerWhatsAppMessageResponseSchema>;
```

| HTTP | Body/condición |
| --- | --- |
| 201 | `{ status: "stored", messageId, eventId, receivedAt }`: esta petición creó la fila y confirmó dispatch. |
| 200 | Mismos IDs y fecha original, `status: "duplicate"`: la fila ya existía; si había dispatch pendiente, se completó antes de responder. |
| 400 | `INVALID_INPUT`: JSON inválido/duplicado, campos desconocidos, identidad incoherente, versión, rango o contenido inválidos. |
| 401 | `UNAUTHENTICATED`: sesión ausente o inválida. |
| 403 | `EMAIL_VERIFICATION_REQUIRED`: usuario no verificado. |
| 409 | `COMPANY_REQUIRED`: usuario sin empresa. |
| 413 | `PAYLOAD_TOO_LARGE`: body excede el máximo; no persistir ni publicar. |
| 415 | `UNSUPPORTED_MEDIA_TYPE`: Content-Type o Content-Encoding no admitidos. |
| 503 | `SERVICE_UNAVAILABLE`: autenticación, persistencia, commit, dispatch o confirmación de dispatch temporalmente no disponibles. Puede haber una fila ya comprometida. |
| 500 | `INTERNAL_ERROR`: datos persistidos incompatibles, respuesta inválida o fallo inesperado. No reportar éxito. |

Los errores usan el formato existente `{ "code": "INVALID_INPUT", "error": "Invalid input", "issues": [{ "field": "message.timestamp", "reason": "INVALID_VALUE" }] }`. `issues` es opcional y solo se incluye en validación; usar rutas y razones estáticas (`INVALID_JSON`, `DUPLICATE_KEY`, `UNKNOWN_FIELD`, `INVALID_VALUE`, `IDENTITY_MISMATCH`). No incluir valores recibidos, mensajes de SQL, token, contenido, descriptor ni stack. No hace falta ampliar `ApiErrorCode`: los códigos listados ya existen.

La frontera de autenticación y parser conserva el orden de Express: un cuerpo inválido puede recibir 400/413/415 antes de autenticar. Una petición bien formada sin sesión recibe 401. Todos los rechazos previos al caso de uso dejan cero efectos.

Reglas de repetición:

1. Unicidad real por `(companyId, whatsappAccountId, whatsappLid)` en `Contact`, `(companyId, contactId)` en `Chat` y `(companyId, chatId, whatsappMessageId)` en `ChatMessage`. En conjunto representan empresa + cuenta + interlocutor + mensaje.
2. La primera escritura gana. Una repetición válida no cambia dirección, texto, caption, MIME, tamaño, uploader ni fechas, aunque el historial posterior entregue contenido distinto. Esto respeta que ediciones y enriquecimiento no están en scope.
3. Una repetición también se valida completa; no usar su clave para saltarse validación/autorización.
4. No exigir `Idempotency-Key`, no deduplicar por `deliveryId`, timestamp, teléfono o usuario Yoyos.
5. Dos empresas o dos cuentas/chats distintos pueden almacenar el mismo ID de protocolo sin colisión. Dos usuarios de una empresa observan la misma deduplicación.
6. Después de perder la respuesta, repetir exactamente la petición devuelve la identidad persistida. El cliente solo retira su pendiente de registro tras validar un 200/201 y su schema; 4xx, 5xx, timeout o respuesta inválida conservan datos locales.

## 5. Tipos internos y caso de uso

Seguir [programming-style.md](programming-style.md), [architecture.md](architecture.md) y [persistence.md](persistence.md). El dominio recibe datos planos y el caso de uso dependencias explícitas. No importar Request, Response, ZodError, Prisma ni pg-boss en aplicación.

En dominio, usar tipos nominales ligeros para `ChatMessageId`, `NativeMessageId`, `WhatsAppAccountId`, `WhatsAppChatId` y `ProtocolMessageId`, construidos por validadores. Reutilizar un tipo compartido de empresa si existe al implementar; no importar el dominio de órdenes solo por un alias. Ningún `as` sustituirá una validación de JSON.

```ts
type MobileMessageContent =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "image"; caption: string | null;
      mimeType: string | null; size: number | null }>;

type RegisterMobileMessageError = Readonly<{
  code: "PERSISTENCE_UNAVAILABLE" | "EVENT_BUS_UNAVAILABLE" |
    "INVALID_STORED_DATA" | "INVALID_EVENT";
  message: string;
}>;

type MobileMessage = Readonly<{
  id: ChatMessageId;
  companyId: CompanyId;
  chatId: string; // UUID interno de Chat, diferente del LID del request
  externalId: NativeMessageId;
  accountId: WhatsAppAccountId;
  remoteChatId: WhatsAppChatId;
  whatsappMessageId: ProtocolMessageId;
  direction: "incoming" | "outgoing";
  sentAt: Date;
  receivedAt: Date;
  uploadedByUserId: string;
  content: MobileMessageContent;
  eventDispatchedAt: Date | null;
}>;

type StoreOutcome = Readonly<{ created: boolean; message: MobileMessage }>;
type RegisterOutcome = Readonly<{
  status: "stored" | "duplicate";
  messageId: ChatMessageId;
  eventId: ChatMessageId;
  receivedAt: Date;
}>;
```

`MobileMessage` es la proyección del registro móvil de `ChatMessage` junto a la identidad de su `Contact`, no otra entidad persistida. `NewMobileMessage` será esa proyección sin `chatId` ni `eventDispatchedAt`; recibirá el ID y reloj generados en aplicación. El UUID de chat se resuelve al asegurar contacto/chat dentro de la transacción. `RegistrationContext` contiene exclusivamente `companyId` y `uploadedByUserId` obtenidos de autenticación. El DTO se transforma a dominio: timestamp → `Date`, ausencias → `null`, `chatId` → `remoteChatId`, `id` → `externalId`. El autor de un mensaje outgoing es desconocido: `uploadedByUserId` identifica quién subió, no quién escribió en WhatsApp.

Definir junto al caso de uso estos puertos, todos con `Result<..., RegisterMobileMessageError>` explícito:

- `storeOnce(input: NewMobileMessage): Promise<Result<StoreOutcome, ...>>`: asegura Contact y Chat y realiza inserción/lectura del mensaje en una sola transacción, vuelve después del commit y devuelve la fila ganadora completa, validada.
- `markEventDispatched(companyId, messageId, at): Promise<Result<void, ...>>`: escritura idempotente con tenant; solo rellena un valor nulo. Cero filas visibles por identidad inexistente es `INVALID_STORED_DATA`, nunca éxito inventado.
- `dispatchMessageRecorded(payload, metadata): Promise<Result<void, ...>>`: adapta el publisher existente y conserva los metadatos recibidos.
- `newMessageId(): ChatMessageId` y `now(): Date`: composición con UUID/clock reales, fakes deterministas en tests.

Secuencia de `registerMobileMessage`:

1. Construir candidato con contexto confiable, ID nuevo y `receivedAt` del servidor.
2. Ejecutar `storeOnce`. Si falla la persistencia o el commit, devolver error y no publicar. No envolver todo el caso de uso en otra transacción exterior.
3. Tomar la fila ganadora, también para duplicados. Si `eventDispatchedAt` existe, responder sin republicar.
4. Construir el evento desde esa fila, nunca desde el contenido de una repetición.
5. Esperar el `Result` de dispatch. Si falla, devolver 503 conservando fila y marcador nulo.
6. Confirmar `eventDispatchedAt`; si falla, devolver 503. Un reintento podrá republicar con el mismo `eventId`.
7. Responder `stored` si este POST insertó, en otro caso `duplicate`; validar schema HTTP de salida.

Los errores inesperados se observan y traducen en la frontera a 500. No convertir una excepción desconocida en duplicado o ausencia. No usar fire-and-forget ni `afterTransactionCommit` para una publicación asíncrona cuyo resultado determina HTTP.

## 6. Persistencia y migración

Modificar los modelos existentes. No crear `WhatsAppMobileMessage` ni otra relación de mensajes en `Company`. Los fragmentos siguientes muestran únicamente campos e índices que cambian o se agregan; conservar IDs, relaciones, defaults tenant y demás campos actuales.

### Contact: identidad disponible sin teléfono obligatorio

```prisma
// Cambios dentro de Contact:
phone              String?
whatsappAccountId  String? @db.VarChar(128)
whatsappLid        String? @db.VarChar(128)

// Conservar @@unique([companyId, phone]) y @@unique([companyId, id]).
@@unique([companyId, whatsappAccountId, whatsappLid])
```

El par de identidad WhatsApp es ambos nulos o ambos LID válidos. Cada contacto debe tener teléfono no vacío o el par completo. Los contactos móviles nuevos usan `phone = null`, `name = null`, `whatsappAccountId = request.accountId` y `whatsappLid = request.chatId`. Un mismo interlocutor en otra cuenta se mantiene separado hasta disponer de una vinculación verificada. No actualizar nombres, teléfonos o identidades de un contacto preexistente al recibir otro mensaje.

Reemplazar el check de teléfono no vacío por checks que distingan NULL de una cadena vacía y exijan al menos una identidad. La unicidad existente por teléfono admite varios NULL en PostgreSQL y sigue deduplicando los contactos Cloud API con teléfono.

### Chat: reutilizar la relación obligatoria con Contact

`Chat` conserva su estructura y `@@unique([companyId, contactId])`. Su `contactId` sigue siendo obligatorio. Asegurar el contacto por cuenta/LID y luego su chat evita duplicar los campos de identidad en `Chat` o dejar chats sin interlocutor. El primer mensaje puede ser incoming u outgoing; ambos crean la misma estructura.

### ChatMessage: ampliar la entidad existente

```prisma
// Campos nuevos dentro de ChatMessage:
whatsappMessageId  String?
imageMimeType      String? @db.VarChar(127)
imageSize          BigInt?
uploadedByUserId   String?
eventDispatchedAt  DateTime? @db.Timestamp(3)

// Nueva unicidad de mensajes móviles; conservar el índice cronológico actual.
@@unique([companyId, chatId, whatsappMessageId])
```

Reutilizar `id`, `chatId`, `externalId`, `direction`, `source`, `userId`, `type`, `text`, `caption`, `sentAt` y `receivedAt`. El ID nativo completo va en `externalId`; `whatsappMessageId` contiene el ID original del protocolo para las filas móviles. La presencia de este último distingue esos registros; NULL identifica el flujo Cloud API existente. Las lecturas móviles obtienen cuenta/LID mediante `Chat.contact` y validan su presencia.

Sustituir `@@unique([companyId, externalId])` por un índice único parcial SQL sobre `(companyId, externalId) WHERE "whatsappMessageId" IS NULL`, conservando la deduplicación Cloud API. Declarar/documentar ese índice en la migración generada si la representación Prisma del proyecto no lo admite; comprobar que una regeneración posterior no lo elimina. Así los dos transportes no colisionan por una cadena externa coincidente. Las lecturas `findMessageId` y la lectura posterior a insert de `chat-repository.ts` deben filtrar `whatsappMessageId: null`; los repositorios móviles buscan por chat + ID de protocolo, nunca solo por `externalId`.

En móvil, derivar `source = contact` para incoming y `source = seller` para outgoing; `userId = null` en ambos casos. Conservar el check de origen actual. `uploadedByUserId` es la atribución histórica del usuario autenticado que subió el mensaje, no su autor WhatsApp; no añadir una FK que bloquee conservar mensajes al mover/eliminar usuarios. Debe ser no vacío en filas móviles y nulo en las Cloud API existentes.

Añadir `metadata_only` al enum existente `MessageImageStatus`. Una imagen móvil recién registrada usa ese estado, `whatsappMediaId = null`, `imageId = null`, sin failure code/message. MIME y tamaño pueden faltar. Este estado no implica subida pendiente automática ni fallo: solo se dispone del registro de la imagen. Ampliar la unión discriminada `MessageImage` con esa variante, conservando `ready` y `failed` y su validación Cloud API. El retorno de `storeMessageImage` y el puerto de inserción Cloud API se restringen a las variantes `ready | failed`; los lectores generales manejan también `metadata_only`. No inventar un `mediaId` para satisfacer los tipos viejos.

Reemplazar `ChatMessage_content_image_state_check` preservando sus ramas anteriores bajo `whatsappMessageId IS NULL`, y agregar ramas explícitas móviles:

- Texto: text presente de 1 a 65536 bytes, caption y todos los campos de imagen nulos.
- Imagen: text nulo, caption nulo o de 1 a 65536 bytes; `imageStatus = metadata_only`; MIME/tamaño opcionales según contrato; `whatsappMediaId`, `imageId` y campos de error nulos.
- ID de protocolo móvil no vacío y dentro de su cota; uploader no vacío; identidad nativa coherente con el contacto en el mapper. Fechas móviles en el rango definido. `eventDispatchedAt` solo aplica a mensajes móviles en este scope.
- Las filas Cloud API conservan metadata nueva y marcador nulos, y sus reglas actuales de contenido/media. No aplicar retroactivamente los nuevos límites de texto a datos históricos Cloud API.

En checks con columnas opcionales usar `IS NULL` / `IS NOT NULL`: un CHECK que produce NULL no rechaza la fila. Guardar `imageSize` como BigInt y comprobar rango seguro antes de convertir a number. No serializar BigInt a JSON. No exigir que la fecha de dispatch sea posterior a recepción, porque el reloj del servidor puede ajustarse.

### Transacción, callers y compatibilidad

La aplicación coordina `withinTransaction` y capacidades de contacto/chat/mensaje. `Contact` conserva sus operaciones en `features/contacts`; añadir allí `ensureWhatsAppContact` con entrada empresa/cuenta/LID y resultado tipado. La composición de chats recibe esa capacidad y la operación de chat existente. Evitar SQL de contactos duplicado en el repositorio de mensajes o una feature que importe infraestructura interna de otra. `storeOnce` es la capacidad compuesta: contacto, chat y mensaje se comprometen juntos y cualquier fallo revierte las altas de esa petición.

En cada alta usar conflictos sobre su clave exacta y leer la fila ganadora. Concurrencia sobre el mismo mensaje produce un contacto, un chat, un mensaje y un único `created: true`. Otro mensaje del mismo chat reutiliza contacto/chat. Un duplicado no cambia contenido ni uploader. No capturar cualquier error único como duplicado ni hacer upsert que sobrescriba datos.

La nulabilidad de `Contact.phone` exige actualizar el dominio y mappers de contactos. Representar sus identidades con variantes validadas (teléfono disponible y/o par LID completo); no usar non-null assertions para conservar el tipo anterior. `ensureContact` por teléfono puede devolver una proyección con teléfono requerido después de comprobarlo; `ensureWhatsAppContact` devuelve el contacto identificado por LID.

Los consumidores de ventas actuales requieren teléfono real (`ContactSnapshot`, contratos de órdenes y formularios web/mobile). Mantener esa condición: `searchSaleContacts` filtra `phone IS NOT NULL`, y `findContactById`, usado para ventas, devuelve ausencia para un contacto sin teléfono. El caso de uso conserva `CONTACT_NOT_FOUND` para un ID no elegible, sin fabricar un número. Los contactos LID quedan guardados y asociados al chat, pero no pasan a compradores de venta hasta disponer de teléfono verificado. No cambiar el contrato público de órdenes para admitir un LID como teléfono. Agregar tests de búsqueda, selección directa y snapshots con esta nueva clase de contacto.

Conservar las FK compuestas `(companyId, contactId)` y `(companyId, chatId)`, los defaults y las políticas RLS de los tres modelos. El acceso HTTP usa `prisma`, nunca `systemPrisma`. Las comprobaciones de aislamiento existentes deben seguir pasando, incluyendo el nuevo camino de contacto LID.

### Migración

Seguir [.agents/skills/database-migrations/SKILL.md](../.agents/skills/database-migrations/SKILL.md). Generar desde `apps/core` con credenciales de migración y base de desarrollo aislada:

```sh
pnpm exec prisma migrate dev --create-only --name adapt_chats_for_mobile_whatsapp
# Revisar SQL generado: campos opcionales, enum, checks e índices.
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

No crear directorios/timestamps a mano ni editar migraciones aplicadas. Los campos nuevos son opcionales para preservar datos Cloud API; no hace falta convertir sus IDs. Mantener datos, relaciones, RLS y restricciones anteriores que todavía apliquen. Construir el índice parcial antes de retirar el índice único anterior, con estrategia y lock timeout adecuados al volumen; separar DDL y creación concurrente si se requiere. Agregar el valor del enum en una migración/paso comprometido antes de usarlo en checks, evitando depender de su disponibilidad dentro de la misma transacción.

Probar base vacía y base con contactos/chats/mensajes/imágenes anteriores. Un rollback de aplicación no es automáticamente seguro después de aceptar contactos con teléfono nulo o imágenes `metadata_only`: desplegar lectores compatibles antes de habilitar la nueva ruta. No eliminar registros para hacer compatible una versión antigua.

## 7. Contrato del evento y límites del dispatch

Definir en `chats/application/events.ts`, usando declaration merging de `AppEvents`:

```ts
type WhatsAppMessageRecorded = Readonly<{
  companyId: CompanyId;
  messageId: ChatMessageId;
}>;

declare module "@core/src/shared/events/application/app-events" {
  interface AppEvents {
    whatsapp_message_recorded: WhatsAppMessageRecorded;
  }
}
```

Nombre: `whatsapp_message_recorded`. Metadata estándar: `{ eventId: message.id, occurredAt: message.receivedAt.toISOString() }`. Usar el UUID del mensaje como ID estable de su único evento de creación evita otra identidad y otra columna. La fecha del hecho es la primera recepción en core, no el timestamp histórico de WhatsApp ni la fecha de reintento.

Schema estricto del payload: solo UUID `companyId` y `messageId`. Validar payload y metadata en el adaptador de publicación aunque no existan suscriptores; verificar que `companyId` coincida con el contexto. El evento no contiene texto, caption, LID, teléfono, descriptor, credenciales ni archivo. No registrar handler ni cambiar `eventHandlers` para introducir uno ficticio.

La composición usará `applicationEventBus().provider.publish` a través del puerto tipado local que conserva metadata; no llamará al helper que genera un UUID nuevo en cada intento. El adaptador convierte errores del bus a los errores definidos, sanea logs y no deja excepciones esperadas escapar. Garantizar que el módulo de augmentation forme parte del programa TypeScript. Actualizar el acceso no condicionado a `payload.orderId` en el log de excepciones del wrapper global; con el nuevo evento ya no existe ese campo en todas las variantes.

Semántica comprobable:

- Un mensaje no comprometido no produce dispatch.
- No existe atomicidad entre la tabla de mensajes y el proveedor pg-boss: usan conexiones/transacciones distintas.
- `eventDispatchedAt` significa que el publisher devolvió éxito y se guardó la confirmación; no significa que un handler ejecutó nada.
- Con cero suscriptores, el proveedor actual acepta el dispatch sin guardar jobs. Es válido para este scope, que no define receptores. Registrar un handler en el futuro no reproducirá mensajes ya confirmados.
- Con suscriptores existentes en un futuro, la semántica de persistencia de jobs será la del bus. No cambiarla como parte de esta API.
- Dos peticiones simultáneas pueden observar el marcador nulo y publicar el mismo `eventId`. Una caída después del dispatch y antes de marcarlo también puede repetirlo. Se conserva un único hecho lógico; no se promete una sola llamada física ni deduplicación del proveedor por `eventId`.
- Si el proceso cae después de persistir y antes de publicar, el POST repetido recupera el dispatch. Si nunca hay otro POST, queda pendiente: no hay recuperación autónoma ni garantía eventual sin reintento móvil. Este límite debe constar en un comentario `ponytail:` junto a la recuperación, indicando que un relay durable sería otra ampliación si se exige recuperación autónoma.
- Un rechazo de publicación nunca borra el mensaje comprometido. El móvil mantiene el pendiente al recibir 503 y reintenta con su misma identidad.

Esta API cumple dispatch post-commit sin implementar quién recibe el evento. Exigir retención de eventos sin suscriptores o recuperación sin cliente requeriría cambiar el contrato del bus y ampliar este alcance explícitamente.

## 8. Archivos y orden de implementación

| Lugar | Trabajo requerido |
| --- | --- |
| `shared/contracts/whatsapp-messages.ts` | Entrada/salida, límites y tipos inferidos. Sin dependencias de core/mobile. |
| `chats/domain/message.ts` | Ampliar tipos existentes para la proyección móvil y `metadata_only`; reutilizar Chat y ChatMessage. |
| `contacts/domain/contact.ts`, aplicación y repositorio de contactos | Teléfono opcional, identidad LID, ensure por cuenta/LID y proyecciones elegibles para ventas. |
| `chats/application/register-mobile-message.ts` | Caso de uso y puertos de persistencia/publicación descritos. |
| `chats/application/events.ts` | Evento tipado y augmentation; parser de evento junto al adaptador si necesita código de infraestructura. |
| `chats/infrastructure/chat-repository.ts` | Persistir en ChatMessage, asegurar Chat, búsquedas Cloud API acotadas, mapping de variantes y marcador de dispatch. |
| `chats/presentation/mobile-message-routes.ts` | Router/factory con dependencia explícita para pruebas de transporte. |
| `chats/index.ts` | Componer la nueva operación sin reemplazar `recordWhatsAppMessage` Cloud API. |
| `src/shared` y presentación de órdenes | Extraer el detector de claves JSON duplicadas conservando callers y tests. |
| `src/app.ts` | No-store, parser específico antes del genérico, ruta privada, clasificación de errores JSON y 415; no caer en `INVALID_COMPANY`. |
| `src/composition/event-bus.ts` | Hacer compatible el log genérico con eventos sin `orderId`; conservar manejo de fallos. |
| `prisma/schema.prisma` y migraciones generadas | Ampliar Contact/ChatMessage, preservar Chat y sus relaciones/RLS, reemplazar checks/índices y regenerar cliente. |
| Pruebas de las tres capas y fixtures E2E | Agregar los escenarios de la sección siguiente; conservar regresión del webhook y órdenes. |

No se necesitan paquetes nuevos, un bus nuevo, endpoints de lectura ni cambios de UI. Las rutas relativas de la tabla desde `chats/` pertenecen a `apps/core/src/features/chats/`.

Orden: contratos y tests puros → modelo/migración y repositorio con integración → caso de uso con fallos de dispatch → composición/ruta → E2E y regresiones. Revisar exports y callers con búsquedas antes de extraer el helper o modificar el registro de eventos. El consumidor móvil futuro podrá importar el contrato compartido; no añadir en este scope un caller ficticio solo para usar el export.

## 9. Pruebas requeridas y criterios observables

Todas las pruebas core usarán Vitest y `expect`. Los nombres siguientes son propuestas que coinciden con los patrones actuales. Colocar tests del contrato compartido en `chats/presentation/mobile-message-schemas.test.ts` importando el schema real; `shared/` por sí solo no entra en el proyecto unit actual. No introducir otro runner.

### Unitarias

| ID | Caso y aserción |
| --- | --- |
| U01 | Texto incoming/outgoing, imagen con/sin caption, MIME/tamaño ausentes: parse y mapping conservan exactamente contenido, identidad y dirección. |
| U02 | Mensaje sin contenido, texto vacío, variante no soportada, combinación text+campos de image, null, coerciones, desconocidos en cada nivel y versión diferente: rechazo antes del caso de uso. |
| U03 | LID válido largo, PN, grupo, dispositivo, número en vez de string, prefijo/base64/UTF-8/JSON de ID inválidos, tupla no coincidente y tupla extra: rechazo determinista; ID de ejemplo se decodifica correctamente. |
| U04 | Límites exactos y uno por encima de IDs, texto/caption en bytes UTF-8, MIME y tamaño. Sustitutos aislados/U+0000 se rechazan; emojis, espacios y saltos se conservan. |
| U05 | Timestamp 0 y máximo admitido, histórico/futuro válidos, negativo, fracción, string, NaN/Infinity mediante test directo y fuera de rango; no inventar ni convertir fecha. |
| U06 | Creación exitosa devuelve stored; el publisher fake solo puede observar fila ya comprometida; fallo de store/commit produce cero dispatch. |
| U07 | Duplicado ya confirmado devuelve IDs/fecha originales, sin actualizar contenido ni dispatch. Duplicado pendiente publica payload desde fila original, incluso si el request trae otro texto/dirección. |
| U08 | Error de bus deja fila pendiente y devuelve fallo; reintento confirma con el mismo ID/fecha. Error al marcar después de publicar permite republicación del mismo evento. |
| U09 | Dispatcher con company incoherente, payload/metadata inválidos o bus no listo: rechazo saneado. Excepción inesperada no se interpreta como duplicado ni éxito. |
| U10 | Respuestas y errores de la ruta validan los schemas; códigos HTTP de la tabla, 415, body duplicado/malformado y salida corrupta producen lo definido. No exponer valores sensibles en errores ni logs propios. |
| U11 | Tests de tipos con `@ts-expect-error`: nombre de evento desconocido, payload sin empresa/messageId, content mezclado e intercambio de IDs nominales fallan typecheck. Sin casts para aprobarlos. |

### Integración con PostgreSQL y proveedor reales

Extender `chats/infrastructure/chat-persistence.test.mjs` y las pruebas de persistencia de contactos, más integración del adaptador de publicación cuando corresponda. Usar una base aislada, migraciones reales y rol `core_app`; mocks de Prisma no acreditan estos resultados.

| ID | Caso y aserción |
| --- | --- |
| I01 | Persistir y releer texto, image mínima y image completa en ambas direcciones; preservar milisegundos, nulls, Unicode y máximo seguro de `imageSize`. Crear o reutilizar Contact/Chat existentes; no crear Image ni tablas paralelas. |
| I02 | Repetición secuencial y al menos 10 inserciones concurrentes de la misma identidad: un Contact, un Chat, un ChatMessage, un creador de mensaje y el mismo UUID para todos; mensajes distintos del mismo interlocutor reutilizan Contact/Chat. Los otros contenidos no sobrescriben el ganador. |
| I03 | Cambiar cuenta, chat, ID de protocolo o empresa crea filas independientes; cambiar solo uploader no. No usar solo externalId o ID de protocolo para buscar. El mismo externalId en Cloud API no captura la búsqueda móvil ni viceversa. |
| I04 | Dentro del alcance tenant, lecturas/escrituras/marcador no acceden a otra empresa; reutilizar fixtures de aislamiento. Verificar que el modelo aparece en las comprobaciones generales de RLS y que su FK/default/política están activos. |
| I05 | Falla de inserción, constraint o commit revierte contacto/chat/mensaje creados en esa transacción; una carrera única esperada no oculta errores de FK, permisos o conexión. SQL directo inválido incumple checks reales. |
| I06 | `markEventDispatched` repetido conserva primera marca, scoped por empresa; fila inexistente produce error. Fallo de marcado conserva el mensaje. |
| I07 | Reiniciar composición entre primera persistencia pendiente y segundo POST recupera mismo evento; no depender de mapas, locks o memoria del proceso. |
| I08 | Provider pg-boss real iniciado sin suscriptores: dispatch retorna éxito, marcador se confirma y no existen jobs de este evento. Provider detenido: error y marcador nulo; posterior arranque/reintento resuelve. No registrar handler de negocio para hacer pasar la prueba. |
| I09 | Dos registros concurrentes a través del caso de uso: un mensaje, un eventId lógico y dispatch repetido permitido; no afirmar que la unicidad de la tabla implica exactamente un job. |
| I10 | Migrar base vacía y fixture con Contact/Chat/ChatMessage previos: nuevos constraints/RLS válidos, datos anteriores intactos y webhook existente operativo. Mapper rechaza datos incompatibles sin sustituirlos por defaults. Contactos LID sin teléfono no aparecen en búsquedas de venta ni permiten crear una venta por selección directa; contactos previos con teléfono siguen funcionando. |

### E2E de la API desplegada localmente

`apps/core/tests/e2e/mobile-whatsapp-messages.spec.ts`, usando las fixtures Vitest y el `APIRequestContext` de Playwright existentes. Ejecutar el servidor completo, autenticación real de prueba, PostgreSQL y arranque real del proveedor. E2E aquí significa cliente HTTP → auth → ruta → aplicación → PostgreSQL → dispatch; no certifica Go, WhatsApp real ni recepción Android/iOS.

| ID | Recorrido y resultado |
| --- | --- |
| E01 | Crear/iniciar sesión de usuario ready mediante fixtures; enviar ejemplo de texto y consultar DB tenant: 201, fila exacta y marcador de dispatch confirmado. |
| E02 | Reenviar el mismo mensaje, incluyendo simulación de respuesta ignorada por cliente: 200 con mismos IDs/fecha y una sola fila. Repetir con contenido cambiado conserva el primero. |
| E03 | Imagen sin MIME/tamaño/caption y outgoing histórico: 201 con metadatos nulos; no descarga HTTP a WhatsApp, acceso a R2 ni dependencia de archivo local. |
| E04 | Sin sesión, sin verificación y sin empresa: códigos definidos y cero filas/dispatch. Usuario de empresa B no modifica fila ni marcador de A; body que intenta imponer companyId es 400. |
| E05 | JSON roto, duplicado, formato no JSON, encoding no admitido y tamaño 102401 bytes: error contractual sin escrituras. Request válido exactamente al límite de body no es rechazado por tamaño. |
| E06 | Tras iniciar el servidor, indisponer el almacenamiento del bus mediante fixture/proxy aislado: POST da 503 y conserva fila pendiente; restaurarlo y repetir devuelve 200/misma fila y confirma dispatch. No usar flags de fallo en endpoints de producción. |
| E07 | Peticiones concurrentes por HTTP: una fila y respuestas válidas stored/duplicate. Verificar regresión del webhook Cloud API y rutas de órdenes que comparten helper/parser/eventos. |

Para E06 no basta parar el worker: el productor sigue publicando sin consumidores. La fixture debe interrumpir la conexión del proveedor o inyectar el fallo en el arranque de un servidor de prueba dedicado, manteniendo real el resto del recorrido. Si se usa un publisher fake, etiquetar ese escenario como integración de composición y conservar una prueba con proveedor real; no llamarlo evidencia de fallo pg-boss real.

Las fixtures usan empresas, usuarios, identidades y bases propias; limpieza por IDs de fixture y cierre de clientes. No usar datos de producción, sleeps arbitrarios ni depender del orden de ejecución. Los fallos se sincronizan con barreras o respuestas observables. No requieren teléfono, QR ni credenciales reales de WhatsApp.

### Comandos y gate de implementación

Con Node 24 y pnpm 12.5.1, dependencias instaladas y servicios de prueba preparados:

```sh
pnpm --dir apps/core lint
pnpm --dir apps/core typecheck
pnpm --dir apps/core test:unit
pnpm --dir apps/core test:integration
pnpm --dir apps/core test:e2e
pnpm --dir apps/core build
```

Los scripts integration/e2e requieren Docker y `psql`; E2E incluye el servidor/build y Chromium según las suites existentes. Conservar comprobación de tipos en mobile si un cambio compartido afecta sus imports. No se requiere probar hardware para aprobar esta API.

El gate exige evidencia de contratos HTTP, constraints/migración, aislamiento, concurrencia, errores de commit y dispatch, recuperación por reintento y regresiones de los callers tocados. Un mock que verifica `publish` llamado no sustituye la prueba de commit ni el E2E. Registrar comandos y resultados reales al implementar: los escenarios de este documento todavía no están implementados ni ejecutados.

## 10. Criterios de aceptación y riesgos conocidos

- Entrada estricta y salida compartida validada; ningún dato del cliente escoge la empresa.
- Una sola fila por identidad; las repeticiones preservan contenido y fechas originales.
- Texto e imágenes sin metadata obligatoria quedan registrados sin teléfono ni sesión WhatsApp en el servidor.
- El dispatch se espera después de un commit real; un fallo no se disfraza de éxito ni provoca pérdida de la fila.
- El evento usa IDs y fecha estables, payload mínimo y ningún handler nuevo.
- Persistencia con migración generada, constraints, RLS y pruebas reales de concurrencia/rollback.
- Unitarias, integración y E2E cubren las matrices anteriores y están verdes antes de declarar implementada la API.

Riesgos aceptados de esta propuesta: la procedencia de cuenta es declarada, no verificada; el registro de imagen no almacena sus bytes; las repeticiones no enriquecen ni corrigen contenido; dispatch puede repetirse y su recuperación depende de repetir el POST; sin suscriptores no se retiene un job ni habrá reproducción futura automática. Son límites explícitos de esta API y del bus actual, no garantías pendientes que un consumidor implícito vaya a resolver.
