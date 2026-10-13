# Refactor: cola de recuperación fuera de `state.bin`

Diseño técnico, 2026-10-13. **Implementado** en `4e31f94` (Android) y `228a1f3` (iOS). Resuelve el problema descrito en `docs/whatsapp-confirmacion-mensajes-latencia.md`: cada `confirmMessageStored` reescribe el estado cifrado completo (`state.bin`, ~1 MB), así que vaciar la cola cuesta O(N²) y bloquea `GLOBAL_LOCK` durante segundos.

La app está en desarrollo: **no hay migración de datos**. Al instalar la versión nueva se pierde el estado anterior y hay que volver a vincular por QR.

Rutas relativas a `apps/mobile/modules/whatsapp/` salvo que se indique otra cosa.

## Decisión

Sustituir el contenedor `state.bin` por **una base SQLite nativa por plataforma** (Kotlin `android.database.sqlite`, Swift `libsqlite3`). La sesión, la cola de recuperación y los metadatos viven en tablas de esa base. Cada escritura es **una transacción**:

- Confirmar un mensaje es `DELETE` de una fila más la actualización de la revisión. No se toca la sesión.
- `ApplyChanges` inserta las entradas pendientes y actualiza la sesión en la misma transacción. La atomicidad que hoy da el `rename` de `state.bin` la da el `COMMIT`.

**No cambia:** el contrato JSON entre Go y el código nativo, el código Go y el código JS.

**Sí cambia:** `NativeStateStore` en Kotlin y Swift, que pasa a escribir a través del adaptador `StateDatabase`, y sus pruebas nativas.

La app queda con dos archivos SQLite con dueños distintos: `yoyos-whatsapp.db`, de JS (mensajes ya guardados y sincronización), y `whatsapp/state.db`, solo del módulo nativo (sesión cifrada y cola). El segundo ya existía como `state.bin`; cambia su formato.

### Por qué la cola se queda en el lado nativo

Go define puertos y el código nativo los implementa. Cambiar de repositorio es un cambio de adaptador dentro de Kotlin y Swift. Go solo ve cuatro callbacks `func(string) (string, error)`:

| Puerto Go | Archivo | Implementación nativa |
|---|---|---|
| `ProtocolStorage.ReadState / ApplyChanges / BeginFreshSession` | `go/bridge/bridge.go:37` | `NativeStateStore.readProtocolState / applyProtocolChanges / beginFreshProtocolSession` |
| `DeliveryStorage.ReadPending / RetirePending` | `go/bridge/delivery.go:17` | `NativeStateStore.readPending / retirePending` |

Go nunca supone que la cola está dentro de `state.bin`. Dentro de Go, `delivery.Ledger`, `history.Ledger` e `identity.Ledger` son interfaces pequeñas que satisface un único `protocolstore.Ledger`, y ese `Ledger` llama a `DeliveryStorage`. Por eso el cambio no sube hasta Go.

### Alternativas descartadas

- **La cola en la base SQLite de JS (`yoyos-whatsapp.db`).** No es viable:
  - Go necesita una respuesta durable y síncrona dentro de `DoDecryptionTxn`, y solo llega a JS mediante un evento asíncrono.
  - JS puede no estar corriendo: Android recibe mensajes con la app minimizada, y la recuperación tiene que funcionar sin consumidor y tras desvincular.
  - La cola guarda texto plano descifrado y debe ir cifrada con claves nativas.
- **Un callback nuevo en Go (`InsertPending`) separado de `ApplyChanges`.** Go tendría que ordenar y recuperar dos escrituras (lectura de comprobación tras un `UncertainCommit` en dos almacenes), y el cifrado tiene que seguir siendo nativo de todos modos. Es más complejidad y no aporta nada.
- **Un archivo cifrado por entrada, junto a `state.bin`.** Funciona, pero las actualizaciones de identidad (`pendingLid` → `resolved`) obligan a versionar archivos (`<id>.<rev>`) y a limpiar huérfanos al abrir. SQLite resuelve eso con una transacción, y además elimina la publicación por `rename`, el `preparedRevision` y su matriz de fallos.

