# Auditoría del flujo de imágenes

Fecha: 2026-09-24. Estado: issues 1–3 implementados; issues 4–6 pendientes.

## Alcance y situación actual

Se revisaron las rutas HTTP, autenticación, aislamiento por empresa, persistencia,
adaptador R2, contratos compartidos, consumidores web/mobile y pruebas.

El flujo implementado es:

```text
Sesión + empresa autorizada
  → POST /api/images con un archivo multipart
  → validación de tamaño, MIME y firma
  → subida a R2
  → creación del registro Image
  → respuesta { id, url }

GET /api/images/:id
  → búsqueda por empresa e identificador
  → construcción de URL pública
  → respuesta { id, url }
```

Todavía no existen consumidores de esta API en web/mobile ni asociaciones
persistidas entre una entidad de negocio y `Image`.

La arquitectura puede mantenerse: casos de uso pequeños, dependencias explícitas,
repositorio local y adaptador de almacenamiento. La autenticación, RLS, filtro por
empresa, límite de 10 MB, claves opacas y compensación ante fallo de persistencia
ya están implementados.

Las URLs públicas son una decisión explícita, no un fallo de autorización: la
sesión protege la consulta de metadatos, pero quien conoce una URL puede descargar
el objeto. Este módulo no debe usarse para documentos privados sin definir otro
contrato de acceso.

## Orden de implementación

| Orden | Issue | Prioridad |
| --- | --- | --- |
| 1 | Contratos HTTP y errores incompatibles | Alta, antes de conectar clientes |
| 2 | Se aceptan archivos que no son imágenes completas | Alta, antes de habilitar subidas reales |
| 3 | Persistencia fuera del patrón de Result | Media, junto con los errores HTTP |
| 4 | Configuración y construcción de URLs | Media, antes de desplegar |
| 5 | Integración con productos y clientes | Necesaria para completar la funcionalidad |
| 6 | Limpieza de imágenes sin referencias | Necesaria para operar el flujo completo |

## 1. Contratos HTTP y errores incompatibles

### Evidencia e impacto

Las [rutas de imágenes](../apps/core/src/shared/images/presentation/routes.ts)
devuelven errores con `{ error }`, mientras el
[contrato compartido](../shared/contracts/registration.ts) exige `{ code, error }`.
El [cliente móvil](../apps/mobile/src/shared/infrastructure/api-client.ts) valida
ese contrato y convertiría los errores propios de imágenes en `INVALID_RESPONSE`.
Esto afecta a archivos inválidos, exceso de tamaño, imágenes inexistentes y fallos
del almacenamiento. Los errores de autenticación emitidos por el middleware sí
usan el contrato común.

Las respuestas exitosas `{ id, url }` tampoco se validan mediante un esquema Zod
compartido, a diferencia de lo exigido por
[programming-style.md](programming-style.md).

### Solución

1. Crear `shared/contracts/images.ts` con el esquema de respuesta `{ id, url }` y
   sus tipos inferidos. Validar UUID y URL HTTP/HTTPS apta para mostrar imágenes.
2. Reutilizar el formato común `{ code, error }`. Ampliar los códigos necesarios
   para imágenes y usar el helper `apiError` en todas las salidas de error.
3. Validar las respuestas exitosas en la frontera HTTP antes de enviarlas. Un
   resultado interno inválido debe registrarse y responder como error interno.
4. Adaptar el transporte móvil para conservar o traducir los nuevos errores de
   forma explícita. Agregar únicamente códigos al esquema no resuelve su mapeo.
5. Validar también la respuesta en el futuro adaptador de imágenes de cada cliente.
   La entrada multipart mantiene su validación específica; no necesita convertirse
   artificialmente en JSON.

Mapeo propuesto:

| Caso | HTTP | Código |
| --- | --- | --- |
| Multipart incorrecto, archivo inválido o formato no admitido | 400 | `INVALID_IMAGE` |
| Archivo o petición demasiado grandes | 413 | `IMAGE_TOO_LARGE` |
| Tipo de petición distinto de multipart | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Imagen inexistente o de otra empresa | 404 | `NOT_FOUND` |
| Fallo del proveedor de almacenamiento | 502 | `IMAGE_STORAGE_UNAVAILABLE` |
| Persistencia no disponible | 503 | `SERVICE_UNAVAILABLE` |
| Configuración interna inválida o respuesta interna inválida | 500 | `INTERNAL_ERROR` |

