# Tareas de implementación de WhatsApp nativo para Expo

Fuente: [Diseño de la librería Go + whatsmeow](whatsmeow-go-expo-implementation.md), revisado el 8 de octubre de 2026.

Estado: backlog pendiente. Este documento organiza la implementación; no acredita que las funcionalidades ni las pruebas estén terminadas. Los detalles normativos y los casos UT/IT mantienen como referencia el documento fuente.

## Alcance y forma de trabajar

Implementar el módulo local `apps/mobile/modules/whatsapp/` para Android e iOS: una cuenta activa, vinculación QR, recepción individual de texto e imágenes históricas y nuevas, persistencia nativa cifrada, entrega durable, descarga explícita y servicio Android. Los mensajes enviados desde otros dispositivos de la cuenta también están incluidos.

Cada tarea entrega una capacidad comprobable con sus contratos, implementación, integración y pruebas. No se separan archivos, tipos, fixtures o tests en tareas independientes. Cada incremento debe compilar y pasar sus verificaciones sin necesitar una tarea futura; puede usar un consumidor de prueba o un transporte controlado para demostrar su capacidad. Eso no equivale a declarar completo el flujo final. Ningún método pendiente devolverá un éxito simulado.

Los contratos compartidos se comprobarán en ambas plataformas. Las integraciones usarán transporte y servicios externos controlados; las pruebas de claves, filesystem y durabilidad usarán APIs nativas reales. No requieren cuenta real ni escanear QR. Sus resultados no acreditarán compatibilidad con el servicio WhatsApp real.

Quedan fuera de estas tareas las tablas y reglas del consumidor productivo, su activación JavaScript en segundo plano, la sincronización con core y una nueva cola de subida. Tampoco se incluyen envío, grupos como contenido público, otros adjuntos, modo Live, migración de mensajes previos, publicación remota del paquete ni almacenamiento temporal de lotes históricos mayores que el buffer. La recepción durante suspensión de iOS permanece sin solución definida; se valida la recuperación al reanudarse.

## Secuencia y dependencias

| Tarea | Resultado verificable | Depende de |
| --- | --- | --- |
| WA-01 | Módulo cargado y callbacks Go/nativo ejecutados | — |
| WA-02 | Estado cifrado durable y recuperable tras caídas | WA-01 |
| WA-03 | Stores de protocolo transaccionales con errores propagados | WA-02 |
| WA-04 | Mensajes e imágenes normalizados con identidad estable | WA-03 |
| WA-05 | API pública y conexión única con QR y reconexión | WA-03 |
| WA-06 | Recepción en vivo y entrega confirmable resistente a caídas | WA-04, WA-05 |
| WA-07 | Recuperación de mensajes con correspondencia PN/LID tardía | WA-06 |
| WA-08 | Historial admitido por lotes completos y con memoria acotada | WA-07 |
| WA-09 | Desvinculación segura y cambio de cuenta sin pérdida de pendientes | WA-07 |
| WA-10 | Descarga, reutilización y borrado de imágenes privadas | WA-09 |
| WA-11 | Límites configurables y persistidos sin pérdida de datos | WA-08, WA-10 |
| WA-12 | Recepción Android independiente de pantallas y recreación del servicio | WA-11 |
| WA-13 | Recuperación iOS al volver a ejecutar la aplicación | WA-11 |
| WA-14 | Evidencia integral de seguridad, recuperación y límites operativos | WA-12, WA-13 |

Las dependencias indican capacidades necesarias para cerrar una tarea, no obligan a crear commits que dejen el proyecto roto. WA-05 incluye el cierre básico de una conexión; WA-09 completa la retirada segura de credenciales y su integración pública. Las pruebas que crucen varias capacidades se completan cuando estén disponibles todas sus dependencias y antes de cerrar WA-14.

## Tareas

### WA-01 — Compilar y ejecutar el módulo local en Android e iOS

- [ ] Pendiente

**Resultado:** una app de prueba Expo carga `WhatsApp`, llama a Go y recibe valores y errores de callbacks nativos reales.

**Implementación:** crear la estructura propuesta siguiendo `brother-printer`, registro Expo, bridge Go, integración AAR/podspec y `build-go.sh` con destinos `android`, `ios`, `all`. Partir de la prueba aislada existente sin confundir generación de bindings con ejecución. Mantener whatsmeow en `internal/` y bindear solo `./bridge`.

**Aceptación y verificación:**