## Invariantes que se mantienen

1. **La cola es durable a más tardar junto con la sesión que descifró el mensaje.** Si la sesión avanza sin la entrada, el mensaje se pierde para siempre. Si queda la entrada sin la sesión, WhatsApp lo reenvía y JS descarta el duplicado (la clave primaria `message.id` es determinista). Con una sola transacción se cumple de forma exacta.
2. **Confirmar es durable e idempotente.** Si `retirePending` responde con éxito, la fila ya no existe en disco (`synchronous=FULL`). Si el id no existe, responde `removed=false`. Un fallo de lectura nunca se interpreta como una cola vacía.
3. **Una entrada retirada no reaparece**, y una actualización de identidad no la recrea: `UPDATE ... WHERE delivery_id=?` sin hacer upsert.
4. **Confirmar no toca la sesión ni `sessionRevision`**, y no necesita `K_session`, la generación ni la red (`TestExternalWriteWaitsAndConfirmDoesNotConflict`).
5. **Orden** por `(createdRevision numérico, createdOrdinal)`, con los pares únicos y `createdRevision <= revision` (lo valida `validatePending` en Go, `go/internal/protocolstore/store.go:384`).
6. **Presupuesto.** Las inserciones se admiten contra el presupuesto configurado. Las actualizaciones y las llamadas solo de protocolo se admiten hasta `max(budget, readBudget)`. `readBudget` nunca baja.
7. **Cifrado.** Nada sensible queda en claro en el disco. La cola usa `K_recovery` y sobrevive a la desvinculación. La sesión usa `K_session`.
   Una base sin su clave de recuperación es inválida aunque no tenga pendientes.
8. **Un único escritor.** Se mantienen el `GLOBAL_LOCK` estático y el contador `publication` (IT-STO-07 prueba instancias concurrentes).

## Esquema SQLite

Archivo `whatsapp/state.db` (Android: `noBackupFilesDir`; iOS: el mismo directorio de Application Support, con `completeUntilFirstUserAuthentication` y excluido de backups):

```sql
-- Al abrir cada conexión:
PRAGMA journal_mode = TRUNCATE;  -- se verifica la respuesta: nunca MEMORY ni OFF
PRAGMA synchronous = FULL;       -- un COMMIT que vuelve es durable
PRAGMA secure_delete = ON;       -- pone a cero las páginas que libera una confirmación

CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), store_id TEXT NOT NULL,
                   revision TEXT NOT NULL, control BLOB NOT NULL);
CREATE TABLE session (id INTEGER PRIMARY KEY CHECK (id = 1), value BLOB NOT NULL);
CREATE TABLE pending (delivery_id TEXT PRIMARY KEY, created_revision TEXT NOT NULL,
                      created_ordinal INTEGER NOT NULL, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL,
                      UNIQUE (created_revision, created_ordinal));
```

- `meta.control` es el JSON `{sessionKeysToDelete, options, androidService}` (4 KiB como máximo).
- `session.value` es el JSON de sesión de siempre: `{accountId, sessionKeyId, sessionRevision, nonceBase64, ciphertextBase64}`, con el protocolo cifrado bajo `K_session` y su AAD sin cambios.
- `pending.ciphertext` es la entrada completa (el mismo JSON que recibe Go) cifrada con AES-GCM bajo `K_recovery`, con AAD `["yoyos-whatsapp-pending",1,storeId,deliveryId,createdRevision,createdOrdinal]`. Al descifrar se comprueba además que esos tres campos del JSON coinciden con las columnas. Una actualización de identidad vuelve a sellar la fila con un nonce nuevo.
- En claro solo quedan IDs, revisiones, `options` y la intención Android.
- `revision` sigue siendo global y sube con cada transacción, también al confirmar.
- El presupuesto se sigue midiendo sobre el array JSON de pendientes en memoria, igual que antes, así que su semántica no cambia.