### Verificación

- Comprobar cuerpo y estado HTTP de cada error, no solamente el estado.
- Pasar un error de imágenes por el cliente móvil y verificar que no se convierta
  en `INVALID_RESPONSE` por falta de `code`.
- Rechazar respuestas exitosas con ID o URL inválidos.
- Mantener el mismo `404` para una imagen inexistente y una ajena.

## 2. Se aceptan archivos que no son imágenes completas

### Evidencia e impacto

`actualType` en las [rutas](../apps/core/src/shared/images/presentation/routes.ts)
comprueba solamente los primeros 3, 8 o 12 bytes. Una firma válida no garantiza
que el resto del archivo sea una imagen decodificable.

El [test de integración](../apps/core/src/shared/images/presentation/routes.test.mjs)
obtiene `201` con un supuesto PNG de nueve bytes. No contiene una imagen completa.
Además, el límite de 10 MB no limita la cantidad de píxeles al decodificar.

### Solución

1. Mantener el límite del cuerpo antes del procesamiento y el límite del archivo.
2. Validar el contenido con un decodificador mantenido que soporte JPEG, PNG y
   WebP. Revisar dependencias disponibles antes de incorporar una nueva; no escribir
   parsers propios para estos formatos.
3. Configurar un límite explícito de píxeles antes de decodificar y verificar el
   contenido completo. Leer únicamente la firma o los metadatos no cierra el issue.
4. Rechazar archivos truncados, corruptos, vacíos o cuyo formato detectado no
   coincida con el declarado. No subirlos a R2 ni crear registros locales.
5. Definir los límites de dimensiones/píxeles según el uso de fotos de producto y
   documentarlos junto con los 10 MB. Si se admiten imágenes animadas, aplicar
   límites al procesamiento de sus cuadros; en caso contrario, rechazarlas
   explícitamente.

No hace falta agregar variantes, miniaturas o transformaciones configurables para
resolver la validación. La conversión de formatos de cámara se define al conectar
el selector móvil.

### Verificación

- Reemplazar el fixture exitoso por una imagen real pequeña.
- Probar imágenes válidas de cada formato admitido.
- Rechazar firmas aisladas, truncamientos, MIME incorrecto y exceso de píxeles.
- Verificar que los rechazos no invoquen almacenamiento ni persistencia.

## 3. Persistencia fuera del patrón de Result

**Estado: resuelto.** `ImageRepository.create` y `find` devuelven `Result`;
los errores conocidos de Prisma producen `PERSISTENCE_UNAVAILABLE` y las
excepciones inesperadas llegan al manejador global. La subida compensa los
fallos de creación y de obtención de URL sin ocultar el fallo original.

### Evidencia e impacto originales

El [repositorio](../apps/core/src/shared/images/infrastructure/image-repository.ts)
devolvía directamente las promesas de Prisma. Una indisponibilidad de base de
datos producía una excepción y terminaba como `500` genérico.

Los módulos recientes traducen errores técnicos conocidos a `Result`, por ejemplo
`PERSISTENCE_UNAVAILABLE`. Antes, el
[caso de uso](../apps/core/src/shared/images/application/images.ts) compensaba una
creación fallida dentro de `catch`, por lo que cambiar solamente el repositorio
habría dejado incompleto el manejo de compensación.

### Solución

1. Cambiar `ImageRepository.create` y `find` para devolver `Result` con errores
   identificables. Una búsqueda sin coincidencia sigue siendo éxito con `null`.
2. Traducir errores técnicos conocidos en el adaptador y conservar el diagnóstico
   en logs internos. No convertir cualquier fallo en ausencia de imagen.
3. En `uploadImage`, compensar tanto un `Result` fallido de creación como una
   excepción inesperada. Devolver el error original aunque la compensación falle.