- Fijar las versiones candidatas del diseño: Go 1.26.5, whatsmeow `v0.0.0-20261006124319-9399289b022b` y x/mobile `v0.0.0-20260908204917-8b95e45f8d3e` para gomobile y gobind. Registrar la matriz nativa efectiva tras el primer build exitoso, mínimos explícitos y lockfiles existentes de mobile.
- Cargar Android arm64/amd64 e iOS dispositivo arm64 y simuladores arm64/amd64, con los prefijos Java/Objective-C definidos y filtros ABI coherentes.
- Validar prerrequisitos por destino. Fallar ante herramientas, patches o artefactos ausentes; `all` no omite destinos. No instalar SDKs, actualizar dependencias ni descargar toolchains implícitos.
- Aplicar patches versionados sobre una copia de la revisión esperada, fuera del caché Go. Generar en temporal, publicar artefactos completos y detener el build consumidor si falla la generación, aunque exista un binario anterior.
- Demostrar llamada Expo → Go y callback con valor/error Go → Kotlin/Swift → Go. Documentar comandos y revisión de fuentes; excluir herramientas y binarios generados de Git.

**Límite:** esta tarea no acredita sesión, recepción ni durabilidad. Los cambios nativos posteriores exigirán regenerar y reconstruir.

### WA-02 — Conservar y recuperar el estado cifrado en almacenamiento nativo

- [ ] Pendiente

**Resultado:** guardar sesión y pendientes juntos, cerrar el proceso y recuperar una revisión coherente sin exponer claves ni perder datos previamente publicados.

**Implementación:** writer único en Kotlin/Swift, formato `YOYOWA01`, `state.bin`/`state.next`, dos claves y registros seguros de creación. El contenedor cifrado incluirá `options` obligatorias en iOS y Android; `androidService` conservará solo intención y cuenta. Concretar las operaciones de sincronización, cierre, reemplazo y metadatos verificables en cada plataforma. Persistir la cota confiable de lectura junto con la revisión publicada antes de admitir snapshots; no dejar ese requisito para cuando se reduzcan límites.

**Aceptación y verificación:**

- Round-trip del contenedor, sesión, pendientes, revisiones, limpieza de claves, `options` efectivas en iOS/Android y control Android. Validar AAD exacto, AES-256-GCM, nonces nuevos, versiones, uint64 decimal, IDs, JSON/UTF-8/Base64, campos duplicados o desconocidos, longitudes y overflow antes de reservar memoria. Respetar header de 4 KiB, control de 4 KiB incluyendo `options` y fórmula máxima `S + B + 8244` del archivo.
- Usar `K_recovery` para el contenedor y `K_session` para credenciales; conservar ciphertext de sesión cuando solo cambia recuperación. Impedir alias arbitrario, confusión de claves o `sessionRevision > revision`.
- Registrar creación antes de generar claves. Recuperar cada interrupción de instalación inicial y creación provisional de sesión; distinguir instalación vacía de una establecida incompleta. Ante respuestas inciertas, releer el registro y lo publicado.
- Inyectar fallos de cifrado, escritura, sync, cierre, reemplazo, respuesta y falta de espacio. No promover `state.next`, restaurar revisiones antiguas ni interpretar fallo como ausencia. Tras reemplazo incierto, releer antes de otra mutación.
- Verificar Keystore no exportable sin autenticación por uso, Keychain `AfterFirstUnlockThisDeviceOnly`, directorios privados persistentes, exclusión de backup/transferencia y protección también de temporales. Probar antes/después del primer desbloqueo; no reemplazar claves por un fallo de acceso temporal.

**Límite:** el snapshot no ofrece protección contra restauración maliciosa de un archivo antiguo válido. El protocolo real se conecta en WA-03.

### WA-03 — Persistir todas las operaciones de protocolo mediante transacciones recuperables

- [ ] Pendiente

**Resultado:** whatsmeow solo observa éxito de almacenamiento después de un commit nativo y no confirma al transporte ante un fallo local.

**Implementación:** auditar los stores de la versión fijada y completar todos los codecs de registros v1, campos de dispositivo, prekeys, mappings y reglas de reintento. Implementar `ReadState`/`ApplyChanges`, preparación transaccional y patches necesarios, reutilizando la prueba aislada.

**Aceptación y verificación:**

- Documentar y probar round-trip de cada tipo/clave/valor del catálogo de registros, límites por registro y payload del binding, incluida expansión Base64. No sustituir escrituras desconocidas por stores que devuelvan éxito sin guardar.
- Leer una revisión coherente; aplicar únicamente puts/deletes, altas e identidad permitidos sobre estado vigente. Validar contrato, cuenta, generación registrada por nativo y revisión esperada antes de mutar; Go no reemplaza `pending`, confirma entregas ni ejecuta logout mediante callbacks genéricos.
- `DoDecryptionTxn` ve cambios preparados propios y publica juntos todos los cambios críticos y contenido recuperable. Las escrituras externas también esperan commit. El límite de sesión de 16 MiB admite la frontera y rechaza el exceso sin podar registros.
- Copiar metadatos y todos los hijos v2/v3 antes de descifrar; implementar `PreDecryptMessage`, `ErrLocalStorage` y `MessageReceiveFinished` con cierre único y breve. Auditar también PN/LID previo al hook, secretos, identidad, grupos y sincronización.
- Instrumentar intentos reales de ACK en transporte controlado: error local, error compuesto, panic recuperable o limpieza fallida no habilitan ACK, retry ni `UndecryptableMessage`. Un error genuino del protocolo mantiene su tratamiento propio.
- Traducir códigos internos sin interpretar textos. Ante respuesta incierta, descartar memoria no confirmada y releer; rechazar generaciones retiradas y revisiones obsoletas. Confirmaciones concurrentes no resucitan pendientes; no mantener locks al llamar a Go/JavaScript o esperar al consumidor.

