# Tareas de implementación de la API de mensajes WhatsApp móvil

Fuente normativa: [whatsapp-mobile-message-api-implementation.md](whatsapp-mobile-message-api-implementation.md).

Estado: plan de trabajo; ninguna casilla implica implementación o pruebas ejecutadas.

## Objetivo y organización

Implementar `POST /api/whatsapp/messages` para registrar un mensaje bajo la empresa autenticada y confirmar el dispatch de `whatsapp_message_recorded` después del commit. Un éxito confirma persistencia y aceptación por el bus, no ejecución de un consumidor ni almacenamiento del archivo de una imagen.

Las tareas agrupan comportamientos verificables con sus contratos, datos, lógica, integración y pruebas. No son tareas independientes por archivo, columna o función. Los primeros comportamientos se validan mediante contratos y operaciones de aplicación con PostgreSQL; la tarea 6 completa el recorrido HTTP. Ejecutar en orden **1 → 2 → 3 → 4 → 5 → 6 → 7**. La ruta de producción solo se habilita cuando el flujo completo está listo; no publicar implementaciones parciales que respondan éxito sin dispatch.

Los IDs U, I y E remiten a los escenarios completos de la sección 9 de la fuente. Si aparecen en varias tareas, cada una cubre su parte y la tarea 7 verifica el escenario completo. Las tablas de límites, errores, checks y contratos de la fuente siguen siendo normativas; este plan no las sustituye ni flexibiliza.

## Alcance global

- Un mensaje por petición: texto o imagen con metadata opcional, incoming/outgoing, histórico o nuevo.
- Identidad por empresa, cuenta LID, chat LID e ID del protocolo; primera escritura ganadora y aislamiento entre empresas.
- Reutilización de `Contact → Chat → ChatMessage`, migraciones compatibles y conservación de los flujos Cloud API y ventas existentes.
- Entrada/salida estrictas, autenticación existente, dispatch post-commit con identidad estable y recuperación al repetir el POST.
- Pruebas unitarias, de tipos, PostgreSQL/proveedor reales, E2E HTTP y regresiones de los callers modificados.

## Fuera de alcance global

- Consumidor Expo, cola móvil, módulo Go, recepción real Android/iOS y cambios de pantallas.
- Vinculación o verificación de cuentas WhatsApp, asociación/fusión con clientes comerciales y deduplicación entre Cloud API y móvil.
- Descarga, descifrado o subida de imágenes; almacenar descriptores, referencias sensibles o archivos locales.
- Análisis de conversaciones, nuevas funcionalidades de ventas y handlers del evento.
- Lotes, sincronización bidireccional, edición, eliminación, grupos y contenidos distintos de texto/imagen.
- Workers de recuperación, outbox genérico, bus nuevo, entrega exactamente una vez, nuevos endpoints de lectura y paquetes nuevos.

Las adaptaciones de contactos usados en ventas y las regresiones del webhook sí están incluidas: son necesarias para preservar el comportamiento actual.

## Tarea 1. Admitir mensajes válidos y rechazar entradas inválidas sin efectos

**Flujo:** JSON recibido → validación de transporte e identidad → entrada de dominio exacta, o error contractual sin invocar persistencia/publicación.

**Dependencias:** ninguna. Se prueba con schemas reales y una ruta/factory con dependencia explícita de prueba; su montaje productivo se completa en la tarea 6.

**Alcance**

- Definir request/response en `shared/contracts/whatsapp-messages.ts`, con tipos derivados exclusivamente mediante `z.infer`, sin dependencias de core/mobile.
- Validar todos los escalares y límites de la sección 3: bytes UTF-8, LID completos, tupla del ID nativo, Base64url canónico, fechas, MIME y tamaño. Conservar contenido sin recortes, coerciones, defaults ni normalización.
- Transformar a tipos nominales y unión de contenido: timestamp a `Date`, ausencias a `null`, `id` a `externalId` y chat remoto a `remoteChatId`. Validar antes de construir identidades nominales.
- Implementar el comportamiento del parser específico: límite de 102400 bytes, JSON estricto, rechazo de compresión y Content-Type no admitido. Extraer `hasDuplicateJsonKeys` a presentación compartida y actualizar callers/tests de órdenes y `app.ts` sin dependencia chats → presentación de órdenes.
- Preparar respuestas/errores saneados y validación de salida; definir el router mediante dependencia explícita, sin caso de uso ficticio en producción.
- Cubrir con fixtures la forma de adaptación desde `ReceivedMessage`: texto, imagen cuyo texto se vuelve caption e imagen mínima. Mantener `image.reference`, `deliveryId` y URI local fuera del contrato.

