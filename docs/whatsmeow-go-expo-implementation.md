# Librería WhatsApp para Expo con Go y whatsmeow

**Estado:** propuesta técnica v1 consolidada para revisión. Define la librería y su interfaz; la implementación nativa y las pruebas en dispositivos siguen pendientes. Las decisiones acordadas se distinguen de las propuestas internas y de las comprobaciones pendientes. Android contempla recepción con la app minimizada; iOS es un destino de compilación previsto cuya recepción durante suspensión sigue sin solución definida.

## Índice

- [Alcance y ubicación](#alcance-y-ubicación)
- [Responsabilidades](#responsabilidades)
- [Carpetas propuestas](#carpetas-propuestas)
- [Interfaz TypeScript](#interfaz-typescript)
- [Errores y recuperación](#errores-y-recuperación)
- [Configuración y límites](#configuración-del-límite-de-recuperación)
- [Una cuenta activa y cambio de cuenta](#una-cuenta-activa-y-cambio-de-cuenta)
- [Conexión, segundo plano y reinicio Android](#conexión-y-ciclo-de-vida)
- [Persistencia segura de la sesión](#persistencia-segura-de-la-sesión)
- [Entrega durable de mensajes a Expo](#entrega-durable-de-mensajes-a-expo)
- [Imágenes privadas de corta duración](#imágenes-privadas-de-corta-duración)
- [Compilación e integración](#compilación-e-integración)
- [Estado de la definición y pendientes](#estado-de-la-definición-y-pendientes)
- [Validación antes de implementar el flujo completo](#validación-antes-de-implementar-el-flujo-completo)
- [Fuentes técnicas](#fuentes-técnicas)

## Alcance y ubicación

Crearemos el módulo local `apps/mobile/modules/whatsapp/`, siguiendo la organización de `brother-printer`. Su nombre público y nativo será `WhatsApp`; [whatsmeow](https://github.com/tulir/whatsmeow) será una dependencia interna del wrapper Go.

La primera versión soportará Android e iOS, vinculación exclusivamente por QR y recepción de texto e imágenes en chats individuales. Incluirá mensajes `incoming` y mensajes `outgoing` enviados desde otros dispositivos de la cuenta vinculada. No expondrá envío de mensajes ni recepción de grupos, videos, audios, documentos o stickers.

Se descarta el modo Live y la obligación de mantener la pantalla encendida. La definición operativa actual del MVP se centra en recepción en segundo plano en Android mediante un servicio nativo en primer plano; la sesión permanecerá exclusivamente en el móvil. La recepción con iOS suspendido sigue sin una solución validada y no se dará por resuelta con este mecanismo Android.

### Variantes de contenido y normalización acordadas

| Caso | Comportamiento de v1 |
| --- | --- |
| Texto normal | Entregar el texto completo. |
| Imagen con o sin descripción | Entregar su referencia; incluir la descripción en `text` cuando exista. |
| Mensaje citado o reenviado | Entregar su contenido propio, sin incorporar el mensaje citado ni metadatos de reenvío. |
| Edición | Excluir el evento de edición; no reemplazar una entrega anterior. |
| Eliminación | Excluir el evento de eliminación; no ordenar borrar lo guardado por el consumidor. |
| Mensaje temporal | Admitirlo como texto o imagen normal, sin programar su eliminación. |
| Imagen de visualización única | Excluirla de v1. |
| Reacción u otro contenido fuera del alcance | No emitir `ReceivedMessage`. |

Los mensajes temporales admitidos podrán permanecer en Yoyos después de desaparecer de WhatsApp. Una eliminación posterior en WhatsApp tampoco eliminará la copia del consumidor. Si el historial contiene únicamente una versión ya editada como mensaje normal, se entregará ese contenido; no se prometerá reconstruir el original ni procesar eventos de edición.

Un texto vacío sin imagen no producirá una entrega vacía; con imagen se omitirá `text` si no existe descripción. No se recortará ni modificará el texto recibido. Un timestamp ausente o inválido (cero, negativo, posterior al año 9999 o fuera de los enteros seguros de JSON en milisegundos) **no es un error de normalización**: **decisión del dueño del producto (2026-10-10)**, que sustituye a la regla anterior de detener ese procesamiento. La fecha pasa a ser *desconocida*: el mensaje se normaliza, se persiste, se entrega y se confirma con normalidad, sin detener la recepción ni afectar a otros mensajes ni al lote, y se omite `timestamp` (nunca `0`, que se leería como 1970, ni la hora de recepción). El orden de entrega es el de llegada (vivo: revisión y ordinal) y la deduplicación usa `message.id`, no la fecha; en un lote de historial, el mensaje de fecha desconocida conserva su posición de protocolo respecto a sus vecinos de la misma conversación (toma la clave de orden del anterior conocido, o del primer conocido posterior). No se conserva el valor original inválido. Los tipos excluidos seguirán la política general de exclusión y no se confundirán con errores de normalización.

El MIME de una imagen recibida podrá faltar: `image.mimeType` y el campo equivalente del descriptor serán opcionales. Su ausencia no descartará el mensaje. Antes de devolver `DownloadedImage`, la descarga deberá determinar un MIME válido a partir del archivo verificado; si no puede, devolverá `IMAGE_UNAVAILABLE`, sin presentar una descarga exitosa. Los datos insuficientes para descargar conservarán el tratamiento ya definido de `IMAGE_UNAVAILABLE`.

### Recepción inicial y continua

Al vincular, la librería entregará todos los mensajes disponibles que WhatsApp proporcione dentro del alcance anterior, incluidos los mensajes históricos recibidos en la sincronización inicial. Después continuará entregando mensajes nuevos. No filtrará por antigüedad, por fecha de vinculación ni por criterios de negocio de Expo.

Los mensajes históricos y nuevos se normalizarán al mismo `ReceivedMessage` y se entregarán por `messageReceived`, con la cuenta de origen y su identidad estable. La librería admitirá repeticiones y no consultará las tablas de Expo para decidir qué emitir. El procesamiento del consumidor, su persistencia definitiva, deduplicación y sincronización con core quedan fuera del alcance de este diseño.

“Todos” significa todos los mensajes disponibles que proporcione el protocolo, manteniendo la restricción a chats individuales, texto e imágenes. No se prometerá recuperar el historial completo de la cuenta ni mensajes que WhatsApp no entregue. La descarga de imágenes seguirá siendo explícita.

whatsmeow expone el historial mediante [`HistorySync`](https://github.com/tulir/whatsmeow/blob/9399289b022b/types/events/events.go) y permite normalizar sus mensajes mediante [`ParseWebMessage`](https://github.com/tulir/whatsmeow/blob/9399289b022b/client.go). El adaptador deberá atender esa ruta además de la recepción en vivo. Las pruebas aisladas de recepción en vivo no demuestran la recuperación del historial.

#### Admisión del historial: lote completo en el buffer existente

En la [versión fijada de `message.go`](https://github.com/tulir/whatsmeow/blob/9399289b022b/message.go), la recepción de una notificación programa un recibo `hist_sync`; la ruta automática descarga el lote, emite `HistorySync` y solicita eliminar el archivo remoto. Ese recibo no espera la persistencia del consumidor. Devolver un resultado desde el manejador de `HistorySync` tampoco controla por sí solo esa eliminación. `DownloadHistorySync()` materializa y descomprime el lote completo en memoria; no es una API de lectura incremental. Su opción de almacenamiento síncrono no convierte los errores de todos los stores internos en un fallo de la llamada.

El diseño requerirá controlar la descarga y el recibo mediante `ManualHistorySyncDownload` y `DisableManualHistorySyncReceipt`, además de adaptar la captura durable de la notificación y la propagación de errores. No se asumirá que activar esas opciones resuelve el ACK de transporte, el commit criptográfico o la recuperación. El adaptador distinguirá el ACK de la notificación, el recibo de historial y la eliminación remota; ninguno podrá retirar la única fuente recuperable de mensajes todavía no confirmados localmente.

Los mensajes históricos usarán el mismo buffer, identidades y confirmación pública que los mensajes nuevos. Antes de emitir uno, su contenido y los cambios de protocolo necesarios deberán estar comprometidos durablemente. Los mappings PN/LID del historial se procesarán antes de normalizar los mensajes que dependan de ellos. Ante un error de lectura, escritura o normalización de un mensaje del alcance soportado, no se declarará completado el lote ni se saltará silenciosamente ese mensaje. Los tipos fuera del alcance seguirán excluidos por la política general.

Procesar un lote mensaje a mensaje solamente en RAM no cumple la recuperación tras una caída: aunque Expo confirme los primeros, todavía podría perderse el resto. Conservar únicamente la referencia remota tampoco garantiza recuperarlo, porque el recurso puede dejar de estar disponible. El progreso o número de chunk del protocolo no demuestra que el consumidor haya persistido su contenido.

**Decisión adoptada para v1:** se admitirán durablemente todos los mensajes soportados de un lote dentro del buffer cifrado existente antes de emitir cualquiera de ellos. La admisión del lote y los cambios de protocolo necesarios se comprometerán juntos; un fallo no dejará una admisión parcial. El presupuesto incluirá contenido, metadatos, cifrado y reservas, según la regla general del buffer. No se añadirá almacenamiento temporal de lotes con otro presupuesto.

Si el lote cabe en el presupuesto total pero falta espacio por otros pendientes, se esperará a sus confirmaciones, sin bloquearlas ni mantener el escritor de sesión ocupado. La espera respetará la retirada de la generación por desconexión, logout o fallo local. Si el lote supera por sí solo el presupuesto, se informará `RECOVERY_BUFFER_FULL`, sin admisión parcial ni reintento automático interminable. El límite podrá aumentarse mediante `EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB`, de 10 MiB por defecto, aplicando las reglas de configuración e inicialización ya definidas. Esta versión no garantiza recibir lotes arbitrariamente grandes ni recuperar desde el servidor un lote rechazado.

También deberán limitarse la descarga y la descompresión para evitar que un lote agote la memoria antes de comprobar el presupuesto, conforme a los límites internos propuestos más abajo. El límite de contenido pendiente no equivale al consumo máximo de RAM del parser; la aplicación de esos límites en la adaptación de whatsmeow deberá validarse antes de implementar el flujo completo.

La mejora para procesar lotes mayores mediante almacenamiento temporal cifrado privado y acotado queda diferida en [Todoist: procesar lotes de historial mayores que el buffer de recuperación](https://app.todoist.com/app/task/whatsapp-procesar-lotes-de-historial-mayores-que-el-buffer-de-recuperacion-6hhPmFpPgwRjVpRV). Requerirá definir su presupuesto, protección, recuperación y eliminación. No forma parte de v1 ni autoriza implementación en esta etapa de documentación.

Habrá una sola cuenta activa por instalación y un único cliente nativo. Se podrán conservar entregas pendientes de cuentas anteriormente desvinculadas, pero no mantener conexiones simultáneas a varias cuentas.

Este documento define el diseño; la integración nativa todavía requiere implementación y validación en dispositivos.

La etapa actual se limita a definir y revisar los detalles técnicos en este Markdown. Las carpetas, contratos y comportamientos descritos son propuestas para una implementación posterior; las comprobaciones pendientes no se ejecutarán como parte de esta definición. Los cambios del documento se mantendrán sin commits por cada ajuste.

La aplicación todavía no está en producción. No se requiere una migración de mensajes existentes ni compatibilidad con sus identificadores o referencias anteriores para introducir esta librería. Definiremos un contrato v1 nuevo; esta decisión no autoriza borrar datos ni ejecutar migraciones durante la etapa de diseño.

La [prueba aislada de bindings](whatsmeow-go-expo-probe/README.md) ya compila whatsmeow con Go 1.26.5 y genera Java/Objective-C para callbacks con errores. Fija las versiones candidatas y documenta sus límites: todavía no valida AAR/XCFramework, ejecución Expo, sesión ni recuperación tras caídas.

## Responsabilidades

```text
Expo / TypeScript
    ↕ métodos y eventos
Kotlin (Android) / Swift (iOS)
    ↕ bindings generados por gomobile
Wrapper Go → whatsmeow → WhatsApp
```

| Componente | Responsabilidad |
| --- | --- |
| Fachada TypeScript del módulo | API pública, contratos y validación de respuestas y eventos nativos. |
| Kotlin / Swift | Adaptar llamadas y callbacks, proporcionar directorios privados y administrar la persistencia segura de sesión y buffer de recuperación. |
| Wrapper Go | Conexión, QR, reconexión, normalización de mensajes, descarga de imágenes y adaptación de los stores y buffer de whatsmeow. |
| Funcionalidad WhatsApp de Expo | Persistir mensajes y referencias de imágenes, administrar la cola existente, subir archivos por HTTP y solicitar su eliminación. |

El almacenamiento definitivo de mensajes y la única cola de sincronización con core seguirán en Expo. Ya existe `src/features/whatsapp/infrastructure/local-database.ts`, con SQLite cifrado y `whatsapp_outbox`. No trasladaremos la sesión de whatsmeow a esa base ni utilizaremos `whatsapp_auth_entries` para ella.

Las tablas, consultas, transacciones y reglas de procesamiento de la app consumidora no se definirán en este documento. Tampoco se definirá ni implementará su activación JavaScript en segundo plano; resolverla no será un requisito para cerrar la interfaz de esta librería. Aquí se especificará únicamente la frontera con esa app: mensajes e identificadores entregados, referencias de imagen y confirmación explícita de persistencia local. La librería podrá validarse con un consumidor de prueba, independientemente de la integración definitiva de Expo.

Como excepción aprobada, el almacenamiento nativo conservará un buffer cifrado temporal del contenido recibido hasta que Expo confirme su commit en SQLite. Go participará mediante el adaptador de protocolo, pero las escrituras serán nativas. Este buffer sí duplica temporalmente contenido de mensajes; no será otra cola de subida a core ni un historial de conversaciones.

Los secretos y registros de protocolo requeridos internamente por whatsmeow forman parte de su estado de sesión; no reemplazan el almacenamiento de mensajes de Expo.

## Carpetas propuestas

```text
apps/mobile/modules/whatsapp/
├── .gitignore                       # Artefactos y herramientas generados
├── index.ts                         # Fachada pública
├── types.ts                         # Contratos públicos
├── expo-module.config.json          # Registro Android e iOS
├── go/
│   ├── go.mod
│   ├── go.sum
│   ├── bridge/
│   │   └── bridge.go                # API exportada compatible con gomobile
│   └── internal/
│       ├── client.go                # QR, conexión y reconexión
│       ├── messages.go              # Mensajes y descarga de imágenes
│       ├── session-store.go         # Stores de whatsmeow y confirmación durable
│       └── delivery.go              # Buffer, recuperación y confirmación de Expo
├── android/
│   ├── build.gradle
│   ├── libs/                        # AAR generado
│   └── src/main/
│       ├── AndroidManifest.xml
│       └── java/expo/modules/whatsapp/
│           ├── WhatsAppModule.kt
│           ├── WhatsAppService.kt    # Propietario del cliente Android en segundo plano
│           └── SessionStorage.kt    # Commit de sesión y buffer cifrado
├── ios/
│   ├── WhatsApp.podspec
│   ├── WhatsAppModule.swift
│   ├── SessionStorage.swift         # Commit de sesión y buffer cifrado
│   └── Frameworks/                  # XCFramework generado
├── scripts/
│   └── build-go.sh
└── README.md
```

Compilaremos únicamente el paquete `go/bridge`. Los tipos de whatsmeow permanecerán en `internal/`, fuera de la API exportada a gomobile. La integración de negocio continuará en `src/features/whatsapp/`, fuera del módulo.

## Interfaz TypeScript

Los contratos siguientes son la propuesta pública. Se validarán los datos que crucen la frontera nativa reutilizando Zod, ya instalado en mobile.

```ts
import type { Result } from "@shared/result";

type MessageDirection = "incoming" | "outgoing";

type WhatsAppErrorCode =
  | "MODULE_UNAVAILABLE"
  | "NOT_INITIALIZED"
  | "INVALID_INPUT"
  | "INVALID_NATIVE_RESPONSE"
  | "NATIVE_CALL_FAILED"
  | "CONNECTION_FAILED"
  | "SESSION_EXPIRED"
  | "SESSION_STORAGE_FAILED"
  | "SESSION_STORAGE_LIMIT_REACHED"
  | "SESSION_STATE_INVALID"
  | "IDENTITY_UNAVAILABLE"
  | "ACCOUNT_NOT_CONNECTED"
  | "RECOVERY_BUFFER_FULL"
  | "HISTORY_LIMIT_REACHED"
  | "STORAGE_LIMIT_REACHED"
  | "IMAGE_UNAVAILABLE"
  | "IMAGE_DOWNLOAD_FAILED"
  | "IMAGE_DELETE_FAILED"
  | "REMOTE_LOGOUT_UNCONFIRMED";

interface WhatsAppError {
  code: WhatsAppErrorCode;
  message: string;
}

type ConnectionState =
  | "disconnected"
  | "connecting"
  | "awaitingQr"
  | "connected"
  | "reconnecting"
  | "sessionExpired";

interface WhatsAppOptions {
  maxImageStorageBytes?: number;   // Default: 50 * 1024 * 1024
  maxRecoveryBufferBytes?: number; // Default: 10 * 1024 * 1024
}

interface ImageReference {
  messageId: string;
  downloadReference: string; // Descriptor opaco, serializable y versionado
}

interface ReceivedMessage {
  id: string;
  accountId: string; // Cuenta de origen; también en entregas recuperadas
  whatsappMessageId: string;
  chatId: string;
  direction: MessageDirection;
  timestamp?: number; // Unix en milisegundos; ausente (o null en el borde nativo) = fecha desconocida, nunca 0 (decisión 2026-10-10)
  text?: string;     // Texto o caption de la imagen
  image?: {
    mimeType?: string;
    size?: number;   // Bytes, si se conoce antes de descargar
    reference: ImageReference;
  };
}

interface DownloadedImage {
  uri: string;
  mimeType: string;
  size: number;
}

interface WhatsAppEvents {
  qr: { value: string; expiresAt: number };
  connectionChanged: { state: ConnectionState };
  messageReceived: { deliveryId: string; message: ReceivedMessage };
  error: WhatsAppError;
}

interface WhatsAppClient {
  initialize(options?: WhatsAppOptions): Promise<Result<void, WhatsAppError>>;
  connect(): Promise<Result<void, WhatsAppError>>;
  disconnect(): Promise<Result<void, WhatsAppError>>;
  logout(): Promise<Result<void, WhatsAppError>>;

  confirmMessageStored(deliveryId: string): Promise<Result<void, WhatsAppError>>;

  downloadImage(reference: ImageReference): Promise<Result<DownloadedImage, WhatsAppError>>;
  deleteDownloadedImage(messageId: string): Promise<Result<void, WhatsAppError>>;

  addListener<E extends keyof WhatsAppEvents>(
    event: E,
    listener: (payload: WhatsAppEvents[E]) => void,
  ): { remove(): void };
}
```

`id` será estable y distinguirá cuenta, chat y mensaje. Expo conservará esa asociación al persistir los mensajes, incluso después de desvincular o vincular otra cuenta.

`accountId` será el LID canónico de la cuenta de origen, no el dispositivo vinculado ni la cuenta que esté activa al reemitir un pendiente. Expo utilizará este dato para asociar la entrega a su contexto de negocio; no deducirá la cuenta de una variable global del cliente activo.

La referencia de imagen contendrá los datos necesarios para descargar y descifrar el adjunto, mediante el descriptor v1 propuesto abajo. El consumidor la conservará como dato opaco; no deberá registrarla en logs. El wrapper validará el descriptor al recibirlo y no aceptará rutas de archivos arbitrarias.

Esto ajusta la propuesta inicial `downloadImage(messageId)`: un identificador por sí solo no permite recuperar el adjunto después de reiniciar si Go no persiste los mensajes ni sus referencias.

No habrá `getPendingMessages()` ni `acknowledgeMessages()` para la sincronización con core en la librería. Estas operaciones corresponden a la cola de Expo. `confirmMessageStored(deliveryId)` tendrá otro significado: confirmar que el mensaje ya está comprometido en SQLite local, para retirar su contenido del buffer nativo. No confirmará una subida a core ni eliminará imágenes.

`deliveryId` será un identificador opaco asignado al crear el registro de recuperación y persistido con su cuenta y revisión de creación. Permanecerá igual durante reemisiones y commits posteriores del contenedor; no se recalculará desde la revisión vigente. La confirmación será idempotente y no podrá confirmar accidentalmente un registro de otra cuenta. Expo registrará su listener antes de iniciar la recuperación de entregas y confirmará únicamente después del commit local.

### Identidad del mensaje y de su entrega

Proponemos mantener dos identidades distintas: `message.id` representa el mensaje de WhatsApp; `deliveryId` representa una entrega pendiente que el consumidor puede confirmar. Reemitir un pendiente conservará ambas. Recibir otra vez el mismo mensaje después de retirar su pendiente podrá crear otro `deliveryId`, conservando `message.id`.

| Campo | Regla |
| --- | --- |
| `accountId` | LID de la cuenta de origen en formato `<id>@lid`, sin componente de dispositivo vinculado. No cambia por reiniciar ni por emitir un pendiente mientras otra cuenta está activa. |
| `chatId` | LID del interlocutor del chat individual en formato `<id>@lid`, sin componente de dispositivo. Historial y recepción en vivo utilizarán la misma normalización. |
| `whatsappMessageId` | ID original del protocolo, conservado sin modificar mayúsculas, minúsculas ni contenido. |
| `message.id` | Codificación determinista y versionada de `[accountId, chatId, whatsappMessageId]`, independiente del timestamp, texto, imagen, dirección y revisión de almacenamiento. |
| `deliveryId` | ID aleatorio de la entrega pendiente, creado una vez y persistido antes de emitir. No se reutiliza para un mensaje nuevo ni cambia al reemitir el mismo pendiente. |

Para `message.id` proponemos `wa-message:v1:` seguido de Base64 URL-safe sin padding del array JSON compacto UTF-8 producido por el adaptador Go. La construcción quedará centralizada en Go; Kotlin/Swift y TypeScript tratarán el resultado como opaco. Codificar una tupla evita colisiones por concatenar campos con un separador que también pudiera aparecer en un ID.

Para `deliveryId` proponemos `wa-delivery:v1:` seguido de 16 bytes aleatorios criptográficos codificados como 32 caracteres hexadecimales en minúsculas. Se comprobará que no colisione con un pendiente existente antes de admitirlo. La confirmación validará ese formato, buscará exactamente ese registro y nunca utilizará la cuenta activa como sustituto de su cuenta de origen.

Usaremos LID como representación canónica acordada. Se conservará el JID completo como cadena, sin convertir su parte numérica a `number`. El adaptador retirará el componente de dispositivo mediante [`ToNonAD`](https://github.com/tulir/whatsmeow/blob/9399289b022b/types/jid.go). Si el protocolo entrega una dirección por número (PN), utilizará la correspondencia de [`LIDStore`](https://github.com/tulir/whatsmeow/blob/9399289b022b/store/store.go) para obtener su LID; retirar el dispositivo por sí solo no convierte PN en LID.

El número de teléfono y el username no serán necesarios para identificar el chat ni participarán en `message.id`. Tampoco se utilizarán para fabricar un LID. Cuando falte la correspondencia PN/LID se aplicará la propuesta de conservación descrita abajo; no se emitirá un ID provisional basado en PN o username que después cambie de identidad.

Los identificadores públicos asignados se conservarán con el pendiente y sus referencias de imagen. La recuperación no los recalculará utilizando el cliente actual. Los ejemplos y verificaciones posteriores deberán cubrir el mismo mensaje histórico/en vivo, repetición tras retirar el pendiente, cambio de dispositivo, PN/LID y recuperación de una cuenta desvinculada. El diseño del procesamiento que realice el consumidor seguirá fuera del alcance.

### Correspondencia PN/LID todavía ausente

El adaptador utilizará primero el LID recibido del protocolo o su dirección alternativa verificada para el mismo interlocutor. Si solo dispone de PN, consultará las correspondencias de `LIDStore`. Una ausencia válida será distinta de un fallo al leer el store: la primera dejará la identidad pendiente; el segundo activará la parada por fallo local de persistencia.

Si todavía no conoce el LID del chat, conservará la entrega en el mismo buffer cifrado, con `deliveryId`, LID de la cuenta de origen, dirección original, metadatos y contenido recuperable. Esa conservación se comprometerá junto con los cambios criptográficos antes de avanzar. Todavía no emitirá `ReceivedMessage` ni permitirá confirmar esa recepción al protocolo. Para admitirla deberá conocer el LID de la cuenta propia; una cuenta aún no identificada no recibirá un `accountId` provisional.

Al incorporar una correspondencia verificada se completarán `chatId` y `message.id` y se publicarán durablemente con el pendiente antes de emitirlo. La recuperación al iniciar reevaluará también los pendientes sin identidad final. No habrá polling de red ni reconstrucción del cliente por cada correspondencia ausente; se utilizarán los datos disponibles y las actualizaciones del protocolo.

El coordinador mantendrá una sola entrega pública en curso, recorriendo los pendientes que ya tengan identidad definitiva en su orden de creación. Podrá saltar temporalmente los que todavía no la tengan para que un contacto sin correspondencia no bloquee todos los demás. Los pendientes sin resolver seguirán consumiendo el presupuesto del buffer y no vencerán. La admisión reservará dentro de ese mismo presupuesto el espacio necesario para completar sus identificadores, según los límites del contrato interno; no creará otro archivo, historial ni presupuesto de confirmaciones.

El código `IDENTITY_UNAVAILABLE` informará que existen recepciones conservadas que aún no pueden emitirse con identidad definitiva. No significará corrupción de sesión ni provocará reintentos continuos de conexión. Se notificará al entrar en esa condición, sin emitir un error por cada recorrido del mismo pendiente. Si se agota el buffer, aplicará `RECOVERY_BUFFER_FULL` y se conservarán todos los registros admitidos.

`logout()` conservará también esos pendientes y sus datos de origen. Antes de retirar la sesión se completarán las correspondencias que ya puedan verificarse con el estado disponible. Si una correspondencia nunca llegó, eliminar credenciales no la creará: el registro permanecerá legible, pero su emisión requerirá obtener información verificable para la cuenta de origen. No se resolverá utilizando arbitrariamente el cliente de otra cuenta. El contrato de recuperación sin credenciales aplica a pendientes con identidad ya resuelta; resolver los demás dependerá de disponer de esa información. Ambos comportamientos requieren pruebas nativas posteriores.

Esta política está acordada y requiere implementación y validación posteriores. Se comprobará la llegada tardía de correspondencias, reinicio, logout con identidad pendiente, capacidad reservada y la posibilidad de procesar actualizaciones del protocolo mientras otra entrega espera confirmación, sin bloquear la resolución.

La fachada seguirá el patrón de `brother-printer`: validará respuestas nativas con Zod y devolverá `Result` utilizando `ok`/`err` de `@shared/functional`. No implementaremos otro formato de resultados ni una jerarquía de clases de error.

Los fallos esperados de métodos devolverán `success: false`; las excepciones del puente nativo se capturarán y convertirán en errores explícitos. El evento `error` cubrirá fallos fuera de una llamada concreta. Los callbacks de Go transportarán contratos propios serializados como JSON; las imágenes no cruzarán hacia JavaScript como bytes o base64.

## Errores y recuperación

Expo tomará decisiones por `code`, sin interpretar el texto de `message`. Los mensajes serán diagnósticos saneados, sin claves, QR, contenido de conversaciones ni referencias sensibles de imágenes. La app será responsable del texto traducido que muestre al usuario.

| Código | Comportamiento esperado |
| --- | --- |
| `MODULE_UNAVAILABLE` | Build sin el módulo o plataforma no soportada. Informar la indisponibilidad; no reintentar en bucle. |
| `NOT_INITIALIZED` | Preparar mediante `initialize()` la capacidad que requiere la operación. Un fallo exclusivo de sesión no deshabilita la recuperación local ya validada. |
| `INVALID_INPUT` | Corregir opciones, identificadores o referencias inválidas; no repetir la misma entrada. |
| `INVALID_NATIVE_RESPONSE` / `NATIVE_CALL_FAILED` | El resultado no se puede verificar. Conservar datos y tratarlo como incierto; no afirmar éxito ni borrar sesión. |
| `CONNECTION_FAILED` | Reintentar automáticamente solo fallos transitorios de red mientras la conexión siga solicitada. Un inicio de servicio rechazado o un proceso QR terminado requiere una nueva solicitud explícita. |
| `SESSION_EXPIRED` | Detener reintentos de autenticación y solicitar nueva vinculación por QR. |
| `SESSION_STORAGE_FAILED` / `SESSION_STATE_INVALID` | Detener el procesamiento afectado y la conexión; conservar archivos y evitar una restauración o eliminación silenciosa. Una sesión inválida con contenedor validado permite la recuperación local y retirada explícita de sesión descritas abajo. |
| `IDENTITY_UNAVAILABLE` | Conservar recepciones sin identidad definitiva y esperar una correspondencia verificable. Continuar con pendientes resolubles; no tratar la ausencia como una sesión corrupta. |
| `ACCOUNT_NOT_CONNECTED` (propuesto) | Una descarga nueva requiere la cuenta de origen conectada. Conservar la referencia; no conectar otra cuenta ni interpretar el adjunto como eliminado. |
| `RECOVERY_BUFFER_FULL` | Si falta espacio por otros pendientes, pausar y reanudar al liberar capacidad suficiente, mientras siga solicitado. Si un mensaje o lote supera por sí solo el presupuesto, informar el rechazo sin admisión parcial ni reintento automático interminable. |
| `STORAGE_LIMIT_REACHED` | No descargar más imágenes hasta liberar espacio o ajustar su presupuesto. |
| `SESSION_STORAGE_LIMIT_REACHED` (propuesto) | Conservar la revisión publicada y detener cambios de protocolo; no borrar claves ni registros para reducir su tamaño. |
| `HISTORY_LIMIT_REACHED` (propuesto) | Detener el procesamiento del lote que supera el límite de descarga o descompresión; no emitir parcialmente ni tratarlo como un fallo transitorio de red. |
| `IMAGE_UNAVAILABLE` | El adjunto ya no está disponible o no puede recuperarse; mantener el mensaje y registrar la condición. |
| `IMAGE_DOWNLOAD_FAILED` | Limpiar el archivo parcial; reintentar explícitamente cuando se resuelva el fallo transitorio. |
| `IMAGE_DELETE_FAILED` | El archivo seguirá contando contra el límite; reintentar el borrado sin afirmar que se liberó espacio. |
| `REMOTE_LOGOUT_UNCONFIRMED` | La sesión local puede estar eliminada sin confirmación de desvinculación remota. Informar esa incertidumbre; no restaurar credenciales eliminadas. |

Un fallo de escritura de sesión o recuperación tendrá prioridad sobre el reintento de conexión: reconectar automáticamente no corregirá un estado que no pudo guardarse. Un callback inválido no confirmará una entrega. La repetición de confirmaciones y borrados idempotentes permitirá resolver respuestas perdidas sin duplicar operaciones de negocio.

Para los éxitos sin datos, la fachada devolverá `ok(undefined)`. El consumidor comprobará `result.success` antes de usar `result.data` o considerar terminada una operación. La suscripción a eventos conservará el contrato estándar con `remove()`.

### Estado inicial al suscribirse

**Decisión acordada:** un nuevo listener de `connectionChanged` recibirá el estado vigente del controlador preparado y después sus cambios. Si se registra antes de `initialize()`, esperará a que se prepare el controlador. No se deducirá `connected` de la mera existencia de credenciales persistidas. Una sesión inválida con recuperación local disponible tendrá conexión `disconnected`; el error de inicialización comunicará la causa.

Un nuevo listener de `qr` recibirá el QR vigente solamente si el controlador sigue en `awaitingQr` y el valor no ha vencido, conservando su `expiresAt` original. Suscribirse no generará otro QR ni reiniciará su vencimiento. Al salir de `awaitingQr` se invalidará el QR; los valores vencidos o invalidados pendientes de emitir se descartarán.

El controlador ordenará la entrega inicial con los cambios posteriores para que un estado antiguo no llegue después de uno nuevo. Cada reproducción inicial se dirigirá únicamente al listener recién registrado; no provocará emisiones adicionales a los anteriores. `connectionChanged`, `qr` y `error` admitirán varios listeners, pero los errores pasados no se reproducirán. Registrar listeners no iniciará una conexión. La suscripción única de `messageReceived` tendrá las reglas de sustitución y recuperación descritas en la sección de entrega durable.

## Configuración del límite de recuperación

En Yoyos, el límite del buffer se configurará mediante una variable de entorno de Expo, en `apps/mobile/.env` o en el entorno que genere el bundle:

```dotenv
EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB=10
```

La composición de mobile leerá esa variable, validará un entero positivo en MiB y lo convertirá a bytes antes de llamar al módulo. Si no está definida, utilizará 10 MiB. Un valor definido pero inválido producirá un error de configuración; no se sustituirá silenciosamente por el default.

```ts
const mib = Number(process.env.EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB ?? "10");
const maxRecoveryBufferBytes = mib * 1024 * 1024;

if (!Number.isSafeInteger(mib) || mib <= 0 || !Number.isSafeInteger(maxRecoveryBufferBytes)) {
  throw new Error("Invalid EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB");
}

const result = await WhatsApp.initialize({ maxRecoveryBufferBytes });
// La composición propagará result y el consumidor comprobará result.success.
```

`maxRecoveryBufferBytes` seguirá siendo el parámetro de la interfaz nativa; la variable de entorno será la fuente de configuración de Yoyos. Go y Kotlin/Swift recibirán el valor validado y no leerán el archivo `.env` del proyecto. La configuración se compondrá fuera de `src/app/` y del módulo reutilizable.

Expo sustituye las referencias estáticas `process.env.EXPO_PUBLIC_*` en el bundle JavaScript. Este límite no es un secreto y puede ser público. Cambiar la variable requerirá regenerar o recargar el bundle correspondiente; no cambia la configuración de una app ya ejecutándose ni exige recompilar Go por sí solo.

### Actualización de límites acordada

Se podrán actualizar los límites mediante `initialize(options)` con la conexión detenida. La secuencia será `disconnect()` exitoso → `initialize()` con las nuevas opciones → `connect()` cuando se quiera reanudar. Repetir opciones equivalentes será idempotente. Mientras exista una solicitud de conexión, incluyendo QR, reconexión o pausa por buffer lleno, opciones distintas devolverán `INVALID_INPUT`; no bastará observar el estado público `disconnected` si todavía existe intención de recepción.

La actualización se serializará con el almacenamiento y las operaciones de archivos. Esperará a que una descarga anterior cancelada termine su limpieza antes de aplicar el límite de imágenes, sin bloquear el writer de sesión durante esa espera. Devolverá éxito solo después de guardar la configuración efectiva. Una recreación posterior del servicio utilizará esos valores. Un fallo conservará el tratamiento de resultado incierto y relectura del estado publicado; no se afirmará que el cambio terminó.

Reducir un límite por debajo de lo ocupado será válido y no eliminará datos. El buffer permitirá recuperar y confirmar pendientes, pero no admitirá contenido nuevo hasta disponer de capacidad suficiente. Las imágenes completas podrán reutilizarse o borrarse; no se admitirán descargas nuevas que excedan el presupuesto. Las escrituras necesarias para drenar pendientes y guardar configuración deberán seguir siendo posibles aunque el contenido conservado exceda el nuevo límite. La lectura de datos ya admitidos se validará separadamente de la capacidad para nuevas admisiones, incluso después de reiniciar.

El formato deberá conservar una cota de lectura confiable suficiente para los snapshots ya admitidos; reducir el presupuesto de admisión no reducirá esa cota mientras pueda necesitarse para recuperar datos. Su persistencia y validación previa a reservar memoria se concretarán con el almacenamiento nativo. No se aceptarán longitudes arbitrarias del archivo por el hecho de permitir datos por encima del nuevo presupuesto. Aumentar el buffer tampoco garantiza recuperar un lote rechazado cuyo recurso remoto haya desaparecido.

### Límites internos propuestos

Los siguientes valores serán una propuesta inicial para medir en dispositivos. No representan límites de WhatsApp ni tamaños ya comprobados en cuentas reales. El buffer configurable y el presupuesto de imágenes mantendrán sus contratos existentes; los tres límites nuevos serán constantes internas de v1, sin añadir opciones públicas o variables de entorno en esta propuesta.

| Recurso | Límite inicial propuesto | Qué se contabiliza |
| --- | --- | --- |
| Estado de sesión | 16 MiB | Representación serializada del bloque de sesión, incluyendo registros, claves de registro, codificación binaria y sobrecarga de su cifrado. |
| Entrada de un lote histórico | 16 MiB | Bytes recibidos de la descarga y payload inline, incluyendo la sobrecarga criptográfica del transporte cuando corresponda. |
| Historial descomprimido | 32 MiB | Bytes del protobuf descomprimido, antes de construir sus objetos y normalizar mensajes. |

El presupuesto de sesión será independiente del buffer y de las imágenes. Se comprobará sobre el estado resultante de cada transacción, antes de publicar: alcanzar exactamente el límite será válido; superarlo devolverá `SESSION_STORAGE_LIMIT_REACHED` y detendrá esa generación. No se eliminarán sesiones Signal, prekeys, correspondencias ni otros registros por antigüedad para hacer espacio. Una restauración que ya supere el límite conservará el archivo y bloqueará la conexión; la recuperación de pendientes legibles y su confirmación seguirán por su ruta independiente.

El límite de entrada se aplicará mientras se reciben bytes, sin confiar solamente en el tamaño declarado. El de descompresión se aplicará mientras se produce la salida y antes de llamar al parser protobuf; comprobarlo después de un `ReadAll` sin límite no cumple el contrato. Un lote que exceda cualquiera devolverá `HISTORY_LIMIT_REACHED`, conservará los pendientes anteriores y no se marcará como completado ni se programará para reintento automático continuo. Los cambios de protocolo del lote rechazado no deberán quedar publicados parcialmente.

Se procesará un solo lote histórico a la vez y no se acumularán lotes completos esperando al consumidor en RAM. La admisión de mensajes normalizados seguirá requiriendo que el lote completo quepa en `maxRecoveryBufferBytes`, incluyendo sus metadatos y cifrado. Por tanto, un lote puede caber en los límites de entrada y descompresión y aun devolver `RECOVERY_BUFFER_FULL`. Aumentar la variable del buffer no aumentará los límites internos de historial; estos podrán revisarse antes de implementar según mediciones y la tarea de mejora ya registrada.

32 MiB de protobuf no equivalen a 32 MiB de RAM: se suman objetos del parser, normalización, copias entre lenguajes y preparación de snapshots. La validación deberá medir ese pico y acotar profundidad, cantidades y tamaños de registros antes de materializar colecciones costosas; los umbrales concretos del esquema de registros siguen pendientes de auditoría. No se ofrecerá una garantía de memoria total del proceso basada solamente en estos tres valores.

Los parsers de snapshots y JSON interno comprobarán límites de bytes antes de decodificar campos Base64 o reservar colecciones a partir de longitudes externas. El máximo del archivo se calculará con la fórmula del formato v1 descrita abajo, comprobando overflow al sumar presupuestos; los máximos de los payloads del binding se cerrarán con su esquema de registros y expansión Base64. La segunda copia necesaria para publicar un snapshot y los temporales de imágenes también requieren espacio real en disco; los presupuestos lógicos no garantizan que exista. Una falta de espacio conservará la revisión publicada y seguirá el tratamiento de error de almacenamiento.

Antes de adoptar estos valores se comprobarán cuentas y lotes representativos, casos exactamente en el límite y un byte por encima, tamaños declarados falsos y expansión excesiva al descomprimir. Esta sección define una propuesta de límites y rechazo seguro; no implementa los controles ni autoriza ejecutarlos en esta etapa.

## Una cuenta activa y cambio de cuenta

- El módulo `WhatsApp` administrará un solo cliente. No habrá una fábrica ni un mapa público de clientes.
- Llamadas repetidas o concurrentes a `initialize()` no crearán otro cliente ni borrarán datos. Los cambios de opciones seguirán la actualización de límites con conexión detenida; no reiniciarán una sesión silenciosamente.
- `disconnect()` no permitirá vincular otra cuenta: conserva las credenciales de la cuenta actual.
- Para cambiar de cuenta, primero se ejecutará `logout()` y después `connect()` para vincular mediante un nuevo QR. Si el borrado local de credenciales falla, no se iniciará otra vinculación encima del estado existente.
- Los pendientes anteriores conservarán `accountId`, `id` y `deliveryId` de origen. Sus confirmaciones y borrados de imágenes seguirán siendo válidos aunque haya otra cuenta activa.
- Los registros de recuperación y nombres de archivos de imágenes tendrán separación por cuenta. Los límites de 10 MiB de recuperación y 50 MiB de imágenes aplicarán al total conservado por instalación, no se multiplicarán al cambiar de cuenta.

El almacenamiento nativo conservará una única sesión activa y registros de recuperación asociados a sus cuentas. Mantendrá el commit atómico entre sesión y recuperación descrito abajo; no separará esas escrituras en archivos independientes sin un mecanismo que preserve esa atomicidad.

## Conexión y ciclo de vida

- `initialize()` preparará el almacenamiento, restaurará el estado confirmado y preparará el cliente cuando la sesión sea utilizable. Con un consumidor registrado, recuperará también entregas locales sin confirmar, incluso si falla únicamente la restauración de sesión. No conectará automáticamente.
- `connect()` conectará con la sesión restaurada o emitirá QR si no existe una vinculación. Emitirá cada QR nuevo con su vencimiento; la app lo mostrará.
- Tras una pérdida de red habrá reconexión automática con esperas crecientes, un máximo y un solo intento activo.
- `disconnect()` cerrará la conexión, detendrá los reintentos y conservará la sesión. Una nueva llamada a `connect()` reanudará la conexión.
- Una sesión revocada cambiará el estado a `sessionExpired`, detendrá los reintentos de autenticación y requerirá otra vinculación.
- `logout()` detendrá conexión y reintentos, solicitará la desvinculación y eliminará el estado local de sesión y su clave. Conservará los mensajes de Expo, los archivos descargados y las entregas locales todavía sin confirmar. Estas últimas conservarán la cuenta original y podrán recuperarse sin restaurar las credenciales eliminadas. Si no se puede confirmar la desvinculación remota, la API deberá informarlo; no afirmará que WhatsApp la confirmó.

La reconexión aplica mientras el proceso pueda ejecutarse. No garantiza mantener la conexión cuando Android o iOS suspenden o terminan la app. Al reiniciar se restaurará la sesión; la recuperación de mensajes durante interrupciones requiere pruebas propias.

### MVP Android: recepción con la app minimizada

**Decisión acordada:** se descarta el modo Live. La recepción no requerirá Yoyos visible ni mantener encendida la pantalla. En Android se diseñará un servicio nativo en primer plano que mantenga el único cliente Go y el controlador de almacenamiento independientemente de la pantalla. Se acepta como condición de operación que el cliente mantenga energía, red y ajustes de batería compatibles con la recepción. Resolver restricciones de ahorro de energía queda fuera del MVP; no se prometerá latencia de segundos cuando esas condiciones no se cumplan.

`connect()` solicitará iniciar el servicio desde un contexto permitido por Android. El servicio tendrá la notificación visible requerida por la plataforma, sin contenido de mensajes o credenciales. Minimizar Yoyos o destruir una pantalla no equivaldrá a `disconnect()` ni creará otro cliente. `disconnect()` detendrá conexión, reintentos y servicio conservando sesión y pendientes; `logout()` hará lo mismo y aplicará su retirada durable y desvinculación existentes. El servicio activo no equivaldrá por sí solo al evento `connected`.

**Elección técnica propuesta:** usar `remoteMessaging` para la continuidad de mensajes de una cuenta vinculada entre dispositivos. Esa finalidad coincide con la [descripción oficial del tipo](https://developer.android.com/develop/background-work/services/fgs/service-types#remote-messaging); es una inferencia aplicada al wrapper, no una aprobación específica de Android o de Google Play para whatsmeow. La integración deberá verificar el caso real, incluyendo imágenes. La política de reinicio acordada se describe abajo; el servicio no garantiza continuar tras cualquier terminación ni un plazo de recuperación.

[Doze puede restringir red y CPU por inactividad del dispositivo](https://developer.android.com/training/monitoring-device-state/doze-standby), incluso sin activar manualmente un modo de ahorro. Por eso la condición a cargo del cliente incluye ajustes de optimización de batería adecuados, no solamente evitar el botón de ahorro. Su configuración y la validación de recepción con pantalla apagada deberán distinguirse de mantener un servicio ejecutándose.

**Frontera de la librería:** se expondrán los métodos, eventos y confirmación de persistencia ya definidos. Activar el código consumidor de Expo cuando la app esté minimizada queda fuera de esta etapa y no bloquea la definición de esa interfaz. Se mantiene una sola entrega en curso; sin consumidor se conservarán los pendientes y se aplicará la pausa existente. El servicio Go activo no demuestra por sí solo persistencia definitiva en Expo; esa integración se resolverá aparte, sin trasladarla a Go ni confirmar para liberar espacio.

Go, whatsmeow, la sesión y el descifrado permanecerán exclusivamente en el móvil. No se utilizará un receptor en servidor ni notificaciones enviadas por Yoyos para despertar la app. iOS sigue siendo una plataforma prevista para la librería, pero este servicio Android no resuelve su recepción durante suspensión; no se presenta como una garantía equivalente entre plataformas.

### Declaración e inicio del servicio Android

La declaración pertenecerá a `android/src/main/AndroidManifest.xml` del módulo y se verificará en el manifest final de la app:

| Declaración | Propósito |
| --- | --- |
| `android.permission.INTERNET` | Conexión de red del cliente Go. |
| `android.permission.FOREGROUND_SERVICE` | Ejecutar el servicio en primer plano. |
| `android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING` | Permiso del tipo elegido en Android 14 o superior. |
| Servicio `expo.modules.whatsapp.WhatsAppService` | `exported="false"`, `stopWithTask="false"` y `foregroundServiceType="remoteMessaging"`; mismo proceso de la app, sin proceso remoto adicional. |

El [tipo `remoteMessaging`](https://developer.android.com/develop/background-work/services/fgs/service-types#remote-messaging) no exige permisos runtime propios. En versiones anteriores a API 34 se utilizará el servicio en primer plano con las llamadas compatibles, sin pasar una constante de tipo inexistente. Los mínimos SDK seguirán los de la app.

El arranque seguirá el [flujo oficial](https://developer.android.com/develop/background-work/services/fgs/launch): solicitud explícita desde un contexto permitido → creación del servicio → publicación inmediata de su notificación y promoción a primer plano → validación de almacenamiento y preparación del cliente fuera del hilo principal → conexión. La lectura, descifrado o inicialización Go no retrasarán la promoción exigida por Android. Durante una recreación se publicará primero un estado genérico de preparación; si no existe intención válida de recepción, se retirará la notificación y se detendrá el servicio.

Se usará un canal estable `whatsapp-connection`, de importancia baja, y un ID de notificación reservado por la app para este servicio. El contenido será genérico, por ejemplo «Conexión de WhatsApp activa»; no expondrá QR, número, cuenta, mensajes ni claves. La notificación abrirá la app mediante una intención explícita e inmutable, sin nuevas acciones de descarga o desvinculación. Descartar la pantalla de recientes no detendrá voluntariamente el servicio, aunque no evitará que el sistema termine el proceso.

La librería no abrirá un diálogo de permisos dentro de `connect()`. Si la app decide solicitar `POST_NOTIFICATIONS`, gestionará su declaración y solicitud en su propia interfaz. Android permite iniciar un servicio en primer plano sin conceder ese permiso: debe seguir publicando su notificación, pero el usuario puede verla únicamente en el administrador de tareas, según la [documentación de permisos de notificación](https://developer.android.com/develop/ui/compose/notifications/notification-permission). Su denegación no se tratará como pérdida de la sesión.

Si Android rechaza iniciar o promover el servicio, se retirará la solicitud de recepción, se conservarán sesión y pendientes y se comunicará `CONNECTION_FAILED` sanitizado. Si el rechazo ocurre antes de aceptar `connect()`, devolverá un `Result` fallido; si ocurre después, utilizará `error` y `connectionChanged: disconnected`. No se repetirá un inicio prohibido en bucle ni se cambiará automáticamente a otro tipo de servicio. Los fallos al persistir la retirada mantendrán la prioridad de error de almacenamiento existente.

Esta elección fija la propuesta de integración. Queda comprobar el arranque, el manifest combinado y la recepción en Android real; si la app se distribuye por Google Play, también deberá justificar el uso del servicio según sus requisitos vigentes. No se sustituirá esta comprobación por declarar varios tipos sin relación con la función.

### Reinicio del servicio Android

**Política acordada:** el servicio utilizará `START_STICKY` para permitir que Android intente recrearlo si termina su proceso mientras estaba activo. Esa recreación no tiene un plazo garantizado, según el [contrato de Service](https://developer.android.com/reference/android/app/Service#START_STICKY).

| Situación | Comportamiento del MVP |
| --- | --- |
| Android termina el proceso del servicio activo | Al recrearlo, validar almacenamiento y restaurar una única conexión con la sesión vinculada, si la recepción sigue solicitada. |
| Reinicio del teléfono | No iniciar por `BOOT_COMPLETED`; esperar una nueva llamada a `connect()` desde un contexto permitido. |
| `disconnect()` o `logout()` | Retirar la solicitud de recepción y detener el servicio; una nueva conexión requiere `connect()`. |
| Usuario fuerza la detención o detiene la app desde Android | No programar tareas o alarmas para contrarrestar la detención; esperar que vuelva a abrir la app y solicite `connect()`. |
| Sesión ausente, revocada o almacenamiento inválido | No iniciar QR ni restaurar una copia anterior en segundo plano; conservar el tratamiento de errores y la vinculación explícita. |

**Mecanismo interno propuesto:** conservar `androidService` dentro del contenedor cifrado publicado por el mismo writer. Será `null` en iOS o antes de preparar el módulo en Android; en Android contendrá exactamente `receiveRequested: boolean` y `accountId: string | null`. Los límites efectivos estarán en `options`, un campo del mismo contenedor compartido por ambas plataformas. `androidService` no contendrá una generación Go persistida ni un estado de conexión supuesto. Sus bytes pertenecerán al presupuesto de metadatos de control existente.

`initialize()` conservará las opciones efectivas en `options` sin activar recepción. `connect()` habilitará la restauración automática únicamente cuando exista una sesión vinculada; una vinculación QR completada publicará conjuntamente la sesión y su solicitud de recepción. La recreación nativa restaurará `options` de esa misma revisión sin ejecutar JavaScript ni leer `.env`, comprobará que la cuenta coincide y creará una generación nueva. Al volver Expo, `initialize()` adoptará ese controlador con opciones equivalentes, sin duplicarlo. Para aplicar opciones distintas se detendrá primero la conexión mediante `disconnect()` y se seguirá la actualización de límites acordada. Esta recreación interna no cambia la regla de que una llamada pública a `initialize()` no conecta por sí sola.

`disconnect()` deshabilitará durablemente `receiveRequested` antes de devolver éxito y detendrá el servicio; `logout()` lo hará antes de intentar la desvinculación y conservará esa desactivación al retirar credenciales. Un fallo local que requiera intervención explícita también retirará la solicitud y detendrá el servicio, sin usar `START_STICKY` como reintento de almacenamiento. Si falla guardar la desactivación, se detendrá la ejecución y se devolverá o emitirá el error de almacenamiento; no se afirmará que la intención quedó persistida. Las carreras entre parada, publicación y recreación requieren pruebas nativas.

El reinicio no confirma pendientes ni inicia un consumidor Expo. Si este no está disponible, seguirá aplicándose la pausa y recuperación existentes. La detención desde el administrador de Android puede terminar la app sin callbacks, según la [documentación de detención por el usuario](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping); no se dependerá de `onDestroy()` para guardar mensajes o registrar esa acción. No se añadirán receptores de arranque, alarmas ni opciones públicas de reinicio en el MVP.

### Resultado de los métodos y llamadas repetidas

Proponemos separar la aceptación de una conexión de su resultado posterior. `connect()` devolverá éxito cuando el controlador haya aceptado iniciar o mantener la conexión solicitada; la app comprobará `connectionChanged: connected` para saber que la conexión se completó. La espera del usuario para escanear el QR no mantendrá la llamada pendiente. Un error detectado antes de aceptar la operación devolverá `Result` fallido; los errores posteriores se informarán mediante `error` y el cambio de estado correspondiente.

| Método | Cuándo devuelve éxito | Repetición |
| --- | --- | --- |
| `initialize()` | Al validar el almacenamiento y preparar el cliente y la recuperación local, sin esperar confirmaciones de mensajes; una sesión inválida seguirá devolviendo error con recuperación local disponible cuando sea legible. | Con opciones equivalentes, reutiliza la preparación o cliente. Opciones distintas requieren conexión detenida y actualización durable de límites. |
| `connect()` | Al aceptar la solicitud de conexión. | Durante conexión, QR, conexión activa o reconexión, conserva una sola solicitud; no abre otro cliente ni genera otra vinculación paralela. |
| `disconnect()` | Al detener la generación de protocolo y sus reintentos, conservando el estado durable. | Si ya está desconectado, éxito sin otra operación. |
| `logout()` | Al completar la retirada local durable de sesión y su clave, con desvinculación remota confirmada cuando corresponda. | Llamadas simultáneas comparten el resultado. Si ya no existe sesión ni limpieza pendiente, éxito local sin otra operación; no certifica una desvinculación remota anterior. |
| `confirmMessageStored()` | Al retirar el pendiente durablemente o verificar que el identificador válido no tiene pendiente. | Borrado idempotente, sin conservar un historial de confirmaciones. |

La preparación de `initialize()` será única para llamadas simultáneas y las actualizaciones de opciones se serializarán. Una preparación fallida no se reutilizará como éxito; un intento posterior deberá volver a validar el estado afectado. Antes de preparar la capacidad que necesita cada método devolverá `NOT_INITIALIZED`; registrar listeners seguirá permitido. Un fallo de sesión no retirará la capacidad de almacenamiento ya validada.

### Inicialización parcial y sesión inválida

**Decisión acordada:** el controlador distinguirá internamente almacenamiento disponible y sesión utilizable, sin añadir estados públicos. Un resultado fallido de `initialize()` no significará por sí solo que toda operación local quedó deshabilitada.

| Situación | Resultado de `initialize()` | Capacidades |
| --- | --- | --- |
| Almacenamiento válido y sesión válida o ausente | Éxito | Recuperación local y conexión; sin sesión, `connect()` iniciará QR. |
| Buffer legible y validado, pero sesión inválida | `SESSION_STATE_INVALID` | Recuperar y confirmar pendientes con identidad resuelta; conexión bloqueada. |
| Contenedor de recuperación no validable | Error de almacenamiento o estado | Recuperación y conexión bloqueadas; conservar archivos y claves. |

En la inicialización parcial, `confirmMessageStored()` utilizará el almacenamiento validado y no devolverá `NOT_INITIALIZED` por el fallo de sesión. El consumidor conservará sus listeners y podrá seguir persistiendo los mensajes recuperados. `connect()` devolverá el error de sesión mientras no se resuelva; no iniciará QR encima del estado inválido.

`logout()` estará disponible si el contenedor está validado y permite identificar con seguridad la clave de sesión que debe retirarse. Aplicará la eliminación durable existente conservando pendientes; si no puede verificarse la desvinculación remota, devolverá `REMOTE_LOGOUT_UNCONFIRMED`. Tras completar la retirada local, `connect()` podrá iniciar una vinculación nueva. Si falta la clave del contenedor o este está corrupto, no se intentará una limpieza selectiva ni se borrarán datos automáticamente. La recuperación de pendientes sin identidad resuelta conserva sus restricciones PN/LID existentes.

### Serialización y cierre de operaciones

El controlador serializará las decisiones de conexión, desconexión y logout en su orden de admisión. Una parada invalidará la generación y descartará sus QR y cambios de conexión tardíos. No esperará un commit futuro de Expo para completar la parada: cancelará la espera del manejador de protocolo, preservando el pendiente durable y sin reportarlo como confirmado. Las confirmaciones y la recuperación local tendrán su ruta independiente sobre el writer nativo.

Cada QR emitido sustituirá al anterior. Al salir de `awaitingQr`, la app dejará de mostrarlo; un valor vencido no seguirá considerándose disponible mientras espera el siguiente. Una sesión revocada no iniciará un QR por reconexión automática: `connect()` devolverá `SESSION_EXPIRED` hasta que la app solicite `logout()` para retirar el estado anterior y después `connect()` para una nueva vinculación.

Si `logout()` retira correctamente las credenciales locales pero no confirma el resultado remoto, devolverá `REMOTE_LOGOUT_UNCONFIRMED` manteniendo la conexión detenida. Si falla la retirada local, devolverá el error de almacenamiento y bloqueará una nueva vinculación hasta resolverla. Se verificará en una implementación posterior que la parada cancele esperas sin perder pendientes y que las llamadas repetidas no produzcan clientes ni vinculaciones adicionales.

### Esperas y reintentos

Los tiempos siguientes serán los valores internos iniciales acordados, pendientes de medición durante la implementación. No añadiremos opciones públicas ni variables de entorno para ellos en esta versión.

| Operación | Tiempo o política | Al terminar el plazo o fallar |
| --- | --- | --- |
| Establecer conexión de red y autenticación | 30 segundos por intento, excluyendo la espera de escaneo de QR. | Cancelar el intento y comunicar `CONNECTION_FAILED`; una sesión vinculada podrá usar la reconexión automática mientras siga solicitada. |
| Reconexión por fallo transitorio de red | Esperas de 1, 2, 4, 8, 16 y después 30 segundos entre intentos; uno activo a la vez. | Mantener el tope de 30 segundos mientras siga solicitada. Reiniciar la espera tras una conexión completada. |
| Descarga de una imagen | 60 segundos por intento de descarga, excluyendo la espera en la cola. | Cancelar y limpiar el archivo incompleto; liberar solamente espacio efectivamente retirado. Devolver `IMAGE_DOWNLOAD_FAILED`, o el error de capacidad cuando corresponda. No reintentar automáticamente. |
| Desvinculación remota | 15 segundos para obtener confirmación remota. | Continuar con la retirada local segura y devolver `REMOTE_LOGOUT_UNCONFIRMED` si no se verificó el resultado remoto. |
| Confirmación de una entrega por el consumidor | Sin vencimiento automático. | Conservar el pendiente y esperar una confirmación explícita o la cancelación de la espera por el controlador; no descartar ni confirmar por tiempo transcurrido. |

La espera del QR utilizará el vencimiento recibido del protocolo. Cuando ese proceso termine sin vinculación, se retirará el QR, se emitirá `CONNECTION_FAILED` y el estado será `disconnected`; otra solicitud explícita de conexión podrá iniciar una nueva vinculación. No se fabricará un vencimiento ni se repetirá indefinidamente el proceso de QR por un temporizador propio.

`disconnect()`, `logout()` y la parada por un fallo local cancelarán los intentos de red y sus esperas. La reconexión automática no tratará una sesión revocada, almacenamiento inválido, buffer lleno ni falta de consumidor como si fueran fallos transitorios de red. La confirmación tardía de un pendiente durable seguirá siendo válida después de detener su espera original.

Los plazos se medirán con tiempo monotónico mientras el proceso pueda ejecutarse. La suspensión de la app no garantizará ejecución de temporizadores; al reanudarse se comprobará la vigencia de las operaciones y se evitarán intentos concurrentes o resultados de generaciones retiradas.

Un deadline solicitará cancelación, sin certificar que todo I/O haya terminado exactamente en ese instante. Las operaciones deberán finalizar o aislar sus resultados antes de reutilizar sus recursos. Las escrituras nativas no se darán por fallidas y revertidas solamente porque haya vencido una espera: cualquier resultado incierto se resolverá leyendo el estado publicado, conforme al contrato de persistencia.

## Persistencia segura de la sesión

La sesión de whatsmeow no es un token ni solamente los datos obtenidos después del QR. Incluye identidad, claves, sesiones Signal por dispositivo y estado del protocolo que cambia al enviar y recibir. whatsmeow entrega los mensajes descifrados; necesita ese estado interno para poder procesarlos.

Go mantendrá el estado activo en memoria. Implementaremos los stores necesarios de whatsmeow con un adaptador hacia almacenamiento nativo privado y cifrado, administrado por Kotlin/Swift. No será un evento público de sesión que JavaScript persista posteriormente ni dependerá del SQLite de Expo.

### Contrato de escritura

```text
whatsmeow solicita guardar un cambio
    → adaptador Go solicita persistencia nativa
    → Kotlin/Swift cifra y confirma la escritura durable
    → el store devuelve éxito a whatsmeow
```

El retorno exitoso de una escritura significará que el cambio está comprometido en almacenamiento durable. Actualizar memoria o encolar una tarea no contará como persistencia. No esperaremos al cierre de la app ni utilizaremos guardados periódicos con una ventana de pérdida.

Los callbacks de almacenamiento serán internos y bloqueantes respecto de la operación Go, ejecutados fuera del hilo de interfaz. Deberán propagar errores de cifrado, lectura y escritura. Si falla una escritura, se detendrá el procesamiento del cliente, se descartará el estado en memoria no confirmado y se emitirá un error; no se continuará silenciosamente con ese estado.

Los cambios se serializarán y los grupos que deban ser consistentes se guardarán de manera atómica. El almacenamiento cifrado tendrá versión de formato y revisión monotónica para impedir escrituras fuera de orden. Cada actualización se preparará en un archivo nuevo, se sincronizará y se reemplazará atómicamente el estado anterior; se deberá validar también la durabilidad del reemplazo y sus metadatos en cada plataforma.

Al iniciar se recuperará la última revisión confirmada. Un estado dañado, una versión incompatible o una clave ausente producirán un error explícito. No se borrará el estado ni se restaurará silenciosamente una copia antigua, porque también podría desactualizar las sesiones criptográficas.

### Protección y custodia de claves

El estado se cifrará con cifrado autenticado y nonces únicos. La clave se custodiará mediante almacenamiento seguro nativo: Keychain en iOS y protección respaldada por Android Keystore en Android. La clave y las credenciales no se expondrán en los eventos públicos ni en logs.

La protección de las entregas pendientes tendrá un ciclo de vida separado de la clave de sesión: eliminar credenciales durante `logout()` no deberá hacer ilegible el buffer. El formato de almacenamiento deberá permitir esa separación manteniendo el commit atómico de sesión y recuperación.

Los archivos de sesión estarán en directorios privados, excluidos de backups y transferencia a otro dispositivo. No se utilizará caché para guardar la sesión.

#### Política nativa propuesta de acceso

Para permitir operaciones locales con pantalla apagada, las dos claves de almacenamiento podrán utilizarse sin solicitar PIN o biometría por cada operación. Esta política será interna, sin opciones nuevas en TypeScript; no modifica la protección de la base SQLite consumidora de Expo.

| Plataforma | Claves | Archivos privados |
| --- | --- | --- |
| Android | Generar `K_recovery` y `K_session` AES-256 en `AndroidKeyStore`, no exportables, sin autenticación por uso (`setUserAuthenticationRequired(false)`) ni requisito de dispositivo desbloqueado (`setUnlockedDeviceRequired(false)` donde exista). No exigir StrongBox como condición de compatibilidad. | Directorio `whatsapp/` bajo `noBackupFilesDir` del contexto normal, con almacenamiento protegido por credenciales. No usar almacenamiento Direct Boot. |
| iOS | Guardar ambas claves en Keychain con `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, sin sincronización iCloud ni requisito biométrico. | Directorio privado persistente, excluido de backup, con protección `completeUntilFirstUserAuthentication`, también en archivos temporales antes de publicarlos. |

La configuración Android utiliza los controles documentados en [KeyGenParameterSpec](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder); el [almacenamiento protegido por credenciales](https://developer.android.com/privacy-and-security/direct-boot) evita acceder a la sesión antes del primer desbloqueo después de reiniciar. En iOS, [la clase Keychain elegida](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly) y [la protección de archivos](https://developer.apple.com/documentation/foundation/urlfileprotection/completeuntilfirstuserauthentication) permiten acceso después del primer desbloqueo, incluso al bloquear nuevamente. Esto habilita acceso al almacenamiento, no ejecución del proceso durante la suspensión de iOS.

No se admitirá recepción antes del primer desbloqueo posterior a reiniciar. Si el almacenamiento está temporalmente protegido, se detendrá la operación con un error de acceso, conservando archivos y claves; no se confundirá con instalación vacía ni se generarán claves de reemplazo. Una clave realmente ausente o inválida seguirá el tratamiento `SESSION_STATE_INVALID` existente. La disponibilidad con pantalla bloqueada y el comportamiento antes/después del primer desbloqueo deberán validarse en dispositivos; la política de recreación del servicio Android se define en la sección de ciclo de vida.

### Formato propuesto: una revisión, dos claves

La primera implementación utilizará un snapshot completo `state.bin` y un temporal `state.next` en el mismo directorio privado. Cada commit publicará una revisión completa que contiene sesión y recuperación. Las imágenes seguirán en su directorio independiente. Es una propuesta de formato v1 pendiente de implementación y pruebas nativas.

```text
whatsapp/                         # Privado, persistente y excluido de backups
├── state.bin                    # Única revisión publicada
├── state.next                   # Preparación de un commit; siempre cifrada
└── images/                      # Adjuntos completos y temporales de descarga

state.bin
  header: formatVersion, storeId, revision, recoveryKeyId
  encryptedContainer: AES-256-GCM con K_recovery
    session: null o {accountId, sessionKeyId, sessionRevision, nonceBase64, ciphertextBase64}
      ciphertextBase64: estado de protocolo cifrado con K_session
    pending: entregas recuperables, con cuenta, IDs, metadatos y plaintext del protocolo
    sessionKeysToDelete: IDs de claves retiradas cuya eliminación debe completarse
    options: límites efectivos de recuperación e imágenes en iOS y Android
    androidService: solicitud de recepción y cuenta en Android, o null
```

`K_recovery` protegerá el contenedor completo y sobrevivirá a `logout()`. `K_session` protegerá adicionalmente las credenciales y el estado criptográfico de la única cuenta activa; cada nueva vinculación tendrá una clave e identificador nuevos. Los registros de protocolo que actúan como credenciales pertenecerán al bloque `session`, no a `pending`. Las dos claves permanecerán bajo custodia nativa; Go recibirá datos de protocolo descifrados, pero no estas claves de cifrado del almacenamiento.

Usaremos AES-GCM de las APIs nativas, con tag de 16 bytes y nonce de 12 bytes generado de forma segura para cada cifrado, sin derivarlo de la revisión y respetando los límites de uso por clave. El header será autenticado como datos asociados; su codificación exacta y límites de lectura formarán parte del formato. La sesión autenticará también `storeId`, tipo de bloque, versión, cuenta, ID de clave y `sessionRevision`. Así, la sesión conservará su ciphertext cuando una confirmación cambie solamente la recuperación: `sessionRevision` podrá ser menor que `revision`, pero nunca mayor. Una revisión nueva no deberá volver a cifrar la sesión con un nonce anterior.

Las revisiones se transportarán entre Go y nativo como cadenas decimales de enteros sin signo de 64 bits, validadas sin coerción ni overflow. La versión del formato de archivo y la del esquema de registros de protocolo se validarán antes de crear el cliente. Los campos binarios que crucen JSON usarán Base64 con límites de tamaño; nunca pasarán por la fachada TypeScript. La autenticación y una revisión monotónica permiten controlar integridad y orden de escrituras; no constituyen por sí solas protección contra un atacante que restaure un archivo antiguo válido.

#### Codificación del archivo v1 propuesta

El contenido descifrado será JSON UTF-8 compacto, sin compresión ni dependencias de serialización nuevas. El archivo tendrá un envoltorio binario pequeño para no codificar en Base64 todo el ciphertext:

```text
magic                 8 bytes ASCII: YOYOWA01
headerLength          uint32 big-endian
header                headerLength bytes: JSON UTF-8
nonce                 12 bytes
ciphertextLength      uint64 big-endian; incluye el tag
ciphertextAndTag       ciphertextLength bytes: AES-256-GCM, tag al final
```

El header contendrá exactamente `formatVersion: 1`, `storeId`, `revision` y `recoveryKeyId`; no contendrá accountId, mensajes ni secretos. `storeId` y los IDs de claves serán 16 bytes aleatorios representados como 32 caracteres hexadecimales en minúsculas. `revision` será decimal uint64 canónico, sin signo ni ceros iniciales salvo `"0"`. El header tendrá un máximo de 4 KiB. El AAD del contenedor será todo el prefijo hasta `ciphertextLength` inclusive, usando los bytes originales del archivo; no se reconstruirá serializando nuevamente el header leído.

El JSON cifrado del contenedor tendrá exactamente `session`, `pending`, `sessionKeysToDelete`, `options` y `androidService`. `options` será siempre un objeto con exactamente `maxRecoveryBufferBytes` y `maxImageStorageBytes`: enteros JSON entre 1 y 9007199254740991 bytes inclusive, sin coerción; no se admitirán strings, fracciones, `null` ni campos adicionales. En el primer snapshot se publicarán los valores efectivos validados (10 MiB y 50 MiB por defecto); después de `logout()` permanecerán los últimos valores publicados. En iOS `androidService` será siempre `null`; en Android seguirá el esquema interno de reinicio descrito arriba y leerá los límites solo de `options`. `session` será `null` o un objeto con `accountId`, `sessionKeyId`, `sessionRevision`, `nonceBase64` y `ciphertextBase64`. Los binarios dentro de JSON usarán Base64 estándar con padding, sin espacios; el ciphertext de sesión incluirá su tag al final. `pending` será una lista de registros internos, no un mapa ni un historial de confirmaciones. Los esquemas propuestos de pendientes y registros de protocolo se describen abajo; los codecs de valores específicos de whatsmeow deberán completarse al auditar el adaptador.

`initialize(newOptions)` publicará `options` con sesión, pendientes e intención Android de la misma revisión, sin descartar contenido al reducir límites; devolverá éxito solo tras el reemplazo durable. Al reiniciar, iOS y Android autenticarán el snapshot y restaurarán sus `options` antes de preparar cliente, admitir contenido o recrear recepción. Una respuesta incierta exigirá releer la revisión publicada antes de decidir qué valores rigen; `state.next` nunca aportará opciones por sí solo. Un campo ausente o inválido en v1 es estado inválido, no autorización para restaurar defaults. La primera instalación sin `state.bin` usa defaults u opciones explícitas y los publica al crear su primera revisión.

El AAD de sesión será una lista JSON UTF-8 compacta, en este orden: `["yoyos-whatsapp-session", 1, storeId, accountId, sessionKeyId, sessionRevision]`. Sus strings estarán restringidos a los formatos ASCII de identidad ya definidos, sin escapes alternativos. Una confirmación podrá conservar ese bloque cifrado porque `revision` global no pertenece a su AAD. Los IDs de claves seleccionarán únicamente aliases del namespace propio del módulo, nunca una ruta o un alias arbitrario del sistema.

Para acotar el archivo, `S` será el límite de 16 MiB del objeto de sesión serializado, incluyendo Base64 y metadatos; `B` será la cota de recuperación aplicable a los datos admitidos, incluyendo el array de pendientes y sus reservas existentes. Coincidirá con el presupuesto de admisión salvo cuando deba conservar una cota anterior por una reducción de límites; no impedirá leer ni drenar datos previamente admitidos. Se admitirán hasta 4 KiB adicionales de estructura y metadatos de control del contenedor, incluyendo `options` y `androidService`; superar ese subtotal rechazará el snapshot aunque `S` o `B` tengan espacio. Por tanto, su plaintext tendrá un máximo conservador `S + B + 4096` bytes y el archivo completo un máximo `S + B + 8244` bytes, incluyendo header máximo, prefijo, nonce y ambos tamaños, y tag externo. La admisión de contenido nuevo seguirá comprobándose contra `options.maxRecoveryBufferBytes` vigente, mientras la lectura usará la cota confiable de la revisión. `sessionKeysToDelete` tendrá como máximo un ID: se completará su limpieza antes de crear otra sesión, según la regla existente.

La lectura comprobará tamaño total antes de cargar el archivo, longitudes antes de reservar memoria, tag mínimo de 16 bytes y ausencia de bytes sobrantes. Se rechazarán campos desconocidos o duplicados, UTF-8 inválido, versiones distintas y longitudes incoherentes. El header será solo información no confiable para localizar la clave hasta autenticar el contenedor; no se utilizará para borrar claves o modificar el estado. El mismo formato aplicará a `state.next`, que seguirá siendo una preparación y nunca se promoverá por su contenido. Esta propuesta fija el envoltorio; no demuestra todavía durabilidad ni compatibilidad nativa.

### Esquema de registros internos propuesto

#### Registros de sesión v1 propuestos

El plaintext del bloque de sesión será `{protocolSchemaVersion: 1, records: [...]}`. Cada registro tendrá exactamente `{recordType, recordKey, valueBase64}`; la pareja tipo/clave será única dentro de la sesión. `valueBase64` contendrá la representación versionada del dato que maneja el store, no una serialización automática de `store.Device` con sus interfaces, logger o punteros. Los tipos se limitarán a esta lista inicial, basada en los [stores de la versión fijada](https://github.com/tulir/whatsmeow/blob/9399289b022b/store/store.go):

| `recordType` | Identidad del registro | Contenido |
| --- | --- | --- |
| `device` | Singleton | Credenciales e identidad del dispositivo vinculado. |
| `identity` | Dirección Signal | Clave de identidad remota. |
| `signal-session` | Dirección Signal | Registro binario de sesión Signal. |
| `prekey` / `prekey-state` | ID uint32 / singleton | Prekey y estado necesario para generación y subida. |
| `sender-key` | Grupo y emisor | Registro binario de sender key requerido por el protocolo. |
| `app-state-key` | ID binario de clave | Data, fingerprint y timestamp. |
| `app-state-version` / `app-state-mac` | Nombre de colección / colección e index MAC | Versión, hash y MACs de sincronización. |
| `contact` / `chat-setting` | JID | Datos auxiliares que los stores de whatsmeow requieren. |
| `message-secret` | Chat, emisor e ID WhatsApp | Secreto de protocolo, sin cuerpo del mensaje. |
| `privacy-token` / `nct-salt` | JID / singleton | Token con sus tiempos / salt. |
| `lid-mapping` | PN | Correspondencia verificada PN ↔ LID de la cuenta de esta sesión. |
| `retry-hash` | Hash del ciphertext | Metadatos mínimos de reintento del protocolo, sin contenido confirmado. |

`recordKey` será Base64 URL-safe sin padding de una lista JSON UTF-8 compacta de componentes string, en el orden de la tabla. El singleton utilizará `[]`. Los enteros serán cadenas decimales canónicas, los binarios Base64 estándar y los JIDs conservarán su representación de protocolo, incluyendo dispositivo cuando el store lo requiera. La restricción pública de LID sin dispositivo no se aplicará a una dirección Signal interna. La validación rechazará componentes inesperados, claves no canónicas y duplicados; no se permitirá inventar namespaces o rutas. Un registro `lid-mapping` comprobará también que no introduzca una correspondencia inversa contradictoria.

El registro `device` conservará NoiseKey e IdentityKey privadas, SignedPreKey con ID y firma, RegistrationID, AdvSecretKey, ID y LID internos, Account firmado y los campos persistidos de plataforma/nombres, FacebookUUID, LIDMigrationTimestamp y CompanionMetaNonce. La reconstrucción de claves utilizará las funciones existentes de whatsmeow; los flags de ejecución, callbacks y referencias a stores se reconstruirán en memoria. El [store oficial de dispositivo](https://github.com/tulir/whatsmeow/blob/9399289b022b/store/sqlstore/container.go) será referencia de campos, no una dependencia SQLite del módulo.

Excluir grupos de la API pública no autoriza omitir escrituras criptográficas o de sincronización que el protocolo ejecute. Se conservarán bajo el presupuesto de sesión, sin exponer funciones de contactos o grupos. `EventBuffer` utilizará los pendientes descritos abajo para su contenido recuperable; no añadirá otra colección de cuerpos de mensajes en la sesión. Las rutas de eventos de envío propio no se habilitarán como almacenamiento de conversaciones en este módulo sin envío.

Los codecs concretos de `valueBase64`, los contadores de prekeys y las reglas de reintentos deberán documentarse junto al adaptador de la versión fijada durante su implementación. La existencia de estas interfaces no demuestra que ya se hayan auditado todas las escrituras o su atomicidad. No se sustituirá una escritura crítica desconocida por un store que devuelve éxito sin guardar.

#### Entregas pendientes v1 propuestas

Cada entrada de `pending` conservará los siguientes datos internos:

```ts
interface PendingRecordV1 {
  deliveryId: string;
  accountId: string;
  createdRevision: string; // uint64 decimal; permanece al reemitir
  createdOrdinal: number;  // uint32: orden dentro del mismo commit
  source: "live" | "history";
  identityState: "pendingLid" | "resolved";
  message?: ReceivedMessage;
  recovery: {
    messageInfoJson: string;
    items: Array<{
      format: "v2" | "v3" | "history";
      plaintextBase64: string;
      ciphertextHashBase64?: string;
    }>;
  };
}
```

`resolved` requerirá `message` completo, con cuenta y referencias coherentes; `pendingLid` no contendrá un mensaje con IDs provisionales. Resolver identidad publicará `message` e `identityState` juntos, conservando deliveryId y orden de creación. El recorrido ordenará por revisión numérica y ordinal; se rechazarán pares repetidos. El ordinal no será un contador global ni una marca de confirmación.

`messageInfoJson` será un DTO versionado de los metadatos necesarios de `types.MessageInfo`, con JIDs como strings y tiempos enteros definidos por el codec. Conservará dirección, chat/emisor y direcciones alternativas, ID, timestamp y metadatos del dispositivo emisor; incluirá los demás campos de protocolo que exija el replay auditado. No se guardarán objetos Go o punteros. Cada hijo cifrado de recepción en vivo tendrá su formato, plaintext y hash SHA-256 de 32 bytes; la ruta histórica conservará el protobuf del mensaje individual y no inventará un hash de ciphertext. No se conservará el lote histórico comprimido completo en otra cola.

El mensaje normalizado permite entrega local sin credenciales después de logout; los datos de recuperación permiten completar el procesamiento de protocolo y normalización cuando corresponda, sin volver a descifrar sobre estado Signal avanzado. Si hace falta una sesión para completar trabajo todavía pendiente, su eliminación no se resolverá usando otra cuenta. El adaptador deberá demostrar esta separación en los cruces de caída ya definidos.

Todo el registro, incluidos el mensaje normalizado, los datos de recuperación y las reservas para completar LID, contará contra el mismo presupuesto de recuperación. No incluirá archivos de imagen descargados, estado de subida a Core, número de intentos de negocio ni confirmaciones históricas. `confirmMessageStored()` retirará la entrada completa de forma durable; mantener metadatos mínimos de protocolo no autoriza conservar su cuerpo después de confirmar.

### Publicación de una revisión

El writer nativo será único y serializará recepción, cambios de protocolo y confirmaciones locales. Validará la generación del cliente y la revisión esperada de sesión en los cambios de protocolo. Construirá cada snapshot desde la revisión global vigente bajo su exclusión de escritura; rechazará callbacks antiguos y cambios basados en una sesión desactualizada antes de modificar el archivo.

1. Preparar la revisión siguiente en memoria, aplicando juntos los cambios de sesión y del buffer de la transacción. Validar esquema y presupuestos antes de publicarla.
2. Cifrar el contenedor y escribirlo íntegramente en `state.next`, sin temporales con plaintext.
3. Sincronizar el archivo y cerrar comprobando errores.
4. Reemplazar `state.bin` mediante una operación atómica dentro del mismo filesystem, y completar la sincronización de metadatos requerida por la plataforma.
5. Actualizar la revisión confirmada en memoria y devolver éxito al store Go.

La implementación deberá comprobar fallos de escritura, sincronización, cierre y reemplazo. Si falla después del reemplazo, la respuesta será fallida y el controlador volverá a leer la revisión publicada antes de intentar otra operación. Un error de respuesta no implicará restaurar la revisión anterior.

La documentación de [AtomicFile](https://developer.android.com/reference/android/util/AtomicFile) describe reemplazo y sincronización, pero exige protección de concurrencia externa. Además, el [código de Android 16](https://android.googlesource.com/platform/frameworks/base/+/android-16.0.0_r1/core/java/android/util/AtomicFile.java) registra ciertos fallos de sincronización/cierre/rename sin propagarlos desde `finishWrite`. Por eso esa llamada aislada no satisfará nuestro contrato de éxito durable: el adaptador deberá usar operaciones nativas con errores verificables. En iOS también habrá que validar explícitamente la sincronización y el reemplazo; todavía no se ha elegido ni probado su implementación concreta.

Reescribir el snapshot completo simplifica el primer writer, pero consume I/O, memoria y espacio temporal proporcionales al estado total, incluyendo pendientes. El presupuesto del buffer contabilizará su representación codificada y la sobrecarga atribuible del contenedor; el estado de sesión tendrá un límite propio. Los límites de buffer e imágenes no garantizan disponer del espacio necesario para una segunda copia. Ante falta de espacio se conservará la revisión publicada y se detendrá el procesamiento. Un journal incremental solo se evaluará si las mediciones de esta versión justifican su complejidad.

### Inicio y desvinculación con este formato

Al iniciar se autenticará y validará `state.bin`, que será la única revisión publicada. `state.next` no se promoverá por tener una revisión mayor: una preparación no demuestra commit. Tras validar la revisión publicada se retirarán temporales incompletos. Un archivo corrupto, una clave ausente o una combinación incompleta de archivos y claves producirá error explícito, salvo la creación interrumpida reconocida mediante el registro descrito abajo. Solo se iniciará una instalación vacía cuando no existan artefactos, claves ni registro de creación previos de esa instalación.

#### Recuperación de creación de claves acordada

Un registro mínimo en almacenamiento seguro distinguirá una creación inicial en curso de una instalación ya establecida. Identificará la instalación y las claves involucradas; se guardará antes de crearlas. El orden será: registrar creación en curso → crear claves → publicar durablemente el primer `state.bin` → marcar creación terminada. Antes de completar esa secuencia no se permitirá vincular ni recibir mensajes.

| Estado encontrado al iniciar | Acción |
| --- | --- |
| Creación en curso, sin archivo publicado ni temporal | Completar la creación usando las claves existentes y crear únicamente las todavía no creadas según ese registro. |
| Creación en curso y `state.bin` válido y coherente | Reconocer la publicación y marcar creación terminada. |
| Creación en curso con temporal, sin archivo publicado | Retirar la preparación incompleta y repetir la creación inicial, sin promover el temporal. |
| Creación terminada, pero falta archivo o clave | `SESSION_STATE_INVALID`; no generar almacenamiento vacío. |
| Archivo publicado corrupto, registro ausente con artefactos o identificadores incoherentes | Conservar artefactos y bloquear recuperación automática. |

Una operación incierta sobre el registro se resolverá releyéndolo antes de avanzar. Retirar un temporal deberá comprobar el resultado antes de repetir la preparación. Este procedimiento solo recuperará la creación inicial reconocida; no autoriza descartar datos de una instalación establecida.

Al vincular una cuenta también se registrará el identificador provisional de `K_session` antes de crearla. Tras una caída se validará la revisión publicada: si contiene esa sesión y clave, se conservarán y se completará el registro; si la sesión no llegó a publicarse, se retirará únicamente la clave provisional identificada antes de intentar otra vinculación. Si no puede validarse lo publicado, no se decidirá su ausencia ni se eliminará la clave. Un fallo de limpieza bloqueará otra vinculación; los pendientes existentes permanecerán intactos. Los registros de creación y su protección nativa deberán concretarse y probarse junto a las operaciones de almacenamiento seguro; no se asumirá una transacción única entre estos y el filesystem.

#### Recuperación local y retirada de sesión

Las entregas validadas del contenedor podrán recuperarse independientemente de restaurar credenciales. Si falla la restauración de `session`, la conexión quedará bloqueada con `SESSION_STATE_INVALID`, preservando los pendientes legibles bajo `K_recovery`.

`logout()` detendrá la generación activa y solicitará la desvinculación remota conforme a su contrato. Para retirar el estado local, primero publicará durablemente `session: null`, manteniendo `pending`, e incluirá el ID de `K_session` en `sessionKeysToDelete`. Después eliminará esa clave del almacenamiento seguro y publicará la retirada de su ID. La lista permitirá completar la eliminación al reiniciar después de una caída; el snapshot con `session: null` no volverá a utilizar una clave retirada que siga físicamente presente.

El éxito local de `logout()` requerirá completar la retirada durable y la eliminación de la clave. Un fallo impedirá afirmar que terminó; mantendrá la conexión detenida y se resolverá leyendo el estado actual. La limpieza pendiente se completará antes de permitir otra vinculación. Solo podrá retirar IDs del namespace propio del módulo; se validará que no incluyan `K_recovery` ni la clave de una sesión activa. El resultado de desvinculación remota seguirá siendo independiente. `K_recovery` permanecerá disponible y una vinculación posterior no reutilizará `K_session`. Esto define el orden de dos sistemas de almacenamiento, sin prometer una transacción única entre filesystem y Keychain/Keystore.

Antes de dar este diseño por implementado, habrá que inyectar fallos y cierres en cada paso de publicación y logout, verificar que no se mezcla sesión de una revisión con entregas de otra, y medir el coste de snapshots y espacio temporal en Android/iOS. También se probarán clave ausente, corrupción, respuesta de commit perdida y limpieza de claves retirada interrumpida. Las pruebas Go existentes no validan esas propiedades nativas.

### Contrato interno Go ↔ almacenamiento nativo

Proponemos dos operaciones internas: leer el estado confirmado y aplicar cambios. La prueba aislada `Storage.Commit(snapshot)` valida el binding de un callback con error; no será el contrato final ni autorizará a Go a reemplazar el archivo completo.

| Operación conceptual | Entrada y resultado |
| --- | --- |
| Leer | Devuelve versión de contrato, revisión global, sesión descifrada con su revisión y pendientes recuperables. Una sesión ausente es un valor válido; una lectura fallida es un error. |
| Aplicar | Recibe versión de contrato, generación, revisión esperada de sesión y cambios de registros de protocolo, junto con las entregas creadas en esa transacción. Devuelve las revisiones confirmadas después del commit durable. |

Los payloads serán JSON interno con cadenas, números acotados y binarios Base64; las revisiones mantendrán su representación decimal de 64 bits. Go y Kotlin/Swift validarán versión, operaciones permitidas, identificadores y tamaños. Las firmas propuestas abajo y el transporte de errores tipados se verificarán con un binding mínimo de `gobind`; las claves de cifrado y los nombres de archivo permanecerán exclusivamente en nativo. Este contrato no añade métodos a TypeScript.

#### Firmas y respuestas propuestas para el binding v1

El contrato candidato usará dos callbacks implementados por Kotlin/Swift y llamados desde Go. El siguiente código describe la interfaz futura; no es una implementación ni modifica la prueba aislada:

```go
type Storage interface {
    ReadState(requestJSON string) (responseJSON string, err error)
    ApplyChanges(requestJSON string) (responseJSON string, err error)
}
```

La [documentación de gobind](https://pkg.go.dev/golang.org/x/mobile/cmd/gobind) permite strings e interfaces con métodos que devuelven un valor y `error`. Eso respalda la elección de tipos; las firmas generadas y su ejecución real seguirán pendientes de validación. No se exportarán maps, tipos protobuf, contextos ni punteros al estado de whatsmeow mediante este binding.

| Payload | Campos propuestos |
| --- | --- |
| Solicitud `ReadState` | `contractVersion: 1`. Leerá una revisión coherente bajo el writer nativo, sin crear una sesión ausente ni conectar. |
| Éxito `ReadState` | `revision`, `sessionRevision`, `session` y `pending`. La sesión podrá ser `null`; las revisiones serán cadenas decimales uint64. Una instalación vacía válida tendrá revisiones `"0"`. |
| Solicitud `ApplyChanges` | `contractVersion: 1`, `generationId`, `accountId`, `expectedSessionRevision`, `protocolChanges`, `pendingInserts` y `pendingIdentityUpdates`. |
| Cambio de protocolo | `operation: "put"` con `recordType`, `recordKey` y `valueBase64`, o `operation: "delete"` con `recordType` y `recordKey`. El tipo y la clave identificarán registros de protocolo, nunca rutas de archivos. |
| Éxito `ApplyChanges` | `revision` y `sessionRevision` después de publicar durablemente todos los cambios de la solicitud. No significará que Expo haya confirmado los mensajes. |

`generationId` será un identificador opaco de la ejecución registrado por el controlador nativo; no se recuperará desde una sesión antigua ni se aceptará solamente porque Go lo envíe. Bajo el writer se comprobarán generación vigente, cuenta y revisión esperada. La ausencia de sesión tendrá revisión de sesión `"0"` en este contrato; crear una vinculación seguirá requiriendo la autorización interna del controlador y una clave nativa nueva. `recordType` y `recordKey` seguirán la lista y codificación de registros v1 propuesta arriba; sus codecs de valores se completarán al auditar el adaptador de la versión fijada, sin aceptar namespaces arbitrarios.

Las respuestas JSON tendrán `contractVersion: 1` y conservarán la forma de resultado ya usada en el proyecto: `success: true` con `data`, o `success: false` con `error: {code, message}`. Los fallos esperados devolverán esa respuesta con `err` nulo. `err` quedará para un fallo de invocación sin una respuesta válida; nunca se decidirá si hubo commit interpretando el texto de una excepción o `NSError`. El adaptador nativo capturará sus errores operacionales y Go recuperará los panics controlables antes de cruzar el binding; no se dependerá de que una excepción o panic sin manejar atraviese la frontera de lenguajes.

| Código interno propuesto | Tratamiento |
| --- | --- |
| `INVALID_REQUEST` | Rechazar antes de mutar; informar del incumplimiento del contrato interno, sin repetirlo automáticamente. |
| `STALE_GENERATION` / `SESSION_REVISION_MISMATCH` | Rechazar antes de mutar; retirar la operación y reconstruir desde estado confirmado según el controlador. |
| `BUFFER_FULL` | Traducir a `RECOVERY_BUFFER_FULL`; conservar estado y aplicar la política de capacidad. |
| `SESSION_FULL` (propuesto) | Traducir a `SESSION_STORAGE_LIMIT_REACHED`; conservar la revisión publicada y detener cambios de protocolo. |
| `STORAGE_FAILED` | Traducir a `SESSION_STORAGE_FAILED`; detener y verificar el archivo publicado antes de otro intento. |
| `STATE_INVALID` | Traducir a `SESSION_STATE_INVALID`; preservar artefactos y bloquear la conexión. |

Un `err`, JSON inválido, versión inesperada o resultado incoherente detendrá la operación como fallo del almacenamiento interno. Si ocurrió después de `ApplyChanges`, el resultado del commit se considerará incierto: no se reenviará la misma mutación ni se repetirá el descifrado sobre memoria modificada. Se releerá y validará el estado publicado. Ningún payload o diagnóstico incluirá claves nativas de almacenamiento; el contenido descifrado de protocolo y pendientes será sensible y no se registrará en logs.

`pendingInserts` incorporará registros nuevos con sus IDs ya asignados; no reemplazará la colección vigente. `pendingIdentityUpdates` actualizará únicamente pendientes existentes con identidad aún incompleta, sin recrear uno confirmado. El borrado por `confirmMessageStored()` y la retirada de sesión por `logout()` seguirán siendo operaciones del controlador nativo sobre el mismo writer, no instrucciones genéricas disponibles para estos callbacks Go. Antes de aplicar se validará la solicitud completa y sus límites; los codecs de valores, los límites por registro y el tamaño máximo de las solicitudes deberán concretarse al implementar el adaptador, respetando los presupuestos globales definidos.

Go enviará altas, reemplazos y borrados explícitos de registros, nunca una copia completa de `pending`. Kotlin/Swift aplicará esos cambios sobre el estado confirmado vigente. Completar la identidad de un pendiente será una actualización explícita de sus metadatos, que no podrá cambiar identificadores ya asignados ni recrear un registro retirado concurrentemente. `confirmMessageStored()` utilizará el mismo writer para retirar una entrega de forma idempotente, sin necesitar una sesión activa ni depender de la generación de protocolo que la recibió.

Distinguiremos dos revisiones: `revision` cambia con cualquier publicación; `sessionRevision` cambia cuando se modifica el bloque de sesión. Una confirmación incrementa la primera y conserva la segunda. Así, una confirmación durante el descifrado no invalida por sí sola los cambios de protocolo ni puede reaparecer como pendiente al guardarlos. Un cambio concurrente de sesión sí invalidará la revisión esperada: se detendrá la operación y se reconstruirá el cliente desde el estado confirmado, sin repetir el descifrado sobre memoria ya modificada.

El adaptador Go serializará sus transacciones de protocolo. Dentro de `DoDecryptionTxn`, las lecturas verán el estado confirmado más los cambios preparados por esa transacción; todas las escrituras participantes se acumularán en ella. Al terminar correctamente enviará una sola operación de aplicación que incluya estado criptográfico y contenido recuperable. Solo después del éxito durable actualizará su vista confirmada. Un fallo descartará la preparación y activará la parada del controlador. Las escrituras críticas fuera de esa transacción también deberán esperar su propio commit durable.

El bloqueo de transacciones Go y el writer nativo se liberarán antes de emitir a Expo o esperar su confirmación. La confirmación podrá entonces publicar otra revisión sin esperar el bloqueo de protocolo. El writer no llamará a JavaScript ni volverá a entrar en Go mientras tenga su exclusión de escritura; cualquier notificación posterior se emitirá al liberarla. La parada y el cambio de generación se coordinarán con ese writer para que no puedan aprobarse escrituras tardías después de retirar la sesión.

Antes de cerrar este contrato se probarán tres cruces: confirmar una entrega mientras Go prepara otra, detener una generación mientras espera persistencia y perder la respuesta de un commit que sí quedó publicado. Se comprobará que ningún pendiente confirmado reaparece, que no se aceptan escrituras de la generación retirada y que la recuperación usa el estado publicado. Son requisitos del adaptador propuesto, todavía sin implementación nativa.

### Riesgo validado y límites

Una copia guardada después de procesar mensajes puede quedar desactualizada si la app termina antes de escribirla. Esto no implica necesariamente perder la vinculación por QR, pero puede perder estado criptográfico y provocar fallos de descifrado.

En el código revisado, Signal llama a `StoreSession` antes de retornar de cifrado/descifrado, y la ruta de envío de whatsmeow exige `PutCachedSessions` antes de continuar. El adaptador debe respetar esas expectativas de persistencia. Falta auditar todas las escrituras y su manejo de errores en la versión fijada, especialmente cambios de prekeys, identidad y operaciones que afectan varios registros.

El objetivo es recuperar el último estado confirmado ante una caída del proceso. Ningún diseño puede conservar una sesión si WhatsApp la revoca, se eliminan los datos de la app o se pierde su clave. Este contrato requiere pruebas; todavía no constituye una garantía implementada.

## Entrega durable de mensajes a Expo

La recepción deberá sobrevivir a una caída entre actualizar el estado criptográfico y guardar el mensaje en SQLite de Expo. No basta con guardar la sesión ni con retrasar el ACK a WhatsApp.

Usaremos `EnableDecryptedEventBuffer`, `SynchronousAck` y un manejador con resultado de éxito como base del adaptador. El contrato será:

```text
1. Descifrar dentro de una transacción del almacenamiento nativo
2. Commit atómico: cambios de sesión + contenido y metadatos recuperables
3. Emitir messageReceived(deliveryId, message)
4. La app consumidora verifica su persistencia local según su propia implementación
5. Expo llama a confirmMessageStored(deliveryId)
6. Commit nativo: retirar la entrega pendiente
7. El manejador termina con éxito y se permite confirmar al protocolo
```

La transacción de descifrado deberá incluir todas las escrituras criptográficas involucradas, no solo `PutSession`. Si no se completa, se descartará el estado en memoria de esa operación y no se emitirá una entrega exitosa. Ante error de persistencia o falta de confirmación de Expo, no se avanzará como si el mensaje estuviera guardado.

La limpieza automática de `EventBuffer` no podrá retirar contenido antes del paso 5 ni invalidar la recuperación definida por el wrapper. La llamada pública coordinará la confirmación con el manejador de whatsmeow; no hará escrituras concurrentes independientes fuera del orden de commits.

### Recuperación y duplicados

- Caída antes del commit del paso 2: no se confirma al protocolo y el estado no confirmado se descarta. La recuperación desde el servidor dependerá de sus reglas de reentrega; no se promete retención remota indefinida.
- Caída después del paso 2 y antes del paso 5: el módulo reemitirá la entrega local pendiente al iniciar, sin depender de descifrar otra vez el mismo paquete.
- Caída después del commit de Expo y antes del paso 6: Expo reconocerá el mensaje duplicado por cuenta y `id`, y repetirá la confirmación local.
- Caída después del paso 6 y antes del ACK: se conserva el estado de protocolo confirmado. Si una reentrega puede recuperarse y vuelve a emitirse a Expo, Expo reconocerá su identidad y confirmará sin duplicar el mensaje ni sus operaciones de negocio. El manejo de reintentos del protocolo requiere validación propia.

Este flujo ofrece entrega al menos una vez a la app consumidora, que será responsable de su procesamiento idempotente. No se prometerá entrega exactamente una vez entre los procesos y almacenamientos.

### Inicio, reemisión y confirmación local

`initialize()` abrirá y validará el almacenamiento y preparará la recuperación, sin esperar a que Expo confirme todos los pendientes para resolver su resultado. La lectura fallida devolverá error; emitir un evento no contará como confirmación. La recuperación local podrá continuar sin conexión de red y con la cuenta de origen desvinculada.

La primera versión tendrá un único coordinador de entregas en `go/internal/delivery.go`, compartido por recuperación y recepción nueva. Entregará un mensaje a Expo por vez y esperará su confirmación durable antes de entregar el siguiente. Recorrerá los pendientes existentes con identidad resuelta en su orden de creación local, reevaluando los demás cuando haya correspondencias; ese orden no constituye una garantía de orden cronológico de WhatsApp. Los nuevos registros se incorporarán después de su commit, sin lanzar otro recorrido concurrente de pendientes.

El coordinador mantendrá en memoria solamente la entrega en curso y los datos necesarios para recorrer pendientes comprometidos. El archivo nativo seguirá siendo la fuente de recuperación. Reiniciar el proceso conservará el mismo `deliveryId` y `message.id`, aunque el evento llegue otra vez. Ante ausencia de consumidor o fallo de entrega se conservará el registro y se detendrá la recepción; la suscripción nueva permitirá recuperar localmente según las reglas siguientes, sin un bucle de reemisión ni borrado por vencimiento.

#### Sustitución del consumidor y recuperación sin reiniciar el proceso

**Decisión acordada:** `addListener("messageReceived", ...)` registrará el único consumidor activo y activará la recuperación local cuando el almacenamiento esté preparado. Si existe una entrega en curso todavía pendiente, la reemitirá con los mismos `deliveryId` y `message.id`, sin crear otro registro; en caso contrario entregará el siguiente pendiente con identidad resuelta. Registrarse antes de `initialize()` seguirá permitido y esperará a disponer del almacenamiento.

Una suscripción nueva sustituirá a la anterior. Cada registro tendrá una identidad interna: ejecutar posteriormente el `remove()` de la suscripción antigua no retirará la nueva. Se descartarán emisiones todavía encoladas hacia un consumidor sustituido; un callback que ya comenzó podría terminar tarde. Las confirmaciones de ese consumidor seguirán siendo válidas si persistió el mensaje, porque confirman el `deliveryId` y no la identidad del listener. El consumidor deberá persistir idempotentemente incluso si ambos procesamientos llegan a coincidir.

Al retirar el consumidor activo o destruir su runtime se conservará la entrega, se pausará su emisión y se aplicará la parada de recepción por ausencia de consumidor. El coordinador serializará sustitución, selección de pendiente y confirmación para no iniciar dos recorridos ni bloquearse esperando una confirmación ya comprometida. La integración mantendrá este consumidor a nivel general de la app, independiente de la navegación entre pantallas; no se define aquí cómo activar JavaScript en segundo plano.

Volver a suscribirse reanudará la recuperación local sin requerir red, credenciales ni reiniciar el proceso. No iniciará conexión ni anulará `disconnect()`, `logout()` o una parada por fallo local. La recepción de red se reanudará mediante el controlador solo cuando conserve una solicitud válida y sus condiciones de recuperación se cumplan; una parada que exige un nuevo intento explícito seguirá exigiéndolo. No se añadirán métodos públicos ni temporizadores de reemisión.

La confirmación tendrá estos resultados:

| Estado del identificador | Resultado |
| --- | --- |
| Pendiente conocido | Publicar atómicamente su retirada; devolver éxito después del commit. |
| Identificador válido sin pendiente | Devolver éxito sin modificar el estado ni liberar una entrega distinta. |
| Identificador mal formado | Devolver `INVALID_INPUT`, sin borrar registros ni liberar una entrega distinta. |
| Fallo de lectura o publicación | Devolver el error de almacenamiento y conservar la entrega como incierta hasta releer el estado publicado. |

Solo después de verificar la retirada durable del pendiente se notificará al coordinador para liberar esa entrega en curso. Si la respuesta se pierde, Expo podrá repetir la llamada: comprobar que el identificador válido ya no tiene un pendiente también resolverá la operación. Un fallo de lectura no contará como ausencia. El éxito significa que no queda ese pendiente, sin conservar una prueba adicional del commit de Expo.

Se validarán reinicios antes y después del commit de Expo, confirmaciones repetidas y concurrentes, una respuesta de confirmación perdida y recuperación de una cuenta desvinculada. La recuperación no enviará ACK por una cuenta nueva para resolver registros de otra cuenta. Este coordinador es una propuesta de ejecución pendiente de implementación y pruebas.

### Contrato con la app consumidora

La librería conservará solamente entregas pendientes hasta que el consumidor confirme su persistencia local. Entregará `accountId`, `message.id` y `deliveryId` sin consultar el almacenamiento del consumidor. Un evento repetido podrá tener otro `deliveryId`, pero conservará la identidad estable del mensaje.

La app consumidora será responsable de procesar y persistir mensajes de forma idempotente. Su consulta de mensajes existentes y el diseño de sus tablas, cola y operaciones de negocio quedan fuera de este alcance.

El consumidor llamará a `confirmMessageStored(deliveryId)` únicamente después de verificar que el mensaje está persistido, también si reconoce una entrega repetida. Mientras no confirme, la librería conservará el pendiente. La retirada será durable e idempotente; una respuesta perdida podrá resolverse repitiendo la confirmación.

```text
messageReceived(deliveryId, message)
    → app consumidora procesa y confirma su persistencia local
    → app consumidora confirma deliveryId
    → librería retira el pendiente; si ya no existe, éxito
```

Se mantendrán el commit atómico de estado criptográfico y contenido pendiente, la persistencia durable antes de emitir y la recuperación después de caídas. Los metadatos mínimos que requiera whatsmeow para sus propios reintentos seguirán formando parte del estado de protocolo y deberán verificarse al implementar el store. El wrapper no conservará un historial adicional de mensajes confirmados ni tendrá un presupuesto o vencimiento para ese historial.

### Contenido del buffer y punto pendiente de integración

El buffer contendrá el contenido necesario para reconstruir `ReceivedMessage`, su referencia de imagen, cuenta de origen, identificador de entrega y metadatos del protocolo. No contendrá bytes de imágenes descargadas. Las referencias y el contenido estarán cifrados y no aparecerán en logs.

La interfaz nativa actual de whatsmeow `BufferedEvent` contiene plaintext y timestamps, pero no todos los metadatos del chat ni una operación pública para enumerar entregas pendientes. Activar el flag por sí solo no implementa el flujo anterior.

La [prueba aislada del hook](whatsmeow-go-expo-probe/README.md#prueba-del-contexto-previo-al-descifrado) incluye un patch candidato `PreDecryptMessage`: recibe el contexto, `MessageInfo` y el nodo padre antes del descifrado y permite devolver un contexto derivado. Se verificó en la versión fijada que los metadatos atraviesan la ruta de recepción hasta `DoDecryptionTxn` y el almacén Signal; otra comprobación con plaintext sintético verifica `PutBufferedEvent`. Un error del hook detiene esa llamada. Esto valida el transporte del contexto, sin demostrar persistencia ni recuperación real.

El wrapper copiará y serializará los metadatos y formatos de cada hijo cifrado antes de la transacción, asociados a su ciphertext. No conservará punteros prestados ni supondrá que todos los hijos tienen el mismo formato. La enumeración de pendientes será propia del almacenamiento nativo. Quedan por probar la reconstrucción v2/v3, la atomicidad durable y el replay; todavía no se integra el patch ni se fija un fork.

La versión original envía ACK en ciertas rutas de error general de descifrado y recuperación de panic. El patch candidato incorpora `store.ErrLocalStorage`: los stores propios envolverán esa marca en todo fallo local de persistencia/capacidad, conservando la causa en Go. La ruta de descifrado detendrá esos errores antes de confirmar, solicitar reintentos o emitir `UndecryptableMessage`; no los confundirá con fallos del protocolo. Una ausencia válida de datos no llevará esa marca.

También se detiene la confirmación cuando falla la limpieza del buffer. Con el buffer activado, un panic de recepción no confirma al protocolo; un panic del consumidor devuelve fallo de entrega y conserva el pendiente. La [prueba de fallos locales](whatsmeow-go-expo-probe/README.md#prueba-de-fallos-locales-sin-confirmación-al-protocolo) verificó estas decisiones con stores controlados y un cliente desconectado, incluyendo ACK síncrono/asíncrono y un control de error del protocolo. No demuestra rollback, durabilidad ni tráfico real de ACK.

El candidato ya propaga los errores de lectura LID, migración PN/LID y escritura de secretos de mensajes en la recepción v2. Propone `MessageReceiveFinished(context.Context, *types.MessageInfo, error)`, invocado una vez al terminar `decryptMessages`, incluyendo fallos del hook y panic recuperados con el buffer activado. La prueba verifica que los errores auxiliares conservan su causa y evitan continuar, entregar o limpiar el pendiente. Es un callback interno Go; la interfaz TypeScript permanece igual. Un error nulo en este callback indica fin del procesamiento, sin implicar que Expo haya guardado el mensaje.

La [prueba de propagación](whatsmeow-go-expo-probe/README.md#propagación-de-fallos-auxiliares-y-cierre-de-recepción) no implementa el controlador ni amplía la transacción. Siguen pendientes las escrituras previas al hook (`StoreLIDPNMapping`), tareas de sincronización y partes de protocolo/v3. El replay deberá reconstruir y repetir el procesamiento necesario de secretos/protocolo antes de emitir a Expo; todas las escrituras críticas deberán cumplir el contrato de commit durable. La marca y ambos hooks pertenecen al patch propuesto, no al whatsmeow original.

### Controlador y recuperación después de un fallo

El controlador del wrapper vivirá en `go/internal/client.go`. Coordinará la admisión de operaciones de protocolo, la generación activa del cliente y la parada; el store nativo seguirá siendo dueño del estado confirmado. Su capacidad de recuperación local podrá prepararse sin restaurar un cliente de protocolo cuando falle únicamente la sesión. El adaptador registrará el primer fallo local al producirse, incluso fuera de la recepción, y bloqueará nuevas operaciones de protocolo de esa generación. El callback final comunicará los fallos detectados por Go y cerrará la admisión de la recepción. Los callbacks serán breves y no esperarán una desconexión, restauración ni confirmación de Expo.

Ante un fallo, el controlador cancelará la ejecución y la reconexión de esa generación, esperará fuera del callback a que terminen sus operaciones y descartará su estado en memoria. Emitirá un error sanitizado y el estado público `disconnected`; la causa de parada será interna. Los callbacks tardíos de la generación anterior deberán rechazarse. La confirmación de entregas ya persistidas seguirá disponible en su ruta independiente, con escrituras serializadas sobre el estado confirmado.

| Causa | Reacción y condición para reanudar |
| --- | --- |
| Buffer de recuperación lleno | Conservar pendientes y detener recepción. Tras liberar capacidad, reconstruir desde la revisión confirmada y reanudar si continúa solicitado, respetando desconexión, logout o sesión expirada. |
| Lectura, cifrado o commit nativo fallido | Emitir `SESSION_STORAGE_FAILED` y detener. Un nuevo intento explícito deberá volver a abrir y validar el estado durable antes de conectar. |
| Panic o fallo del consumidor | Emitir `NATIVE_CALL_FAILED`, conservar pendientes y detener. Reanudar requiere un nuevo intento con estado confirmado y consumidor disponible. |
| Archivo incompatible, corrupto o clave ausente | Mantener `SESSION_STATE_INVALID`; la recuperación requerirá una acción explícita sobre la causa y no elegirá silenciosamente una revisión antigua. |
| Sesión revocada por WhatsApp | Mantener el flujo `sessionExpired` y solicitar nueva vinculación QR. |

Reconstruir después de un error usará la última revisión durable que pueda verificarse al leer el almacenamiento. Un callback fallido no demuestra que el disco permanezca en la revisión anterior: el commit pudo completarse y fallar su respuesta. Se validarán juntos sesión y buffer, y se reemitirán pendientes idempotentemente. Estos comportamientos son requisitos de integración pendientes de pruebas de concurrencia, cierres forzados y plataformas reales.

El buffer tendrá un presupuesto de 10 MiB por defecto. Yoyos lo configurará mediante `EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB` y lo pasará como `maxRecoveryBufferBytes`, separado de los 50 MiB de imágenes. Contará contenido y metadatos serializados de entregas pendientes, su sobrecarga de cifrado y las reservas de operaciones en curso. El estado criptográfico de sesión tendrá un presupuesto independiente; este límite no representa el espacio total de la librería ni el de las copias transitorias necesarias para un reemplazo atómico.

Al agotarlo, se detendrá la recepción antes de comprometer nuevos mensajes y se emitirá `RECOVERY_BUFFER_FULL`, preservando todos los pendientes. Cuando Expo confirme entregas y libere capacidad suficiente, se reanudará la recepción, salvo que se haya llamado a `disconnect()` o `logout()` o haya expirado la sesión. La ruta de `confirmMessageStored()` seguirá disponible mientras la recepción esté detenida.

Si una sola entrega supera el presupuesto, se informará explícitamente; liberar otras entregas no resolverá ese caso y no se entrará en un bucle de reintentos. Un presupuesto insuficiente no se compensará descartando contenido. Los límites se validarán al inicializar; reducirlos por debajo de lo ya ocupado no eliminará registros existentes.

Si no hay consumidor, también se detendrá la recepción. No se descartarán registros sin confirmar por antigüedad ni se confirmarán para liberar espacio. Su retirada ocurrirá únicamente después de la confirmación local de Expo.

La recuperación local incluye registros de cuentas desvinculadas; esos registros nunca se mezclarán con una nueva vinculación ni utilizarán sus credenciales para confirmar al servidor.

## Imágenes privadas de corta duración

La descarga será explícita. `downloadImage(reference)` descargará y descifrará la imagen, la guardará en un directorio privado y devolverá su URI, MIME y tamaño. No se añadirá a la galería ni se solicitará acceso a ella para esta operación.

### Referencia de descarga v1 propuesta

`downloadReference` será `wa-image:v1:` seguido de Base64 URL-safe sin padding de un JSON UTF-8 con los siguientes campos internos. El consumidor no los interpretará; Go los validará y reconstruirá el objeto de descarga de whatsmeow.

```ts
// Esquema interno del descriptor; no se exporta como API TypeScript.
interface ImageDownloadDescriptorV1 {
  accountId: string;       // LID de origen
  messageId: string;       // Igual a ImageReference.messageId
  mimeType?: string;
  directPath?: string;     // Ruta relativa de media del protocolo
  mediaKey?: string;       // Base64 de la clave del adjunto
  fileSha256?: string;     // Base64 del hash del archivo descifrado
  fileEncSha256?: string;  // Base64 del hash del archivo cifrado
  fileLength?: string;     // Bytes declarados, decimal uint64
}
```

No incluirá URL completa, caption, thumbnail, bytes de imagen ni credenciales de sesión. Base64 es una codificación, no cifrado: el descriptor contiene una clave del adjunto y se tratará como dato sensible. Esa clave es distinta de las credenciales de WhatsApp y de las claves nativas de almacenamiento.

Proponemos un máximo de 16 KiB para la cadena codificada. El parser rechazará versiones desconocidas, campos ajenos al esquema, tamaños excesivos y un `messageId` distinto del externo. Las claves y hashes presentes deberán decodificar a 32 bytes; `fileLength` se validará como decimal uint64 sin coerción a un número inseguro. `directPath`, si existe, será una ruta de media que empiece con `/`, sin esquema, autoridad ni fragmento; no se interpretará como ruta del filesystem. Los hosts de descarga serán los proporcionados por el cliente de WhatsApp.

Una referencia emitida podrá conservar metadatos incompletos del protocolo. Si faltan los datos necesarios para descargar y verificar el adjunto, `downloadImage()` devolverá `IMAGE_UNAVAILABLE` y no descartará el mensaje. Una referencia mal formada o incoherente devolverá `INVALID_INPUT`. El tamaño declarado será una previsión, no permiso para superar el presupuesto ni sustituir la medición del archivo final.

La ausencia de `mimeType` no invalidará por sí sola el descriptor. La descarga o reutilización determinará un MIME válido a partir del archivo verificado antes de devolverlo; `DownloadedImage.mimeType` seguirá siendo obligatorio. No se inventará un MIME de imagen para declarar éxito si el archivo no puede identificarse.

Primero se buscará un archivo completo válido para ese `messageId`, verificándolo contra el descriptor. Si existe, se reutilizará aunque la cuenta ya esté desconectada o desvinculada. Para una descarga nueva, la política v1 propuesta requerirá que la cuenta conectada coincida con `accountId`; en otro caso devolverá `ACCOUNT_NOT_CONNECTED`, sin iniciar conexión automática ni usar las credenciales de otra cuenta. Borrar archivos completos seguirá siendo independiente de esa conexión.

Usaremos [`DownloadToFile`](https://github.com/tulir/whatsmeow/blob/9399289b022b/download-to-file.go) para descargar y descifrar en un temporal privado, validando integridad antes de publicarlo como completo. El adaptador de archivo deberá limitar también `WriteAt`, `Truncate` y preasignaciones, no solamente escrituras secuenciales, y contabilizar el tamaño máximo temporal cifrado. Se cerrará y publicará el archivo antes de devolver su URI. No se devolverá una imagen completa como bytes a Kotlin/Swift o JavaScript.

El wrapper no programará otra descarga automática después de fallar la llamada. Los reintentos de transporte y cambios de host internos de whatsmeow pertenecerán a esa misma llamada y deberán respetar el plazo total de 60 segundos y la reserva de espacio. No se incorporará en v1 un flujo de solicitud de reenvío de media al teléfono para recuperar adjuntos expirados. La conexión de media puede renovarse por protocolo; su disponibilidad después de reiniciar y el control de límites deberán verificarse en ambas plataformas.

```text
Expo solicita descargar
    → Go descarga a archivo privado
    → Expo sube el archivo por HTTP
    → servidor confirma
    → Expo solicita deleteDownloadedImage(messageId)
```

Usaremos un directorio privado persistente para archivos pendientes de subida, excluido de backups. Su vida será temporal por política de eliminación, pero no será caché que el sistema pueda limpiar antes de terminar una subida. Expo conservará la URI y el estado de entrega en su cola existente.

El límite será 50 MiB por defecto, configurable mediante `maxImageStorageBytes`. Contará archivos completos y reservas de descargas en curso. Si no se conoce el tamaño de antemano, se limitarán los bytes realmente escritos. Al agotarse el presupuesto, la operación fallará con `STORAGE_LIMIT_REACHED`; el mensaje permanecerá en Expo para reintentar.

Una descarga fallida intentará eliminar su archivo incompleto y liberará solamente el espacio efectivamente retirado. Si falla esa limpieza, el temporal seguirá contando contra el límite y el error informará del fallo sin afirmar que se liberó espacio. Al iniciar se identificarán y eliminarán temporales incompletos con la misma regla; los archivos completos pendientes seguirán contando contra el límite. El borrado será idempotente. Confirmar un mensaje en la cola de Expo y eliminar su imagen serán operaciones independientes; no se eliminarán archivos pendientes solamente por desvincular la cuenta.

Antes de descargar otra vez el mismo adjunto, se reutilizará un archivo completo existente si es válido. No se garantizará la descarga indefinida desde WhatsApp: el recurso remoto puede dejar de estar disponible.

### Concurrencia de imágenes propuesta

Para v1, `downloadImage()` y `deleteDownloadedImage()` se ejecutarán uno por uno, en orden de admisión, mediante una cola interna de operaciones de archivos. No habrá descargas paralelas ni una opción pública de concurrencia. Dos solicitudes de la misma imagen no descargarán dos copias: la segunda verificará y reutilizará el archivo que dejó la primera, si terminó correctamente. Si la primera falla, la segunda será un intento explícito independiente.

Un borrado admitido después de una descarga esperará su finalización; un borrado admitido antes retirará el archivo y una descarga posterior podrá volver a obtenerlo. Borrar un archivo ya ausente devolverá éxito; un fallo de lectura o permisos no se interpretará como ausencia. Una URI identifica un archivo privado, no lo reserva frente a un borrado posterior: el consumidor coordinará sus solicitudes mientras use ese archivo.

La elegibilidad de una descarga remota se comprobará al comenzar su turno. Los 60 segundos cubrirán esa operación de red y sus reintentos internos, excluyendo la espera en la cola. `disconnect()`, `logout()` o la retirada de la generación cancelarán la descarga remota activa y evitarán que sus resultados tardíos publiquen un archivo; la llamada cancelada devolverá `IMAGE_DOWNLOAD_FAILED`. Las solicitudes en espera todavía podrán reutilizar un archivo completo válido, pero no iniciarán red usando una generación retirada: devolverán `ACCOUNT_NOT_CONNECTED` y necesitarán una nueva solicitud explícita. La cancelación no esperará su turno en la cola de imágenes.

La publicación de un archivo completo y la retirada de su generación tendrán un orden definido: si se publicó primero, se conservará; si se retiró primero, se limpiará el parcial sin publicarlo. Un archivo completo que no supere la verificación devolverá `IMAGE_UNAVAILABLE`; el consumidor podrá borrarlo explícitamente antes de reintentar. Los nombres internos se derivarán de la identidad del mensaje mediante una representación segura; ningún identificador o descriptor se usará directamente como ruta del filesystem.

La serialización de archivos será independiente del escritor de sesión y de las confirmaciones de mensajes; no se mantendrá su bloqueo durante una descarga ni al esperar al consumidor. Esta simplificación limita el rendimiento a una operación de imágenes a la vez; se reconsiderará solamente si las mediciones muestran que hace falta concurrencia.

## Compilación e integración

[gomobile](https://pkg.go.dev/golang.org/x/mobile/cmd/gomobile) generará un AAR para Android y un XCFramework para iOS, incluyendo dispositivo y simulador. Sus bindings son Java y Objective-C, consumidos desde Kotlin y Swift; no generan por sí solos un módulo Expo.

| Plataforma | Herramientas de compilación |
| --- | --- |
| Compartido | Go, gomobile, gobind y dependencias de whatsmeow con versiones fijadas. |
| Android | JDK, Android SDK/NDK y Gradle para integrar el AAR. |
| iOS | macOS, Xcode y CocoaPods para integrar el XCFramework. |

El script `build-go.sh` producirá los artefactos antes del build nativo de mobile. El entorno que compile Go necesitará las herramientas anteriores; el teléfono no necesitará instalar Go ni Node.js. Cualquier cambio de código nativo requerirá reconstruir la app. No funcionará en Expo Go ni se plantea soporte web en esta versión.

### Versiones y artefactos propuestos para v1

El módulo seguirá siendo local al repositorio; no se publicará un paquete npm, Maven o CocoaPods remoto para el MVP. Se versionarán Go, Kotlin/Swift, la fachada, los scripts y los lockfiles. Los AAR, XCFramework, bindings auxiliares y ejecutables de herramientas se generarán y excluirán de Git, siguiendo el patrón de artefactos locales de impresión.

| Componente | Versión candidata o regla |
| --- | --- |
| Go | `1.26.5`, utilizada por la prueba aislada. La compilación móvil completa deberá validarla. |
| whatsmeow | `v0.0.0-20261006124319-9399289b022b`, base de los patches y la auditoría. |
| gomobile y gobind | Ambos de `golang.org/x/mobile v0.0.0-20260908204917-8b95e45f8d3e`; no mezclar versiones. |
| Expo / React Native | Integrar con los lockfiles de mobile, actualmente Expo `~57.0.24` y React Native `0.86.3`; no crear otra instalación de React Native dentro del módulo. |
| JDK, SDK/NDK, Gradle, Xcode y CocoaPods | Alinear con el proyecto nativo generado para esa versión Expo. Fijar sus versiones exactas después de la primera compilación nativa exitosa; las herramientas probadas para generar bindings no constituyen una matriz compatible ya validada. |

`go.mod` y `go.sum` serán propios del módulo. Las herramientas `gomobile` y `gobind` se declararán con esa misma versión y se prepararán en un directorio generado del módulo. El script pondrá ese directorio al principio de su PATH: la versión fijada de gomobile busca un ejecutable `gobind`, por lo que declarar solo `go tool gobind` no basta para ejecutar `gomobile bind`. No dependerá de herramientas globales instaladas con `@latest` ni actualizará dependencias durante un build. Se comprobará la versión efectiva de Go; cualquier actualización será un cambio explícito de la matriz.

La dependencia fija declara Go `1.26.0` como mínimo y sugiere `go1.27.1` en su directiva toolchain. Esa sugerencia no se confundirá con una versión móvil ya probada ni permitirá una descarga implícita que cambie la herramienta efectiva del build. La política del módulo principal se fijará explícitamente; la compatibilidad de Go `1.26.5` sigue siendo candidata.

| Salida | Destino y arquitecturas propuestas |
| --- | --- |
| Android | `android/libs/WhatsAppGo.aar`: `android/arm64` para dispositivos y `android/amd64` para emulador x86_64. No se incluirá soporte Android de 32 bits en esta propuesta. Los filtros ABI de la app deberán coincidir con las arquitecturas verificadas del AAR. |
| iOS | `ios/Frameworks/WhatsAppGo.xcframework`: `ios/arm64` e `iossimulator/arm64,iossimulator/amd64`, para dispositivo y simuladores Apple Silicon/Intel. No se incluirán targets macOS o Catalyst. |

La [documentación de gomobile](https://pkg.go.dev/golang.org/x/mobile/cmd/gomobile) permite seleccionar plataformas y arquitecturas. Solo se bindeará `./bridge`; se fijarán el prefijo Java `expo.modules.whatsapp.go` y el prefijo Objective-C `YYWhatsAppGo`, independientes del nombre público Expo `WhatsApp`. Los mínimos Android/iOS se pasarán explícitamente desde la matriz de la app, sin confiar en los defaults antiguos de gomobile. Las arquitecturas, nombres generados y mínimos deberán comprobarse en los binarios y en una app real.

### Orden del build y consumo nativo

`scripts/build-go.sh` tendrá los destinos `android`, `ios` y `all`. Cada destino validará sus herramientas, versiones y dependencias antes de compilar. La selección Android no exigirá Xcode; iOS requerirá macOS con Xcode completo. No se instalarán SDKs ni se modificará la configuración del sistema automáticamente. Un destino solicitado que no pueda generarse fallará; `all` no omitirá silenciosamente una plataforma.

El flujo será: preparar herramientas fijadas → verificar dependencias y aplicar la adaptación de whatsmeow identificada → generar en un directorio temporal → publicar el artefacto completo → ejecutar el build nativo Expo. Gradle y CocoaPods consumirán el resultado, sin descargar ni compilar Go por su cuenta. Si falta el artefacto, la integración fallará con la indicación de generarlo; no usará un stub para aparentar que el módulo está disponible. El proceso local o CI deberá detenerse si falla su generación, sin continuar con un binario anterior.

Android declarará la dependencia AAR local siguiendo `brother-printer`. El podspec iOS declarará `Frameworks/WhatsAppGo.xcframework` como framework vendorizado. La generación Go deberá ocurrir antes de resolver la integración nativa. Cambios en Go, los patches o los contratos del binding requerirán regenerar los binarios y reconstruir la app; una actualización JavaScript no sustituirá un cambio nativo.

La adaptación de whatsmeow seguirá pendiente de elegir y auditar. Para una primera integración se propone aplicar patches versionados a una copia de la dependencia, usando la estrategia de la prueba aislada y sin modificar el caché Go. Se comprobará que cada patch aplica a la revisión esperada; no se descargará automáticamente una rama móvil ni se sustituirá por upstream sin el patch cuando falle. Elegir un fork remoto no es necesario para definir o distribuir el módulo local.

La primera comprobación nativa verificará carga de ambas arquitecturas Android, carga en dispositivo y simulador iOS, llamada Expo → Go y callback de almacenamiento con error Go → Kotlin/Swift → Go. Se registrarán las versiones efectivas y los comandos exitosos en el README del módulo. La identidad de los artefactos se asociará a esa revisión de fuentes; fijar versiones no promete archivos byte a byte idénticos ni demuestra recepción, persistencia o compatibilidad del protocolo.

Usaremos Expo Modules para métodos asíncronos y eventos. Las operaciones de red y disco se ejecutarán fuera del hilo de interfaz. Los eventos públicos entregarán un mensaje normalizado por vez, sin bytes de imagen. El buffer de recuperación y la admisión de historial pertenecerán a la librería; el procesamiento de mensajes y las subidas HTTP serán responsabilidad de Expo.

## Estado de la definición y pendientes

El alcance, la interfaz pública, la estructura del módulo y los contratos de recepción, confirmación, imágenes y sesión están definidos para orientar la implementación. Los esquemas internos, límites y versiones de herramientas identificados como propuestas deberán contrastarse con la adaptación de whatsmeow y los primeros builds nativos; este documento no acredita su funcionamiento.

Quedan estos pendientes concretos:

- **Diseño operativo Android:** verificar la adecuación de `remoteMessaging`, el manifest y el arranque permitido, y comprobar la política acordada de recreación del proceso, parada explícita y reconexión después de reiniciar el teléfono. La recepción con iOS suspendido sigue sin solución definida bajo las restricciones acordadas.
- **Adaptador de protocolo:** completar los codecs y límites por registro, auditar todas las escrituras críticas y resolver los hooks necesarios para comprometer sesión y recuperación antes de confirmar al protocolo.
- **Almacenamiento nativo:** elegir y verificar las operaciones de publicación durable de cada plataforma, los registros de creación de claves, la cota confiable de lectura tras reducir límites, la recuperación ante cierres y el acceso a claves y archivos después del primer desbloqueo.
- **Build e integración nativa:** fijar la matriz efectiva de herramientas, verificar los artefactos y probar llamadas y callbacks en dispositivos y simuladores.

La implementación del consumidor Expo, sus tablas y su activación en segundo plano quedan fuera de esta definición. Las pruebas de la librería usarán un consumidor de prueba para validar entregas y confirmaciones. No se requiere migración de mensajes existentes.

## Validación antes de implementar el flujo completo

Las siguientes listas contienen descripciones directas de tests unitarios y de integración. Los checkboxes representan tests pendientes de implementar y ejecutar; no acreditan resultados. Se conserva el alcance de la librería y un consumidor de prueba, sin implementar tablas de negocio, sincronización con core ni activación JavaScript en segundo plano.

Los contratos compartidos se verificarán en Android e iOS. Los tests de plataforma usarán el entorno correspondiente. Las propuestas internas conservarán ese estado hasta validarse.

### Tests unitarios

Validan una regla o componente aislado con reloj, transporte, almacenamiento y callbacks controlados. No usan una cuenta WhatsApp, red real ni almacenamiento seguro de plataforma. Cada entrada describe directamente lo que debe comprobar el test.

- [ ] **UT-API-03 — Conserva el contrato Result y distingue aceptación de finalización.** Con respuestas controladas, devuelve ok(undefined), conserva códigos de fallo y distingue aceptación de la operación de eventos posteriores.
- [ ] **UT-API-06 — Valida opciones, IDs y referencias antes de mutar estado.** Rechaza opciones, IDs y referencias mal formados sin invocar la dependencia de almacenamiento.
- [ ] **UT-CFG-01 — Aplica los límites predeterminados de recuperación e imágenes.** Resuelve 10 MiB y 50 MiB cuando las opciones no están definidas y calcula los bytes efectivos.
- [ ] **UT-CFG-02 — Convierte MiB válidos y rechaza configuración inválida sin fallback.** Un entero positivo en MiB se convertirá de forma segura; valor vacío, cero, negativo, fracción, texto no numérico o conversión fuera de entero seguro fallarán sin sustituirse por el default.
- [ ] **UT-CON-01 — Devuelve éxito al aceptar connect sin afirmar conexión completada.** Con transporte controlado, resuelve connect al aceptar la solicitud y espera el evento para marcar connected.
- [ ] **UT-CON-02 — Mantiene una sola solicitud de conexión ante llamadas repetidas.** Ante solicitudes repetidas, mantiene una sola intención y una sola invocación activa al transporte.
- [ ] **UT-CON-03 — Sustituye e invalida QR sin reiniciar automáticamente una vinculación terminada.** Sustituye el QR, conserva expiresAt e invalida el valor al abandonar awaitingQr; no reinicia automáticamente el proceso terminado.
- [ ] **UT-CON-04 — Cancela autenticación al vencer 30 segundos excluyendo el escaneo.** Con reloj controlado, solicita cancelación a los 30 segundos de red/autenticación y excluye la espera del escaneo.
- [ ] **UT-CON-05 — Aplica backoff hasta 30 segundos y lo reinicia al conectar.** Con reloj controlado, aplica 1, 2, 4, 8, 16 y 30 segundos, mantiene el tope y reinicia la secuencia después de connected.
- [ ] **UT-CON-07 — Bloquea reconexión de una sesión revocada hasta logout.** Transiciona a sessionExpired, suprime reintentos y rechaza connect hasta retirar la sesión.
- [ ] **UT-CON-08 — Prioriza fallos locales frente a reintentos de red.** Clasifica almacenamiento, capacidad y consumidor como causas distintas de un fallo transitorio de red.
- [ ] **UT-CON-10 — Respeta el orden de connect, disconnect y logout.** Con dependencias controladas, respeta admisión y retirada de generación al intercalar las tres operaciones.
- [ ] **UT-EVT-01 — Entrega el estado vigente al registrar un listener nuevo.** Entrega al listener nuevo el estado actual del controlador preparado, sin deducir connected de la existencia de credenciales.
- [ ] **UT-EVT-02 — Espera la preparación antes de entregar el estado inicial.** No entrega estado hasta completar preparación y después entrega el vigente.
- [ ] **UT-EVT-03 — Reproduce solo el QR vigente con su vencimiento original.** Con reloj controlado, entrega el mismo QR únicamente mientras awaitingQr y antes de expiresAt.
- [ ] **UT-EVT-04 — Impide entregar estado o QR obsoletos después de cambios nuevos.** Al intercalar suscripción y actualización, descarta emisiones iniciales obsoletas y QR invalidados.
- [ ] **UT-EVT-05 — Aísla la reproducción inicial y no reproduce errores pasados.** Dirige la reproducción al nuevo listener, mantiene los anteriores y no reproduce errores históricos.
- [ ] **UT-EVT-06 — Retira únicamente el listener solicitado sin alterar la conexión.** Retira solo la identidad de suscripción indicada y no invoca operaciones de conexión.
- [ ] **UT-MSG-01 — Normaliza texto e imagen en ambas direcciones y fuentes.** Normaliza fixtures históricos y vivos de texto/imagen con dirección incoming y outgoing y el mismo contrato.
- [ ] **UT-MSG-02 — Excluye grupos y contenido fuera del alcance público.** Filtra cada tipo excluido antes de emitir ReceivedMessage.
- [ ] **UT-MSG-03 — Conserva texto y caption y omite entregas de texto vacío.** Texto conservará contenido y espacios; una imagen con descripción la incluirá en `text`. Imagen sin descripción omitirá `text`; texto vacío sin imagen no generará entrega vacía.
- [ ] **UT-MSG-04 — Entrega solo el contenido propio de citas y reenvíos.** Se entregará el contenido propio sin añadir el cuerpo citado ni metadatos de reenvío.
- [ ] **UT-MSG-05 — Ignora ediciones y eliminaciones sin modificar entregas previas.** Esos eventos no reemplazarán mensajes entregados ni ordenarán borrar copias. Un mensaje normal ya editado disponible en historial podrá entregarse sin reconstruir el original.
- [ ] **UT-MSG-06 — Conserva mensajes temporales sin programar eliminación.** Se admitirán sin vencimiento local ni eliminación programada; desaparecer de WhatsApp no borrará pendientes ni indicará al consumidor borrar su copia.
- [ ] **UT-MSG-07 — Una fecha ausente o inválida queda desconocida.** Un timestamp ausente, cero, negativo o fuera de rango no produce error: el contenido se normaliza, `timestamp` se omite (nunca `0` ni la hora del reloj) y el evento original no se modifica. Decisión del dueño, 2026-10-10.
- [ ] **UT-MSG-08 — Conserva imágenes sin MIME o referencia completa.** Admite metadatos con MIME o información de descarga ausentes y conserva la referencia opaca.
- [ ] **UT-MSG-09 — Admite historial disponible sin filtrar por antigüedad.** No filtra fixtures históricos por antigüedad o fecha de vinculación ni descarga sus imágenes al normalizar.
- [ ] **UT-ID-01 — Mantiene message.id entre historial, vivo y reinicios.** El mismo mensaje histórico/en vivo, tras reinicio o cambio de dispositivo, conservará `message.id`; cambios de timestamp, texto, imagen, dirección o revisión no alterarán su construcción.
- [ ] **UT-ID-02 — Distingue cuentas, chats e IDs de protocolo sin colisiones por concatenación.** Variar cuenta, chat o ID de protocolo producirá la identidad de su tupla; se preservarán mayúsculas y contenido del ID original. Componentes con separadores no colisionarán por concatenación.
- [ ] **UT-ID-03 — Codifica identidades canónicas sin pérdida numérica.** Go generará el prefijo y Base64url sin padding de la tupla JSON compacta; JIDs seguirán como strings sin pérdida numérica. Kotlin/Swift y TypeScript no reconstruirán identidades desde el cliente actual.
- [ ] **UT-ID-04 — Conserva deliveryId durante replay y evita colisiones con pendientes.** Replay conservará `deliveryId` y revisión de creación; una repetición después de confirmar podrá crear otro deliveryId con el mismo message.id. Una colisión aleatoria con un pendiente existente no se admitirá como entrega nueva.
- [ ] **UT-ID-05 — Normaliza PN y dispositivos a LID mediante correspondencias verificadas.** Normaliza componentes de dispositivo y consulta el mapping verificado para PN sin fabricar LID.
- [ ] **UT-ID-07 — Distingue correspondencia ausente de fallo de lectura del store.** Emite IDENTITY_UNAVAILABLE una vez por entrada en la condición; diferencia ausencia válida de error del store.
- [ ] **UT-DEL-06 — Entrega un pendiente por vez en orden de revisión y ordinal.** Selecciona una sola entrega por revisión numérica y ordinal, saltando las identidades todavía pendientes.
- [ ] **UT-DEL-07 — Retira pendientes idempotentemente sin historial de confirmaciones.** Con writer controlado, espera éxito durable antes de liberar la entrega y considera idempotente un ID válido ausente.
- [ ] **UT-DEL-08 — Rechaza confirmaciones inválidas y resuelve respuestas perdidas.** Rechaza IDs mal formados; una lectura fallida no equivale a ausencia y repetir una respuesta perdida no libera otro ID.
- [ ] **UT-DEL-09 — Serializa confirmaciones sin liberar otra entrega.** Intercalar confirmaciones repetidas o ajenas no libera incorrectamente el turno actual.
- [ ] **UT-SUB-01 — Activa recuperación local al registrar el consumidor.** Registra un único consumidor, espera almacenamiento preparado y selecciona entrega en curso o siguiente pendiente.
- [ ] **UT-SUB-02 — Sustituye el consumidor y reemite la misma entrega pendiente.** Sustituye la identidad del consumidor y reemite los mismos IDs sin solicitar otro registro al buffer.
- [ ] **UT-SUB-03 — Ignora remove de una suscripción sustituida.** Ignora remove antiguo y descarta callbacks encolados para una suscripción sustituida.
- [ ] **UT-SUB-04 — Acepta la confirmación tardía de un consumidor anterior.** Acepta la confirmación por deliveryId aunque provenga de un callback del consumidor anterior.
- [ ] **UT-SUB-05 — Coordina confirmación y sustitución sin duplicar recorridos.** Intercala sustitución y confirmación sin iniciar dos recorridos ni esperar una entrega ya retirada.
- [ ] **UT-SUB-07 — Recupera localmente al suscribirse sin anular paradas explícitas.** La nueva suscripción activa recuperación local sin invocar connect ni retirar causas de parada explícita.
- [ ] **UT-SUB-08 — Conserva pendientes ante fallo de entrega al consumidor.** Un callback fallido conserva la entrega y detiene emisión sin un temporizador de reemisión.
- [ ] **UT-BUF-01 — Contabiliza contenido, metadatos, cifrado y reservas.** Suma representación serializada, cifrado, metadatos y reservas; excluye bytes de imagen descargados.
- [ ] **UT-BUF-02 — Admite el límite exacto y rechaza un byte adicional.** Admite exactamente el presupuesto y rechaza un byte adicional, tanto para una entrega como para un lote.
- [ ] **UT-BUF-04 — Rechaza entregas mayores que el presupuesto sin reintento infinito.** Distingue una entrega intrínsecamente excesiva de capacidad temporalmente ocupada y evita reintentos infinitos.
- [ ] **UT-HIS-02 — Rechaza el lote completo si falla un mensaje soportado.** Con stores controlados, falla la preparación completa ante un mensaje soportado inválido; excluye tipos no soportados sin tratarlos como corrupción.
- [ ] **UT-HIS-05 — Limita entrada y descompresión antes de materializar el exceso.** Con streams controlados, corta entrada y descompresión al exceder el límite antes de entregar el exceso al parser.
- [ ] **UT-HIS-06 — Aplica independientemente presupuestos de historial y recuperación.** Evalúa por separado límites de entrada, descompresión y recuperación, devolviendo el error de la restricción incumplida.
- [ ] **UT-FMT-02 — Rechaza envoltorios inválidos antes de reservar memoria.** Valida magic, versión, header, longitudes, tag y ausencia de bytes sobrantes antes de reservar según longitudes externas.
- [ ] **UT-FMT-03 — Rechaza JSON y Base64 inválidos o excesivos.** Rechaza campos desconocidos/duplicados, UTF-8 inválido y Base64 no canónico o excesivo.
- [ ] **UT-FMT-06 — Valida enteros, IDs y sumas sin coerción ni overflow.** Revisiones uint64 decimales, IDs hex y ordinal uint32 cumplirán formato y límites; signos, ceros no canónicos y overflow se rechazarán sin coerción. Se comprobará overflow al sumar presupuestos y expansión Base64.
- [ ] **UT-FMT-07 — Conserva registros de sesión y rechaza claves o mappings inválidos.** Hace round-trip de codecs de registros y rechaza tipos/claves duplicados o no canónicos y mappings contradictorios.
- [ ] **UT-FMT-08 — Valida coherencia, orden y formatos de pendientes.** Valida estados de identidad, coherencia del mensaje, ordinal/revisión únicos y formato de cada hijo recuperable.
- [ ] **UT-BRG-04 — Rechaza solicitudes internas inválidas antes de mutar.** Valida el contrato de ApplyChanges y rechaza versión, identidad, generación, revisión o tamaño inválidos antes de aplicar.
- [ ] **UT-BRG-05 — Traduce códigos internos sin interpretar mensajes de error.** Mapea cada código interno al público acordado preservando la prioridad del error de almacenamiento.
- [ ] **UT-IMG-02 — Rechaza descriptores mal formados o incoherentes.** Valida prefijo, versión, límite de 16 KiB, campos, IDs, Base64, longitudes de claves/hashes y uint64 decimal.
- [ ] **UT-IMG-03 — Rechaza rutas y hosts arbitrarios en referencias.** Rechaza esquema, autoridad, fragmento y rutas arbitrarias en directPath, sin permitir seleccionar un host externo.
- [ ] **UT-IMG-04 — Devuelve IMAGE_UNAVAILABLE para referencias incompletas o recursos expirados.** Con transporte controlado, informa IMAGE_UNAVAILABLE por metadata insuficiente o recurso expirado y no solicita reenvío.
- [ ] **UT-IMG-05 — Exige la cuenta de origen conectada para una descarga nueva.** Permite red únicamente para la cuenta coincidente conectada cuando no existe completo reutilizable.
- [ ] **UT-IMG-09 — Limita bytes reales y reservas en todas las operaciones de archivo.** Contabiliza reservas y bytes de operaciones controladas WriteAt, Truncate y preasignación, incluso con tamaño declarado falso.
- [ ] **UT-IMG-10 — Aplica el plazo total de descarga sin reintento automático del wrapper.** Con reloj controlado, limita red y reintentos internos a 60 segundos, excluye cola y no crea reintento automático nuevo.
- [ ] **UT-IMG-12 — Borra idempotentemente sin confundir error con ausencia.** Con filesystem controlado, considera idempotente ausencia confirmada y diferencia fallos de permisos/lectura.
- [ ] **UT-IMG-13 — Serializa descargas y evita copias duplicadas del mismo adjunto.** Mantiene una sola operación de archivos y reutiliza el primer éxito para dos solicitudes del mismo adjunto.
- [ ] **UT-IMG-14 — Respeta orden de admisión entre descarga y borrado.** Ejecuta descarga y borrado en orden de admisión, sin reservar la URI frente a borrados posteriores.
- [ ] **UT-IMG-15 — Ordena cancelación y publicación sin publicar resultados retirados.** Intercala cancelación y publicación; preserva el completo publicado primero o impide publicar si ganó la retirada.
- [ ] **UT-IMG-16 — Impide red de solicitudes encoladas con generación retirada.** Impide iniciar red con una generación retirada, aunque una nueva esté conectada, y permite reutilizar un completo válido.

### Tests de integración

Validan interacciones entre componentes reales: fachada y módulo, binding Go/nativo, writer, claves, filesystem, descarga o servicio. El transporte de WhatsApp y los servicios externos se sustituirán por mocks o dobles locales controlados, con fixtures de QR, mensajes, historial, media y errores; no se requerirán cuentas reales, escaneo QR ni infraestructura exterior. Los tests de durabilidad y custodia de claves usarán las APIs nativas reales. Estas pruebas validarán el contrato local, sin acreditar compatibilidad con el servicio WhatsApp real. Cuando también existe un test unitario de la regla, este test comprueba que la integración respeta su resultado.

- [ ] **IT-API-01 — Devuelve MODULE_UNAVAILABLE cuando el módulo no está disponible.** En un build sin el módulo, Expo Go o una plataforma no soportada, las operaciones devolverán `MODULE_UNAVAILABLE`, sin simular conexión ni éxito.
- [ ] **IT-API-02 — Rechaza operaciones sin preparar su capacidad y permite registrar listeners.** Antes de inicializar, cada operación que necesita almacenamiento o cliente devolverá `NOT_INITIALIZED`; registrar y retirar listeners seguirá permitido.
- [ ] **IT-API-03 — Conserva el contrato Result y distingue aceptación de finalización.** Los métodos exitosos sin datos devolverán `ok(undefined)` y los fallos esperados conservarán su código en `Result`. Un error posterior a aceptar una operación se notificará por eventos, sin convertir retrospectivamente su aceptación en conexión completada.
- [ ] **IT-API-04 — Rechaza respuestas y eventos nativos inválidos sin confirmar entregas.** JSON, versión, estructura o tipos incompatibles producirán `INVALID_NATIVE_RESPONSE`; no se afirmará éxito ni se borrará estado. Un evento inválido no llegará como mensaje válido ni confirmará su entrega.
- [ ] **IT-API-05 — Convierte excepciones del puente en NATIVE_CALL_FAILED sin asumir rollback.** Una excepción de invocación se convertirá en `NATIVE_CALL_FAILED`; si el resultado de una mutación es incierto, se conservarán datos y se resolverá mediante el estado publicado o repetición idempotente permitida.
- [ ] **IT-API-06 — Valida opciones, IDs y referencias antes de mutar estado.** Opciones, IDs y referencias mal formados se rechazarán con `INVALID_INPUT` antes de mutar. Se comprobarán los mismos límites en las fronteras nativas aunque una llamada omita la fachada TypeScript.
- [ ] **IT-API-07 — Limita la API a las responsabilidades públicas acordadas.** La API no expondrá envío, listado de la cola de core ni confirmación de subida. Confirmar persistencia local no significará subir a core ni borrar imágenes.
- [ ] **IT-API-08 — Transporta metadatos sin bytes de imagen y ejecuta red y disco fuera del hilo de interfaz.** Callbacks Go usarán contratos JSON y eventos públicos entregarán un mensaje normalizado por vez; bytes/base64 de imágenes no cruzarán a JavaScript. Red y disco no bloquearán el hilo de interfaz.
- [ ] **IT-INI-01 — Prepara una instalación sin sesión sin conectar ni emitir QR.** Inicializar preparará almacenamiento y recuperación sin conectar ni emitir QR; una llamada posterior a `connect()` podrá comenzar vinculación.
- [ ] **IT-INI-02 — Restaura sesión y pendientes sin conectar automáticamente.** Inicializar restaurará el estado confirmado y pendientes sin conectar automáticamente; conectar reutilizará la sesión y no exigirá otro QR válido por defecto.
- [ ] **IT-INI-03 — Comparte un único cliente entre inicializaciones concurrentes.** Inicializaciones simultáneas o repetidas con opciones equivalentes compartirán la preparación y un único controlador, cliente y coordinador, sin borrar datos.
- [ ] **IT-INI-04 — Revalida una preparación fallida al reintentar.** Repetirla volverá a validar el estado afectado; no reutilizará el intento anterior como éxito ni conservará memoria no confirmada.
- [ ] **IT-INI-05 — Permite recuperar y confirmar pendientes con sesión inválida y buffer válido.** Inicializar devolverá `SESSION_STATE_INVALID`, mantendrá la conexión bloqueada y permitirá emitir y confirmar pendientes resueltos, sin devolver `NOT_INITIALIZED` por ese fallo exclusivo de sesión.
- [ ] **IT-INI-06 — Bloquea recuperación y conexión cuando el contenedor no puede validarse.** Corrupción o falta de `K_recovery` bloquearán recuperación y conexión; no se emitirán datos no autenticados ni se intentará limpieza selectiva automática.
- [ ] **IT-INI-07 — Permite logout seguro desde una inicialización parcial.** Con contenedor validado y clave de sesión identificable, retirar la sesión conservará pendientes y habilitará nueva vinculación tras completar la retirada local. Una desvinculación remota no verificable devolverá `REMOTE_LOGOUT_UNCONFIRMED`.
- [ ] **IT-INI-08 — Adopta el controlador nativo existente al regresar JavaScript.** Al volver JavaScript, inicializar adoptará el controlador nativo existente con opciones equivalentes, sin duplicarlo ni solicitar otra conexión. Opciones distintas seguirán los tests de configuración.
- [ ] **IT-CFG-01 — Aplica los límites predeterminados de recuperación e imágenes.** Sin variable de entorno ni opciones personalizadas se utilizarán 10 MiB de recuperación y 50 MiB de imágenes. La composición pasará los bytes efectivos al módulo en ambas plataformas.
- [ ] **IT-CFG-03 — Transfiere opciones del bundle y restaura las persistidas sin leer .env en nativo.** Cambiar el bundle permitirá pasar nuevos valores; Go y código nativo no leerán `.env`. La recreación del servicio utilizará opciones persistidas sin JavaScript.
- [ ] **IT-CFG-04 — Guarda límites nuevos después de disconnect y los conserva al reiniciar.** `disconnect()` exitoso seguido de `initialize(newOptions)` publicará `options` en la misma revisión sin borrar sesión ni pendientes; `connect()` posterior los utilizará. Reinicios de iOS y Android restaurarán los valores publicados aun sin sesión y no tomarán opciones de `state.next`; una respuesta incierta se resolverá releyendo `state.bin`.
- [ ] **IT-CFG-05 — Rechaza límites distintos mientras la recepción sigue solicitada.** Opciones distintas durante conexión, QR, reconexión o pausa por buffer lleno devolverán `INVALID_INPUT`. Repetir opciones equivalentes será idempotente incluso con cliente activo.
- [ ] **IT-CFG-06 — Conserva y permite drenar datos que superan un límite reducido.** Inicializar aceptará el nuevo límite; pendientes e imágenes seguirán legibles después de reiniciar, confirmables, reutilizables o borrables. Nuevas admisiones esperarán o fallarán según capacidad, sin descartar datos existentes.
- [ ] **IT-CFG-07 — Mantiene una cota de lectura suficiente tras reducir el presupuesto.** Reducir presupuesto no reducirá la cota confiable necesaria para snapshots previos ni aceptará longitudes arbitrarias. Una confirmación o actualización de configuración podrá publicar mientras se drena el exceso.
- [ ] **IT-CFG-08 — Serializa cambios de límites y espera la limpieza de descargas canceladas.** Actualizaciones se serializarán; el límite de imágenes esperará la limpieza de una descarga cancelada sin bloquear el writer durante esa espera. Un fallo de publicación no devolverá éxito y su resultado incierto se resolverá leyendo lo publicado.
- [ ] **IT-CFG-09 — Mantiene presupuestos globales e independientes al cambiar de cuenta.** Cambiar de cuenta no multiplicará límites. Aumentar recuperación no aumentará límites internos de historial/sesión ni garantizará recuperar recursos remotos rechazados o expirados.
- [ ] **IT-CON-01 — Devuelve éxito al aceptar connect sin afirmar conexión completada.** `connect()` devolverá éxito al aceptar la solicitud; solo `connectionChanged: connected` indicará conexión completada. Esperar el escaneo no mantendrá pendiente el método.
- [ ] **IT-CON-02 — Mantiene una sola solicitud de conexión ante llamadas repetidas.** Llamadas durante conexión, QR, estado conectado o reconexión mantendrán una solicitud y un intento activo, sin abrir clientes o vinculaciones paralelos.
- [ ] **IT-CON-03 — Sustituye e invalida QR sin reiniciar automáticamente una vinculación terminada.** Cada QR nuevo sustituirá al anterior conservando su vencimiento real. Salir de `awaitingQr` lo invalidará; un proceso terminado sin vincular emitirá `CONNECTION_FAILED` y `disconnected`, sin reiniciarse hasta otra solicitud explícita.
- [ ] **IT-CON-04 — Cancela autenticación al vencer 30 segundos excluyendo el escaneo.** Un intento de red/autenticación tendrá 30 segundos excluyendo la espera de QR; al vencer se cancelará y reportará fallo, permitiendo reconexión transitoria solo si hay sesión vinculada y sigue solicitada.
- [ ] **IT-CON-05 — Aplica backoff hasta 30 segundos y lo reinicia al conectar.** Perder red producirá esperas de 1, 2, 4, 8, 16 y luego 30 segundos, con un intento activo. Una conexión completada reiniciará la secuencia; no se crearán intentos paralelos al fluctuar la red.
- [ ] **IT-CON-06 — Cancela conexión y reintentos conservando sesión al desconectar.** Detener cancelará red, esperas y reintentos, conservará sesión y pendientes y rechazará resultados tardíos. Repetir la parada será idempotente; reconectar requerirá nueva solicitud.
- [ ] **IT-CON-07 — Bloquea reconexión de una sesión revocada hasta logout.** Se emitirá `sessionExpired`, se detendrán reintentos y `connect()` devolverá `SESSION_EXPIRED` hasta retirar el estado con `logout()`. No se iniciará QR automáticamente.
- [ ] **IT-CON-08 — Prioriza fallos locales frente a reintentos de red.** Fallo de persistencia, buffer lleno o consumidor ausente no se tratarán como red transitoria. Un error de almacenamiento bloqueará la generación aunque coincida con recuperación de red.
- [ ] **IT-CON-09 — Revalida deadlines al reanudarse y aísla resultados tardíos.** Al reanudar se comprobará la vigencia con tiempo monotónico sin crear intentos duplicados. Un timeout no se interpretará como rollback de I/O; resultados tardíos quedarán terminados o aislados antes de reutilizar recursos.
- [ ] **IT-CON-10 — Respeta el orden de connect, disconnect y logout.** Intercalar `connect()`, `disconnect()` y `logout()` respetará orden de admisión y retirada de generaciones; la parada no esperará un commit futuro del consumidor.
- [ ] **IT-EVT-01 — Entrega el estado vigente al registrar un listener nuevo.** Un listener nuevo recibirá el estado vigente y después sus cambios; una sesión guardada nunca bastará para emitir `connected`.
- [ ] **IT-EVT-02 — Espera la preparación antes de entregar el estado inicial.** El listener esperará preparación y recibirá entonces el estado correcto; sesión inválida con recuperación disponible no se presentará como conectada.
- [ ] **IT-EVT-03 — Reproduce solo el QR vigente con su vencimiento original.** Se reproducirá solo en `awaitingQr`, sin regenerarlo ni extender `expiresAt`; un QR vencido o invalidado no se entregará.
- [ ] **IT-EVT-04 — Impide entregar estado o QR obsoletos después de cambios nuevos.** Una conexión o invalidación concurrente con la suscripción no dejará un estado viejo después del nuevo ni un QR obsoleto encolado para emitir.
- [ ] **IT-EVT-05 — Aísla la reproducción inicial y no reproduce errores pasados.** Conexión, QR y errores admitirán varios listeners. La reproducción inicial se dirigirá solo al nuevo y no repetirá eventos en los anteriores; los errores antiguos no se reproducirán.
- [ ] **IT-EVT-06 — Retira únicamente el listener solicitado sin alterar la conexión.** `remove()` retirará únicamente la suscripción correspondiente; agregar o quitar estos listeners no solicitará conexión ni provocará desvinculación.
- [ ] **IT-MSG-01 — Normaliza texto e imagen en ambas direcciones y fuentes.** Texto e imágenes individuales, tanto `incoming` como `outgoing` de otros dispositivos, se normalizarán por historial y recepción en vivo con el mismo contrato.
- [ ] **IT-MSG-02 — Excluye grupos y contenido fuera del alcance público.** Grupos, video, audio, documentos, stickers, reacciones e imágenes de visualización única no emitirán `ReceivedMessage`. La exclusión pública no omitirá escrituras de protocolo necesarias.
- [ ] **IT-MSG-07 — Una fecha ausente o inválida no detiene ni pierde mensajes.** Con timestamp ausente o inválido, en vivo y en historial, el mensaje se persiste, se entrega sin `timestamp` y se confirma con normalidad, también tras reiniciar y ante la reentrega del servidor; no falla la sesión, el lote de historial se admite completo, el orden de llegada se conserva (en el lote, la posición de protocolo) y la deduplicación usa `message.id`. No se inventa hora de recepción ni `0`. La API pública acepta `timestamp` ausente o `null`. Decisión del dueño, 2026-10-10.
- [ ] **IT-MSG-08 — Conserva imágenes sin MIME o referencia completa.** Ausencia de MIME o datos de descarga no descartará el mensaje. MIME será opcional en recepción/descriptor; una descarga exitosa exigirá MIME válido y los datos insuficientes producirán `IMAGE_UNAVAILABLE`.
- [ ] **IT-MSG-09 — Admite historial disponible sin filtrar por antigüedad.** Se admitirán mensajes proporcionados sin filtrar por antigüedad o fecha de vinculación, sin prometer historial que WhatsApp no entregue. Imágenes permanecerán como referencias hasta descarga explícita.
- [ ] **IT-ID-05 — Normaliza PN y dispositivos a LID mediante correspondencias verificadas.** Retirar el componente de dispositivo conservará LID canónico; PN requerirá correspondencia verificada, nunca un LID inventado a partir de número o username. Historial y vivo coincidirán.
- [ ] **IT-ID-06 — Conserva identidad pendiente sin emitir IDs provisionales.** Con LID propio conocido se guardará el pendiente sin ID público provisional, sin emitir ni permitir su confirmación al protocolo, reservando capacidad para completarlo. Sin LID propio no se admitirá bajo otra cuenta.
- [ ] **IT-ID-07 — Distingue correspondencia ausente de fallo de lectura del store.** Ausencia válida emitirá `IDENTITY_UNAVAILABLE` al entrar en esa condición, sin repetirlo por recorrido ni hacer polling; una lectura fallida del store activará parada de almacenamiento.
- [ ] **IT-ID-08 — Completa identidad durablemente al recibir una correspondencia.** Actualizarla publicará identidad y mensaje juntos conservando deliveryId y orden antes de emitir. El coordinador podrá entregar otros pendientes resueltos y procesar mappings mientras espera confirmación.
- [ ] **IT-ID-09 — Conserva pendientes sin LID tras reinicio y logout.** Se reevaluarán pendientes con datos verificables de su cuenta; antes de retirar sesión se completarán correspondencias disponibles. Los restantes no vencerán ni se resolverán con credenciales de otra cuenta.
- [ ] **IT-ID-10 — Aísla pendientes y archivos de cuentas anteriores.** `disconnect()` conservará la cuenta; cambiar requerirá logout completado. Los pendientes, referencias y archivos anteriores mantendrán separación y podrán confirmarse/borrarse sin mezclar credenciales o enviar ACK por la cuenta nueva.
- [ ] **IT-DEL-01 — Ordena commit nativo, entrega, persistencia del consumidor, retirada y ACK.** Observar commit conjunto de sesión y contenido antes del evento; persistencia del consumidor antes de confirmación; retirada durable antes de éxito del manejador y permiso de ACK. Emitir o encolar por sí solo no cumplirá esos pasos.
- [ ] **IT-DEL-02 — Descarta estado no confirmado si la app cae antes del commit nativo.** No se emitirá ni confirmará éxito; se descartará estado no confirmado. Una posible reentrega remota se tratará según el protocolo, sin asumir retención indefinida.
- [ ] **IT-DEL-03 — Reemite la entrega comprometida tras caída anterior a la confirmación.** Antes del commit del consumidor o antes de su confirmación, reiniciar reemitirá el pendiente local con los mismos IDs, sin descifrar otra vez el paquete sobre estado avanzado.
- [ ] **IT-DEL-04 — Evita duplicar persistencia tras caída posterior al commit del consumidor.** El consumidor de prueba reconocerá el duplicado y confirmará; la prueba observará una sola persistencia lógica y retirada posterior del pendiente.
- [ ] **IT-DEL-05 — Conserva protocolo confirmado si la app cae antes del ACK.** Se conservará protocolo confirmado; una reentrega recuperable mantendrá message.id y podrá confirmarse idempotentemente, sin exigir historial nativo de mensajes confirmados.
- [ ] **IT-DEL-06 — Entrega un pendiente por vez en orden de revisión y ordinal.** Recuperación y mensajes nuevos compartirán una entrega pública en curso, ordenada por revisión numérica y ordinal; la fecha del mensaje no impondrá orden cronológico. Inicializar no esperará todas las confirmaciones.
- [ ] **IT-DEL-07 — Retira pendientes idempotentemente sin historial de confirmaciones.** Un pendiente se retirará solo tras commit durable; confirmar de nuevo o confirmar un ID válido ausente devolverá éxito sin borrar otro pendiente ni conservar tombstones de confirmación.
- [ ] **IT-DEL-08 — Rechaza confirmaciones inválidas y resuelve respuestas perdidas.** ID mal formado devolverá `INVALID_INPUT`; lectura o publicación fallida no equivaldrá a ausencia. Perder la respuesta de una retirada exitosa se resolverá repitiendo la confirmación.
- [ ] **IT-DEL-09 — Serializa confirmaciones sin liberar otra entrega.** Confirmaciones repetidas o de otra entrega no liberarán por error el turno actual. Una confirmación de cuenta anterior será válida aunque el cliente activo sea otro o no haya credenciales.
- [ ] **IT-DEL-10 — Retiene pendientes sin vencimiento y elimina su entrada completa al confirmar.** Un pendiente sin confirmar no vencerá ni se descartará por edad; confirmar retirará toda su entrada recuperable, sin mantener cuerpos en otra colección ni borrar su imagen descargada.
- [ ] **IT-DEL-11 — Recupera pendientes resueltos sin red ni credenciales.** Pendientes resueltos se entregarán tras desconexión, logout o fallo exclusivo de sesión; los datos de origen y referencias permanecerán iguales y no dependerán de una conexión nueva.
- [ ] **IT-SUB-01 — Activa recuperación local al registrar el consumidor.** Registrar messageReceived antes o después de preparar almacenamiento activará la recuperación local; si hay entrega en curso se reemitirá, y si no se elegirá el siguiente pendiente resuelto.
- [ ] **IT-SUB-02 — Sustituye el consumidor y reemite la misma entrega pendiente.** Un nuevo consumidor sustituirá al anterior y recibirá la entrega pendiente con IDs originales, sin otra fila de buffer ni coordinador paralelo.
- [ ] **IT-SUB-03 — Ignora remove de una suscripción sustituida.** Retirar la suscripción sustituida no retirará la vigente. Emisiones encoladas al consumidor antiguo se descartarán.
- [ ] **IT-SUB-04 — Acepta la confirmación tardía de un consumidor anterior.** Podrá terminar y confirmar después de la sustitución; el consumidor de prueba tolerará persistencia concurrente por identidad sin duplicar su efecto lógico.
- [ ] **IT-SUB-05 — Coordina confirmación y sustitución sin duplicar recorridos.** Confirmar justo antes, durante o después de sustituir consumidor no causará espera de una entrega ya retirada ni dos recorridos simultáneos.
- [ ] **IT-SUB-06 — Conserva la entrega al desaparecer el runtime consumidor.** Se conservará el pendiente y se pausará emisión/recepción, sin timeout de descarte. Recrear JavaScript y suscribirse recuperará localmente sin reiniciar el proceso nativo.
- [ ] **IT-SUB-07 — Recupera localmente al suscribirse sin anular paradas explícitas.** Resuscribirse después de disconnect, logout o fallo local no solicitará red ni anulará intervención explícita requerida. La recuperación local continuará si el almacenamiento sigue validado.
- [ ] **IT-SUB-08 — Conserva pendientes ante fallo de entrega al consumidor.** Un fallo de entrega conservará el pendiente y notificará el error acordado; no contará como confirmación ni generará bucle de reemisión. La nueva suscripción permitirá recuperación local conforme al controlador.
- [ ] **IT-BUF-01 — Contabiliza contenido, metadatos, cifrado y reservas.** Mensaje normalizado, recovery, metadatos, codificación, cifrado y reservas de identidad contarán en el presupuesto global. Bytes de imágenes descargadas no se cargarán a ese buffer.
- [ ] **IT-BUF-02 — Admite el límite exacto y rechaza un byte adicional.** Un registro o lote que alcance exactamente el presupuesto podrá admitirse; uno que lo exceda no se comprometerá parcialmente. Se comprobarán casos de un byte por debajo, en el límite y por encima.
- [ ] **IT-BUF-03 — Pausa y reanuda admisión al liberar capacidad mediante confirmaciones.** Pausar con `RECOVERY_BUFFER_FULL` conservará pendientes y permitirá confirmaciones. Al liberar suficiente capacidad se reanudará solo si sigue solicitado, respetando parada y expiración.
- [ ] **IT-BUF-04 — Rechaza entregas mayores que el presupuesto sin reintento infinito.** Si excede por sí sola el presupuesto, se informará el rechazo sin descartar otros pendientes ni reintentar indefinidamente cuando se libere espacio insuficiente.
- [ ] **IT-HIS-01 — Admite el lote completo y sus cambios antes de emitir.** Todos los mensajes soportados y cambios de protocolo se publicarán juntos antes de emitir el primero; se procesarán mappings antes de normalizar dependientes.
- [ ] **IT-HIS-02 — Rechaza el lote completo si falla un mensaje soportado.** Error de lectura, normalización o escritura de un mensaje soportado no dejará admisión parcial ni declarará completado el lote. Tipos fuera de alcance se excluirán conforme a su política.
- [ ] **IT-HIS-03 — Permite confirmar durante espera de espacio y cancela admisión retirada.** Un lote que cabe, pero espera confirmaciones para obtener espacio, no bloqueará el writer ni dichas confirmaciones. Disconnect, logout o fallo local retirarán su generación e impedirán admisión tardía.
- [ ] **IT-HIS-04 — Procesa un solo lote sin acumular lotes completos en RAM.** Se procesará uno a la vez sin acumular lotes completos en RAM mientras espera el consumidor; no se creará almacenamiento temporal de historial fuera del buffer acordado.
- [ ] **IT-HIS-05 — Limita entrada y descompresión antes de materializar el exceso.** Entrada descargada e inline se medirán durante recepción; salida descomprimida se limitará antes del parser. Tamaños declarados falsos y expansión excesiva producirán `HISTORY_LIMIT_REACHED` sin cargar primero el exceso completo.
- [ ] **IT-HIS-06 — Aplica independientemente presupuestos de historial y recuperación.** Un lote que cabe en 16 MiB de entrada y 32 MiB descomprimidos podrá fallar por el buffer; aumentar este no cambiará aquellos límites ni ocultará el código correspondiente.
- [ ] **IT-HIS-07 — Preserva una fuente recuperable al controlar ACK, recibo y eliminación.** Instrumentar por separado ACK de notificación, recibo histórico y eliminación del archivo remoto. Ninguno retirará la única fuente recuperable de contenido todavía no confirmado localmente; flags por sí solos no demostrarán esta propiedad.
- [ ] **IT-HIS-08 — Recupera historial comprometido tras caídas en sus distintas etapas.** Interrumpir captura de notificación, descarga, admisión y entrega; recuperar lo comprometido sin depender únicamente de una referencia remota o número de chunk. Un lote rechazado no se presentará como recuperable indefinidamente.
- [ ] **IT-HIS-09 — Mide el pico de memoria real del procesamiento histórico.** Con lotes representativos y adversarios se medirán parser, normalización, copias del binding y snapshots; las cotas de bytes no se reportarán como cota total de RAM. Umbrales de profundidad/cantidad requerirán cerrar el esquema antes de fijar su aceptación numérica.
- [ ] **IT-FMT-01 — Conserva todos los bloques al escribir y leer un snapshot.** Escribir y leer el formato candidato conservará sesión, pendientes, revisiones, limpieza de claves, `options` efectivas en iOS/Android y control Android; los datos de protocolo no se reconstruirán desde punteros o interfaces serializados.
- [ ] **IT-FMT-02 — Rechaza envoltorios inválidos antes de reservar memoria.** Magic, versión, header superior a 4 KiB, longitudes incoherentes, tag corto, truncamiento o bytes sobrantes se rechazarán antes de usar datos; tamaños se comprobarán antes de reservar memoria.
- [ ] **IT-FMT-03 — Rechaza JSON y Base64 inválidos o excesivos.** Campos desconocidos/duplicados, `options` ausentes, inválidas o fuera del control de 4 KiB, UTF-8 inválido y Base64 no canónico o excesivo se rechazarán en sus contratos respectivos, sin decodificar previamente tamaños no acotados.
- [ ] **IT-FMT-04 — Detecta alteraciones de contenedor y sesión mediante autenticación.** Modificar header, nonce, ciphertext o tag invalidará el contenedor; modificar la cuenta, clave, storeId o revisión asociada invalidará el bloque de sesión correspondiente. Un header no autenticado no autorizará borrar claves.
- [ ] **IT-FMT-05 — Utiliza nonces nuevos y conserva revisiones coherentes.** Cada cifrado nuevo utilizará nonce seguro, sin derivarlo de revisión ni reutilizar el anterior. Confirmar pendientes podrá conservar ciphertext y sessionRevision sin volver a cifrar la sesión; sessionRevision nunca excederá revision.
- [ ] **IT-FMT-07 — Conserva registros de sesión y rechaza claves o mappings inválidos.** Cada tipo de la lista v1 tendrá round-trip de su clave y valor según el codec auditado, incluidos todos los campos persistidos de device. Tipos desconocidos, claves duplicadas/no canónicas y mappings inversos contradictorios se rechazarán.
- [ ] **IT-FMT-08 — Valida coherencia, orden y formatos de pendientes.** Resolved exigirá mensaje y referencias coherentes; pendingLid no admitirá ID provisional. Revisión/ordinal duplicados se rechazarán; cada hijo vivo preservará su formato y hash de 32 bytes y el histórico no inventará hash de ciphertext.
- [ ] **IT-FMT-09 — Mantiene separadas las claves de sesión y recuperación.** K_recovery cifrará el contenedor y K_session las credenciales; Go no recibirá claves de almacenamiento y JavaScript no recibirá ninguna. La retirada de K_session no hará ilegibles pendientes resueltos.
- [ ] **IT-FMT-10 — Rechaza escrituras obsoletas sin atribuir protección contra rollback externo.** Comprobar revisión esperada impedirá escrituras obsoletas, pero no se declarará protección contra restauración maliciosa de un snapshot antiguo válido sin otro mecanismo definido.
- [ ] **IT-STO-01 — Devuelve éxito únicamente después de publicación durable.** Un callback de escritura no devolverá éxito al actualizar RAM o encolar trabajo; deberá completar cifrado, escritura, sincronización, cierre, reemplazo y sincronización de metadatos requeridos.
- [ ] **IT-STO-02 — Conserva la revisión publicada ante fallo previo al reemplazo.** Inyectar por separado error de cifrado, escritura parcial, sync, cierre y reemplazo; conservar la revisión publicada, no emitir entrega exitosa y detener la generación afectada.
- [ ] **IT-STO-03 — Relee lo publicado ante un resultado incierto posterior al reemplazo.** Ante fallo de sincronización de metadatos o respuesta perdida, releer lo publicado antes de otra operación; no restaurar automáticamente la revisión anterior ni repetir una mutación suponiendo rollback.
- [ ] **IT-STO-04 — Recupera una revisión coherente tras cierre en cada frontera de publicación.** Terminar el proceso antes/después de cada paso de publicación y reiniciar; recuperar una revisión coherente sin mezclar sesión y pendientes de revisiones distintas. state.next no se promoverá por su número mayor.
- [ ] **IT-STO-05 — Conserva estado publicado cuando falta espacio para temporales.** Agotar espacio para la segunda copia o temporales conservará el estado publicado y producirá error, aunque los presupuestos lógicos no se hayan agotado.
- [ ] **IT-STO-06 — Detiene cambios de protocolo al superar el presupuesto de sesión.** Exactamente 16 MiB será admisible; excederlo detendrá cambios con `SESSION_STORAGE_LIMIT_REACHED`, sin podar claves, sesiones o mappings. Restauración sobredimensionada bloqueará conexión y permitirá recuperación legible.
- [ ] **IT-STO-07 — Serializa todas las mutaciones sobre la revisión vigente.** Recepción, confirmaciones, identidad y logout se serializarán sobre estado vigente; una confirmación no se perderá porque Go publique una copia vieja del buffer.
- [ ] **IT-STO-08 — Limpia temporales sin promover preparaciones no confirmadas.** Un temporal incompleto se retirará después de validar la revisión publicada; un error de lectura/limpieza no se interpretará como ausencia. Temporales de estado nunca contendrán plaintext.
- [ ] **IT-KEY-01 — Completa creación inicial antes de permitir vinculación.** Registrar creación e IDs precederá generar claves; publicar state.bin precederá marcar terminada. Antes de terminar no se permitirá vincular ni recibir.
- [ ] **IT-KEY-02 — Recupera creación interrumpida reutilizando claves existentes.** Reiniciar con registro en curso reutilizará claves existentes y creará solo las no creadas; no confundirá instalación parcial reconocida con una instalación nueva ajena.
- [ ] **IT-KEY-03 — Repite preparación inicial tras retirar un temporal incompleto.** Con registro en curso y solo temporal, retirarlo y repetir preparación no promoverá contenido sin commit. Un fallo de retirada impedirá afirmar que la recuperación terminó.
- [ ] **IT-KEY-04 — Reconoce la publicación inicial antes de completar su registro.** Con registro todavía en curso y state.bin válido/coherente se conservará lo publicado y se finalizará el registro, sin generar otras claves.
- [ ] **IT-KEY-05 — Rechaza instalaciones establecidas incompletas sin recrearlas vacías.** Falta de archivo/clave tras creación terminada, artefactos sin registro, corrupción o IDs incoherentes producirán `SESSION_STATE_INVALID`, conservando evidencia y sin reiniciar vacía.
- [ ] **IT-KEY-06 — Conserva claves de sesiones publicadas y retira solo provisionales.** Interrumpir antes y después de crear/publicar; conservar la clave referenciada por sesión publicada o retirar únicamente la provisional no publicada después de validar el estado. Una limpieza fallida bloqueará nueva vinculación.
- [ ] **IT-KEY-07 — Relee el registro de creación ante respuestas inciertas.** Perder respuesta a una actualización segura obligará a releer antes de continuar; no se decidirá ausencia de sesión/clave sobre una lectura fallida.
- [ ] **IT-KEY-08 — Respeta protección y primer desbloqueo en Android.** Claves no exportables y archivos en almacenamiento protegido por credenciales permitirán el uso previsto después del primer desbloqueo sin autenticación por operación; antes de él, fallar preservará archivos y claves.
- [ ] **IT-KEY-09 — Respeta protección y primer desbloqueo en iOS.** Claves AfterFirstUnlockThisDeviceOnly y archivos completeUntilFirstUserAuthentication, incluidos temporales, conservarán acceso previsto tras primer desbloqueo, sin implicar ejecución durante suspensión.
- [ ] **IT-KEY-10 — Excluye backups y restringe aliases al namespace del módulo.** Estado e imágenes se ubicarán en almacenamiento privado persistente excluido de backup/transferencia; claves no se sincronizarán. IDs solo seleccionarán aliases del módulo; no se aceptarán rutas ni claves ajenas.
- [ ] **IT-OUT-01 — Completa retirada durable de sesión y clave antes de éxito local.** Detener generación y recepción solicitada, intentar desvinculación, publicar session null con clave pendiente de borrar, eliminarla y retirar su marcador; devolver éxito local solo después de completar esa secuencia.
- [ ] **IT-OUT-02 — Retira credenciales aunque la desvinculación remota no se confirme.** Sin confirmación remota en 15 segundos, completar retirada local segura y devolver `REMOTE_LOGOUT_UNCONFIRMED`, sin restaurar credenciales ni afirmar desvinculación remota.
- [ ] **IT-OUT-03 — Bloquea nueva vinculación cuando falla la retirada local.** Fallar publicación, borrado de clave o retirada del marcador mantendrá conexión detenida y bloqueará vinculación nueva hasta resolverlo; releer distinguirá pasos ya comprometidos.
- [ ] **IT-OUT-04 — Completa limpieza pendiente al reiniciar durante logout.** Reiniciar en cada paso completará eliminación registrada; una clave retirada todavía presente no se reutilizará. No se retirará K_recovery ni una clave de sesión activa.
- [ ] **IT-OUT-05 — Comparte logout concurrente y permite repetición idempotente.** Llamadas simultáneas compartirán resultado; repetir sin sesión ni limpieza pendiente dará éxito local sin certificar un resultado remoto anterior.
- [ ] **IT-OUT-06 — Conserva mensajes, imágenes y pendientes al desvincular.** Logout no borrará mensajes del consumidor, imágenes ni pendientes; resolverá mappings disponibles antes de retirar sesión y mantendrá los restantes con su cuenta original.
- [ ] **IT-BRG-01 — Propaga llamadas y errores de callbacks por el binding real.** Expo llamará a Go mediante Kotlin/Swift y callbacks retornarán valor/error en Android e iOS reales; generación de bindings por sí sola no aprobará el caso.
- [ ] **IT-BRG-02 — Lee una revisión coherente sin confundir fallo con estado vacío.** Devolverá una revisión coherente y versionada, sesión null válida y revisiones cero para instalación vacía; una lectura fallida no se presentará como estado vacío ni conectará automáticamente.
- [ ] **IT-BRG-03 — Aplica cambios permitidos atómicamente sobre la revisión vigente.** Cambios put/delete, altas y resolución de identidad se aplicarán juntos sobre estado vigente y devolverán revisiones solo tras commit. No permitirán reemplazar todo pending, confirmar entregas o ejecutar logout desde Go.
- [ ] **IT-BRG-04 — Rechaza solicitudes internas inválidas antes de mutar.** Versión, generación no registrada, cuenta, revisión esperada, tipos, claves o tamaños inválidos se rechazarán antes de mutar. Verificar `INVALID_REQUEST`, `STALE_GENERATION` y `SESSION_REVISION_MISMATCH` según su causa.
- [ ] **IT-BRG-05 — Traduce códigos internos sin interpretar mensajes de error.** BUFFER_FULL, SESSION_FULL, STORAGE_FAILED y STATE_INVALID se traducirán al código público acordado conservando prioridad de almacenamiento, sin interpretar mensajes de excepciones.
- [ ] **IT-BRG-06 — Reconstruye desde disco tras respuesta incierta de ApplyChanges.** Err, JSON inválido o respuesta incoherente después de aplicar detendrá la operación y obligará a releer; no reenviará automáticamente la misma mutación ni repetirá descifrado sobre memoria modificada.
- [ ] **IT-BRG-07 — Compromete juntos cambios de descifrado y contenido recuperable.** Lecturas verán cambios preparados propios; todas las escrituras participantes y contenido recuperable se comprometerán juntos. Fallar descartará preparación; escrituras críticas externas también esperarán persistencia durable.
- [ ] **IT-BRG-08 — Permite confirmar durante descifrado sin resucitar pendientes.** Cambiar revision por confirmar no invalidará por sí solo expectedSessionRevision, ni permitirá reaparecer el pendiente. Un cambio concurrente real de sesión sí rechazará la operación y reconstruirá desde estado confirmado.
- [ ] **IT-BRG-09 — Rechaza callbacks de generaciones retiradas.** Detener mientras espera persistencia rechazará callbacks tardíos y cambios posteriores al logout; no quedarán escrituras autorizadas solo por un generationId enviado por Go.
- [ ] **IT-BRG-10 — Permite confirmar y detener sin deadlocks entre callbacks y writer.** Writer no entrará en Go/JavaScript bajo su bloqueo; locks de transacción y writer se liberarán antes de esperar consumidor. Confirmar y detener seguirán posibles durante recepción, historial o descarga bloqueados.
- [ ] **IT-PRO-01 — Copia metadatos e hijos y reconstruye replay sin punteros prestados.** Hook previo copiará metadatos y todos los hijos/ciphertexts con sus formatos, sin punteros prestados. Reconstrucción v2/v3 y replay histórico conservarán chat, emisor, dirección y referencia correcta.
- [ ] **IT-PRO-02 — Impide ACK y reintentos de protocolo ante fallos locales.** Lecturas/escrituras/transacciones/capacidad marcadas como fallo local detendrán ACK, reintento y UndecryptableMessage, incluso con errores compuestos; probar ACK síncrono y asíncrono observando los intentos de emisión en el transporte controlado.
- [ ] **IT-PRO-03 — Conserva el tratamiento de errores genuinos del protocolo.** Una ausencia válida o error de protocolo no se etiquetará como disco; conservará la ruta de tratamiento prevista, sirviendo de control frente al caso local.
- [ ] **IT-PRO-04 — Conserva contenido y bloquea ACK ante panic o fallo de limpieza.** Panic recuperable de recepción/consumidor o fallo de limpiar EventBuffer no confirmará ni perderá contenido; diagnósticos no expondrán el valor sensible del panic.
- [ ] **IT-PRO-05 — Notifica fin de recepción una sola vez sin bloquear el callback.** MessageReceiveFinished ocurrirá una vez en éxito, fallo del hook y panic cubierto; callback será breve y liberará solo admisión adquirida. Error nulo no probará commit del consumidor ni ACK enviado.
- [ ] **IT-PRO-06 — Propaga fallos de todas las escrituras auxiliares auditadas.** Inyectar fallos en PN/LID, secretos, prekeys, identidad, grupos y sincronización auditados, incluyendo rutas previas al hook y v3; todos los cambios críticos propagarán fallo y no usarán stores que simulen persistencia.
- [ ] **IT-PRO-07 — Completa procesamiento recuperable antes de emitir tras caída.** Antes de emitir tras caída se completará procesamiento recuperable de secretos/protocolo que corresponda, sin volver a descifrar sobre estado avanzado ni usar sesión de otra cuenta.
- [ ] **IT-IMG-01 — Descarga usando una referencia persistida antes de reiniciar.** Conservar el descriptor en el consumidor de prueba, reiniciar y descargar con cuenta de origen conectada; no depender de un historial nativo de mensajes ya confirmados.
- [ ] **IT-IMG-02 — Rechaza descriptores mal formados o incoherentes.** Rechazar prefijo/versión desconocidos, campos ajenos, cadena mayor de 16 KiB, Base64 inválido, IDs incoherentes y claves/hashes presentes que no decodifiquen a 32 bytes. fileLength respetará uint64 decimal sin pérdida de precisión.
- [ ] **IT-IMG-03 — Rechaza rutas y hosts arbitrarios en referencias.** DirectPath válido será relativo de media con `/`, sin esquema, autoridad ni fragmento. Entradas de filesystem o URL arbitraria no se utilizarán para leer/escribir ni elegir hosts ajenos al cliente.
- [ ] **IT-IMG-04 — Devuelve IMAGE_UNAVAILABLE para referencias incompletas o recursos expirados.** Descriptor válido sin datos necesarios o recurso remoto no disponible devolverá `IMAGE_UNAVAILABLE`, conservando el mensaje. No solicitará automáticamente reenvío de media al teléfono.
- [ ] **IT-IMG-05 — Exige la cuenta de origen conectada para una descarga nueva.** Sin archivo completo reutilizable, descargar exigirá cuenta conectada coincidente; en otro caso devolverá `ACCOUNT_NOT_CONNECTED`, sin conectar automáticamente ni usar otras credenciales.
- [ ] **IT-IMG-06 — Devuelve URI únicamente después de verificar y publicar la imagen.** Descargar/descifrar a temporal privado, verificar integridad, determinar MIME, cerrar y publicar precederá devolver URI, MIME y tamaño reales; la imagen no se añadirá a galería ni requerirá permiso para ella.
- [ ] **IT-IMG-07 — Rechaza imágenes sin integridad o MIME válido.** Hashes incoherentes, archivo completo inválido o MIME indeterminable no se devolverán como éxito. Un completo inválido dará `IMAGE_UNAVAILABLE` y permitirá borrado explícito antes de reintentar.
- [ ] **IT-IMG-08 — Reutiliza archivos completos válidos sin sesión conectada.** Archivo completo válido se reutilizará sin red incluso tras disconnect/logout o con otra cuenta activa; su descriptor seguirá validándose.
- [ ] **IT-IMG-09 — Limita bytes reales y reservas en todas las operaciones de archivo.** Archivos completos y reservas contarán globalmente; tamaño desconocido/falso, WriteAt, Truncate y preasignaciones no superarán límites ni ocultarán el máximo temporal cifrado. Probar frontera exacta y un byte por encima con `STORAGE_LIMIT_REACHED`.
- [ ] **IT-IMG-10 — Aplica el plazo total de descarga sin reintento automático del wrapper.** Red y cambios de host internos compartirán 60 segundos excluyendo espera en cola; timeout cancelará y devolverá `IMAGE_DOWNLOAD_FAILED`. El wrapper no iniciará otro intento sin nueva llamada explícita.
- [ ] **IT-IMG-11 — Limpia parciales y conserva su consumo si falla el borrado.** Una descarga fallida retirará parcial; si la limpieza falla, seguirá contando el espacio realmente ocupado y se informará el fallo. Reiniciar repetirá limpieza de incompletos conservando completos.
- [ ] **IT-IMG-12 — Borra idempotentemente sin confundir error con ausencia.** Borrar archivo ausente dará éxito; error de permisos/lectura no equivaldrá a ausencia y devolverá `IMAGE_DELETE_FAILED`, sin declarar espacio liberado.
- [ ] **IT-IMG-13 — Serializa descargas y evita copias duplicadas del mismo adjunto.** Descargas y borrados se ejecutarán uno por uno en admisión; dos solicitudes del mismo adjunto reutilizarán el primer éxito o harán un nuevo intento explícito si falló.
- [ ] **IT-IMG-14 — Respeta orden de admisión entre descarga y borrado.** Borrar después esperará descarga; borrar antes permitirá descargar de nuevo después. La URI no reservará el archivo ante un borrado posterior solicitado por el consumidor.
- [ ] **IT-IMG-15 — Ordena cancelación y publicación sin publicar resultados retirados.** Disconnect, logout o retirada de generación cancelarán red activa sin esperar la cola. Si publicación ganó la carrera, conservar completo; si ganó la parada, impedir publicación tardía y limpiar parcial.
- [ ] **IT-IMG-16 — Impide red de solicitudes encoladas con generación retirada.** Podrán reutilizar completos válidos, pero no iniciar red con generación retirada; devolverán `ACCOUNT_NOT_CONNECTED` y requerirán una llamada nueva, incluso si otra generación se conectó entretanto.
- [ ] **IT-IMG-17 — Permite persistencia y confirmación independientes durante descarga.** Durante descarga, sesión y confirmaciones seguirán progresando; confirmar mensajes/logout no borrarán imágenes. Los archivos persistentes sobrevivirán al cierre y sus nombres derivados no permitirán atravesar rutas.
- [ ] **IT-AND-01 — Declara permisos y servicio correctos en el manifest combinado.** Comprobar INTERNET, FOREGROUND_SERVICE y permiso remoto correspondiente, servicio no exportado, stopWithTask false, mismo proceso y tipo remoteMessaging; no declarar tipos alternativos para ocultar un rechazo.
- [ ] **IT-AND-02 — Promueve el servicio antes de inicializar Go o almacenamiento.** Desde contexto permitido publicar notificación y promover antes de inicializar Go/leer almacenamiento, fuera del trabajo pesado del hilo principal; APIs anteriores a 34 no recibirán una constante inexistente.
- [ ] **IT-AND-03 — Publica notificación genérica con canal e intención correctos.** Canal estable de importancia baja, ID reservado y apertura explícita/inmutable; no contendrá QR, cuentas, credenciales o mensajes ni acciones nuevas de descarga/logout.
- [ ] **IT-AND-04 — Permite inicio con notificaciones denegadas sin solicitar permisos.** Con permiso concedido o denegado mantener publicación requerida y no interpretar denegación como pérdida de sesión; connect no abrirá diálogo de permisos.
- [ ] **IT-AND-05 — Detiene un inicio rechazado sin bucles ni pérdida de sesión.** Rechazo antes de aceptación devolverá Result fallido; rechazo posterior emitirá error y disconnected. Retirar intención, preservar datos y no entrar en bucle; fallo al guardar retirada tendrá prioridad de almacenamiento.
- [ ] **IT-AND-06 — Mantiene el cliente al minimizar o retirar pantallas.** Navegar, cerrar pantalla o retirarla de recientes no desconectará voluntariamente ni creará otro cliente. Servicio activo no equivaldrá a connected ni a persistencia del consumidor.
- [ ] **IT-AND-07 — Restaura una única generación con intención válida mediante START_STICKY.** Tras muerte del proceso restaurar opciones e intención válidas, verificar cuenta y crear una generación única sin JavaScript. Sin intención válida retirar notificación y detener; no prometer plazo de recreación.
- [ ] **IT-AND-08 — Evita QR y restauraciones antiguas sin sesión utilizable.** Sesión ausente, revocada, inválida o cuenta incoherente no iniciará QR de fondo ni restaurará una revisión antigua; conservar tratamiento de errores y vinculación explícita.
- [ ] **IT-AND-09 — Desactiva intención durablemente antes de éxito de la parada.** Disconnect/logout desactivarán receiveRequested antes de éxito; carreras con recreación no resucitarán una intención retirada. Si guardar falla, detener ejecución y comunicar incertidumbre sin afirmar persistencia.
- [ ] **IT-AND-10 — Respeta reinicio y detención del usuario sin arranque compensatorio.** Reiniciar teléfono no iniciará receptor por BOOT_COMPLETED; force-stop o parada desde Android no provocarán alarmas/tareas compensatorias ni dependerán de onDestroy para guardar contenido.
- [ ] **IT-AND-11 — Comprueba recepción bajo las condiciones de energía acordadas.** Inyectar recepción mediante transporte controlado con pantalla apagada y ajustes de batería acordados; observar por separado Doze, pérdida simulada de red y proceso terminado, sin atribuir al servicio garantías de latencia que el contrato excluye.
- [ ] **IT-AND-12 — Conserva pendientes sin iniciar ni suplantar al consumidor Expo.** Recreación nativa no confirmará pendientes ni arrancará por sí sola consumidor Expo; mantendrá pausa/recuperación. Al volver JavaScript se aplicarán sustitución de consumidor y estado inicial de listeners.
- [ ] **IT-IOS-01 — Recupera estado al volver de suspensión sin prometer recepción suspendida.** Comprobar conservación de estado/pending, acceso tras primer desbloqueo y recuperación al volver a ejecutar. Registrar la falta de garantía de recepción suspendida; este caso no aprobará una solución iOS todavía indefinida.
- [ ] **IT-BLD-01 — Usa versiones fijadas sin actualizaciones implícitas de herramientas.** Verificar Go efectivo, gomobile/gobind de la misma revisión y dependencia/lockfiles del módulo; no descargar toolchain implícito, usar herramientas globales @latest ni actualizar dependencias durante build.
- [ ] **IT-BLD-02 — Valida prerrequisitos y falla sin omitir destinos solicitados.** Android no requerirá Xcode; ios requerirá macOS/Xcode completo. Herramientas ausentes harán fallar el destino y all no omitirá plataformas ni instalará SDKs automáticamente.
- [ ] **IT-BLD-03 — Aplica patches solo a la revisión esperada y fuera del caché.** Aplicar patches a copia de la revisión esperada sin alterar caché Go; fallo de patch detendrá build sin sustituir silenciosamente por upstream o rama móvil.
- [ ] **IT-BLD-04 — Publica artefactos completos y detiene consumo ante generación fallida.** Generar en temporal y publicar completo antes de consumo nativo; ausencia o fallo detendrá Gradle/CocoaPods/flujo CI sin stub ni uso de un binario anterior como si fuera nuevo.
- [ ] **IT-BLD-05 — Genera y carga únicamente arquitecturas, prefijos y mínimos acordados.** Verificar arm64/amd64 Android y dispositivo/simuladores iOS acordados, filtros ABI, mínimos explícitos y prefijos Java/Objective-C; cargar cada destino contemplado sin targets extra supuestos.
- [ ] **IT-BLD-06 — Integra el módulo local con los lockfiles de la app.** Módulo público/nativo WhatsApp registrado, AAR local y XCFramework vendorizado cargarán con Expo Modules; la app utilizará sus lockfiles existentes, sin otra instalación React Native dentro del módulo.
- [ ] **IT-BLD-07 — Exige regenerar y reconstruir después de un cambio nativo.** Modificar Go, patches o bindings exigirá regenerar binarios y reconstruir app; una actualización solo JavaScript no acreditará ese cambio. El dispositivo no requerirá instalar Go ni Node.
- [ ] **IT-BLD-08 — Relaciona artefactos con fuentes y herramientas efectivas.** Registrar revisión de fuentes, herramientas efectivas y comandos exitosos; artefactos/herramientas generados permanecerán excluidos de Git. Compilar bindings no demostrará recepción, recuperación ni igualdad byte a byte de binarios.
- [ ] **IT-SEG-01 — Elimina secretos y contenido sensible de todos los diagnósticos.** Provocar cada familia de errores, incluidos panic y fallos de binding, y comprobar ausencia de claves, QR, mensajes y descriptores sensibles en logs, errores públicos y notificaciones. Los consumidores decidirán por code, no por message.
- [ ] **IT-SEG-02 — Mantiene credenciales y recepción exclusivamente en el móvil.** Comprobar que sesión, descifrado y recepción permanecen en el móvil, sin copiar credenciales a core ni usar un receptor servidor. El consumidor de prueba no añadirá otra cola de subida nativa.
- [ ] **IT-SEG-03 — Mide coste de snapshots con carga representativa.** Medir latencia, memoria y espacio transitorio con sesión/buffer representativos y cerca de sus límites, incluyendo confirmaciones repetidas; reportar mediciones sin inventar un umbral de rendimiento aún no acordado.

Los tests dependientes de codecs, cota confiable de lectura, registros seguros de creación, umbrales del parser, operaciones durables o matriz final de herramientas requieren concretar esos detalles antes de implementarse. Las mediciones sin umbral acordado documentarán su resultado y no se presentarán como un criterio de rendimiento aprobado.


## Fuentes técnicas

- [Expo Modules API](https://docs.expo.dev/modules/overview/).
- [Variables de entorno en Expo](https://docs.expo.dev/guides/environment-variables/).
- [gomobile: compilación y artefactos](https://pkg.go.dev/golang.org/x/mobile/cmd/gomobile).
- [gobind: restricciones de tipos](https://pkg.go.dev/golang.org/x/mobile/cmd/gobind).
- [Stores de whatsmeow](https://pkg.go.dev/go.mau.fi/whatsmeow/store).
- [Adaptación de sesiones Signal](https://github.com/tulir/whatsmeow/blob/9399289b022b/store/signal.go).
- [Guardado de sesiones en caché](https://github.com/tulir/whatsmeow/blob/9399289b022b/store/sessioncache.go).
- [Interfaces de EventBuffer](https://github.com/tulir/whatsmeow/blob/9399289b022b/store/store.go).
- [Transacción de descifrado y entrega de eventos](https://github.com/tulir/whatsmeow/blob/9399289b022b/message.go).
- [Ruta de envío](https://github.com/tulir/whatsmeow/blob/9399289b022b/send.go).
- [Cifrado y descifrado Signal](https://github.com/tulir/libsignal-protocol-go/blob/master/session/SessionCipher.go).
- [SecureStore: protección por plataforma y límites](https://docs.expo.dev/versions/latest/sdk/securestore/).