**Journal.** Se eligió journal de rollback en lugar de WAL: un solo archivo más su journal, sin `-wal` ni `-shm`. Android activa por defecto un "WAL de compatibilidad", y `StateDatabase` lo desactiva. En un Samsung con F2FS, el SQLite de Android usa escrituras atómicas por lotes y no crea el journal: la atomicidad la da el sistema de archivos.

**Creación inicial.** La base completa (esquema más la fila `meta` con revisión 0) se crea en `state.db.next`, se cierra y se renombra a `state.db` sincronizando el directorio, así que existe entera o no existe. Las reglas de creación interrumpida no cambian: claves o alias presentes sin base hacen el almacén inválido, nunca vacío.

**Corrupción.** El manejador de corrupción por defecto de Android borra la base. `StateDatabase` usa uno vacío, así que una base corrupta falla con `SESSION_STATE_INVALID` y el archivo se conserva.

### Registro de creación: se conserva y pierde `preparedRevision`

El registro de control (`creation.bin` en Android, un item de Keychain en iOS) sigue existiendo. Las operaciones de Keystore y Keychain no pueden entrar en una transacción SQLite, así que hace falta una intención escrita antes de crear o borrar claves.

| Campo | Destino |
|---|---|
| `status`, `storeId`, `recoveryKeyId`, `provisionalSessionKeyId` | Se quedan, con la misma función. |
| `readBudget` | Se queda. Go lo sigue leyendo (`recoveryReadBound()`), y solo se reescribe cuando el presupuesto sube, antes de publicar. |
| `preparedRevision` | **Se elimina.** El `COMMIT` une la revisión y los datos. |

Antes, cada `commit` reescribía este registro (un cifrado Keystore y un `fsync` más). Ahora solo se reescribe al crear el almacén, al emparejar o al subir el presupuesto.

## Tipos

Hay una sola implementación de persistencia por plataforma, así que no se definió una interfaz aparte: `StateDatabase` es el adaptador y `NativeStateStore` lo usa directamente. El cifrado y la validación se quedan en `NativeStateStore`; el adaptador solo mueve filas.

**Kotlin**, en `android/src/main/java/expo/modules/whatsapp/StateDatabase.kt`:

```kotlin
internal class SealedPending(val deliveryId: String, val createdRevision: String, val createdOrdinal: Long,
                             val nonce: ByteArray, val ciphertext: ByteArray)
internal class StoredState(val storeId: String, val revision: String, val control: ByteArray,
                           val session: ByteArray?, val pending: List<SealedPending>)
/** One publication: everything in it commits in a single SQLite transaction or not at all. */
internal class StateChange(val revision: String, val control: ByteArray, val sessionChanged: Boolean, val session: ByteArray?,
                           val deletes: List<String> = emptyList(), val inserts: List<SealedPending> = emptyList(),
                           val updates: List<SealedPending> = emptyList())

internal class StateDatabase(file: File) : Closeable {
  fun read(sessionLimit: Long, entryLimit: Long): StoredState
  fun write(change: StateChange, beforeCommit: () -> Unit)   // beforeCommit: punto de inyección de fallos
  companion object { fun create(file: File, storeId: String, control: ByteArray) }
}
```

Los valores que pueden superar los ~2 MB del `CursorWindow` de Android (la sesión, hasta 16 MiB, y entradas grandes) se leen por tramos con `substr()`.

**Swift**, en `ios/Storage/StateDatabase.swift`: los mismos tipos como `struct` (`SealedPending`, `StoredState`, `StateChange`) y `final class StateDatabase` sobre la API C de `SQLite3`, sin dependencias nuevas (`s.library = 'sqlite3'` en el podspec).

**Go y JS:** no cambian. La salida JSON de `readPending` y `readProtocolState` conserva su estructura (`go/internal/protocolstore/store.go:58-115`, `ledger.go:17-21`).

## Casos de uso nativos (`NativeStateStore`)

`NativeStateStore` mantiene su API pública, incluidas `open()` y `commit(expectedRevision, change)`. El estado publicado se guarda en caché **por instancia** y se recarga cuando otra instancia publica (contador estático `publication`). En producción hay una sola instancia (`ConnectionRuntime.writer`), así que la caché solo se recarga al arrancar.