**Límite:** se conserva estado interno de grupos requerido por el protocolo sin exponer recepción pública de grupos. La entrega completa a Expo se valida en WA-06.

### WA-04 — Normalizar mensajes e identidades estables de texto e imagen

- [ ] Pendiente

**Resultado:** fixtures históricos y vivos del mismo mensaje producen el mismo contrato público e identidad de origen.

**Implementación:** normalización compartida en Go de ambas direcciones, construcción versionada de `message.id`, `deliveryId` y descriptor opaco de imagen. Incluir fixtures y validaciones sin depender de la cuenta activa al recuperar.

**Aceptación y verificación:**

- Admitir texto íntegro e imágenes con o sin caption/MIME, citas y reenvíos con su contenido propio, temporales sin borrado programado y mensaje normal ya editado presente en historial. No filtrar por antigüedad ni fecha de vinculación.
- Excluir grupos, ediciones, eliminaciones, visualización única, reacciones y demás contenido fuera de alcance. Texto vacío sin imagen no emite; timestamp ausente o inválido (decisión del dueño, 2026-10-10) deja la fecha desconocida: el mensaje se entrega y confirma con normalidad, sin `timestamp` (nunca `0` ni la hora de recepción), sin detener la normalización ni el lote; orden de llegada y deduplicación por `message.id`. Redefine UT-MSG-07 e IT-MSG-07.
- Canonicalizar cuenta y chat como LID sin dispositivo mediante correspondencias verificadas; conservar JIDs como strings e ID de protocolo exacto. No fabricar LID desde PN o username.
- Generar `wa-message:v1:` desde la tupla JSON/Base64url definida; verificar independencia de texto, fecha, dirección, revisión y dispositivo. Generar `wa-delivery:v1:` con aleatoriedad criptográfica y comprobación de colisión; conservarlo en replay.
- Emitir referencias serializables con cuenta e identidad coherentes y metadatos incompletos permitidos. No incluir bytes de imagen, credenciales, URLs arbitrarias ni descargas automáticas.

**Límite:** esta tarea no entrega mensajes con LID todavía desconocido; WA-07 implementa su conservación y resolución.

### WA-05 — Exponer la API y administrar una conexión única con QR

- [ ] Pendiente

**Resultado:** un consumidor de prueba inicializa, solicita conexión, observa QR/estados, desconecta y reconecta sin crear clientes paralelos.

**Implementación:** fachada TypeScript con Zod y `Result`/`ok`/`err` del proyecto, controlador de capacidades y generaciones, eventos y errores públicos. Integrar las operaciones disponibles en este incremento; los métodos restantes se completan con sus tareas funcionales antes del cierre global.

**Aceptación y verificación:**

- `initialize()` no conecta ni espera confirmaciones; llamadas simultáneas comparten preparación y un fallo no se reutiliza como éxito. Separar almacenamiento disponible de sesión utilizable; sesión inválida permite las capacidades locales validadas y bloquea conexión.
- Devolver `MODULE_UNAVAILABLE`, `NOT_INITIALIZED`, `INVALID_INPUT`, `INVALID_NATIVE_RESPONSE` o `NATIVE_CALL_FAILED` según el contrato. Validar respuestas/eventos y sanear diagnósticos; una excepción no implica rollback. Éxitos vacíos devuelven `ok(undefined)`.
- `connect()` resuelve al aceptar, no al conectar ni al escanear. Mantener una sola solicitud; sustituir QR, preservar su expiración real e invalidarlo al salir de `awaitingQr`. Final de QR fallido requiere solicitud explícita nueva.
- Aplicar 30 segundos de red/autenticación, excluyendo escaneo, y backoff 1/2/4/8/16/30 segundos. Cancelar intentos al parar, revalidar deadlines monotónicos al reanudarse y aislar resultados tardíos. Sesión revocada exige retirada explícita antes de nueva vinculación.
- Reproducir estado vigente y QR válido solo al nuevo listener, ordenados respecto de cambios posteriores. No reproducir errores pasados ni conectar al suscribirse. `remove()` afecta únicamente su suscripción.
- Serializar decisiones y detener sin esperar un futuro commit del consumidor. Clasificar red, capacidad, consumidor y persistencia por separado; prioridad del fallo local sobre reconexión.

**Límite:** servicio Android, retirada de credenciales y entrega confirmable se completan en sus tareas; no se declara recepción de fondo por tener un controlador conectado.

### WA-06 — Recibir y recuperar entregas confirmables sin pérdida local

- [ ] Pendiente

