# Productos en core: primera versión web

Estado: alcance funcional acordado; diseño técnico pendiente de revisión.

## Objetivo

Permitir a cualquier usuario autenticado de una empresa crear, listar, consultar
y editar sus productos desde core. Esta entrega incluye persistencia, migración,
tipos, validaciones y pantallas web. No publica una API de productos para mobile.

El éxito se verifica creando un producto, encontrándolo en el listado, abriendo
su detalle y editándolo sin modificar sus existencias ni acceder a otra empresa.

## Decisiones acordadas

- Cada producto tiene al menos una variante. El alta web crea exactamente una,
  sin atributos; no existe un editor de variantes en esta versión.
- Nombre obligatorio y no único; descripción y una imagen opcionales.
- SKU opcional, único por empresa cuando exista, ignorando mayúsculas y espacios
  iniciales/finales. Vacío significa ausencia, sin generación automática.
- Precio de venta mayor que cero. Precio de compra opcional y no negativo.
  Ambos admiten como máximo dos decimales.
- El frontend envía la moneda explícitamente, tomando inicialmente la moneda
  del país de la empresa. No hay selector; el servidor valida monedas admitidas.
- Stock inicial opcional, entero no negativo, cero si se omite. Después del alta
  solo se consulta; no se puede ajustar ni editar desde este módulo.
- Producto y variante se crean activos, con identificadores QR propios e
  inmutables, distintos de sus IDs internos y del SKU.
- Edición de nombre, descripción, imagen, SKU y precios. Moneda, stock y QR
  permanecen iguales. La imagen se puede reemplazar o quitar.
- Listado sin fotos, con nombre, SKU, precio de venta y stock, búsqueda por nombre
  o SKU, paginación y orden de creación descendente.
- Detalle en una página propia, con foto, datos, precios, stock y acceso a editar.
- Crear y editar usan páginas propias y un formulario compartido. Guardar lleva
  al detalle; Cancelar no guarda cambios.
- Cualquier usuario de la empresa puede operar sus productos, sin roles nuevos.

Fuera del alcance: categorías (también su modelo y columna), varias variantes en
el formulario, selector de moneda, ajustes de stock, ventas, reservas, eliminar,
archivar, mostrar/descargar/imprimir QR y endpoints de productos para mobile.

## Modelo de datos propuesto

Las siguientes decisiones técnicas concretan el alcance para su revisión.

| Modelo | Campos principales |
| --- | --- |
| `Product` | `id` UUID, `companyId` UUID, `name`, `description` nullable, `imageId` UUID nullable, `currency`, `qrCode`, `status`, `createdAt`, `updatedAt` |
| `ProductVariant` | `id` UUID, `companyId` UUID, `productId` UUID, `attributes` JSON, `sku` nullable, `salePrice` decimal, `purchasePrice` decimal nullable, `qrCode`, `status` |
| `ProductStock` | `variantId` UUID como clave primaria, `companyId` UUID, `quantity` entero |

Relaciones: una empresa tiene muchos productos; un producto tiene muchas
variantes; cada variante tiene exactamente un registro de stock. El alta guarda
producto, variante con `attributes = {}` y stock en una única transacción. No se
declara `productId` único en variantes: la restricción de una variante pertenece
al formulario y al caso de uso inicial, no a la cardinalidad de la base.

La creación atómica y la ausencia de operaciones que eliminen variantes
garantizan al menos una variante en todos los flujos expuestos. La clave foránea
por sí sola no garantiza ese mínimo. Si en el futuro se permite eliminar
variantes, ese caso de uso deberá preservar la misma regla.

Cada tabla nueva incorpora `companyId`, relación a `Company` y RLS. Las relaciones
variante/producto, stock/variante y producto/imagen incluyen empresa en sus claves
foráneas compuestas, para impedir referencias entre empresas. Se añade la clave
compuesta necesaria a `Image` sin cambiar su contrato público.

### Representación y restricciones

- `sku`: recortar extremos; vacío a `null`; conservar mayúsculas para presentación.
  Un índice único por `companyId` y `lower(sku)` para valores no nulos protege
  tanto creación como edición concurrentes. No se eliminan espacios interiores.
- Precios: `Decimal(14,2)`, máximo `999999999999.99`. Validar precisión antes de
  guardar para no depender del redondeo de la base. Checks de venta positiva y
  compra nula o no negativa. Reutilizar `Money` en los tipos de dominio.
- Cantidad: entero entre cero y `2147483647`, límite de la columna de base de
  datos; validar antes de persistir y proteger con check no negativo.
