# Ventas manuales en core

Definiciones de producto y arquitectura acordadas para la primera versión del flujo de ventas manuales, tipo POS.

## Objetivo y alcance

Permitir que un vendedor registre una venta que se cobra y se entrega en el momento. Una venta completada queda cobrada y entregada.

Este documento define el comportamiento del producto, la persistencia, los tipos y los casos de uso. Describe el diseño acordado; no implica que el módulo ya esté implementado.

## Flujo de venta

1. **Agregar productos.** El vendedor busca productos por nombre, selecciona la variante cuando corresponda e indica las cantidades.
2. **Asociar un cliente, opcionalmente.** La venta usa “público general” por defecto. El vendedor puede asociar un cliente si lo necesita.
3. **Revisar la venta.** Se muestran los productos, las cantidades, los precios del catálogo y el total.
4. **Confirmar el cobro.** El vendedor verifica que recibió el total por billetera digital y confirma el cobro en el sistema. Basta con su confirmación; no se solicita un número de operación.
5. **Completar la venta.** Si hay stock suficiente para todos los productos, la venta queda cobrada y entregada, y se descuentan del inventario las unidades vendidas. Si algún producto no tiene stock suficiente, se bloquea la venta.

## Reglas de producto

| Aspecto | Definición |
| --- | --- |
| Búsqueda de productos | Por nombre. |
| Cliente | Opcional; “público general” por defecto. |
| Precios | Se utilizan los precios del catálogo, sin modificaciones. |
| Descuentos | No disponibles en esta versión; se incorporarán más adelante. |
| Medio de pago | Billetera digital. |
| Confirmación del pago | Manual, a cargo del vendedor, por el total de la venta. |
| Número de operación | No se solicita. |
| Entrega | En el momento de la venta. |
| Validación de stock | Se bloquea la venta si algún producto no tiene unidades suficientes. |
| Descuento de stock | Al completar la venta. |

## Fuera de esta primera versión

- Pedidos con pago o entrega posterior.
- Modificación de precios y aplicación de descuentos.
- Otros medios de pago.
- Búsqueda mediante lector de códigos de barras.
- Anulación de ventas completadas.

## Arquitectura y flujo técnico

La funcionalidad pertenece a `orders` y sigue las convenciones de [arquitectura](architecture.md), [dominio](domain.md), [persistencia](persistence.md) y [tipado y validación](programming-style.md) del proyecto.

```text
Formulario del POS
  → action de React Router
  → parseo y validación con Zod
  → createOrder con datos primitivos validados
  → consulta de contacto y catálogo
  → buildOrder con datos del backend
  → persistencia de orden y detalles, y descuento de stock
  → respuesta a la pantalla
```

La consulta de datos, la construcción de la orden y las escrituras se coordinan dentro de la transacción de `createOrder`.

| Componente | Responsabilidad |
| --- | --- |
| Formulario | Armar el carrito y enviar ID, contacto opcional, variantes y cantidades. |
| `action` de React Router | Obtener el contexto autenticado, leer la petición, validar y parsear con Zod, invocar el caso de uso y adaptar el resultado a la pantalla. |
| `createOrder` | Validar las reglas de aplicación, consultar las dependencias y coordinar la creación dentro de una transacción. |
| `buildOrder` | Construir la entidad mediante una función pura, validar sus invariantes y calcular subtotales y total. |
| Adaptadores de persistencia | Guardar los datos, ejecutar operaciones condicionadas y traducir errores técnicos conocidos. |

La empresa y el vendedor se obtienen de la sesión autenticada. Los valores enviados por el frontend no establecen la identidad ni el alcance de acceso.

## Ciclo de vida y duplicados

- Solo se persisten ventas completadas: cobradas y entregadas.
- El carrito vive en la pantalla. Salir o recargar pierde la venta en preparación.
- El carrito no reserva stock.
- No se necesita un campo de estado para esta primera versión.
- El frontend genera el UUID de la orden al iniciar la venta y lo conserva durante los intentos de confirmación.
- El backend valida su formato y la base de datos garantiza la unicidad, incluso ante solicitudes simultáneas.
- Si el ID ya existe, se devuelve `ORDER_ALREADY_EXISTS`. No se devuelve la orden existente como resultado exitoso ni se descuentan unidades nuevamente.
- No se agrega `idempotencyKey`.

## Contrato de entrada y tipado fuerte

