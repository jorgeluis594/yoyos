# Prueba de bindings de whatsmeow

Esta prueba aislada compila whatsmeow en Go, genera bindings Java y Objective-C y comprueba un hook candidato para transportar metadatos antes del descifrado. No conecta una cuenta, no guarda credenciales y no implementa la API de producción.

## Versiones probadas

| Dependencia | Versión |
| --- | --- |
| Go | `1.26.5` |
| whatsmeow | `v0.0.0-20261006124319-9399289b022b` |
| golang.org/x/mobile | `v0.0.0-20260908204917-8b95e45f8d3e` |

`go.mod` y `go.sum` fijan la resolución. `gobind` está declarado como herramienta del módulo; no hace falta instalarlo globalmente. Estas versiones son candidatas para la integración, no una matriz Android/iOS ya validada.

## Ejecutar

Desde esta carpeta, con Go 1.26.5:

```sh
go test ./bridge
go vet ./bridge
go tool gobind -lang=java -outdir=generated/java ./bridge
go tool gobind -lang=objc -outdir=generated/objc ./bridge
```

Si Go está instalado mediante mise pero el workspace no lo selecciona, anteponer `mise exec go@1.26.5 --` a cada comando.

La prueba verifica que se puede construir el cliente sin conectarlo, rechazar una entrada de probe inválida y propagar un error del callback Go. Los archivos generados quedan excluidos de Git.

Los checks del módulo apuntan a `./bridge`. Una ejecución de `go test ./...` tras generar bindings también intenta compilar el código auxiliar Objective-C de `generated/` y falla por falta de `seq.h`: esa generación todavía no constituye un paquete nativo listo para compilar.

En Java, el callback se genera como:

```java
void commit(String snapshot) throws Exception;
```

En Objective-C, se genera como:

```objc
- (BOOL)commit:(NSString *)snapshot error:(NSError **)error;
```

Esas firmas permiten representar el error en el adaptador Kotlin/Swift. La generación no demuestra que la excepción atraviese correctamente la frontera en ejecución; esa prueba requiere el binario y la plataforma real.

## Qué falta validar

- Compilar AAR y XCFramework e invocarlos desde Expo.
- Ejecutar un callback nativo que falla y comprobar el error recibido en Go.
- Implementar el almacenamiento cifrado y probar el commit durable frente a cierres forzados.
- Completar la serialización del contexto de recepción, almacenar metadatos y enumerar pendientes para replay local.
- Vincular por QR y probar restauración y recepción en dispositivos reales.

La inspección de la versión fijada confirma que `store.BufferedEvent` solo contiene `Plaintext`, `InsertTime` y `ServerTime`. `store.EventBuffer` no ofrece enumeración de pendientes y el cliente no expone un hook de contexto de mensaje previo a su descifrado. Un evento `events.Message` ocurre después de la transacción, demasiado tarde para completar atómicamente los metadatos que exige el diseño.

## Prueba del contexto previo al descifrado

`pre-decrypt-context.patch` propone un único hook Go opcional en el cliente:

```go
PreDecryptMessage func(context.Context, *types.MessageInfo, *waBinary.Node) (context.Context, error)
```

Se ejecuta al entrar en `decryptMessages`, antes de la migración de sesión y del descifrado. El wrapper podrá copiar y serializar los metadatos del mensaje y de sus hijos `enc` en un contexto derivado. La cuenta provendrá del cliente activo. No deberá modificar ni conservar los punteros recibidos. Cada hijo puede tener un formato distinto: no se debe asumir que un formato del nodo padre identifica todos sus plaintexts. Este hook es interno a Go; no se expone mediante gobind ni a Expo.

Un error o un contexto nulo detiene esa llamada sin descifrar ni enviar ACK. El hook debe comunicar el error al wrapper y gestionar la pausa/reanudación. Se ejecuta dentro de la protección de panic de recepción. Devolver error no implementa por sí solo una cola ni garantiza una reentrega remota. Sin hook, se conserva el transporte del contexto existente.

Ejecutar desde esta carpeta:

```sh
sh check-context-hook.sh
```

El script aplica el patch a una copia temporal de la dependencia fijada, añade el test de `testdata/`, ejecuta la prueba con detector de carreras y `go vet`, y elimina la copia. No modifica el caché de módulos ni cambia el `go.mod` de esta prueba. Usa la versión de Go seleccionada, desactivando para esos comandos la descarga del toolchain más nuevo que pide el módulo upstream.

La prueba recorre `decryptMessages` → `decryptDM` → `bufferedDecrypt` → `DoDecryptionTxn` → almacén Signal, y comprueba que cuenta, chat, ID, dirección, timestamp y formato llegan en el contexto. El almacén de prueba cancela antes de necesitar claves reales. Una llamada adicional a `bufferedDecrypt` con plaintext sintético verifica el contexto de `PutBufferedEvent` y la propagación de su error. También comprueba el rechazo del hook y la ruta sin hook. No prueba descifrado real, rollback, commit durable, ACK sobre una conexión ni reconstrucción de eventos.

## Prueba de fallos locales sin confirmación al protocolo