4. En `getImage`, propagar el fallo del repositorio sin intentar construir la URL.
5. Mapear los errores en HTTP conforme al issue 1. Mantener el manejo global de
   excepciones para fallos inesperados.

La subida remota debe continuar fuera de una transacción de negocio que pueda
revertirse después. El flujo previsto sube primero y asocia después; envolverlo
todo en `withinTransaction` no hace transaccional a R2 y podría dejar un objeto
remoto sin registro si el commit posterior falla.

### Verificación

- Crear registro falla: se intenta borrar el objeto y se conserva el error original.
- Compensación falla o lanza excepción: se registra sin ocultar el fallo inicial.
- Consulta falla: devuelve error de servicio, no `404`.
- Añadir cobertura para fallos al obtener la URL, cuya compensación ya existe.

Verificado: 18 pruebas unitarias de imágenes, lint y typecheck de `apps/core`,
y 5 pruebas de integración con la base aislada. La integración confirma
`503 SERVICE_UNAVAILABLE` ante un fallo de consulta y el intento de borrado remoto
cuando falla la creación del registro.

## 4. Configuración y construcción de URLs

### Evidencia e impacto

El [adaptador R2](../apps/core/src/shared/images/infrastructure/r2-image-storage.ts)
acepta `R2_PUBLIC_BASE_URL` usando solamente `URL.canParse` y concatena la clave.
Se reprodujo este resultado:

```text
Base:      https://images.example.test?version=1
Clave:     abc
Resultado: https://images.example.test?version=1/abc
```

La clave queda dentro del query, en lugar de identificar el objeto. Tampoco se
restringe el protocolo. Además, `getUrl` exige que exista el cliente S3 y todas sus
credenciales, aunque solo construye una URL pública.

### Solución

1. Validar la configuración una vez al componer el adaptador.
2. Definir la base pública como URL HTTP/HTTPS sin credenciales, query ni fragmento;
   exigir HTTPS en producción. Definir explícitamente si se permiten prefijos de
   ruta y conservarlos al agregar la clave.
3. Normalizar la barra final y construir la URL con la clave codificada.
4. Separar la configuración necesaria para mostrar URLs de la requerida para
   subir o eliminar objetos. `getUrl` no debe depender de credenciales de escritura.
5. Validar también el endpoint de almacenamiento y distinguir configuración
   inválida de indisponibilidad del proveedor. No exponer credenciales en errores.

### Verificación

- Base con y sin barra final: ambas producen la misma URL.
- Query, fragmento, credenciales o protocolo inválido: configuración rechazada.
- Prefijo de ruta, si está admitido: se conserva correctamente.
- Sin credenciales de escritura: la URL pública puede resolverse; subir o eliminar
  devuelve un error explícito de configuración.

## 5. Integración pendiente con productos y clientes

### Evidencia e impacto

No hay selección de archivos, subida ni adaptador consumidor de `/api/images` en
web/mobile. Tampoco hay una relación persistida de producto a `Image`.

El [producto móvil](../apps/mobile/src/features/products/domain/product.ts) define
`photo?: string`, que [generateProduct](../apps/mobile/src/features/products/application/generate-product.ts)
copia sin establecer si contiene un ID, una URL o una URI local. La
[decisión del módulo](images-api.md) exige persistir `imageId`.

### Solución

1. Definir el contrato de producto con `imageId: string | null` para la asociación
   persistente. Usar `{ id, url } | null` cuando el cliente necesite mostrarla.
   Mantener la URI temporal del selector dentro del estado del formulario.
2. Implementar el adaptador de subida con el transporte autenticado existente y
   los esquemas compartidos. Enviar un único campo multipart `file`.
3. Incorporar selección, previsualización, estado de subida, error y reintento en
   las pantallas que realmente consuman imágenes. Asegurar que el selector móvil
   entregue un formato admitido o lo convierta antes de subir.
4. Subir primero; guardar la entidad con el ID recibido después. Si falla guardar
   la entidad, conservar ese ID para reintentar sin volver a subir el mismo archivo.
5. En el servidor, verificar existencia y pertenencia de la imagen a la empresa
   autorizada. Un ID enviado por el cliente no es una autorización.