**Resultado:** el consumidor de prueba persiste un mensaje, confirma su entrega y recupera duplicados de forma idempotente tras caídas.

**Implementación:** recepción en vivo sobre el adaptador transaccional, coordinador único de recuperación y nuevos pendientes, buffer presupuestado y `confirmMessageStored`. Integrar `EnableDecryptedEventBuffer`, `SynchronousAck` y resultado del manejador sin confiar únicamente en esos flags.

**Aceptación y verificación:**

- Observar la secuencia commit sesión/contenido → evento → commit del consumidor → retirada durable → permiso de ACK. Limpieza de EventBuffer no retira antes el contenido. Completar replay de protocolo necesario sin volver a descifrar sobre estado Signal avanzado.
- Probar caídas antes del commit nativo, después de él, tras commit del consumidor y tras retirada previa al ACK. Mantener IDs del pendiente; otra entrega posterior del mismo mensaje puede tener nuevo deliveryId y el mismo message.id.
- Emitir una entrega por vez, ordenada por revisión numérica y ordinal, compartida por recuperación y recepción nueva. Recuperar pendientes resueltos sin red ni credenciales, incluso con fallo exclusivo de sesión.
- Confirmar idempotentemente un ID válido ausente, rechazar formato inválido y diferenciar ausencia de fallo de lectura. Respuestas perdidas permiten repetición; no conservar tombstones, cuerpos confirmados ni borrar imágenes.
- Sustituir el único consumidor y reemitir el mismo pendiente; ignorar `remove()` antiguo y callbacks encolados obsoletos. Admitir confirmación tardía del consumidor anterior sin dos recorridos ni efectos lógicos duplicados en el consumidor de prueba.
- Sin consumidor, ante runtime destruido o callback fallido, conservar pendientes y detener recepción según la causa. Resuscribirse recupera localmente sin anular paradas explícitas ni crear temporizadores de reemisión.
- Contabilizar contenido codificado, recuperación, metadatos, cifrado y reservas en 10 MiB por defecto. Pausar/reanudar al liberar capacidad solo si sigue solicitado; una entrega excesiva no causa descarte ni reintento infinito. Confirmaciones permanecen disponibles.

**Límite:** ofrece al menos una entrega; la idempotencia productiva y la cola a core pertenecen al consumidor, fuera del alcance.

### WA-07 — Recuperar mensajes cuya identidad PN/LID se completa después

- [ ] Pendiente

**Resultado:** un mensaje sin mapping verificable queda seguro y se entrega con identidad definitiva cuando llega la correspondencia, sin bloquear otros chats.

**Aceptación y verificación:**

- Admitir `pendingLid` solo con LID propio conocido; guardar contenido, origen, deliveryId, orden y reserva para identidad junto con cambios criptográficos. No emitir ID provisional ni permitir ACK de esa recepción.
- Distinguir ausencia válida de fallo del store; emitir `IDENTITY_UNAVAILABLE` al entrar en la condición, sin polling ni errores repetidos por recorrido.
- Publicar mensaje e identidad resueltos atómicamente antes del evento, sin recrear una entrega confirmada ni cambiar IDs ya asignados. Procesar mappings mientras otra entrega espera confirmación.
- Saltar temporalmente pendientes no resueltos, que siguen ocupando presupuesto y no vencen. Reevaluarlos al reiniciar con información verificable de su propia cuenta.
- Probar llegada tardía, reinicio y capacidad reservada. Preparar la resolución de mappings disponibles antes de retirar sesión; WA-09 verificará esa ruta integrada con logout.

**Límite:** borrar credenciales no crea correspondencias faltantes; otra cuenta no puede resolver arbitrariamente esas identidades.

### WA-08 — Recuperar historial mediante admisión atómica del lote completo

- [ ] Pendiente

**Resultado:** todo mensaje soportado de un lote queda durable antes de emitir el primero, o el lote no se admite parcialmente.

**Implementación:** atender `HistorySync` y normalización histórica, captura recuperable de notificación y adaptación de descarga/recibos con `ManualHistorySyncDownload` y `DisableManualHistorySyncReceipt`.

**Aceptación y verificación:**

- Procesar mappings antes de normalizar sus dependientes. Publicar juntos todos los mensajes soportados y cambios de protocolo; un fallo de lectura, normalización o escritura aborta el lote completo. Excluir contenido fuera de alcance no equivale a error.
- Instrumentar por separado ACK de notificación, recibo `hist_sync` y eliminación remota; ninguno retira la única fuente recuperable de contenido aún no confirmado localmente. Los flags y el retorno del callback no bastan como evidencia.
- Si cabe en el presupuesto total pero falta capacidad libre, esperar confirmaciones sin retener writer ni bloquear parada. Si el lote excede por sí solo el buffer, devolver `RECOVERY_BUFFER_FULL` sin bucle ni admisión parcial.
- Procesar un solo lote y evitar acumulación de lotes completos en RAM. Limitar bytes reales de entrada/inline a 16 MiB y descompresión a 32 MiB antes del parser; tamaños declarados falsos y expansión excesiva generan `HISTORY_LIMIT_REACHED`.
- Concretar y probar cotas de profundidad, cantidad y tamaño de registros antes de materializar colecciones costosas. Medir pico real de parser, normalización, binding y snapshots; no equiparar límite de protobuf con RAM total.
- Interrumpir captura, descarga, admisión y entrega; recuperar lo comprometido sin depender solo de URL/chunk remoto y sin publicar cambios parciales de un lote rechazado.