La [ruta de recepción de la versión fijada](https://github.com/tulir/whatsmeow/blob/9399289b022b/message.go) envía ACK ante ciertos errores generales de descifrado y en su recuperación de panic. El mismo patch ahora incorpora `store.ErrLocalStorage`, una marca Go para fallos locales de persistencia o capacidad. El adaptador propio deberá devolver errores que la envuelvan desde todas sus operaciones fallidas, incluyendo lectura, escritura, inicio/commit/rollback de transacción y almacenes usados por Signal:

```go
return fmt.Errorf("native commit: %w: %w", store.ErrLocalStorage, cause)
```

Es una extensión candidata de la dependencia; no existe en la versión original ni en el probe de bindings `bridge/`. Una ausencia válida de sesión o un error del protocolo no deben marcarse como fallo de disco. La marca permite conservar la causa para `errors.Is` sin depender de comparar mensajes de texto. El wrapper comunicará códigos públicos sanitizados y no enviará esa causa a Expo.

`decryptMessages` detiene los errores marcados antes de las rutas de ACK, reintento o `UndecryptableMessage`, con prioridad incluso si un error compuesto incluye un error de contador del protocolo. Un fallo al retirar plaintext del buffer también detiene la confirmación final. Con `EnableDecryptedEventBuffer`, la recuperación de panic no confirma y sus diagnósticos omiten el valor del panic. Un consumidor que hace panic devuelve fallo de entrega y no provoca que se limpie el pendiente; esto corrige la recuperación de `dispatchEvent` en su punto común.

`check-context-hook.sh` ejecuta también `TestRecoveryStorageFailure`. Se prueban las rutas de lectura del buffer, transacción, acceso Signal, error compuesto, limpieza y panic del hook/recepción/consumidor, con ACK síncrono y asíncrono. Un control de protocolo conserva su ACK, evento y contador de reintentos. Las pruebas usan un cliente desconectado: detectan intentos de ACK/receipt mediante los avisos de envío fallido y observan eventos y reintentos; no prueban paquetes en una conexión real. Para escritura/commit se comprueba aparte la propagación de la marca con plaintext sintético. Al retirar la guarda de fallos locales, el caso de lectura falla por intentar confirmar o reintentar.

Esta política depende de que el adaptador marque los errores. No clasifica automáticamente errores de stores ajenos ni implementa rollback, pausa global o descarte del estado en memoria.

## Propagación de fallos auxiliares y cierre de recepción

El patch devuelve ahora los errores de lectura LID, migración PN/LID y escritura de secretos del mensaje. En la recepción v2, un fallo de secretos detiene el proceso antes del evento `Message`, conservando el contenido del buffer. La ausencia válida de LID conserva su comportamiento. Se adaptaron todos los callers de los helpers modificados, incluyendo envío, reintentos y `DangerousInternalClient`; algunas firmas de esa API interna cambian en el candidato. Esto mantiene consistente el cambio de dependencia y no añade un método público de envío a Expo.

También propone un callback interno Go:

```go
MessageReceiveFinished func(context.Context, *types.MessageInfo, error)
```

Se invoca una vez al salir de `decryptMessages`, incluso cuando falla la preparación o se recupera un panic con el buffer activado. Recibe errores locales conservando la causa, `ErrMessageReceivePanic` para panic de recepción y `ErrMessageDeliveryFailed` para fallo del consumidor. El callback no deberá bloquear, lanzar panic ni conservar punteros prestados. Un error nulo indica que esa llamada terminó por una ruta normal; no demuestra entrega a Expo ni un ACK enviado, especialmente con ACK asíncrono.

El controlador podrá usar `PreDecryptMessage` para admitir una operación y el callback final para cerrar esa admisión, reportar el fallo y despertar su proceso de parada. Liberará la admisión solo si fue adquirida. La desconexión, espera de operaciones y restauración se harán fuera de esos callbacks. La integración debe registrar también el fallo en el propio store, porque existen tareas y escrituras anteriores al hook o fuera de la recepción.

Los tests comprueban notificación única en las rutas cubiertas, rechazo previo al descifrado tras errores PN/LID, causa y clasificación conservadas, y ausencia de entrega/limpieza/ACK ante fallo de secretos v2. Los errores auxiliares simulados son errores de store sin marca previa; el helper los clasifica. Estas comprobaciones usan stores controlados y no implementan el controlador ni prueban migración real, v3, persistencia, concurrencia entre clientes o recuperación tras caídas.

La auditoría continúa pendiente para `StoreLIDPNMapping` previo al hook, grupos, tareas de sincronización y partes de protocolo/v3. El formato recuperable deberá permitir repetir el procesamiento necesario de secretos/protocolo antes de entregar el pendiente a Expo; el callback posterior no amplía la transacción de descifrado ni demuestra que todas las escrituras formen ya un único commit.

El patch queda como propuesta reproducible; todavía no elegimos mantener un fork ni integrarlo en el módulo móvil. La enumeración de pendientes será del almacenamiento nativo propio. Siguen pendientes la serialización por hijo/ciphertext, la reconstrucción de eventos v2/v3, el almacenamiento cifrado y las pruebas de caída.

## Estado del entorno revisado

La prueba se ejecutó en macOS arm64 el 6 de octubre de 2026. Go y generación de ambos bindings pasaron.

Go 1.26.5 y JDK Temurin 17.0.20+8 están instalados mediante mise; no estaban seleccionados en el workspace. El directorio Android SDK contiene command-line tools, pero no NDK, platforms ni build-tools. Solo están disponibles las Command Line Tools de Apple; no Xcode completo.

Por eso no se generaron AAR ni XCFramework. Tampoco se validaron QR, persistencia, recuperación o ejecución Kotlin/Swift. Para continuar esas comprobaciones se necesitan los componentes Android de compilación y Xcode completo, además de dispositivos o simuladores.