El contrato de entrada contiene datos primitivos y su tipo se deriva del esquema Zod. Su forma conceptual es:

```text
id: string UUID
contactId: string UUID | null
items: lista no vacía de {
  variantId: string UUID
  quantity: number entero positivo dentro del rango seguro
}
```

No se requiere que el frontend construya una entidad `Order` ni tipos de dominio. El contrato no incluye precios, subtotales, total, empresa, vendedor ni fecha de venta. El medio de pago es fijo para este caso de uso: `digital_wallet`.

Todos los contratos JSON usan esquemas Zod: se validan las entradas y salidas y se derivan los tipos de transporte con `z.infer`. Los contratos compartidos viven en `shared/contracts/` y no importan entidades de la aplicación ni modelos de persistencia.

Los tipos de dominio son independientes de los contratos de transporte:

- `OrderId`, `OrderItemId`, `ContactId`, `VariantId`, `CompanyId` y `UserId` distinguen identificadores mediante tipos de marca, reutilizando los tipos y exports existentes cuando corresponda.
- `PositiveInteger` representa una cantidad validada como entera, positiva y dentro del rango seguro de la aplicación.
- Los datos son `readonly` y las variantes de negocio usan uniones discriminadas.
- La creación de valores de dominio requiere validación; una aserción de tipo no reemplaza esa validación.
- Las operaciones que pueden fallar devuelven `Result<T, E>` o `Promise<Result<T, E>>`.
- Las reglas de negocio siguen aplicándose en dominio y aplicación, aunque la entrada ya haya pasado por Zod en presentación.

```ts
type OrderCustomer =
  | Readonly<{ kind: "general_public" }>
  | Readonly<{
      kind: "contact";
      contactId: ContactId;
      name: string | null;
      phone: string;
    }>;

type OrderItem = Readonly<{
  id: OrderItemId;
  variantId: VariantId;
  productName: string;
  variantAttributes: Readonly<Record<string, string>>;
  sku: string | null;
  quantity: PositiveInteger;
  unitPrice: Money;
  subtotal: Money;
}>;

type Order = Readonly<{
  id: OrderId;
  companyId: CompanyId;
  sellerId: UserId;
  customer: OrderCustomer;
  paymentMethod: "digital_wallet";
  completedAt: Date;
  items: readonly [OrderItem, ...OrderItem[]];
  total: Money;
}>;
```

Estos fragmentos describen contratos de dominio, no archivos ya implementados. `Money` y `Result` se reutilizan desde `shared/`.

## Persistencia

Se utiliza la base de datos actual de core y su mecanismo de aislamiento por empresa.

### Order

| Campo | Tipo o representación | Regla |
| --- | --- | --- |
| `id` | UUID | Generado en el frontend; único. |
| `companyId` | UUID | Empresa del contexto autenticado. |
| `sellerId` | Identificador de `User` | Vendedor del contexto autenticado; conserva el tipo de almacenamiento de `User.id`. |
| `contactId` | UUID nullable | Referencia a `Contact` de la misma empresa. |
| `contactName` | Texto nullable | Copia del nombre al vender; puede ser nulo si el contacto no tiene nombre. |
| `contactPhone` | Texto nullable | Copia del teléfono al vender. |
| `currency` | Código de moneda admitido | Una moneda para toda la orden. |
| `total` | `numeric(15,2)` | Calculado por el backend. |
| `paymentMethod` | Valor restringido a `digital_wallet` | Billetera digital confirmada por el vendedor. |
| `completedAt` | Fecha y hora en UTC | Instante generado por el backend. |

### OrderItem

| Campo | Tipo o representación | Regla |
| --- | --- | --- |
| `id` | UUID | Generado por el backend. |
| `companyId` | UUID | Misma empresa que la orden. |
| `orderId` | UUID | Referencia a la orden. |
| `variantId` | UUID | Referencia a la variante vendida. |
| `productName` | Texto | Copia del nombre al vender. |
| `variantAttributes` | JSON | Copia de atributos validada como pares de texto. |
| `sku` | Texto nullable | Copia del SKU al vender. |
| `quantity` | Entero grande | Positivo y limitado al rango entero seguro de la aplicación. |
| `unitPrice` | `numeric(11,2)` | Precio del catálogo obtenido por el backend. |
| `subtotal` | `numeric(15,2)` | Calculado por el backend. |

La moneda se almacena una vez en `Order`; el mapeo de persistencia la utiliza al reconstruir los valores `Money` de los detalles. Los modelos de base de datos no se exponen como contratos de aplicación.