**Límite:** no agrega spool histórico con presupuesto separado ni garantiza recuperar un recurso rechazado que desapareció del servidor. Los límites propuestos se validan y cualquier ajuste se documenta explícitamente.

### WA-09 — Desvincular y cambiar de cuenta preservando pendientes

- [ ] Pendiente

**Resultado:** retirar la sesión y su clave permite vincular otra cuenta mientras los pendientes anteriores siguen identificados y recuperables.

**Aceptación y verificación:**

- Detener generación y recepción solicitada; completar mappings ya verificables y solicitar desvinculación con plazo de 15 segundos. Publicar `session: null` y clave pendiente de eliminar, borrarla y retirar durablemente su marcador antes del éxito local.
- Sin confirmación remota, completar retirada local y devolver `REMOTE_LOGOUT_UNCONFIRMED`; nunca restaurar credenciales ni afirmar confirmación remota inexistente.
- Inyectar caída o fallo en cada paso, completar limpieza al reiniciar y bloquear vinculación nueva hasta resolverla. No eliminar `K_recovery` ni clave de sesión activa; la nueva sesión usa otra clave.
- Logout concurrente comparte resultado; repetir sin sesión/limpieza es éxito local idempotente. Inicialización parcial permite logout solo cuando el contenedor y la clave a retirar son verificables.
- Recuperar/confirmar pendientes anteriores sin cuenta activa o con otra distinta; mantener cuentas, IDs, referencias y pendientes sin LID sin mezclar credenciales ni ACK. Disconnect conserva vinculación y no habilita por sí solo cambio de cuenta.
- Conservar mensajes del consumidor y archivos de imagen existentes; WA-10 completa la prueba con descargas reales controladas.

**Límite:** sesión expirada o inválida no autoriza borrado automático de un contenedor corrupto ni recuperación silenciosa con una revisión antigua.

### WA-10 — Descargar, reutilizar y eliminar imágenes privadas con capacidad limitada

- [ ] Pendiente

**Resultado:** una referencia guardada antes de reiniciar permite descargar y devolver URI/MIME/tamaño verificados; un archivo completo válido se reutiliza sin red.

**Aceptación y verificación:**

- Validar descriptor `wa-image:v1:`, máximo de 16 KiB, campos permitidos, IDs coherentes, uint64 decimal y claves/hashes de 32 bytes. Rechazar rutas/hosts arbitrarios; usar únicamente rutas de media y hosts del cliente. Descriptor mal formado produce `INVALID_INPUT`; incompleto o expirado, `IMAGE_UNAVAILABLE`.
- Verificar primero archivo completo. Sin completo válido, exigir cuenta de origen conectada o devolver `ACCOUNT_NOT_CONNECTED`. No conectar automáticamente ni solicitar reenvío al teléfono.
- Descargar/descifrar a temporal privado mediante el adaptador de archivo, verificar integridad, determinar MIME válido, cerrar y publicar antes de devolver URI. No pasar bytes/base64 al bridge público ni añadir a galería.
- Contabilizar 50 MiB globales por defecto: completos, reservas y máximo temporal cifrado; acotar escrituras reales, `WriteAt`, `Truncate` y preasignaciones con tamaño desconocido/falso. Comprobar límite exacto y exceso.
- Serializar descargas/borrados por admisión; reutilizar duplicados exitosos y respetar borrado anterior/posterior. Medir 60 segundos de operación excluyendo cola, compartidos por reintentos internos; el wrapper no reintenta solo.
- Cancelar red al parar sin esperar turno. Ordenar publicación frente a retirada de generación; encolados pueden reutilizar completos pero no usar una nueva generación para iniciar red automáticamente.
- Limpiar parciales al fallar/iniciar y conservar consumo si falla borrado. Borrar ausente es éxito; lectura/permisos fallidos son `IMAGE_DELETE_FAILED`. Completo inválido no se presenta como éxito y admite borrado explícito.
- Confirmaciones y persistencia siguen progresando durante descarga. Logout conserva completos; nombres derivados impiden atravesar rutas y archivos persisten fuera de caché y backups.

**Límite:** la URI no reserva el archivo frente a un borrado posterior. La subida HTTP y su coordinación pertenecen al consumidor.

### WA-11 — Configurar y actualizar presupuestos sin descartar datos

- [ ] Pendiente

**Resultado:** Yoyos configura límites desde el bundle y puede reducirlos o aumentarlos tras desconectar, conservándolos después de reiniciar.