**Fuera de alcance**

- Escrituras reales, publicación de eventos y habilitación de la ruta productiva.
- Implementar un adaptador o consumidor móvil, truncar contenidos fuera de límite o regenerar el ID nativo.

**Criterios de aceptación**

- [ ] Texto e imagen mínima/completa en ambas direcciones conservan identidad, espacios, saltos, Unicode y opcionales; `" "` es válido y `""` no.
- [ ] Se rechazan versión diferente, arrays, contenido ausente/mezclado/no soportado, campos desconocidos a cualquier nivel, `null` y coerciones. Ningún rechazo llama al caso de uso.
- [ ] El ID de ejemplo es válido; se rechazan PN, grupos, dispositivos, Base64 no canónico, UTF-8 inválido, tuplas incompletas/extra/incoherentes y U+0000/sustitutos aislados. Distintos escapes JSON válidos de la misma tupla se admiten sin reserialización obligatoria.
- [ ] Para cada límite se prueba el extremo válido y el siguiente inválido. Incluye LID 128 bytes, protocolo 512, ID nativo 4096, texto/caption 65536, MIME 127, tamaño 0–9007199254740991 y timestamp 0–253402300799999; NaN, Infinity, fracciones y strings se rechazan donde corresponde.
- [ ] Body válido exactamente de 102400 bytes no falla por tamaño; 102401 devuelve 413. JSON malformado/duplicado, incluso claves anidadas o escapadas equivalentes, devuelve 400; formato/encoding no admitidos devuelve 415, sin inflación del body.
- [ ] Los errores solo incluyen códigos, rutas y razones estáticas de la fuente. Una salida inválida produce 500; no se filtran contenido, valores recibidos, SQL, tokens ni stacks.
- [ ] Las pruebas existentes del detector y del parser de órdenes siguen pasando. Los tests de tipos rechazan contenido mezclado e intercambio de IDs nominales, sin casts para silenciarlos.

**Validación:** U01–U05, U10 y parte de U11. Tests del schema real en `chats/presentation/mobile-message-schemas.test.ts`, dentro de los patrones unit actuales. E05 se completa sobre servidor real en la tarea 6.

## Tarea 2. Admitir contactos LID y conservar los flujos existentes al migrar

**Flujo:** base existente → migración y lectores compatibles → contacto sin teléfono identificable por cuenta/LID, mientras Cloud API y selección de compradores con teléfono siguen funcionando.

**Dependencias:** tarea 1.

**Alcance**

- Generar las migraciones de Contact/ChatMessage y el enum siguiendo la skill de migraciones indicada en la fuente, desde una base de desarrollo aislada y con credenciales de migración. Regenerar cliente; no crear timestamps/directorios a mano ni editar migraciones aplicadas.
- Hacer opcional `Contact.phone`, añadir el par cuenta/LID y su unicidad; validar al menos una identidad y que el par sea completo. Conservar teléfono único por empresa, FK compuestas, defaults y RLS; `Chat.contactId` sigue obligatorio.
- Incorporar los campos móviles, `metadata_only`, checks y unicidades de ChatMessage de la sección 6. Crear el índice parcial Cloud API antes de retirar el anterior; confirmar el enum antes de usarlo en checks y planificar locks/DDL concurrente según volumen.
- Adaptar dominio/mappers de contactos y mensajes a variantes validadas. Añadir `ensureWhatsAppContact` en contacts sin duplicar su SQL en chats; mantener proyección de teléfono comprobado para `ensureContact`.
- Mantener `ContactSnapshot`, contratos y formularios de ventas con teléfono real: filtrar contactos sin teléfono en búsqueda y devolver ausencia en selección directa. Restringir `storeMessageImage` y la inserción Cloud API a `ready | failed`; lectores generales admiten `metadata_only`.
- Acotar las búsquedas y relecturas Cloud API a `whatsappMessageId: null`, revisar exports/callers y preservar `recordWhatsAppMessage`.