### Cliente y datos históricos

Se reutiliza `Contact` como cliente de la venta. No se introduce una entidad de cliente independiente ni un contacto ficticio para “Público general”.

- Para público general, `contactId`, `contactName` y `contactPhone` son `null`.
- Para un contacto seleccionado, se conserva su referencia y una copia de su nombre y teléfono al vender.
- El nombre puede ser nulo en un contacto identificado; el teléfono se conserva.
- Los filtros por cliente utilizan `contactId`.
- Editar posteriormente el contacto o el catálogo no modifica las copias históricas de la venta.

### Integridad e índices

- Órdenes y detalles mantienen el aislamiento por empresa, incluidas las políticas RLS correspondientes.
- Las relaciones incluyen la empresa para impedir referencias a contactos, vendedores, órdenes o variantes de otra empresa.
- El ID de la orden es único. Cada variante aparece una sola vez por orden, con su cantidad total.
- La base de datos restringe cantidades e importes a valores positivos.
- El dominio valida que la orden tenga al menos un detalle, una sola moneda y totales correctos dentro del rango de almacenamiento.
- La transacción garantiza que se guarden todos los detalles junto con la orden.
- No se borran ventas históricas en cascada al borrar contactos o productos; las referencias existentes deben proteger ese historial.
- Se agregan índices para consultar por empresa y fecha, y por empresa, contacto y fecha, considerando el ID como desempate de ordenación.

## Precios y cálculos

El backend obtiene los precios vigentes del catálogo y recalcula todos los subtotales y el total mediante las operaciones de `Money`. Los importes enviados o mostrados por el frontend nunca son la fuente de los valores persistidos.

La orden conserva los precios utilizados en ese cálculo. Se validan los límites de precisión y rango antes de guardar; no se truncan silenciosamente cantidades o importes para hacerlos caber en la base de datos.

No se envían precios esperados para comparar ni se incorpora `PRICE_CHANGED`. Si el catálogo cambia mientras se arma el carrito, el total persistido puede diferir del mostrado previamente. Después de completar la venta, la pantalla utiliza los importes devueltos por el backend.

## Casos de uso

| Caso de uso | Entrada | Salida |
| --- | --- | --- |
| `createOrder` | ID de orden, contacto opcional, variantes y cantidades, más contexto autenticado y dependencias. | Orden completada con importes calculados por el backend, o error. |
| `listOrders` | Paginación y filtros de fecha y cliente. | Resúmenes de ventas, página, tamaño de página y total de resultados. |
| `getOrder` | ID de orden. | Orden completa con sus detalles, o `ORDER_NOT_FOUND`. |

Todos operan dentro de la empresa autenticada. Los casos de uso reciben datos simples y dependencias explícitas; no reciben objetos HTTP, componentes ni clientes de base de datos.

### buildOrder

`buildOrder` es una función pura del dominio invocada por `createOrder`, no otro caso de uso independiente.

Recibe explícitamente los IDs, empresa, vendedor, fecha, contacto opcional y artículos con datos y precios obtenidos por el backend. Valida las invariantes, calcula los importes y construye la entidad con sus copias históricas. Devuelve `Result<Order, BuildOrderError>`.

No consulta la base de datos, no genera IDs o fechas internamente y no descuenta stock. La detección definitiva de duplicados y la disponibilidad de stock dependen de la operación transaccional coordinada por `createOrder`.

### createOrder y transacción

1. Validar la entrada: ID válido, al menos un artículo, cantidades enteras positivas y variantes sin repetir.
2. Abrir la transacción mediante el mecanismo existente `withinTransaction`, conectado por composición.
3. Consultar contacto y catálogo dentro de la empresa autenticada, obteniendo los datos para los precios y las copias históricas.
4. Invocar `buildOrder` con esos datos y los valores generados por el backend.
5. Insertar la orden y sus detalles. La restricción de unicidad impide registrar otra orden con el mismo ID.
6. Descontar el stock de cada variante mediante una operación condicionada a que aún existan unidades suficientes. Procesar las variantes en un orden estable reduce conflictos entre ventas concurrentes.
7. Confirmar la transacción y devolver la orden persistida.

Si falla cualquier artículo u operación, se revierte todo: orden, detalles y descuentos ya ejecutados. Una consulta previa de stock no reemplaza la condición al descontar.