**Implementación:** composición fuera de `src/app/` y del módulo reutilizable, lectura estática de `EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB`, validación y conversión a `maxRecoveryBufferBytes`; publicación durable de `options` en el contenedor cifrado compartido por iOS y Android.

**Aceptación y verificación:**

- Aplicar 10 MiB de recuperación y 50 MiB de imágenes por defecto; variable ausente usa default, definida inválida falla sin fallback. Validar entero positivo y conversión segura a bytes; Go/nativo no leen `.env`.
- `disconnect()` exitoso → `initialize(newOptions)` → `connect()` aplica valores nuevos. Tras reiniciar ambas plataformas restauran `options` de la revisión publicada, incluso sin sesión; `state.next` no aporta valores y una respuesta incierta exige relectura. Opciones equivalentes son idempotentes; distintas con intención activa, QR, reconexión o pausa se rechazan.
- Esperar limpieza de descarga cancelada antes del cambio de límite de imágenes, sin bloquear writer. Publicar opciones antes del éxito; resolver resultado incierto releyendo estado.
- Reducir debajo de lo ocupado conserva datos legibles, confirmables, reutilizables y borrables después del reinicio. Mantener cota confiable de lectura y permitir escrituras para drenar exceso sin aceptar longitudes arbitrarias.
- Presupuestos son globales por instalación e independientes de sesión/historial; cambiar cuenta no los multiplica. Recreación nativa conserva opciones sin JavaScript; cambiar `.env` requiere nuevo bundle, no recompilar Go por sí solo.

**Límite:** aumentar buffer no cambia límites internos ni recupera necesariamente un lote remoto rechazado. No añade nuevas opciones públicas para tiempos o parser.

### WA-12 — Mantener recepción Android fuera de las pantallas y recuperar el servicio

- [ ] Pendiente

**Resultado:** el servicio conserva el único cliente al minimizar la app y, cuando Android lo recrea, restaura solo una intención durable válida.

**Aceptación y verificación:**

- Verificar adecuación real de `remoteMessaging`, incluido manejo de imágenes. Manifest combinado con permisos definidos, servicio no exportado, mismo proceso y `stopWithTask=false`; compatibilidad previa a API 34 sin constante inexistente.
- Desde contexto permitido, publicar notificación y promover antes de cargar Go o almacenamiento; trabajo pesado fuera del hilo principal. Canal `whatsapp-connection`, importancia baja, ID reservado e intención explícita/inmutable sin datos sensibles ni nuevas acciones.
- Probar notificaciones concedidas/denegadas: `connect()` no abre diálogo. Inicio rechazado comunica fallo antes de aceptar o eventos después; retira intención preservando datos, sin bucle ni tipos alternativos.
- Persistir `androidService` con cuenta/opciones y `receiveRequested`. Al completar QR publicar sesión e intención juntas. `START_STICKY` verifica sesión/cuenta/opciones y registra generación nueva sin JavaScript ni QR de fondo; Expo adopta controlador equivalente sin duplicarlo.
- Disconnect/logout/fallo local retiran intención durable antes de éxito. Probar carreras con recreación y fallo de publicación; detener ejecución sin afirmar persistencia si guardar falla.
- Reinicio de teléfono y detención del usuario esperan solicitud explícita; no BOOT_COMPLETED, alarmas compensatorias ni dependencia de `onDestroy()` para salvar mensajes.
- Con transporte controlado, comprobar minimización, recientes, pantalla apagada, ajustes de batería acordados, Doze, pérdida de red y proceso terminado. Ausencia de consumidor conserva/pausa pendientes; recreación no confirma ni activa por sí sola Expo.

**Límite:** servicio activo no demuestra conexión ni persistencia del consumidor; no garantiza latencia o plazo de recreación. Si hay distribución en Google Play, documentar la justificación exigida para el servicio antes de distribuir.

### WA-13 — Recuperar la ejecución iOS después de suspensión

- [ ] Pendiente

**Resultado:** al volver a ejecutar la app, sesión, pendientes e imágenes conservan su estado y el controlador continúa sin resultados obsoletos.

**Aceptación y verificación:**

- Ejecutar contratos compartidos en iOS real además de la carga en simuladores; almacenamiento seguro y filesystem no se sustituyen por mocks para probar custodia/durabilidad.
- Suspender/reanudar con pendiente, QR, intento de conexión y descarga en distintos momentos. Verificar expiraciones, cancelación o aislamiento de resultados tardíos, recuperación local y ausencia de clientes duplicados.
- Comprobar acceso después del primer desbloqueo, protección de temporales y conservación frente a cierre de proceso; antes de desbloquear, error explícito sin recreación vacía.
- Registrar qué se observó al suspender y reanudar y qué depende de volver a ejecutar el proceso. No registrar como aprobado un mecanismo de recepción suspendida que el diseño no define.

**Límite:** no agrega ejecución de fondo iOS, receptor servidor ni notificaciones para despertar la aplicación.

