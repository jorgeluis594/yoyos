# Prueba de bindings de whatsmeow

Esta prueba aislada compila whatsmeow en Go y genera bindings Java y Objective-C para una interfaz pequeña de callbacks de almacenamiento. No conecta una cuenta, no guarda credenciales y no implementa la API de producción.

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
- Capturar contexto de recepción antes del commit criptográfico, almacenar metadatos y enumerar pendientes para replay local.
- Vincular por QR y probar restauración y recepción en dispositivos reales.

La inspección de la versión fijada confirma que `store.BufferedEvent` solo contiene `Plaintext`, `InsertTime` y `ServerTime`. `store.EventBuffer` no ofrece enumeración de pendientes y el cliente no expone un hook de contexto de mensaje previo a su descifrado. Un evento `events.Message` ocurre después de la transacción, demasiado tarde para completar atómicamente los metadatos que exige el diseño.

Necesitaremos un hook acotado previo a `bufferedDecrypt` que permita incorporar cuenta, chat, identificador, dirección y formato del paquete al contexto de la transacción. La enumeración de pendientes será del almacenamiento nativo propio. La forma exacta del hook y la reconstrucción de eventos deben probarse antes de fijar un fork o patch de whatsmeow; no se han implementado aquí.

## Estado del entorno revisado

La prueba se ejecutó en macOS arm64 el 6 de octubre de 2026. Go y generación de ambos bindings pasaron.

Go 1.26.5 y JDK Temurin 17.0.20+8 están instalados mediante mise; no estaban seleccionados en el workspace. El directorio Android SDK contiene command-line tools, pero no NDK, platforms ni build-tools. Solo están disponibles las Command Line Tools de Apple; no Xcode completo.

Por eso no se generaron AAR ni XCFramework. Tampoco se validaron QR, persistencia, recuperación o ejecución Kotlin/Swift. Para continuar esas comprobaciones se necesitan los componentes Android de compilación y Xcode completo, además de dispositivos o simuladores.