`orders/application` coordina el flujo. Productos expone la capacidad necesaria para operar sobre su stock; órdenes no modifica directamente las tablas de otra feature. La composición conecta ambas capacidades a la misma transacción sin exponer el cliente de base de datos al caso de uso.

El pago por billetera sucede fuera del sistema. Como el carrito no reserva unidades, una venta puede rechazarse por stock después de que el vendedor reciba el dinero. La transacción de base de datos no revierte ese pago externo.

### Listado y detalle

El listado usa páginas de 20 ventas, con número de página entero positivo. Ordena por `completedAt` descendente y utiliza el ID como desempate estable.

```ts
type CustomerFilter =
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "general_public" }>
  | Readonly<{ kind: "contact"; contactId: ContactId }>;

type ListOrdersInput = Readonly<{
  page: number;
  customer: CustomerFilter;
  completedFrom?: Date;
  completedBefore?: Date;
}>;
```

El intervalo incluye `completedFrom` y excluye `completedBefore`. Las fechas viajan como cadenas validadas en JSON y se utilizan como `Date` dentro de la aplicación. El listado y su conteo aplican los mismos filtros y alcance de empresa.

Cada resumen contiene ID, fecha, cliente, vendedor, moneda y total. La salida incluye `items`, `page`, `pageSize` y `total`. El detalle agrega los artículos con sus nombres, variantes, cantidades y precios históricos. La presentación muestra “Público general” cuando corresponde.

### Errores

Los errores esperados usan `Result`, con uniones discriminadas por `code` y un `message`. Los errores de creación incluyen:

| Código | Significado |
| --- | --- |
| `ORDER_ALREADY_EXISTS` | Ya existe una orden con ese ID. |
| `CONTACT_NOT_FOUND` | El contacto no está disponible dentro de la empresa. |
| `VARIANT_NOT_FOUND` | Una variante no está disponible dentro de la empresa; incluye `variantId`. |
| `INSUFFICIENT_STOCK` | Una variante no tiene unidades suficientes; incluye `variantId`. |
| `CURRENCY_MISMATCH` | Los artículos no comparten moneda. |
| `INVALID_ORDER` | La orden incumple una regla de validación; los detalles identifican el campo o artículo cuando corresponde. |
| `PERSISTENCE_UNAVAILABLE` | No pudo completarse la operación por un fallo conocido de persistencia. |

`buildOrder` devuelve únicamente errores que puede determinar con sus entradas. Las consultas tienen sus propios contratos; `ORDER_NOT_FOUND` pertenece a `getOrder`. Los errores de parseo se resuelven en presentación antes de invocar el caso de uso. Los errores inesperados permanecen observables y no se convierten en resultados exitosos o ausencia de datos.

## Organización del código

```text
apps/core/src/features/orders/
  domain/          Tipos, construcción, cálculos y errores
  application/     createOrder, listOrders, getOrder y dependencias
  infrastructure/  Persistencia y mapeo
  presentation/    Validación y adaptación de entradas y salidas
  composition.ts   Conexión de casos de uso con sus dependencias

apps/core/app/routes/
  Rutas del POS, listado y detalle mediante actions y loaders

shared/contracts/
  Contratos JSON compartidos, con esquemas y tipos derivados
```

Las rutas delegan el comportamiento a la feature. Se reutilizan las capacidades de productos y contactos para las búsquedas del POS. Los tests se ubican junto al comportamiento que verifican; se crean los archivos necesarios sin introducir repositorios genéricos ni capas adicionales de delegación.

## Validación de la implementación

Los siguientes escenarios describen las pruebas por implementar y sus resultados esperados. No son pruebas implementadas ni ejecutadas. Siguen las [convenciones de testing](testing-conventions.md): cada comportamiento se verifica en la capa que puede demostrarlo, sin repetir toda la matriz de reglas en integración y E2E.

En core, las pruebas se definen y ejecutan con Vitest; Playwright se utiliza para interactuar con el navegador en E2E. Las pruebas unitarias y de integración se ubican junto al comportamiento probado; los recorridos completos, en `apps/core/tests/e2e/`.

### Pruebas unitarias

Se ejecutan sin servidor, red ni base de datos. El dominio recibe datos explícitos y los casos de uso utilizan dependencias simuladas pequeñas. Se verifican resultados y efectos observables, sin afirmar que una simulación demuestra las garantías de una transacción real.

#### Dominio: buildOrder