### WA-14 — Acreditar el contrato completo con fallos, concurrencia y mediciones

- [ ] Pendiente

**Resultado:** evidencia reproducible de todas las capacidades v1 y de sus límites, vinculada a las fuentes y herramientas efectivas.

**Aceptación y verificación:**

- Ejecutar el catálogo completo UT/IT asignado abajo y los cruces entre tareas en Android/iOS. Conservar comandos, entorno, resultados y casos pendientes; ningún test se considera aprobado solo porque se generaron bindings.
- Usar consumidor de prueba durable e idempotente y transporte controlado para recorrer vinculación, vivo/historial, reinicios, confirmación perdida, PN/LID tardío, descarga, logout y nueva cuenta. No agregar tablas productivas ni otra cola de subida.
- Revisar todas las familias de errores, panics y bindings: logs, mensajes públicos y notificaciones no exponen claves, QR, conversaciones ni descriptores. Decisiones por `code`; credenciales, recepción y descifrado permanecen exclusivamente en el móvil.
- Medir latencia, RAM y espacio transitorio de snapshots/confirmaciones e historial con cargas representativas y cercanas a límites. Registrar resultados sin inventar umbrales de rendimiento ni declarar que bytes de protobuf equivalen a memoria total.
- Cerrar con evidencia los pendientes técnicos: codecs y auditoría de escrituras, cotas del parser/binding, cota confiable de lectura, creación de claves, publicación durable por plataforma, matriz nativa y adecuación del servicio Android. Si una propuesta falla, registrar el cambio de diseño necesario y mantener abierta la capacidad afectada.
- Completar README del módulo con API, configuración, compilación/reconstrucción, errores, garantías y límites; actualizar el estado del diseño únicamente según resultados obtenidos.

**Límite:** las integraciones controladas no acreditan interoperabilidad con WhatsApp real, recepción suspendida de iOS, historial remoto completo, entrega exactamente una vez ni rendimiento sin umbral acordado.

## Cobertura del documento fuente

La siguiente matriz asigna cada caso UT/IT existente a una tarea responsable de su cierre. El texto íntegro de cada caso permanece en el documento fuente; no se crean nuevos IDs para aparentar cobertura. Los criterios de cada tarea también cubren las decisiones narrativas que no tienen un test individual. WA-14 verifica el conjunto, sin trasladar a una fase final las pruebas propias de cada incremento.