| Operación | Hoy | Después |
|---|---|---|
| Arranque | Lee y descifra `state.bin`, lo valida entero. | Lee las filas y descifra y valida cada pendiente y la sesión **una vez**. Comprueba que la clave de recuperación existe. |
| `readPending` / `readProtocolState` | Copia completa del estado en cada llamada. | Desde la caché, sin copias ni I/O (`readProtocolState` sigue descifrando la sesión). |
| `retirePending` | Reescribe `state.bin` completo. | Una transacción: borra una fila y sube `revision`. Si el id no existe, no escribe nada. |
| `applyProtocolChanges` | `commit` del estado entero, revalidando todo. | Valida solo las entradas nuevas o resueltas y escribe en una transacción: inserta filas, vuelve a sellar las resueltas y reescribe la sesión si hay `protocolChanges`. |
| `commit` (opciones, intención Android, emparejamiento, logout) | Reescribe el estado completo. | Valida el estado nuevo como antes, compara con el publicado y escribe solo la diferencia: una entrada cambiada se reescribe como borrado más inserción. |
| `beginSession` / `endSession` | Forzaban una recarga completa al terminar. | Solo recargan si fallan, para completar la limpieza pendiente. |

## Fallos y recuperación

| Fallo | Resultado |
|---|---|
| Caída antes del `COMMIT` de `applyProtocolChanges` | Ni sesión ni cola nuevas. No se envió ACK, así que WhatsApp reenvía. |
| Caída después del `COMMIT` y antes de responder | Las dos cosas están publicadas. Go trata la falta de respuesta como `UncertainCommit` y relee. |
| Caída en `retirePending` antes del `COMMIT` | La fila sigue ahí y se vuelve a entregar. JS la descarta como duplicado y vuelve a confirmar. |
| Disco lleno o escritura rechazada | `ROLLBACK`: queda el último estado confirmado y se devuelve `STORAGE_FAILED`. |
| Base corrupta, fila manipulada o clave ausente | `SESSION_STATE_INVALID`. Nunca se crea un almacén vacío encima. |

Puntos de inyección de fallos: `beforeCommit`, `afterCommit` y `response` sustituyen a las siete fases de publicación de archivo (`cipher`, `write`, `sync`, `close`, `replace`, `directorySync`, `response`). Los del ciclo de vida de claves no cambian.

## Validación

**Android (SM-A566E, Android 16):** `connectedDebugAndroidTest` pasa 55 de 57. Las 2 que fallan también fallan en `HEAD` sin este cambio:
- `retirePendingRejectsMalformedRequestsWithoutMutation`: una petición sin `deliveryId` devuelve `STATE_INVALID` en lugar de `INVALID_REQUEST`.
- `exactlySixteenMiBValidSessionRestores`: el fixture pide al Keystore un AAD de 16 MiB.

La matriz de caídas matando el proceso (`StateStoreCrashInstrumentedTest`, con las fases de `scripts/check-android-probe.sh`) recupera en las tres fronteras. Pruebas nuevas: confirmar no toca la sesión guardada; un fallo antes del `COMMIT` no publica ni pendientes ni sesión; una actualización de identidad no recrea una entrada retirada; otra instancia ve la confirmación; y escritura rechazada por el sistema de archivos.

**iOS:** solo typecheck en macOS (Command Line Tools, con stubs de XCTest y del módulo Go). La suite necesita una ejecución con host de app y Xcode completo.

**Go y JS:** sin cambios. Jest del módulo pasa salvo las 2 pruebas IT-SEG-01, que fallan por logs de depuración sin confirmar ajenos a este cambio.

## Fuera de alcance

- **Cada mensaje recibido sigue cifrando la sesión completa.** `applyProtocolChanges` vuelve a sellar la sesión (~1 MB) cuando hay `protocolChanges`, que es casi siempre al recibir. El siguiente paso sería guardar los registros del protocolo como filas y actualizar solo los que cambian. Se decide midiendo en el dispositivo.
- No se añade un índice por `ciphertextHashBase64`: Go busca en la lista que recibe de `ReadState`.