| ID | Prueba | Resultado esperado |
| --- | --- | --- |
| U01 | Construir una venta para público general con varios artículos: 3 unidades a 0.10 y 2 unidades a 0.20, en la misma moneda. | Devuelve una orden con cliente `general_public`, subtotales 0.30 y 0.40, total 0.70 y medio `digital_wallet`. Conserva los IDs, empresa, vendedor y fecha recibidos explícitamente. |
| U02 | Construir una venta con un contacto, incluyendo la variante de contacto sin nombre, y artículos con atributos y SKU opcional. | Conserva las referencias y copias históricas correctas; un contacto sin nombre mantiene su teléfono y no se convierte en público general. Los datos de entrada no se modifican ni quedan compartidos de forma que cambios posteriores alteren las copias históricas. |
| U03 | Construir una orden vacía o con una variante repetida. | Devuelve `INVALID_ORDER`; no produce una entidad parcial. |
| U04 | Construir una orden con cantidades cero, negativas, fraccionarias, no finitas o fuera del rango entero seguro; contrastar con una cantidad positiva válida. | Rechaza las cantidades inválidas e identifica el artículo afectado. La cantidad válida permite construir la orden cuando el resto de las reglas se cumple. |
| U05 | Construir una orden con artículos de monedas distintas. | Devuelve `CURRENCY_MISMATCH`, sin convertir monedas ni sumar importes incompatibles. |
| U06 | Usar precios no positivos, no finitos, con más de dos decimales o fuera del rango del precio unitario; contrastar con precios válidos en los límites admitidos. | Rechaza los precios inválidos antes de calcular o persistir, sin redondearlos o truncarlos silenciosamente; acepta los límites válidos cuando los totales también caben. |
| U07 | Calcular un subtotal que excede `numeric(15,2)` y una orden cuyos subtotales individuales caben pero cuya suma excede ese rango; contrastar con un resultado dentro del límite. | Rechaza cada desbordamiento con un error de construcción y conserva los centavos en el caso válido. No es necesario repetir toda la suite de la utilidad compartida `Money`. |

#### Aplicación y presentación

| ID | Prueba | Resultado esperado |
| --- | --- | --- |
| U08 | Ejecutar `createOrder` con una entrada de primitivos válida y dependencias que entregan catálogo, contacto, IDs y reloj controlados. | Devuelve la orden construida con los precios del catálogo y el contexto autenticado, y solicita persistir esa orden y descontar las cantidades correspondientes. Se verifica el resultado y los valores de los efectos, no el orden interno de llamadas a helpers. |
| U09 | Ejecutar `createOrder` cuando falta el contacto seleccionado o una variante solicitada. | Devuelve `CONTACT_NOT_FOUND` o `VARIANT_NOT_FOUND`, con el identificador pertinente cuando corresponde, sin solicitar guardar la venta ni descontar stock. |
| U10 | Hacer que la construcción falle o que una dependencia reporte un error esperado de duplicado, stock o persistencia. | El caso de uso devuelve el error correspondiente y no continúa con pasos dependientes del fallo. La reversión efectiva de escrituras se verifica en integración. |
| U11 | Parsear una solicitud válida con `contactId: null` y otra con un contacto; luego probar JSON malformado, IDs inválidos, campos requeridos ausentes y tipos incorrectos. | Las solicitudes válidas producen la entrada tipada esperada. Las inválidas producen errores de presentación y no invocan el caso de uso. |
| U12 | Incluir precios, subtotales, total, empresa, vendedor o fecha manipulados en una solicitud. | Esos valores ajenos al contrato nunca se convierten en datos autorizados del caso de uso. No permiten reemplazar los valores calculados o derivados por el backend. |
| U13 | Parsear filtros de listado con cada variante de cliente, fechas válidas y página válida; probar páginas no positivas o fraccionarias, fechas malformadas y un filtro de contacto sin ID válido. | Produce criterios tipados para las entradas válidas y errores para las inválidas. Distingue entre todos los clientes, público general y un contacto concreto. |
| U14 | Adaptar resultados exitosos y errores de los casos de uso en actions y loaders. | Presenta éxito únicamente si el caso de uso tuvo éxito; conserva los importes devueltos por el backend y comunica errores de validación, duplicado, stock y orden no encontrada sin exponer detalles internos. |
| U15 | Recibir un fallo conocido de persistencia o una excepción inesperada al consultar o crear. | El fallo conocido conserva su contrato de error. El inesperado permanece observable y nunca se convierte en orden creada, lista vacía o ausencia válida. |

