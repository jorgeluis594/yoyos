# Librería WhatsApp para Expo con Go y whatsmeow

## Alcance y ubicación

Crearemos el módulo local `apps/mobile/modules/whatsapp/`, siguiendo la organización de `brother-printer`. Su nombre público y nativo será `WhatsApp`; [whatsmeow](https://github.com/tulir/whatsmeow) será una dependencia interna del wrapper Go.

La primera versión soportará Android e iOS, vinculación exclusivamente por QR y recepción de texto e imágenes en chats individuales. Incluirá mensajes `incoming` y mensajes `outgoing` enviados desde otros dispositivos de la cuenta vinculada. No expondrá envío de mensajes ni recepción de grupos, videos, audios, documentos o stickers.

Habrá una sola cuenta activa por instalación y un único cliente nativo. Se podrán conservar entregas pendientes de cuentas anteriormente desvinculadas, pero no mantener conexiones simultáneas a varias cuentas.

Este documento define el diseño; la integración nativa todavía requiere implementación y validación en dispositivos.

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

Como excepción aprobada, el almacenamiento nativo conservará un buffer cifrado temporal del contenido recibido hasta que Expo confirme su commit en SQLite. Go participará mediante el adaptador de protocolo, pero las escrituras serán nativas. Este buffer sí duplica temporalmente contenido de mensajes; no será otra cola de subida a core ni un historial de conversaciones.

Los secretos y registros de protocolo requeridos internamente por whatsmeow forman parte de su estado de sesión; no reemplazan el almacenamiento de mensajes de Expo.

## Carpetas propuestas

```text
apps/mobile/modules/whatsapp/
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
  | "SESSION_STATE_INVALID"
  | "RECOVERY_BUFFER_FULL"
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
  timestamp: number; // Unix en milisegundos
  text?: string;     // Texto o caption de la imagen
  image?: {
    mimeType: string;
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

`accountId` identificará la cuenta lógica de WhatsApp, no el dispositivo vinculado ni la cuenta que esté activa al reemitir un pendiente. Su normalización deberá mantener identidad estable ante cambios de identificadores del protocolo. Expo utilizará este dato para asociar la entrega a su contexto de negocio; no deducirá la cuenta de una variable global del cliente activo.

La referencia de imagen debe contener los datos que whatsmeow necesita para descargar y descifrar el adjunto. Expo la guardará junto con el mensaje en su almacenamiento cifrado; no la interpretará ni registrará en logs. Su formato exacto se definirá al implementar el adaptador. El wrapper validará ese descriptor al recibirlo y no aceptará rutas de archivos arbitrarias.

Esto ajusta la propuesta inicial `downloadImage(messageId)`: un identificador por sí solo no permite recuperar el adjunto después de reiniciar si Go no persiste los mensajes ni sus referencias.

No habrá `getPendingMessages()` ni `acknowledgeMessages()` para la sincronización con core en la librería. Estas operaciones corresponden a la cola de Expo. `confirmMessageStored(deliveryId)` tendrá otro significado: confirmar que el mensaje ya está comprometido en SQLite local, para retirar su contenido del buffer nativo. No confirmará una subida a core ni eliminará imágenes.

`deliveryId` será un identificador opaco del registro de recuperación, asociado a su cuenta y revisión. La confirmación será idempotente y no podrá confirmar accidentalmente un registro de otra cuenta. Expo registrará su listener antes de iniciar la recuperación de entregas y confirmará únicamente después del commit local.

La fachada seguirá el patrón de `brother-printer`: validará respuestas nativas con Zod y devolverá `Result` utilizando `ok`/`err` de `@shared/functional`. No implementaremos otro formato de resultados ni una jerarquía de clases de error.

Los fallos esperados de métodos devolverán `success: false`; las excepciones del puente nativo se capturarán y convertirán en errores explícitos. El evento `error` cubrirá fallos fuera de una llamada concreta. Los callbacks de Go transportarán contratos propios serializados como JSON; las imágenes no cruzarán hacia JavaScript como bytes o base64.

## Errores y recuperación

Expo tomará decisiones por `code`, sin interpretar el texto de `message`. Los mensajes serán diagnósticos saneados, sin claves, QR, contenido de conversaciones ni referencias sensibles de imágenes. La app será responsable del texto traducido que muestre al usuario.

| Código | Comportamiento esperado |
| --- | --- |
| `MODULE_UNAVAILABLE` | Build sin el módulo o plataforma no soportada. Informar la indisponibilidad; no reintentar en bucle. |
| `NOT_INITIALIZED` | Inicializar antes de ejecutar operaciones que requieran el cliente. |
| `INVALID_INPUT` | Corregir opciones, identificadores o referencias inválidas; no repetir la misma entrada. |
| `INVALID_NATIVE_RESPONSE` / `NATIVE_CALL_FAILED` | El resultado no se puede verificar. Conservar datos y tratarlo como incierto; no afirmar éxito ni borrar sesión. |
| `CONNECTION_FAILED` | La reconexión automática tratará fallos transitorios de red mientras el cliente esté activo. |
| `SESSION_EXPIRED` | Detener reintentos de autenticación y solicitar nueva vinculación por QR. |
| `SESSION_STORAGE_FAILED` / `SESSION_STATE_INVALID` | Detener el procesamiento; conservar los archivos y evitar una restauración o eliminación silenciosa. Resolver almacenamiento, clave o formato antes de reanudar. |
| `RECOVERY_BUFFER_FULL` | Pausar recepción y permitir que Expo confirme entregas guardadas; reanudar al liberar capacidad suficiente. |
| `STORAGE_LIMIT_REACHED` | No descargar más imágenes hasta liberar espacio o ajustar su presupuesto. |
| `IMAGE_UNAVAILABLE` | El adjunto ya no está disponible o no puede recuperarse; mantener el mensaje y registrar la condición. |
| `IMAGE_DOWNLOAD_FAILED` | Limpiar el archivo parcial; reintentar explícitamente cuando se resuelva el fallo transitorio. |
| `IMAGE_DELETE_FAILED` | El archivo seguirá contando contra el límite; reintentar el borrado sin afirmar que se liberó espacio. |
| `REMOTE_LOGOUT_UNCONFIRMED` | La sesión local puede estar eliminada sin confirmación de desvinculación remota. Informar esa incertidumbre; no restaurar credenciales eliminadas. |

Un fallo de escritura de sesión o recuperación tendrá prioridad sobre el reintento de conexión: reconectar automáticamente no corregirá un estado que no pudo guardarse. Un callback inválido no confirmará una entrega. La repetición de confirmaciones y borrados idempotentes permitirá resolver respuestas perdidas sin duplicar operaciones de negocio.

Para los éxitos sin datos, la fachada devolverá `ok(undefined)`. El consumidor comprobará `result.success` antes de usar `result.data` o considerar terminada una operación. La suscripción a eventos conservará el contrato estándar con `remove()`.

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

## Una cuenta activa y cambio de cuenta

- El módulo `WhatsApp` administrará un solo cliente. No habrá una fábrica ni un mapa público de clientes.
- Llamadas repetidas o concurrentes a `initialize()` no crearán otro cliente ni borrarán datos. La configuración se fijará al preparar ese cliente; los cambios de opciones no reiniciarán una sesión silenciosamente.
- `disconnect()` no permitirá vincular otra cuenta: conserva las credenciales de la cuenta actual.
- Para cambiar de cuenta, primero se ejecutará `logout()` y después `connect()` para vincular mediante un nuevo QR. Si el borrado local de credenciales falla, no se iniciará otra vinculación encima del estado existente.
- Los pendientes anteriores conservarán `accountId`, `id` y `deliveryId` de origen. Sus confirmaciones y borrados de imágenes seguirán siendo válidos aunque haya otra cuenta activa.
- Los registros de recuperación, marcas procesadas y nombres de archivos de imágenes tendrán separación por cuenta. Los límites de 10 MiB de recuperación y 50 MiB de imágenes aplicarán al total conservado por instalación, no se multiplicarán al cambiar de cuenta.

El almacenamiento nativo conservará una única sesión activa y registros de recuperación asociados a sus cuentas. Mantendrá el commit atómico entre sesión y recuperación descrito abajo; no separará esas escrituras en archivos independientes sin un mecanismo que preserve esa atomicidad.

## Conexión y ciclo de vida

- `initialize()` preparará el almacenamiento, restaurará el estado confirmado y creará el cliente. Con el listener registrado previamente, recuperará también entregas locales sin confirmar; no dependerán de una nueva conexión a WhatsApp. No conectará automáticamente.
- `connect()` conectará con la sesión restaurada o emitirá QR si no existe una vinculación. Emitirá cada QR nuevo con su vencimiento; la app lo mostrará.
- Tras una pérdida de red habrá reconexión automática con esperas crecientes, un máximo y un solo intento activo.
- `disconnect()` cerrará la conexión, detendrá los reintentos y conservará la sesión. Una nueva llamada a `connect()` reanudará la conexión.
- Una sesión revocada cambiará el estado a `sessionExpired`, detendrá los reintentos de autenticación y requerirá otra vinculación.
- `logout()` detendrá conexión y reintentos, solicitará la desvinculación y eliminará el estado local de sesión y su clave. Conservará los mensajes de Expo, los archivos descargados y las entregas locales todavía sin confirmar. Estas últimas conservarán la cuenta original y podrán recuperarse sin restaurar las credenciales eliminadas. Si no se puede confirmar la desvinculación remota, la API deberá informarlo; no afirmará que WhatsApp la confirmó.

La reconexión aplica mientras el proceso pueda ejecutarse. No garantiza mantener la conexión cuando Android o iOS suspenden o terminan la app. Al reiniciar se restaurará la sesión; la recuperación de mensajes durante interrupciones requiere pruebas propias.

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

Los archivos de sesión estarán en directorios privados, excluidos de backups y transferencia a otro dispositivo. No se utilizará caché para guardar la sesión. Se definirá la disponibilidad de la clave con el teléfono bloqueado de acuerdo con el comportamiento de ejecución que realmente validemos.

### Riesgo validado y límites

Una copia guardada después de procesar mensajes puede quedar desactualizada si la app termina antes de escribirla. Esto no implica necesariamente perder la vinculación por QR, pero puede perder estado criptográfico y provocar fallos de descifrado.

En el código revisado, Signal llama a `StoreSession` antes de retornar de cifrado/descifrado, y la ruta de envío de whatsmeow exige `PutCachedSessions` antes de continuar. El adaptador debe respetar esas expectativas de persistencia. Falta auditar todas las escrituras y su manejo de errores en la versión que fijemos, especialmente cambios de prekeys, identidad y operaciones que afectan varios registros.

El objetivo es recuperar el último estado confirmado ante una caída del proceso. Ningún diseño puede conservar una sesión si WhatsApp la revoca, se eliminan los datos de la app o se pierde su clave. Este contrato requiere pruebas; todavía no constituye una garantía implementada.

## Entrega durable de mensajes a Expo

La recepción deberá sobrevivir a una caída entre actualizar el estado criptográfico y guardar el mensaje en SQLite de Expo. No basta con guardar la sesión ni con retrasar el ACK a WhatsApp.

Usaremos `EnableDecryptedEventBuffer`, `SynchronousAck` y un manejador con resultado de éxito como base del adaptador. El contrato será:

```text
1. Descifrar dentro de una transacción del almacenamiento nativo
2. Commit atómico: cambios de sesión + contenido y metadatos recuperables
3. Emitir messageReceived(deliveryId, message)
4. Expo guarda o reconoce el duplicado mediante una transacción SQLite
5. Expo llama a confirmMessageStored(deliveryId)
6. Commit nativo: retirar el contenido pendiente y conservar la marca procesada
7. El manejador termina con éxito y se permite confirmar al protocolo
```

La transacción de descifrado deberá incluir todas las escrituras criptográficas involucradas, no solo `PutSession`. Si no se completa, se descartará el estado en memoria de esa operación y no se emitirá una entrega exitosa. Ante error de persistencia o falta de confirmación de Expo, no se avanzará como si el mensaje estuviera guardado.

La limpieza automática de `EventBuffer` no podrá retirar contenido antes del paso 5 ni invalidar la recuperación definida por el wrapper. La llamada pública coordinará la confirmación con el manejador de whatsmeow; no hará escrituras concurrentes independientes fuera del orden de commits.

### Recuperación y duplicados

- Caída antes del commit del paso 2: no se confirma al protocolo y el estado no confirmado se descarta. La recuperación desde el servidor dependerá de sus reglas de reentrega; no se promete retención remota indefinida.
- Caída después del paso 2 y antes del paso 5: el módulo reemitirá la entrega local pendiente al iniciar, sin depender de descifrar otra vez el mismo paquete.
- Caída después del commit de Expo y antes del paso 6: Expo reconocerá el mensaje duplicado por cuenta y `id`, y repetirá la confirmación local.
- Caída después del paso 6 y antes del ACK: una reentrega remota se reconocerá por su marca procesada; no generará otro mensaje de negocio.

Este flujo ofrece entrega al menos una vez a Expo y requiere inserción idempotente en su SQLite. No se prometerá entrega exactamente una vez entre los procesos y almacenamientos.

### Contenido del buffer y punto pendiente de integración

El buffer contendrá el contenido necesario para reconstruir `ReceivedMessage`, su referencia de imagen, cuenta de origen, identificador de entrega y metadatos del protocolo. No contendrá bytes de imágenes descargadas. Las referencias y el contenido estarán cifrados y no aparecerán en logs.

La interfaz nativa actual de whatsmeow `BufferedEvent` contiene plaintext y timestamps, pero no todos los metadatos del chat ni una operación pública para enumerar entregas pendientes. Activar el flag por sí solo no implementa el flujo anterior.

El adaptador necesitará captura de metadatos antes del commit criptográfico y enumeración local de registros pendientes. Hay que validar cómo obtenerlo en la versión fijada. Si las interfaces públicas no permiten capturar el contexto completo a tiempo, se necesitará un hook mínimo en la integración de whatsmeow; capturarlo únicamente en el evento posterior dejaría abierta la misma ventana de caída. Este punto sigue pendiente de una prueba técnica y puede requerir un cambio en la dependencia.

El buffer tendrá un presupuesto de 10 MiB por defecto. Yoyos lo configurará mediante `EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB` y lo pasará como `maxRecoveryBufferBytes`, separado de los 50 MiB de imágenes. Contará contenido y metadatos serializados de entregas pendientes, su sobrecarga de cifrado y las reservas de operaciones en curso. El estado criptográfico de sesión tendrá un presupuesto independiente; este límite no representa el espacio total de la librería ni el de las copias transitorias necesarias para un reemplazo atómico.

Al agotarlo, se detendrá la recepción antes de comprometer nuevos mensajes y se emitirá `RECOVERY_BUFFER_FULL`, preservando todos los pendientes. Cuando Expo confirme entregas y libere capacidad suficiente, se reanudará la recepción, salvo que se haya llamado a `disconnect()` o `logout()` o haya expirado la sesión. La ruta de `confirmMessageStored()` seguirá disponible mientras la recepción esté detenida.

Si una sola entrega supera el presupuesto, se informará explícitamente; liberar otras entregas no resolverá ese caso y no se entrará en un bucle de reintentos. Un presupuesto insuficiente no se compensará descartando contenido. Los límites se validarán al inicializar; reducirlos por debajo de lo ya ocupado no eliminará registros existentes.

Si no hay consumidor, también se detendrá la recepción. No se descartarán registros sin confirmar por antigüedad ni se confirmarán para liberar espacio. Su limpieza y la retención acotada de marcas procesadas deberán respetar la recuperación y los reintentos del protocolo.

La recuperación local incluye registros de cuentas desvinculadas; esos registros nunca se mezclarán con una nueva vinculación ni utilizarán sus credenciales para confirmar al servidor.

## Imágenes privadas de corta duración

La descarga será explícita. `downloadImage(reference)` descargará y descifrará la imagen, la guardará en un directorio privado y devolverá su URI, MIME y tamaño. No se añadirá a la galería ni se solicitará acceso a ella para esta operación.

```text
Expo solicita descargar
    → Go descarga a archivo privado
    → Expo sube el archivo por HTTP
    → servidor confirma
    → Expo solicita deleteDownloadedImage(messageId)
```

Usaremos un directorio privado persistente para archivos pendientes de subida, excluido de backups. Su vida será temporal por política de eliminación, pero no será caché que el sistema pueda limpiar antes de terminar una subida. Expo conservará la URI y el estado de entrega en su cola existente.

El límite será 50 MiB por defecto, configurable mediante `maxImageStorageBytes`. Contará archivos completos y reservas de descargas en curso. Si no se conoce el tamaño de antemano, se limitarán los bytes realmente escritos. Al agotarse el presupuesto, la operación fallará con `STORAGE_LIMIT_REACHED`; el mensaje permanecerá en Expo para reintentar.

Una descarga fallida eliminará su archivo incompleto y liberará su reserva. Al iniciar se identificarán y eliminarán temporales incompletos; los archivos completos pendientes seguirán contando contra el límite. El borrado será idempotente. Confirmar un mensaje en la cola de Expo y eliminar su imagen serán operaciones independientes; no se eliminarán archivos pendientes solamente por desvincular la cuenta.

Antes de descargar otra vez el mismo adjunto, se reutilizará un archivo completo existente si es válido. No se garantizará la descarga indefinida desde WhatsApp: el recurso remoto puede dejar de estar disponible.

## Compilación e integración

[gomobile](https://pkg.go.dev/golang.org/x/mobile/cmd/gomobile) generará un AAR para Android y un XCFramework para iOS, incluyendo dispositivo y simulador. Sus bindings son Java y Objective-C, consumidos desde Kotlin y Swift; no generan por sí solos un módulo Expo.

| Plataforma | Herramientas de compilación |
| --- | --- |
| Compartido | Go, gomobile, gobind y dependencias de whatsmeow con versiones fijadas. |
| Android | JDK, Android SDK/NDK y Gradle para integrar el AAR. |
| iOS | macOS, Xcode y CocoaPods para integrar el XCFramework. |

El script `build-go.sh` producirá los artefactos antes del build nativo de mobile. El entorno que compile Go necesitará las herramientas anteriores; el teléfono no necesitará instalar Go ni Node.js. Cualquier cambio de código nativo requerirá reconstruir la app. No funcionará en Expo Go ni se plantea soporte web en esta versión.

Usaremos Expo Modules para métodos asíncronos y eventos. Las operaciones de red y disco se ejecutarán fuera del hilo de interfaz. La recepción enviará datos pequeños; los lotes de mensajes pendientes y las subidas serán responsabilidad de Expo.

## Validación antes de implementar el flujo completo

1. Compilar un wrapper mínimo en Android e iOS y llamarlo desde Expo.
   Comprobar la lectura de `EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB`, su default, el rechazo de valores inválidos y el paso del límite a ambas plataformas.
2. Implementar el store personalizado: definir qué interfaces exige la versión fijada, el formato cifrado, transacciones, callbacks nativos y propagación de errores. Evitar deadlocks entre llamadas y callbacks.
3. Vincular por QR, reiniciar la app y reconectar con el estado persistido.
4. Forzar cierres antes, durante y después de una escritura; validar recuperación, falta de espacio, revisión antigua, archivo dañado y clave ausente.
5. Recibir texto e imágenes `incoming` y `outgoing`; comprobar que se excluyen grupos y que Expo es el único almacenamiento definitivo y cola de subida.
6. Reiniciar antes de descargar una imagen y descargarla usando la referencia guardada en Expo. Validar descarga concurrente, límite de espacio, subida, reintento y borrado.
7. Interrumpir cada paso del flujo de entrega y verificar replay local, deduplicación, marcas procesadas y confirmación al protocolo. Validar que sesión y contenido recuperable se comprometen juntos.
8. Probar pérdida de red, suspensión, consumidor ausente, buffer lleno, entrega mayor al presupuesto, sesión revocada y desvinculación con entregas pendientes en dispositivos reales. Comprobar que una confirmación puede ejecutarse mientras el manejador está esperando, sin bloquear su propia cola nativa, y que liberar espacio reanuda la recepción sin contradecir una desconexión explícita.
9. Inicializar concurrentemente y cambiar de cuenta con pendientes. Comprobar que solo existe un cliente activo, que los registros conservan su cuenta original y que los límites siguen siendo globales por instalación.

whatsmeow es una implementación no oficial. La compatibilidad del protocolo, los bindings nativos y el ciclo de vida móvil deben comprobarse con la versión fijada y no asumirse por la compilación solamente.

## Fuentes técnicas

- [Expo Modules API](https://docs.expo.dev/modules/overview/).
- [Variables de entorno en Expo](https://docs.expo.dev/guides/environment-variables/).
- [gomobile: compilación y artefactos](https://pkg.go.dev/golang.org/x/mobile/cmd/gomobile).
- [gobind: restricciones de tipos](https://pkg.go.dev/golang.org/x/mobile/cmd/gobind).
- [Stores de whatsmeow](https://pkg.go.dev/go.mau.fi/whatsmeow/store).
- [Adaptación de sesiones Signal](https://github.com/tulir/whatsmeow/blob/main/store/signal.go).
- [Guardado de sesiones en caché](https://github.com/tulir/whatsmeow/blob/main/store/sessioncache.go).
- [Interfaces de EventBuffer](https://github.com/tulir/whatsmeow/blob/main/store/store.go).
- [Transacción de descifrado y entrega de eventos](https://github.com/tulir/whatsmeow/blob/main/message.go).
- [Ruta de envío](https://github.com/tulir/whatsmeow/blob/main/send.go).
- [Cifrado y descifrado Signal](https://github.com/tulir/libsignal-protocol-go/blob/master/session/SessionCipher.go).
- [SecureStore: protección por plataforma y límites](https://docs.expo.dev/versions/latest/sdk/securestore/).