6. Persistir la relación con una clave foránea siguiendo la skill de migraciones.
   Al implementar limpieza, coordinar asociación y borrado para evitar carreras.
7. Para reemplazar, guardar la asociación nueva antes de considerar el borrado de
   la anterior. Para retirar, guardar `null`; eliminar el objeto únicamente cuando
   ya no tenga referencias autorizadas, según el issue 6.

### Verificación

- Crear producto sin imagen y con imagen propia.
- Rechazar ID inexistente o perteneciente a otra empresa.
- Reemplazar o retirar la imagen sin perder la anterior si guardar falla.
- Cancelar el formulario y reintentar un guardado fallido.
- Verificar selección, subida y visualización con un archivo real en cada cliente.

## 6. Limpieza de imágenes sin referencias

### Evidencia e impacto

El borrado solo se usa como compensación de errores durante la subida. Una subida
exitosa abandonada permanece almacenada. Un cierre del proceso entre R2 y la base
de datos puede dejar un objeto sin registro; una compensación fallida solo genera
un log. No existen limpieza programada ni reconciliación.

Es una limitación reconocida en [images-api.md](images-api.md), no una garantía
existente que haya dejado de funcionar.

### Solución

1. Definir una ventana de retención para subidas todavía no asociadas, de modo que
   no se borren imágenes de formularios abiertos o reintentos válidos.
2. Una vez que existan las asociaciones, implementar limpieza de registros antiguos
   sin referencias. No se necesita un endpoint público de borrado para empezar.
3. Coordinar limpieza y asociación mediante una condición persistente que impida
   asociar una imagen seleccionada para borrado. Por ejemplo, marcarla para
   eliminación en una transacción breve y rechazar nuevas asociaciones a ese
   estado. No mantener una transacción abierta mientras se llama a R2.
4. Borrar el objeto y después el registro marcado. Si el proveedor falla, conservar
   la marca para reintentar; si el proceso se interrumpe tras borrar el objeto,
   repetir el borrado debe ser seguro.
5. Para objetos sin registro, definir una reconciliación periódica entre claves
   almacenadas y registros locales, con una antigüedad mínima superior a una subida
   normal. Limitarla al bucket o prefijo que pertenezca exclusivamente a este módulo.
6. Registrar fallos y permitir reejecutar la limpieza. Evitar introducir una cola o
   un sistema de eventos si una tarea programada satisface el volumen real.

No aplicar una expiración indiscriminada al bucket: también eliminaría imágenes
que siguen asociadas a productos.

### Verificación

- Conservar imágenes referenciadas y subidas recientes sin asociación.
- Eliminar subidas abandonadas después del período definido.
- Reintentar tras fallo de R2 o interrupción entre borrado remoto y local.
- Probar asociación concurrente con limpieza: no debe quedar una referencia rota.
- Reconciliar únicamente objetos antiguos y pertenecientes al módulo.

## Validación realizada y límites

- `pnpm --dir apps/core test:unit src/shared/images`: 18 tests aprobados.
- Desde `apps/core`, `sh scripts/run-tests.sh integration`: 5 tests aprobados,
  incluido el escenario de imágenes con autenticación, RLS y compensación.
- Comprobación local: `{ error: "Unsupported image" }` no satisface el esquema
  común de errores.
- Comprobación local: base con query produce una URL incorrecta; la falta de
  credenciales de escritura bloquea `getUrl`.

Las pruebas simulan R2. No verifican credenciales reales, bucket, dominio público
ni descarga y visualización de un objeto real. La prueba que aceptaba un PNG
incompleto fue reemplazada por una imagen válida y casos de rechazo.

Antes de considerar completo el trabajo, actualizar [images-api.md](images-api.md)
con los contratos, límites y reglas de limpieza implementados, y ejecutar una
prueba controlada de subida y visualización contra el almacenamiento configurado.

## Fuera de esta corrección

No se requiere reescribir el módulo, introducir un framework de repositorios,
subidas directas al proveedor, variantes configurables o un sistema de eventos.
La compresión, miniaturas y eliminación de metadatos necesitan requisitos
explícitos; no son necesarias para corregir los contratos y la validación aquí
identificados.