Como verificación adicional de tipado durante `typecheck`, se comprueba que no sea posible intercambiar identificadores de dominio, construir una orden con una lista vacía ni representar un cliente de tipo `contact` sin los datos requeridos. Son comprobaciones de compilación, no pruebas de validación en tiempo de ejecución.

### Pruebas de integración

Ejercitan la composición y los adaptadores con una base de datos aislada y el mecanismo real de transacciones y aislamiento por empresa. Las pruebas de rutas usan también la autenticación y validación de la aplicación. Se comprueba el estado persistido después de cada operación, no solo su respuesta.

| ID | Prueba | Resultado esperado |
| --- | --- | --- |
| I01 | Crear una venta válida de varios artículos y leerla nuevamente, tanto para público general como para un contacto. | Se conservan orden, detalles, moneda, importes, fecha y datos históricos; el stock disminuye exactamente lo vendido. Para público general los tres campos de contacto son nulos. La lectura reconstruye correctamente cantidades, fechas y valores `Money`. |
| I02 | Cambiar el precio del catálogo entre la preparación de la venta y su envío, y completar usando solo IDs y cantidades. | La orden y la respuesta usan el precio vigente consultado por el backend y sus totales recalculados. No se produce `PRICE_CHANGED` ni se conserva el precio antiguo mostrado en el carrito. |
| I03 | Registrar una venta y volver a enviar su ID, tanto con el mismo contenido como con contenido diferente. | El segundo intento devuelve `ORDER_ALREADY_EXISTS`. La orden original, sus detalles y el stock permanecen sin cambios adicionales. |
| I04 | Enviar simultáneamente dos solicitudes válidas con el mismo ID y stock suficiente para ambas. | Solo una crea la venta; la otra devuelve `ORDER_ALREADY_EXISTS`. Existe una sola orden y el stock se descuenta una sola vez. |
| I05 | Vender exactamente las unidades disponibles y, en otro caso, solicitar una unidad más de las disponibles. | El primer caso deja stock cero. El segundo devuelve `INSUFFICIENT_STOCK`, identifica la variante y no deja orden, detalles ni descuentos. |
| I06 | Enviar simultáneamente dos órdenes con IDs distintos que solicitan la última unidad de una variante. | Una venta se completa y la otra devuelve `INSUFFICIENT_STOCK`. Solo queda una orden completada y el stock termina en cero, nunca negativo. |
| I07 | Crear una venta de varios artículos donde un descuento puede ejecutarse y otro falla por falta de stock. | Se revierte la orden, todos sus detalles y cualquier descuento previo. Cada stock queda igual que antes del intento. |
| I08 | Provocar un fallo de escritura durante una creación que ya haya efectuado cambios dentro de la transacción. | No quedan escrituras parciales ni descuentos de stock. Se comunica el fallo sin devolver una venta exitosa. |
| I09 | Crear, listar y consultar ventas con dos empresas; intentar usar contactos, variantes o IDs de órdenes de la otra empresa. | No se crean referencias cruzadas ni se modifica stock ajeno. Listados y conteos excluyen la otra empresa y su detalle no se devuelve. También se verifican las políticas RLS y referencias compuestas mediante operaciones directas de persistencia. |
| I10 | Invocar las actions y loaders sin sesión o sin empresa autorizada; con sesión válida, intentar imponer otra empresa o vendedor en la solicitud. | El acceso no autorizado se rechaza sin efectos. Los valores manipulados no permiten suplantar al vendedor ni cambiar la empresa derivada de la sesión. |
| I11 | Intentar escrituras que violen unicidad de variante por orden, cantidades o importes positivos, medio de pago permitido y referencias requeridas. | Las restricciones de la base de datos rechazan los datos inválidos incluso si se omite la validación de aplicación. |
| I12 | Editar los nombres, atributos, SKU y precios del catálogo, y el nombre y teléfono del contacto, después de completar una venta. | El detalle histórico mantiene todos los valores originales. El filtro por cliente sigue encontrando la venta por su `contactId`. |
| I13 | Intentar eliminar un contacto o producto referenciado por una venta. | La relación protege el historial: la operación no elimina en cascada la orden ni sus detalles y la venta continúa siendo consultable. |
| I14 | Listar ventas con filtros de todos los clientes, público general y un contacto, combinados con fechas; incluir registros exactamente en el inicio y en el fin del intervalo. | Incluye el límite inicial y excluye el final. Cada filtro retorna únicamente las ventas correspondientes y `total` cuenta esas mismas ventas dentro de la empresa. |
| I15 | Listar más de 20 ventas, incluyendo varias con la misma fecha, y recorrer páginas sobre datos sin cambios concurrentes. | Devuelve páginas de 20 salvo la última, ordenadas por fecha descendente con desempate estable por ID. No repite ni omite registros entre páginas. Sin coincidencias devuelve lista vacía y total cero; una página posterior a la última queda vacía y conserva el total filtrado. |
| I16 | Consultar una orden existente y un ID inexistente. | La primera devuelve la orden con todos sus detalles y copias históricas. El segundo devuelve `ORDER_NOT_FOUND`, sin confundir ausencia con fallo de persistencia. |

