# Latencia al confirmar mensajes de WhatsApp en el móvil

**Estado:** resuelto con el refactor de `docs/whatsapp-refactor-cola-recuperacion.md`. El estado nativo pasa a una base SQLite y confirmar un mensaje borra una fila, en lugar de reescribir `state.bin`.

Diagnóstico del 2026-10-13 sobre un Android físico (Samsung, build debug) con una cuenta de WhatsApp con historial grande. Cada mensaje tardaba entre 7 y 12 segundos en confirmarse, la sincronización con el servidor avanzaba a un mensaje cada 10–15 segundos y la vinculación por QR falló mientras se vaciaba la cola.

## Qué es "confirmar" un mensaje

Un mensaje recibido recorre estos pasos dentro del móvil:

1. **Recepción.** WhatsApp entrega el mensaje cifrado y el módulo Go (whatsmeow) lo descifra.
2. **Cola de recuperación.** Antes de avisar a WhatsApp de que lo recibió, Go guarda el mensaje en la cola de recuperación (`pending`). Lo hace en la misma escritura durable que las claves de cifrado que cambiaron al descifrarlo (`applyProtocolChanges` con `pendingInserts`). Si la app muere a mitad de camino, el mensaje no se pierde: WhatsApp no lo reenviará, pero sigue en la cola.
3. **Entrega a JavaScript.** La app recibe el evento (`message_received`) y guarda el mensaje en su propia base SQLite (`yoyos-whatsapp.db`). De ahí salen "Ver conversaciones" y la sincronización con core.
4. **Confirmación.** La app llama a `confirmMessageStored(id)`: "ya lo tengo en mi base, quítalo de la cola". Go llama a `DeliveryStorage.RetirePending` y el módulo nativo borra la entrada de la cola.

Mientras no se confirma, el mensaje existe en los dos sitios. La confirmación cierra el traspaso y evita que se procese dos veces.

## Por qué tarda

La cola de recuperación no tiene almacenamiento propio: es el arreglo `pending` dentro de `state.bin`, el mismo archivo cifrado que guarda la sesión y las claves del protocolo (en el dispositivo medía unos 1,08 MB). Para quitar una sola entrada, `NativeStateStore.retirePending` llama a `commit`, que reescribe el estado completo:

1. `open()` lee y descifra `state.bin` entero.
2. Copia el estado como JSON varias veces (`JSONObject(state.toString())` en `open` y en `commit`).
3. `validateState` valida el estado nuevo completo.
4. `publish` lo vuelve a cifrar (AES con clave del Android Keystore, que está en hardware) y lo escribe con `fsync`. `writeRecord` escribe además el registro de control con otro `fsync`.

El coste de cada confirmación es proporcional al tamaño de todo el estado, no al del mensaje. Al vaciar una cola de N mensajes se reescribe el archivo N veces, así que el coste total crece de forma cuadrática. En el log del dispositivo se ven decenas de recolecciones de basura seguidas que liberan objetos grandes de 40 a 110 MB, lo que encaja con copias repetidas de todo el estado.

Todo `commit` se ejecuta con `GLOBAL_LOCK` tomado.

## Evidencia observada

Extracto de `adb logcat` tras volver a vincular a las 01:30 (hora de Lima):

```
01:30:04.016 native call confirmMessageStored
01:30:16.080 native done confirmMessageStored  {"success":true}   ← 12,1 s
01:30:18.072 native call confirmMessageStored
01:30:26.536 native done confirmMessageStored  {"success":true}   ← 8,5 s
01:30:28.543 native call confirmMessageStored
01:30:37.835 native done confirmMessageStored  {"success":true}   ← 9,3 s
01:30:39.477 native call confirmMessageStored
01:30:47.249 native done confirmMessageStored  {"success":true}   ← 7,8 s
01:31:10.280 native call confirmMessageStored
01:31:17.822 native done confirmMessageStored  {"success":true}   ← 7,5 s
01:30:10.954 connection_changed awaitingQr
01:31:27.434 library_error CONNECTION_FAILED                      ← falla la vinculación por QR
```

La desvinculación (`logout`) también tardó unos 42 segundos con la misma actividad de memoria, y acabó en `REMOTE_LOGOUT_UNCONFIRMED`.

## Impacto

- **Sincronización lenta.** El servidor recibe como mucho un mensaje cada ~10 s mientras la cola tenga trabajo. Un historial de cientos de mensajes tarda decenas de minutos. Un mensaje nuevo (por ejemplo, la foto de un QR de producto) queda detrás de todo el historial pendiente.
- **Vinculación por QR que falla.** Probablemente el emparejamiento necesita guardar la sesión nueva y espera a que se libere `GLOBAL_LOCK`. WhatsApp no recibe respuesta a tiempo y corta (`CONNECTION_FAILED`); en el teléfono la vinculación se queda en "sincronizando".
- **Desvinculación lenta.** `logout` espera detrás de la misma cola.
- **Memoria y batería.** Copiar y cifrar un estado de 1 MB varias veces por mensaje genera mucha presión de memoria.

## Qué no está medido

- No se han medido tiempos dentro de `commit`. Que el tiempo se vaya en descifrar, validar, cifrar o hacer `fsync` sale de leer el código y del patrón de memoria, no de una medición.
- Que la vinculación falle por esperar a `GLOBAL_LOCK` es una hipótesis. Solo se ha observado que falla mientras la cola se vacía.
- No se sabe cuántas entradas tenía la cola, porque `state.bin` está cifrado.
- No se ha probado en iOS.

## Propuesta

1. **Medir primero.** Registrar en Kotlin la duración de cada fase de `commit` (abrir, validar, cifrar, escribir) y el tiempo de espera de `GLOBAL_LOCK` en `retirePending` y en el guardado de la sesión durante el emparejamiento. Solo códigos y milisegundos, nunca contenido. El código Go no puede registrar nada (`TestITSEG01GoSourcesNeverLogOrPrint`), así que la medición va en el lado nativo.
2. **Separar la cola de recuperación de la sesión.** Guardar cada entrada de `pending` en su propio registro durable (un archivo cifrado por entrada o una tabla), conservando la garantía actual: la entrada se crea en la misma operación atómica que los cambios de protocolo que la originan. Con eso, confirmar es borrar un registro, sin reescribir `state.bin`, y la sesión solo se reescribe cuando cambian claves o datos de la sesión.
3. **No bloquear el emparejamiento.** Con el punto 2, `GLOBAL_LOCK` deja de quedar ocupado durante segundos. Si la medición confirma la espera, valorar que el guardado de la sesión durante la vinculación tenga prioridad sobre el vaciado de la cola.

El punto 2 cambia el contrato de almacenamiento durable (WA-02) y sus pruebas de seguridad. Hay que revisarlo contra `docs/whatsmeow-go-expo-implementation.md` antes de implementarlo.

## Mientras tanto

- Dejar la app abierta hasta que termine de vaciar la cola antes de vincular por QR.
- Si la vinculación falla, esperar a que no haya actividad de `confirmMessageStored` en el log y pedir un QR nuevo.
