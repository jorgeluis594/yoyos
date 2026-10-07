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

Un error o un contexto nulo detiene esa llamada sin descifrar ni enviar ACK. El hook debe comunicar el error al wrapper, gestionar la pausa/reanudación y no lanzar un panic. Devolver error no implementa por sí solo una cola ni garantiza una reentrega remota. Sin hook, se conserva la ruta existente.

Ejecutar desde esta carpeta:

```sh
sh check-context-hook.sh
```

El script aplica el patch a una copia temporal de la dependencia fijada, añade el test de `testdata/`, ejecuta la prueba con detector de carreras y `go vet`, y elimina la copia. No modifica el caché de módulos ni cambia el `go.mod` de esta prueba. Usa la versión de Go seleccionada, desactivando para esos comandos la descarga del toolchain más nuevo que pide el módulo upstream.

La prueba recorre `decryptMessages` → `decryptDM` → `bufferedDecrypt` → `DoDecryptionTxn` → almacén Signal, y comprueba que cuenta, chat, ID, dirección, timestamp y formato llegan en el contexto. El almacén de prueba cancela antes de necesitar claves reales. Una llamada adicional a `bufferedDecrypt` con plaintext sintético verifica el contexto de `PutBufferedEvent` y la propagación de su error. También comprueba el rechazo del hook y la ruta sin hook. No prueba descifrado real, rollback, commit durable, ACK sobre una conexión ni reconstrucción de eventos.

La [ruta de recepción de la versión fijada](https://github.com/tulir/whatsmeow/blob/9399289b022b/message.go) contiene rutas que envían ACK ante errores generales de descifrado, incluidos errores devueltos por el almacenamiento; también envía ACK en su recuperación de panic. Antes de producción habrá que distinguir fallos locales y detener esas rutas sin confirmar el mensaje. `SynchronousAck` y este hook no bastan para ello.

El patch queda como propuesta reproducible; todavía no elegimos mantener un fork ni integrarlo en el módulo móvil. La enumeración de pendientes será del almacenamiento nativo propio. Siguen pendientes la serialización por hijo/ciphertext, la reconstrucción de eventos v2/v3, el almacenamiento cifrado y las pruebas de caída.

## Estado del entorno revisado

La prueba se ejecutó en macOS arm64 el 6 de octubre de 2026. Go y generación de ambos bindings pasaron.

Go 1.26.5 y JDK Temurin 17.0.20+8 están instalados mediante mise; no estaban seleccionados en el workspace. El directorio Android SDK contiene command-line tools, pero no NDK, platforms ni build-tools. Solo están disponibles las Command Line Tools de Apple; no Xcode completo.

Por eso no se generaron AAR ni XCFramework. Tampoco se validaron QR, persistencia, recuperación o ejecución Kotlin/Swift. Para continuar esas comprobaciones se necesitan los componentes Android de compilación y Xcode completo, además de dispositivos o simuladores.