### Pruebas E2E

Ejercitan la aplicación en ejecución desde el navegador, con backend y base de datos de pruebas reales. Se enfocan en recorridos del vendedor y resultados visibles. La confirmación de billetera es manual; estos escenarios no requieren una integración con el proveedor de pagos.

| ID | Recorrido | Resultado esperado |
| --- | --- | --- |
| E01 | Iniciar sesión, abrir el POS, buscar productos por nombre, elegir una variante, agregar cantidades y completar una venta sin seleccionar cliente. | Se muestran precios del catálogo y total, el cliente es “Público general” y el cobro se confirma por billetera sin número de operación. La venta aparece en el listado y su detalle muestra los artículos e importes del backend; el stock visible refleja las unidades vendidas. |
| E02 | Seleccionar un contacto existente, completar una venta y abrirla desde el listado. | El resumen y el detalle identifican al contacto y muestran sus datos históricos. También funciona con un contacto sin nombre, mostrando su teléfono para identificarlo. |
| E03 | Intentar completar una venta cuya cantidad excede el stock disponible; corregir la cantidad y volver a confirmar. | Se comunica la insuficiencia y no aparece una venta completada en el intento fallido. Al corregir, se registra una sola venta con el descuento de stock correspondiente. |
| E04 | Mostrar un precio en el carrito, cambiarlo en el catálogo mediante otra sesión autorizada y luego completar la venta. | La pantalla de resultado y el detalle muestran el precio y total definitivos calculados por el backend, sin solicitar una confirmación por `PRICE_CHANGED`. |
| E05 | Armar un carrito y recargar la página o salir y volver antes de confirmar. | No se recupera una venta en preparación, no se genera una orden en el listado y no se modifica ni reserva stock. |
| E06 | Consultar el listado, filtrar por fechas, público general y un contacto; cambiar de página y abrir un detalle. | Las ventas visibles corresponden a los filtros, la paginación permite recorrer los resultados y el detalle coincide con la venta seleccionada. Los filtros sin coincidencias muestran un estado vacío. |
| E07 | Acceder al POS, listado o detalle sin autenticación y abrir desde otra empresa una URL de detalle conocida. | Se aplica el flujo de acceso correspondiente y nunca se muestran los datos de una venta ajena. |
| E08 | Provocar un fallo controlado del backend al confirmar una venta y volver a intentarlo tras recuperar el servicio. | La pantalla comunica el fallo sin presentar éxito. El intento conserva el ID de la venta y, si el primero se revirtió, la confirmación posterior genera una sola orden. Si el primer intento sí se confirmó y se perdió su respuesta, reenviar el mismo ID muestra el error de duplicado y no registra otra venta. |

### Criterios de ejecución

- Cada escenario utiliza datos aislados y no depende del orden de ejecución ni de datos dejados por otras pruebas.
- Se controlan reloj e identificadores cuando afecten las expectativas; las pruebas concurrentes coordinan los intentos sin depender de pausas arbitrarias.
- Las pruebas de concurrencia y reversión verifican órdenes, detalles y stock finales en la base de datos real de pruebas.
- Las pruebas de navegador esperan resultados observables y utilizan etiquetas o roles accesibles, sin depender de estructura interna o capturas completas de la interfaz.
- Los fallos inducidos utilizan únicamente recursos de pruebas. Los clientes y conexiones creados se cierran y los datos se limpian al finalizar.
- No se agregan pruebas de descuentos, anulaciones, borradores ni otros medios de pago como funcionalidades disponibles: están fuera del alcance acordado.