**Fuera de alcance**

- Convertir IDs históricos, fabricar teléfonos, fusionar contactos, habilitar ventas a contactos LID sin teléfono o eliminar datos para permitir un rollback antiguo.
- Habilitar el endpoint o implementar el registro transaccional móvil completo, que corresponde a la tarea 3.

**Criterios de aceptación**

- [ ] Migraciones aplicables a base vacía y fixture con contactos/chats/mensajes/imágenes anteriores; datos, relaciones y reglas Cloud API permanecen intactos.
- [ ] Un contacto nuevo por cuenta/LID tiene `phone = null` y `name = null`; repeticiones reutilizan el contacto sin alterar su identidad, nombre o teléfono. Otra cuenta conserva un contacto distinto.
- [ ] SQL inválido falla por checks reales: teléfono vacío, par incompleto, ausencia de identidad, variantes de contenido incompatibles y metadata móvil en filas Cloud API. No se aceptan filas inválidas por un CHECK que evalúe NULL.
- [ ] Contactos LID sin teléfono no aparecen en búsqueda de ventas y su selección directa conserva `CONTACT_NOT_FOUND`. Contactos con teléfono, snapshots y contratos web/mobile mantienen su comportamiento.
- [ ] El webhook sigue guardando y deduplicando mensajes e imágenes `ready/failed`; los lectores manejan `metadata_only` sin inventar `mediaId`. Datos incompatibles producen error, no defaults.
- [ ] RLS, permisos de `core_app`, defaults y FK tenant siguen activos; el índice parcial conserva la unicidad Cloud API y una regeneración posterior no lo elimina.
- [ ] Queda documentado el orden de despliegue: lectores compatibles antes de habilitar la ruta; volver a lectores antiguos después de aceptar nuevos datos no se considera rollback seguro.

**Validación:** I10, checks de I05, aislamiento de I04 y regresiones de contactos, ventas y webhook. Verificar tipos de mobile si cambian sus imports compartidos.

## Tarea 3. Registrar y releer un mensaje completo de forma atómica

**Flujo:** entrada validada y contexto confiable → asegurar Contact/Chat → insertar ChatMessage → commit → devolver la proyección persistida.

**Dependencias:** tareas 1 y 2.

**Alcance**

- Implementar `storeOnce` con `Result` explícito y una única transacción para Contact/Chat/ChatMessage, componiendo capacidades de contacts y chats con `withinTransaction` y `withTenantIsolation`.
- Usar `prisma` con tenant, nunca `systemPrisma` desde HTTP. Leer/validar la fila ganadora y devolverla solo después del commit.
- Persistir texto e imágenes con o sin caption/MIME/tamaño en ambas direcciones, incluyendo histórico y fechas futuras admitidas. Usar UUID/reloj de aplicación y recepción del servidor independiente de `sentAt`.
- Derivar source de direction; mantener `userId = null`. Guardar uploader autenticado como atribución histórica, sin FK que impida conservar mensajes al mover/eliminar usuarios.
- Guardar imágenes como `metadata_only` sin crear Image, descargar archivos ni acceder a R2. Usar BigInt para tamaño y validar rango antes de convertir a number; no emitir BigInt en JSON.
- Mapear identidad nativa contra el contacto y rechazar datos almacenados incompatibles. Mantener dominio/aplicación independientes de HTTP, Prisma, ZodError y pg-boss.

**Fuera de alcance**

- Dispatch y respuesta HTTP productiva, que se conectan en tareas 5 y 6.
- Tablas paralelas de mensajes, subida de archivos, atribuir autoría WhatsApp al uploader o enriquecer contactos existentes.

**Criterios de aceptación**