- Límites propuestos: nombre de 1 a 200 caracteres tras recortar extremos, SKU
  hasta 100 y descripción hasta 5000. Descripción vacía se guarda como ausencia.
- Moneda: `PEN`, `USD`, `COP`, `ARS`, `CLP` o `BRL`, según el contrato compartido
  actual. Mapeo inicial del frontend: PE→PEN, US→USD, CO→COP, AR→ARS, CL→CLP,
  BR→BRL. El servidor valida el código recibido, sin derivarlo ni sustituirlo
  por el país; el contrato permite un futuro selector.
- Estado: solo `active` en esta entrega, protegido en dominio y almacenamiento.
- QR: propuesta de valores opacos `product:<UUID aleatorio>` y
  `variant:<UUID aleatorio>`, generados independientemente del ID interno. Índice
  único y check de prefijo en cada tabla; los prefijos separan ambos espacios y
  evitan colisiones entre tablas sin introducir un registro central de códigos.
  Es una decisión nueva para core; mobile actualmente genera UUID sin prefijo.
  No se modifica mobile ni se expone una integración en esta entrega.
- Índice de listado por empresa, fecha de creación e ID; el ID resuelve empates.

## Tipos, reglas y aplicación

El módulo vive en `apps/core/src/features/products`, con las responsabilidades
de dominio, aplicación e infraestructura descritas en las convenciones del repo.
Archivos pequeños pueden agrupar operaciones relacionadas.

Se definen tipos de producto, variante, stock, entrada de creación, entrada de
edición y criterios/resultados del listado. El producto mantiene una colección
de variantes; la entrada web inicial recibe los datos de una única variante.
La entrada de edición omite moneda, stock, QR y estado. El servidor solo escribe
campos permitidos, aunque un cliente manipule el formulario.

Operaciones: crear producto simple, listar productos, obtener detalle y editar
producto simple. Identidad de empresa proviene exclusivamente de la sesión.
Las reglas puras normalizan entradas y validan importes, cantidades y campos;
los casos de uso coordinan efectos; infraestructura traduce modelos y errores.

No importar el dominio privado de mobile: hoy exige SKU y permite categoría,
por lo que su contrato difiere del aprobado para core. Reutilizar los contratos
compartidos `Money` y `Result` y los módulos existentes de empresa e imágenes.
Una posterior integración mobile requerirá alinear estos contratos explícitamente.

La edición conserva IDs y modifica la variante existente. Si encuentra un
producto con más de una variante, no elige una arbitrariamente: muestra que el
formulario simple no soporta esa estructura y rechaza la operación. Todos los
productos creados por esta entrega tienen exactamente una variante.

## Persistencia y migración

Usar el cliente tenant existente y `withinTransaction` para las escrituras
relacionadas de producto, variante y stock. Una colisión de SKU o un fallo de
referencia revierte toda el alta o edición. No usar `systemPrisma` para productos.

Generar la migración con el procedimiento de
`.agents/skills/database-migrations/SKILL.md`:
actualizar el schema, generar con Prisma CLI, revisar el SQL y agregar las
restricciones, índices y políticas necesarios antes de aplicarla en desarrollo.
No escribir carpetas ni marcas de tiempo de migraciones manualmente.

Las tablas se crean con `ENABLE` y `FORCE ROW LEVEL SECURITY` y políticas basadas
en `app.company_id`, antes de conceder acceso al rol de la aplicación. Actualizar
`apps/core/scripts/provision-role.sql` con permisos y comprobación de propiedad.
No agregar lógica específica de productos al módulo genérico de aislamiento.

La entrega no migra productos de mobile ni datos de un catálogo previo: no hay
tablas de productos en el schema actual. La imagen existente sí requiere revisar
el costo del nuevo índice compuesto antes de aplicar la migración.

## Imagen

Reutilizar la subida y consulta existentes. El formulario sube la imagen, recibe
un `imageId` y lo envía al guardar el producto. Validar que pertenece a la misma
empresa, también mediante la referencia compuesta en base de datos.

En edición, distinguir conservar la imagen actual, sustituirla y quitarla
(`imageId = null`). No borrar automáticamente archivos remotos: el módulo actual
no ofrece eliminación pública ni limpieza de imágenes sin referencias. Cancelar
tras subir una imagen o fallar al guardar puede dejar una imagen sin asociar;
esa limitación existente se mantiene explícita. No sostener una transacción de
base de datos mientras se suben bytes al proveedor.

## Pantallas y navegación

Rutas propuestas bajo el locale autorizado de la empresa:

| Ruta | Comportamiento |
| --- | --- |
| `/:locale/products` | Tabla, búsqueda, paginación y botón Crear producto |
| `/:locale/products/new` | Formulario de creación |
| `/:locale/products/:productId` | Detalle y botón Editar |
| `/:locale/products/:productId/edit` | Formulario de edición |

Los loaders/actions web llaman los casos de uso directamente desde el servidor.
No se crean endpoints REST de productos. Se conserva el endpoint existente de
imágenes para la subida. Las escrituras mantienen autenticación y comprobación
del origen conforme al flujo web; no se acepta `companyId` del navegador.

El layout privado actual redirige cualquier URL distinta del dashboard al
dashboard. Corregir su normalización de locale para preservar ruta y consulta,
incluidas las pantallas de productos. Añadir Productos a navegación y actualizar
el elemento activo y la ubicación mostrada en la cabecera según la ruta.

El formulario muestra moneda como dato no editable y la envía al crear. Precio
de compra vacío significa ausencia; `0` es un valor válido. Stock vacío en el
alta significa cero. En edición las existencias solo se muestran como dato.
Cancelar creación vuelve al listado; cancelar edición vuelve al detalle.

Listado: búsqueda parcial sin distinguir mayúsculas en nombre o SKU, con espacios
extremos recortados. Parámetros `q` y `page` en URL; 20 filas por página y orden
`createdAt DESC, id DESC`. Reiniciar a página 1 al buscar. Consultar 21 filas para
determinar si hay siguiente página, sin prometer total ni una instantánea entre
navegaciones. Página inválida vuelve a 1; una página válida sin filas muestra
estado vacío y permite volver. No hacen falta índices de búsqueda especializados
para esta primera entrega.

El detalle muestra nombre, descripción, foto si existe, SKU o «Sin SKU», moneda,
precios y stock. Precio de compra ausente muestra «No registrado». No muestra QR.

Reutilizar tokens, componentes y estilos existentes, con etiquetas accesibles,
errores asociados a los campos, foco visible, mensajes de guardado y controles
deshabilitados durante el envío. La tabla admite desplazamiento horizontal en
pantallas estrechas. No cambiar el sistema visual del resto de core.

## Errores y consistencia

- Validación: conservar valores e indicar el campo que requiere corrección.
- SKU duplicado: mensaje en SKU; detectar también la restricción de base de datos.
- Producto ausente o de otra empresa: mismo resultado de no encontrado.
- Imagen inexistente o no perteneciente a la empresa: rechazar la asociación.
- Fallo de subida: conservar el formulario y permitir reintento; no guardar una
  referencia incompleta. Fallo de guardado: no mostrar éxito ni redirigir.
- Errores inesperados: registrarlos en servidor sin exponer detalles internos;
  distinguir un fallo del listado de un catálogo vacío.
- Ediciones simultáneas: la última escritura confirmada determina los campos
  editables. No se añade versionado optimista en este alcance; stock e IDs nunca
  forman parte de esas escrituras.

## Verificación y aceptación

Pruebas de dominio: límites de precios, precisión, stock, SKU opcional y
normalización, moneda admitida y campos permitidos de edición.

Integración con base de pruebas: creación atómica de las tres entidades,
rollback ante colisión de SKU, unicidad por empresa sin distinguir mayúsculas,
múltiples SKU nulos, misma clave en empresas diferentes, preservación de stock,
moneda y QR al editar y rechazo de referencias a imágenes ajenas. Comprobar el
alcance por empresa a través de los repositorios nuevos, reutilizando las
pruebas existentes para el mecanismo genérico RLS.

Prueba web del recorrido crear → listar/buscar → detalle → editar, con producto
sin foto ni SKU, campos opcionales y errores de SKU/precio/stock. Comprobar foto
opcional, reemplazo y desvinculación con una frontera de almacenamiento
controlada. Verificar que las rutas de productos sobreviven al layout privado y
que no se pueden modificar campos inmutables manipulando la solicitud.

Ejecutar las comprobaciones de tipos, lint y pruebas pertinentes de core según
las convenciones existentes. Validar la migración en una base de desarrollo o
pruebas y revisar visualmente formulario, tabla y detalle en escritorio y móvil.

## Referencias del repositorio

- `docs/architecture.md`, `docs/domain.md`, `docs/persistence.md`.
- `docs/rls-con-prisma.md`, `docs/testing-conventions.md`, `docs/images-api.md`.
- `apps/core/prisma/schema.prisma` y `apps/core/scripts/provision-role.sql`.
- `apps/core/app/routes/private-layout.tsx` y `apps/core/app/routes.ts`.
- `apps/mobile/src/features/products/domain/product.ts` como antecedente, no
  como contrato vinculante de esta nueva interfaz.