| Tarea responsable | Casos del documento fuente |
| --- | --- |
| WA-01 | `IT-BRG-01`, `IT-BLD-01`, `IT-BLD-02`, `IT-BLD-03`, `IT-BLD-04`, `IT-BLD-05`, `IT-BLD-06`, `IT-BLD-07`, `IT-BLD-08` |
| WA-02 | `UT-FMT-02`, `UT-FMT-03`, `UT-FMT-06`, `UT-FMT-08`, `IT-FMT-01`, `IT-FMT-02`, `IT-FMT-03`, `IT-FMT-04`, `IT-FMT-05`, `IT-FMT-08`, `IT-FMT-09`, `IT-FMT-10`, `IT-STO-01`, `IT-STO-02`, `IT-STO-03`, `IT-STO-04`, `IT-STO-05`, `IT-STO-06`, `IT-STO-07`, `IT-STO-08`, `IT-KEY-01`, `IT-KEY-02`, `IT-KEY-03`, `IT-KEY-04`, `IT-KEY-05`, `IT-KEY-06`, `IT-KEY-07`, `IT-KEY-08`, `IT-KEY-09`, `IT-KEY-10` |
| WA-03 | `UT-FMT-07`, `UT-BRG-04`, `UT-BRG-05`, `IT-FMT-07`, `IT-BRG-02`, `IT-BRG-03`, `IT-BRG-04`, `IT-BRG-05`, `IT-BRG-06`, `IT-BRG-07`, `IT-BRG-08`, `IT-BRG-09`, `IT-BRG-10`, `IT-PRO-01`, `IT-PRO-02`, `IT-PRO-03`, `IT-PRO-04`, `IT-PRO-05`, `IT-PRO-06`, `IT-PRO-07` |
| WA-04 | `UT-MSG-01`, `UT-MSG-02`, `UT-MSG-03`, `UT-MSG-04`, `UT-MSG-05`, `UT-MSG-06`, `UT-MSG-07`, `UT-MSG-08`, `UT-MSG-09`, `UT-ID-01`, `UT-ID-02`, `UT-ID-03`, `UT-ID-04`, `UT-ID-05`, `IT-MSG-01`, `IT-MSG-02`, `IT-MSG-07`, `IT-MSG-08`, `IT-MSG-09`, `IT-ID-05` |
| WA-05 | `UT-API-03`, `UT-CON-01`, `UT-CON-02`, `UT-CON-03`, `UT-CON-04`, `UT-CON-05`, `UT-CON-07`, `UT-CON-08`, `UT-EVT-01`, `UT-EVT-02`, `UT-EVT-03`, `UT-EVT-04`, `UT-EVT-05`, `UT-EVT-06`, `IT-API-01`, `IT-API-02`, `IT-API-03`, `IT-API-04`, `IT-API-05`, `IT-INI-01`, `IT-INI-02`, `IT-INI-03`, `IT-INI-04`, `IT-INI-06`, `IT-CON-01`, `IT-CON-02`, `IT-CON-03`, `IT-CON-04`, `IT-CON-05`, `IT-CON-06`, `IT-CON-07`, `IT-CON-08`, `IT-CON-09`, `IT-EVT-01`, `IT-EVT-02`, `IT-EVT-03`, `IT-EVT-04`, `IT-EVT-05`, `IT-EVT-06` |
| WA-06 | `UT-DEL-06`, `UT-DEL-07`, `UT-DEL-08`, `UT-DEL-09`, `UT-SUB-01`, `UT-SUB-02`, `UT-SUB-03`, `UT-SUB-04`, `UT-SUB-05`, `UT-SUB-07`, `UT-SUB-08`, `UT-BUF-01`, `UT-BUF-02`, `UT-BUF-04`, `IT-API-08`, `IT-INI-05`, `IT-DEL-01`, `IT-DEL-02`, `IT-DEL-03`, `IT-DEL-04`, `IT-DEL-05`, `IT-DEL-06`, `IT-DEL-07`, `IT-DEL-08`, `IT-DEL-09`, `IT-DEL-10`, `IT-DEL-11`, `IT-SUB-01`, `IT-SUB-02`, `IT-SUB-03`, `IT-SUB-04`, `IT-SUB-05`, `IT-SUB-06`, `IT-SUB-07`, `IT-SUB-08`, `IT-BUF-01`, `IT-BUF-02`, `IT-BUF-03`, `IT-BUF-04` |
| WA-07 | `UT-ID-07`, `IT-ID-06`, `IT-ID-07`, `IT-ID-08` |
| WA-08 | `UT-HIS-02`, `UT-HIS-05`, `UT-HIS-06`, `IT-HIS-01`, `IT-HIS-02`, `IT-HIS-03`, `IT-HIS-04`, `IT-HIS-05`, `IT-HIS-06`, `IT-HIS-07`, `IT-HIS-08`, `IT-HIS-09` |
| WA-09 | `UT-CON-10`, `IT-INI-07`, `IT-CON-10`, `IT-ID-09`, `IT-ID-10`, `IT-OUT-01`, `IT-OUT-02`, `IT-OUT-03`, `IT-OUT-04`, `IT-OUT-05`, `IT-OUT-06` |
| WA-10 | `UT-IMG-02`, `UT-IMG-03`, `UT-IMG-04`, `UT-IMG-05`, `UT-IMG-09`, `UT-IMG-10`, `UT-IMG-12`, `UT-IMG-13`, `UT-IMG-14`, `UT-IMG-15`, `UT-IMG-16`, `IT-IMG-01`, `IT-IMG-02`, `IT-IMG-03`, `IT-IMG-04`, `IT-IMG-05`, `IT-IMG-06`, `IT-IMG-07`, `IT-IMG-08`, `IT-IMG-09`, `IT-IMG-10`, `IT-IMG-11`, `IT-IMG-12`, `IT-IMG-13`, `IT-IMG-14`, `IT-IMG-15`, `IT-IMG-16`, `IT-IMG-17` |
| WA-11 | `UT-API-06`, `UT-CFG-01`, `UT-CFG-02`, `IT-API-06`, `IT-CFG-01`, `IT-CFG-04`, `IT-CFG-05`, `IT-CFG-06`, `IT-CFG-07`, `IT-CFG-08`, `IT-CFG-09` |
| WA-12 | `IT-INI-08`, `IT-CFG-03`, `IT-AND-01`, `IT-AND-02`, `IT-AND-03`, `IT-AND-04`, `IT-AND-05`, `IT-AND-06`, `IT-AND-07`, `IT-AND-08`, `IT-AND-09`, `IT-AND-10`, `IT-AND-11`, `IT-AND-12` |
| WA-13 | `IT-IOS-01` |
| WA-14 | `IT-API-07`, `IT-SEG-01`, `IT-SEG-02`, `IT-SEG-03` |

Control de cobertura al crear este backlog: **242 casos (68 unitarios y 174 de integración), asignados una vez cada uno**. Esta asignación verifica trazabilidad, no ejecución ni aprobación. Si cambia el catálogo fuente, actualizar esta matriz.

## Condición de cierre del alcance v1

Todas las tareas deben estar completas, con sus pruebas y evidencia de plataforma. No se cierra el alcance si quedan sin resolver atomicidad de sesión/contenido, supresión de ACK ante fallo local, codecs críticos, recuperación de claves o publicación durable. La limitación declarada de iOS suspendido y las exclusiones del consumidor siguen vigentes al cerrar la librería.