- [ ] Texto, imagen mínima y completa se persisten y releen en ambas direcciones con milisegundos, Unicode, ausencias y tamaño máximo seguro exactos; existe un Contact, un Chat y un ChatMessage para el primer registro.
- [ ] Incoming/outgoing usan respectivamente source contact/seller, ambos con autor `userId` nulo y uploader autenticado; `receivedAt` procede del reloj servidor.
- [ ] Imágenes tienen `metadata_only`, sin mediaId/imageId ni errores, y texto/caption respetan su variante. No hay descargas, acceso a archivos locales ni registros Image.
- [ ] Un fallo de inserción, constraint o commit revierte todas las altas de esa transacción. Errores de FK, permisos o conexión no se convierten en duplicados.
- [ ] Con rol `core_app`, una empresa no lee, escribe ni vincula contactos/chats/mensajes de otra; los modelos continúan cubiertos por las comprobaciones generales de RLS.
- [ ] Un mapper que encuentra identidad, fechas, contenido o tamaño incompatibles devuelve `INVALID_STORED_DATA` sin sustituir datos ni producir éxito.

**Validación:** U01 para mapping; I01, I04, I05 e I10 para lectura inválida. Extender `chats/infrastructure/chat-persistence.test.mjs` y pruebas de contactos con PostgreSQL real; mocks de Prisma no acreditan atomicidad.

## Tarea 4. Repetir y registrar concurrentemente sin duplicar ni sobrescribir

**Flujo:** mismo mensaje recibido de nuevo o en paralelo → conflictos por identidad exacta → lectura de la primera fila comprometida → misma identidad y contenido original.

**Dependencias:** tarea 3. La tarea 3 debe usar desde el inicio las claves correctas; aquí se completa y demuestra su comportamiento bajo carreras y transportes coexistentes.

**Alcance**

- Resolver conflictos exactos en contacto, chat y mensaje, leyendo el ganador sin upsert que sobrescriba contenido ni capturas genéricas de cualquier error único.
- Deduplicar por empresa/cuenta/interlocutor/protocolo mediante las claves compuestas de los tres modelos. No usar representación Base64, uploader, teléfono, timestamp, `deliveryId` o `Idempotency-Key`.
- Conservar la primera dirección, contenido, metadata, uploader, IDs y fechas; revalidar completamente cada repetición antes del caso de uso.
- Comprobar independencia entre cuentas/chats/empresas y separación entre Cloud API y móvil aun con el mismo `externalId`.

**Fuera de alcance**

- Corregir o enriquecer mensajes existentes, deduplicar entre transportes, locks en memoria y promesas de una sola publicación física.

**Criterios de aceptación**

- [ ] Repetición secuencial devuelve el mismo UUID/fecha sin cambios, incluso con texto, dirección o metadata distintos pero válidos. Una repetición inválida se rechaza.
- [ ] Al menos 10 inserciones concurrentes de una identidad producen exactamente un Contact, un Chat, un ChatMessage y un resultado `created: true`; todos reciben el mismo UUID ganador.
- [ ] Mensajes diferentes del mismo interlocutor reutilizan Contact/Chat. Cambiar cuenta, chat, protocolo o empresa crea mensajes independientes; cambiar solo uploader no.
- [ ] Dos IDs nativos válidos que codifican la misma tupla con distintos escapes JSON encuentran el mismo mensaje, sin reescribir el `externalId` original.
- [ ] Una cadena `externalId` coincidente en Cloud API y móvil no mezcla búsquedas ni rompe la deduplicación propia de ninguno.
- [ ] Las carreras no ocultan errores de integridad ajenos a la clave esperada y no dependen del orden de ejecución ni de sleeps.

**Validación:** I02, I03 y parte de I05; U07 para conservación del ganador. E02/E07 se completan en la tarea 6, y la concurrencia con dispatch en la tarea 5.

## Tarea 5. Confirmar dispatch post-commit y recuperar fallos al reintentar

**Flujo:** fila comprometida → dispatch con metadata estable → confirmar marcador → resultado; ante fallo, conservar fila y recuperar mediante un registro repetido.

**Dependencias:** tareas 3 y 4.

**Alcance**

- Implementar `registerMobileMessage` y los puertos `storeOnce`, `markEventDispatched`, `dispatchMessageRecorded`, UUID y reloj, según sección 5; dependencias explícitas y errores tipados con `Result`.
- Declarar `whatsapp_message_recorded` con augmentation de `AppEvents` incluida en TypeScript. Payload estricto `{ companyId, messageId }`; metadata `eventId = message.id`, `occurredAt = receivedAt` original en ISO.
- Adaptar `applicationEventBus().provider.publish` preservando metadata y validándola junto al payload/contexto aun sin suscriptores; no usar el helper que genera otro UUID.
- Esperar dispatch y marcado antes de devolver éxito, fuera de la transacción de guardado; sin fire-and-forget, transacción exterior ni callback asíncrono que oculte fallos.
- Hacer `markEventDispatched` idempotente y scoped por tenant; conservar primera marca, sin exigir orden temporal respecto a recepción. Adaptar el log global que presupone `payload.orderId` y sanear errores.
- Recuperar desde la fila ganadora persistida y añadir el comentario `ponytail:` requerido: sin otro POST no hay recuperación autónoma; un relay durable exigiría ampliar alcance.

**Fuera de alcance**

- Handlers ficticios o de negocio, cambios de semántica del bus, recuperación autónoma, retención sin suscriptores y garantía exactamente una vez.

**Criterios de aceptación**

- [ ] El publisher solo observa una fila ya comprometida; un fallo de store/commit produce cero dispatch. Un guardado nuevo con dispatch/marcado exitosos devuelve `stored`.
- [ ] Un duplicado confirmado devuelve IDs/fecha originales sin publicar; uno pendiente construye el evento desde la fila original, no desde el request repetido.
- [ ] Bus no listo/indisponible deja fila pendiente y devuelve error. Restaurarlo y reintentar confirma el mismo evento; reiniciar composición antes del reintento no cambia el resultado.
- [ ] Si publicar funciona pero marcar falla, no hay éxito; el reintento puede republicar con idéntico eventId/occurredAt. El mensaje nunca se borra para compensar un error.
- [ ] Marcado repetido conserva la primera fecha; fila inexistente devuelve `INVALID_STORED_DATA`. La empresa B no puede marcar una fila de A.
- [ ] Proveedor real iniciado sin suscriptores acepta dispatch y confirma marcador sin crear jobs. Proveedor detenido falla y su posterior arranque permite recuperar; no se introduce handler para probarlo.
- [ ] Dos registros concurrentes mantienen un mensaje y un eventId lógico; se permiten varias llamadas de dispatch y no se afirma deduplicación de jobs por eventId.
- [ ] Payload/metadata inválidos o empresa incoherente se rechazan con errores saneados. Excepciones inesperadas no se consideran duplicado ni éxito. El evento/log propio no contiene texto, LID, teléfono, descriptor ni credenciales.
- [ ] Typecheck rechaza nombre desconocido y payload incompleto mediante `@ts-expect-error`; la publicación y los logs de `order_cancelled` siguen funcionando.

**Validación:** U06–U09, resto de U11; I04 para marcador e I06–I09. Usar PostgreSQL y proveedor reales para las garantías de commit/dispatch, además de fakes deterministas para secuencias y fallos puntuales.

## Tarea 6. Registrar desde una sesión autenticada y devolver el resultado HTTP correcto

**Flujo:** cliente HTTP → parser → autenticación/empresa → registro → PostgreSQL → dispatch/marcador → respuesta validada; repetir tras respuesta perdida o fallo temporal.

**Dependencias:** tareas 1–5.

**Alcance**

- Componer la operación en `chats/index.ts` y montar `POST /api/whatsapp/messages` después de `loadApiAccess`/`requireApiCompany`, antes del fallback `/api`; parser específico antes del genérico.
- Obtener empresa/uploader solo desde `response.locals.auth` validado, admitir usuarios ready y aplicar `Cache-Control: no-store` a éxitos y todos los errores, incluidos parser/auth.
- Implementar la tabla completa de sección 4: 201 stored, 200 duplicate, 400 INVALID_INPUT, 401 UNAUTHENTICATED, 403 EMAIL_VERIFICATION_REQUIRED, 409 COMPANY_REQUIRED, 413 PAYLOAD_TOO_LARGE, 415 UNSUPPORTED_MEDIA_TYPE, 503 SERVICE_UNAVAILABLE y 500 INTERNAL_ERROR.
- Traducir fallos temporales de auth/persistencia/commit/dispatch/marcado a 503; datos incompatibles, salida corrupta y excepciones inesperadas a 500. No confundir errores de parser con INVALID_COMPANY.
- Validar toda salida con schema compartido; errores con formato existente y `issues` opcional solo de validación. No ampliar innecesariamente `ApiErrorCode`.
- Añadir `tests/e2e/mobile-whatsapp-messages.spec.ts` con servidor, auth, PostgreSQL y proveedor reales; fixtures propias y fallo controlado del almacenamiento/conexión del bus sin endpoints de fallo productivos.

**Fuera de alcance**

- Verificar propiedad criptográfica de accountId, probar WhatsApp/hardware real o implementar sincronización y ACKs en el cliente móvil.

**Criterios de aceptación**

- [ ] Usuario ready envía texto y recibe 201 con UUIDs válidos, `eventId = messageId`, fecha UTC original y marcador confirmado; DB tenant contiene exactamente el mensaje.
- [ ] Repetir tras ignorar la respuesta devuelve 200 y los mismos IDs/fecha, incluso con contenido cambiado válido. No se altera la primera fila ni se republica si ya está confirmada.
- [ ] Imagen mínima y outgoing histórico reciben 201 con metadata nula y sin descargas, R2 o archivo local. Fechas futuras dentro del contrato también se admiten.
- [ ] Request bien formado sin sesión, sin verificación o sin empresa devuelve respectivamente 401/403/409, sin escrituras ni dispatch. Empresa B no modifica fila/marcador de A y su misma identidad se almacena independientemente.
- [ ] Body que intenta imponer companyId/userId/source/teléfonos/credenciales se rechaza. Query/headers no sustituyen contexto autenticado. Todas las respuestas tienen `no-store`.
- [ ] JSON roto/duplicado, formato/encoding inválido y body excedido devuelven códigos contractuales sin efectos; el body válido exactamente al límite pasa el control de tamaño. Un parser puede rechazar antes de auth y no se exige 401 para un cuerpo inválido.
- [ ] Fallo real del proveedor después de persistir devuelve 503 y deja fila pendiente. Al restaurarlo, repetir devuelve 200 con la misma fila/evento y confirma marcador.
- [ ] El fallo del bus se provoca sobre su conexión/almacenamiento o fixture dedicada que mantenga real el resto del recorrido: parar solo el worker no acredita E06. Un publisher fake se etiqueta integración de composición y no sustituye la evidencia con proveedor real.
- [ ] Peticiones HTTP concurrentes producen una fila y respuestas válidas stored/duplicate. Cada éxito implica commit y dispatch aceptado, nunca ejecución de un handler.
- [ ] Se ejercitan todos los códigos de la tabla, incluidos auth temporalmente indisponible, confirmación fallida y salida inválida, mediante el nivel de prueba apropiado y sin filtración de datos en respuestas/logs.

**Validación:** U10 completo y E01–E07; E07 incluye regresión webhook/órdenes. Usar fixtures Vitest y `APIRequestContext` existentes, con consultas tenant a DB para acreditar efectos.

## Tarea 7. Validar la actualización completa y dejar evidencia para habilitar la API

**Flujo:** instalación vacía o actualización con datos previos → lectores compatibles → servidor completo → mensajes nuevos/repetidos y recuperación de fallos → flujos anteriores operativos.

**Dependencias:** tareas 1–6. Es validación del recorrido de actualización y convivencia, no una tarea donde posponer todas las pruebas anteriores.

**Alcance**

- Ejecutar la matriz completa en entorno aislado con migraciones reales, Node 24, pnpm 12.5.1, PostgreSQL, Docker/psql y requisitos E2E del repositorio.
- Verificar que los tests están incluidos en los patrones reales de Vitest: unit en core, persistencia `.test.mjs` o `.integration.test.ts`, E2E en `tests/e2e/*.spec.ts`; no crear otro runner.
- Completar regresión de los callers afectados: contactos/ventas/snapshots, Cloud API, helper/parser de órdenes, evento order_cancelled y contratos compartidos.
- Registrar comandos, resultados y limitaciones observadas; documentar secuencia de habilitación y restricciones de rollback sin ejecutar un despliegue productivo como parte de esta tarea.
- Documentar para el futuro consumidor los límites del ACK HTTP: retirar solo el pendiente de registro después de validar 200/201 y su schema; conservarlo ante 4xx/5xx/timeout/salida inválida. Mantener pendientes asociados a la empresa original y conservar referencias/archivos de imagen; ACK nativo SQLite es independiente.

**Fuera de alcance**

- Despliegue en producción, certificación Go/Expo/WhatsApp real, cambios de UI o ampliaciones para corregir los riesgos ya aceptados por la especificación.

**Criterios de aceptación**

- [ ] Pasan todos los escenarios U01–U11, I01–I10 y E01–E07, incluyendo migración sobre datos previos, aislamiento, carreras, rollback, dispatch post-commit y recuperación tras reinicio/reintento.
- [ ] Los fixtures usan empresas/usuarios/identidades/bases propias, limpieza por IDs y cierre de clientes; no usan producción, QR, teléfono real, sleeps arbitrarios ni dependencia del orden.
- [ ] Pasan los comandos siguientes y quedan registrados sus resultados reales; se ejecuta typecheck mobile cuando los cambios compartidos afectan sus imports.
- [ ] No quedan callers incompatibles por teléfono nullable, nueva variante de imagen, extracción del detector o evento sin orderId. El build y los flujos existentes funcionan con el esquema migrado.
- [ ] La guía de habilitación exige lectores compatibles antes de admitir nuevos mensajes y explica que restaurar una aplicación antigua puede ser incompatible con datos ya aceptados.
- [ ] La entrega reconoce explícitamente: cuenta declarada no verificada, imágenes sin bytes, primera escritura inmutable, dispatch repetible, recuperación dependiente de otro POST y ausencia de retención/replay sin suscriptores. Ninguna prueba se presenta como garantía más fuerte.

```sh
pnpm --dir apps/core lint
pnpm --dir apps/core typecheck
pnpm --dir apps/core test:unit
pnpm --dir apps/core test:integration
pnpm --dir apps/core test:e2e
pnpm --dir apps/core build
```

**Validación:** gate completo de las secciones 9 y 10. No declarar implementada la API con pruebas pendientes o sustituyendo PostgreSQL/proveedor reales por mocks.

## Trazabilidad de requisitos

| Sección de la fuente | Tareas responsables |
| --- | --- |
| 1–2. Objetivo, alcance y convivencia con el repositorio | Alcance global; 2, 3 y 7 |
| 3. Contrato, parser e interpretación de ReceivedMessage | 1 y 6; límites del futuro cliente en 7 |
| 4. Respuestas, errores y repetición | 1, 4, 5 y 6 |
| 5. Dominio, puertos y secuencia del caso de uso | 1, 3, 4 y 5 |
| 6. Modelos, migración, compatibilidad, transacciones y tenant | 2, 3 y 4; habilitación en 7 |
| 7. Evento, post-commit y recuperación | 5 y 6 |
| 8. Archivos, composición y callers | Distribuidos entre 1–6; regresión conjunta en 7 |
| 9–10. Matriz, gate, criterios y riesgos | Pruebas en cada tarea; gate completo en 7 |

| Escenarios | Responsabilidad principal |
| --- | --- |
| U01–U05 | 1; mapping persistido en 3 |
| U06–U09 | 5; conservación de duplicados en 4 |
| U10 | 1 y 6 |
| U11 | 1 y 5 |
| I01 | 3 |
| I02–I03 | 4 |
| I04 | 2, 3 y 5; recorrido autenticado en 6 |
| I05 | 2, 3 y 4 |
| I06–I09 | 5 |
| I10 | 2 y 3; actualización completa en 7 |
| E01–E07 | 6; ejecución conjunta y regresiones en 7 |

Cada tarea se cierra con su comportamiento demostrado y sus pruebas pasando, no solo con archivos creados. La tarea 7 consolida la evidencia de todo el alcance.
