# Orders mobile: producto y arquitectura

**Estado:** implementación inicial. La primera versión está disponible para empresas autenticadas de cualquier país admitido y registra ventas cobradas por billetera digital y entregadas en el momento. Su comportamiento de producto y las reglas del servidor parten de [ventas manuales en core](ventas-manuales.md). El carrito no se guarda como borrador y la venta requiere conexión.

El concepto técnico se llama `Order` en core, shared y mobile; «Ventas» es solo el texto de la interfaz, como en core.

## Definición de producto

### Objetivo y alcance

Permitir que un vendedor de una empresa autenticada registre desde mobile una orden cobrada por billetera digital y entregada en el momento. El cobro ocurre fuera de la app y el vendedor confirma manualmente que recibió el dinero y entregó los productos; no se pide número de operación. Al completarla, la orden aparece en el historial con el importe y los datos históricos registrados por core.

La primera versión requiere conexión para confirmar. El vendedor puede seguir editando la selección si pierde conexión antes del envío, pero la app no envía órdenes mientras sabe que está desconectada. La pestaña «Ventas» y sus rutas se ofrecen a toda empresa autenticada con acceso listo.

### Reglas del flujo

| Aspecto | Comportamiento |
| --- | --- |
| Productos | Se buscan por nombre, se elige una variante activa y se indica una cantidad. Se muestran precio y stock disponibles; una variante sin stock no se puede agregar. |
| Cliente | «Público general». |
| Precio y total | Mobile muestra el importe calculado con los precios consultados, pero core vuelve a calcularlo con el catálogo vigente al confirmar. No se edita el precio ni se aplican descuentos. |
| Cobro y entrega | El vendedor confirma ambas acciones manualmente. Una orden completada queda cobrada y entregada; no hay estados intermedios. |
| Stock | La selección no reserva unidades. Si al confirmar falta stock, la orden se rechaza y la selección queda editable. |
| Selección temporal | Los artículos y cantidades viven en «Nueva venta». Salir con artículos exige confirmar su descarte; no hay borrador que se recupere al volver o reiniciar. |
| Confirmación incierta | Si no se sabe si core guardó la venta, queda en una cola del teléfono por empresa y se envía sola con el mismo ID; el vendedor puede seguir vendiendo. |

### Pantallas y navegación

- **Ventas:** lista paginada, filtros por fecha y cliente, estados de lista vacía, filtros sin resultados y error de carga. Cada fila usa cliente, fecha y total; el detalle conserva datos históricos. Las ventas en cola se indican como «enviándose» sin acción; solo las que core rechazó piden revisión.
- **Nueva venta:** búsqueda de productos agrupados; tocar un producto abre variantes con precio y stock. La barra inferior resume artículos y total mostrado. Salir con carrito no vacío pide confirmación para descartarlo.
- **Revisar:** permite editar cantidades; explica que el pago y la entrega se confirman manualmente. Ante un rechazo conocido permanece aquí con el carrito intacto.
- **Detalle:** usa siempre el total registrado por core. El aviso de diferencia depende del intento local y solo aparece inmediatamente tras completar o recuperar esa venta.

«Nueva venta» tiene las etapas «Productos» y «Revisar» en la misma ruta para conservar la selección al avanzar y retroceder. La confirmación exige artículos válidos y conexión. Al completarse, se abre el detalle de esa orden. Si core devuelve un rechazo conocido por stock o variante, el vendedor corrige la selección y puede reintentar con el mismo ID.

El historial muestra páginas de 20, ordenadas por fecha de finalización descendente y por ID en los empates. El filtro de cliente distingue todas las órdenes o público general. «Desde» y «Hasta» seleccionan **días completos e inclusivos** de `America/Lima`, no horas ni la zona del teléfono; la fecha y hora visibles usan Lima para que coincidan con el filtro. El detalle muestra los artículos y datos del cliente tal como quedaron registrados al completar la orden.

### Venta en cola y diferencia de importe

Una pérdida de respuesta o un fallo del servidor después de guardar no significa que la venta haya fallado. La venta queda guardada en el teléfono con su ID y la pantalla empieza una venta nueva. Mobile la envía sola: al iniciar sesión, al volver a la app, al recuperar conexión y, mientras siga pendiente, con reintentos de espera exponencial con jitter (hasta 5 minutos entre intentos). Cada intento consulta primero el ID en core y solo reenvía la petición guardada si no existe; core rechaza un ID repetido, así que nunca se duplica ni descuenta stock dos veces. Si core rechaza la venta de forma definitiva (stock, tarifa, pago…), deja de reintentarse y aparece en «Nueva venta» para que el vendedor la revise y la guarde otra vez con los mismos IDs. La cola sobrevive al reinicio y al cierre de sesión y solo se muestra en su empresa. Una venta guardada que no se puede leer se muestra como error con la opción de descartarla, sin bloquear ventas nuevas.

Si el importe registrado por core difiere del mostrado al confirmar, la app presenta ambos importes para que el vendedor ajuste el cobro fuera de la app. Esta comparación se muestra al completar o recuperar el intento en ese dispositivo; al abrir después la orden desde el historial se muestra solo el importe registrado.

### Fuera de esta versión

No se incluyen pedidos con cobro o entrega posteriores, otros medios de pago, modificación manual de precios, descuentos, anulación de órdenes completadas, lector de códigos de barras, borradores persistentes ni sincronización de ventas sin conexión.

## Arquitectura técnica

### Límites de responsabilidad

```text
Pantallas mobile → operaciones de ventas → adaptador HTTP → /api/orders
                                                       ↓
                                      casos de uso existentes de core
                                                       ↓
                                orden + detalles + descuento de stock
                                       en una misma transacción
```

- **Core** conserva las reglas de creación, precios, stock, autorización y aislamiento por empresa. La API adapta HTTP a `orders.create`, `orders.list`, `orders.get` y `orders.searchProducts`; no crea otra implementación de esas reglas.
- **Mobile** posee la interacción, el carrito temporal, el total mostrado y la recuperación de una confirmación incierta. Calcula un importe para orientar al vendedor, pero el resultado de core es el único total registrado.
- **Shared** posee los esquemas Zod del JSON y las utilidades `Money` y `Result`. Mobile no importa entidades ni repositorios de core.
- La primera versión no agrega columnas, tablas, estados de orden ni migraciones. El total mostrado antes de confirmar no se persiste en core.

### Datos y tipos

#### Contratos compartidos

`shared/contracts/orders.ts` ya define los esquemas de creación, orden, resumen, listado y catálogo. También exporta `CreateOrderRequest`, `OrderResponse` y `ListOrdersRequest`, inferidos de sus esquemas. Se usan esos tipos existentes; para las otras respuestas se usa `z.infer<typeof esquema>` donde haga falta. No se agrega una capa de modelos o mapeadores de transporte.

La petición de creación contiene `id: UUID` e `items: [{ variantId: UUID, quantity: entero positivo }]`; la lista no puede estar vacía. No viajan precios, total, medio de pago, fecha, empresa ni vendedor. `orderSchema` devuelve el ID, empresa, vendedor, cliente discriminado entre `general_public` y `contact`, `paymentMethod: "digital_wallet"`, `completedAt` ISO UTC, moneda, total y artículos con nombre, atributos, SKU, cantidad, precio y subtotal históricos. `listOrdersResponseSchema` contiene esos datos de cabecera en `items`, más `page`, `pageSize: 20` y `total`. `orderCatalogSchema` agrupa variantes por producto, con precio y stock. Core valida JSON entrante y saliente; mobile valida lo que envía y cada respuesta recibida.

Core mantiene sus tipos de dominio actuales (`Order`, `OrderCriteria`, `CreateOrderError` e IDs de marca) dentro de `apps/core/src/features/orders/`. `createOrder` valida la petición y coordina `buildOrder`, que construye y valida la entidad. La presentación escribe el JSON con las funciones existentes `toOrderJson` y `toOrderListJson`, validadas por los esquemas de salida; no añade otra capa ni expone Prisma a mobile. `Money` y `Result` se reutilizan desde `shared/`.

#### Estado propio de mobile

El carrito es dato de interacción, separado de la orden persistida. El tipo discriminado evita un ID de orden sin artículos y exige un ID cuando el carrito ya contiene artículos. Los nombres de sus campos siguen los de `Order` y `CreateOrderRequest`; los valores provisionales llevan el prefijo `shown`:

```ts
type OrderDraftItem = Readonly<{
  variantId: CreateOrderRequest["items"][number]["variantId"];
  productName: string;
  variantAttributes: Readonly<Record<string, string>>;
  sku: string | null;
  shownUnitPrice: Money;
  shownStock: number;
  quantity: number;
}>;

type OrderDraft =
  | Readonly<{ kind: "empty"; items: readonly [] }>
  | Readonly<{ kind: "items"; id: CreateOrderRequest["id"];
      items: readonly [OrderDraftItem, ...OrderDraftItem[]] }>;

type PendingOrderConfirmation = Readonly<{
  companyId: OrderResponse["companyId"];
  id: CreateOrderRequest["id"];
  shownTotal: Money;
}>;

type OrderListCriteria = Readonly<{
  page: number;
  customer:
    | Readonly<{ kind: "all" }>
    | Readonly<{ kind: "general_public" }>;
  fromDay?: string;    // YYYY-MM-DD en Lima
  throughDay?: string; // YYYY-MM-DD en Lima, inclusivo
}>;
```

`OrderDraft` y la petición congelada durante el envío viven solo en memoria. El UUID se genera al agregar el primer artículo y no cambia al editar ni al reintentar. Después de reiniciar la app no se conserva la petición: solo entonces se reconstruye el carrito por decisión del vendedor; el envío nunca se repite automáticamente. `PendingOrderConfirmation` guarda únicamente empresa, ID y total mostrado de un envío **ya confirmado por el vendedor**. Se conserva un único intento por empresa incluso al cerrar sesión, y se lee solo al autenticarse nuevamente en esa empresa. La lectura de almacenamiento se valida con un esquema Zod local antes de convertirla en estado de aplicación.

El caso de uso mobile calcula el total mostrado con `multiply` y `add` de `shared/money.ts`, valida cantidades, variantes repetidas y monedas mezcladas, y arma `CreateOrderRequest` al confirmar. Una variante con stock mostrado en cero no se puede agregar; el stock visible nunca reserva unidades. La pantalla construye `OrderListCriteria` y el caso de uso `loadOrders` valida sus días y los convierte a `ListOrdersRequest` con instantes UTC. En core, el handler traduce este contrato a su `OrderCriteria` existente. Core vuelve a validar las reglas de consulta y calcula el importe registrado con el catálogo vigente.

### API de core

Se registra un middleware `Cache-Control: no-store` para `/api/orders` antes del parser JSON y la autenticación, y el router de órdenes después de `loadApiAccess` y `requireApiCompany`, como la API de productos. Así también los errores de parseo y autenticación llevan ese encabezado. El manejador global de `apps/core/src/app.ts` debe reconocer las rutas de órdenes para traducir JSON mal formado a `INVALID_INPUT` y mantener `PAYLOAD_TOO_LARGE` cuando excede 100 kB.

| Método y ruta | Entrada | Salida |
| --- | --- | --- |
| `GET /api/orders` | `page`, `customer`, `completedFrom`, `completedBefore` | `listOrdersResponseSchema` |
| `GET /api/orders/:id` | UUID | `orderSchema` |
| `POST /api/orders` | JSON `createOrderSchema` | `201` + `orderSchema` |
| `GET /api/orders/catalog?search=` | Nombre del producto | `orderCatalogSchema`, hasta 20 productos activos; cada uno incluye solo sus variantes activas |

#### Validación y mapeo HTTP

`apps/core/src/app.ts` registra el router después de `loadApiAccess` y `requireApiCompany`. Cada handler recibe `ReadyAccess` en `response.locals.auth` y toma de allí `company.id` y `user.id`, sin restringir el país. `loadApiAccess` ya instala el aislamiento de empresa; la API no acepta empresa ni vendedor en cuerpo o query. `POST` exige JSON; el parser global conserva el límite de 100 kB. La ruta estática `catalog` se registra antes de `:id`.

En cada entrada se usa `safeParse`: `createOrderSchema` para el cuerpo, `listOrdersSchema` para el listado, UUID para detalle y un esquema estricto de `search` para la búsqueda. El límite JSON rechaza claves desconocidas o repetidas y formatos inválidos; `listOrders` valida además el orden del intervalo y el rango seguro de paginación. El handler traduce `customer` a la unión discriminada de `OrderCriteria` sin introducir valores inválidos ni usar aserciones no comprobadas. Los parámetros de fecha son instantes ISO UTC; los días de producto se convierten antes, en mobile.

`POST` pasa `parsed.data` y `{ companyId: auth.company.id, sellerId: auth.user.id }` a `orders.create`. `GET /api/orders` convierte el query validado en `OrderCriteria` y llama `orders.list`; `GET /api/orders/:id` llama `orders.get`. La búsqueda delega a `orders.searchProducts`, ya conectada a productos. La pantalla no ofrece para selección productos que vuelvan sin variantes activas. Todos los resultados exitosos se proyectan y validan con los esquemas compartidos antes de escribir JSON. Core sigue siendo dueño de fecha, precio, stock, transacción y copias históricas. Una venta de otra empresa responde igual que una inexistente.

El listado conserva páginas de 20 ordenadas por `completedAt` descendente e ID ascendente en empates. `completedFrom` es inclusivo y `completedBefore` exclusivo. La pantalla filtra por **días**, no por hora: «Desde» se convierte a la medianoche de ese día y «Hasta» a la medianoche del día siguiente en `America/Lima`. Por ejemplo, solo el 28/09/2026 corresponde a `[2026-09-28T05:00:00.000Z, 2026-09-29T05:00:00.000Z)`. No se usa la zona del teléfono ni se suma una duración fija de 24 horas para obtener el día siguiente. La conversión se extrae de la ruta web actual de core a una función pura compartida por web y mobile; la fecha y hora de cada venta también se muestran en `America/Lima`.

La pestaña y las rutas de Ventas en mobile se habilitan cuando el acceso de la empresa autenticada está listo. Las rutas de `/api/orders` exigen autenticación y conservan el aislamiento por empresa; las rutas web de core existentes conservan su alcance actual.

El repositorio existente y sus políticas RLS mantienen el aislamiento. `POST` reutiliza la transacción de `createOrder`, que guarda orden y detalles y descuenta stock de forma atómica. La unicidad del ID devuelve `ORDER_ALREADY_EXISTS` en repeticiones, sin repetir el descuento; la recuperación del intento usa `GET` sobre ese mismo ID. La proyección reutiliza `toOrderJson` y `toOrderListJson`, sin serializar Prisma directamente.

#### Errores tipados

El sobre sigue siendo `{ code, error, issues? }` de `shared/contracts/registration.ts`. Se amplía `apiErrorCodeSchema` con los códigos de órdenes y se agregan `orderApiIssueSchema` y `orderApiErrorSchema` en `shared/contracts/orders.ts`. Los tipos `OrderApiIssue` y `OrderApiError` se obtienen con `z.infer`; el esquema de error acota códigos e incidencias admitidos para órdenes. Una incidencia conserva `field` y `reason`; cuando core conoce el artículo afectado agrega `index` (base cero) o `variantId`. Mobile valida también que el código corresponda al estado HTTP y a la operación solicitada, y adapta el campo HTTP `error` a `message` en su `Result`. Los mensajes visibles se eligen por código, nunca a partir del texto técnico de `error`.

| Situación | HTTP y código | Tratamiento mobile |
| --- | --- | --- |
| JSON, query o UUID mal formado | `400 INVALID_INPUT` | Corregir entrada; no enviar otra venta automáticamente. |
| Cuerpo no JSON o mayor a 100 kB | `415 UNSUPPORTED_MEDIA_TYPE` / `413 PAYLOAD_TOO_LARGE` | Mantener el carrito y mostrar error seguro. |
| Regla inválida o monedas mezcladas | `422 INVALID_ORDER` / `CURRENCY_MISMATCH` | Mantener carrito y señalar el problema. |
| Variante ya no disponible | `404 VARIANT_NOT_FOUND` | Mantener carrito; cambiar producto. |
| Stock insuficiente | `409 INSUFFICIENT_STOCK` | Mantener carrito, identificar variante y permitir corregir/reintentar. |
| ID ya registrado | `409 ORDER_ALREADY_EXISTS` | Consultar ese ID antes de decidir si fue el envío previo. |
| Venta inexistente | `404 ORDER_NOT_FOUND` en detalle | Mostrar ausencia sin filtrar información de otra empresa. |
| Persistencia indisponible | `503 SERVICE_UNAVAILABLE` | Comprobar el ID si el envío pudo llegar a core. |

Cuando core conoce la variante o el índice del artículo afectado, `issues` lo conserva para señalar la línea correcta. El adaptador mobile valida el cuerpo de éxito o error recibido como `unknown`; un código inesperado se convierte en error genérico seguro. Los errores de red y autenticación siguen llegando desde el cliente HTTP existente.

### Operaciones y estado mobile

La estructura sigue los límites de `docs/architecture.md` y el patrón de productos. Se crean archivos solo donde existe una responsabilidad distinta:

```text
apps/core/src/features/orders/presentation/api-routes.ts
apps/core/src/app.ts                           # registra el router
shared/contracts/orders.ts                     # contratos JSON y error de órdenes
shared/contracts/registration.ts               # enum HTTP común
shared/orders-date.ts                           # límites UTC de días en Lima

apps/mobile/src/app/orders/
  _layout.tsx                                   # navegación Stack
  index.tsx                                     # historial
  new.tsx                                       # selección y revisión
  [id].tsx                                      # detalle
apps/mobile/src/features/orders/
  application/order-operations.ts              # armado, validación, consultas y confirmación
  infrastructure/order-api.ts                  # HTTP y validación JSON
  infrastructure/pending-order-confirmation.ts # almacenamiento del intento
  presentation/                                # historial, nueva venta, detalle y guardia de salida
apps/mobile/src/features/orders/composition.ts
apps/mobile/src/components/app-tabs.tsx         # pestaña Ventas
```

Las rutas de `src/app/` solo delegan a pantallas de `features/orders/presentation/`. Las dos etapas «Productos» y «Revisar» viven en `orders/new`, con `OrderDraft` local a esa ruta; un cambio de etapa no navega fuera de ella. La guardia de salida intercepta volver o cambiar de pestaña cuando hay artículos sin confirmar, siguiendo el patrón existente de productos, sin convertir el carrito en estado global. `orders/:id` sirve tanto para abrir una venta desde el historial como para mostrar la recién completada. La pestaña y el acceso directo comprueban que `useAccess().state.status === "ready"`; la API exige autenticación de forma independiente.

#### Adaptadores y firmas

`createOrderApi(request)` recibe el `request` autenticado de `src/shared/infrastructure/api-client.ts` y expone `list`, `get`, `create` y `searchCatalog`. Envía los datos que recibe del caso de uso; trata el cuerpo remoto como `unknown`, lo valida con los esquemas compartidos y devuelve `Result` con el tipo exacto inferido de cada respuesta. Los errores de negocio conservan código e incidencias tipadas y usan `message`, como exige `Result`; respuestas desconocidas o incompatibles pasan a `INVALID_RESPONSE`. La búsqueda se acota a las 20 opciones que devuelve core. `createOrderOperations(api, pendingStore)` recibe esos adaptadores por composición, sin importar HTTP ni almacenamiento dentro de la aplicación.

El caso de uso mobile recibe `OrderDraft`, comprueba sus invariantes, arma `CreateOrderRequest`, calcula el total mostrado y coordina el envío y la recuperación. El estado de resultado distingue explícitamente éxito confirmado y confirmación incierta:

```ts
type ConfirmOrderOutcome =
  | Readonly<{ kind: "completed"; order: OrderResponse; shownTotal: Money }>
  | Readonly<{ kind: "queued"; pending: PendingOrderConfirmation }>;

type OrderRequestError =
  | Readonly<{
      code: Extract<TransportError["code"],
        "UNAUTHENTICATED" | "COMPANY_REQUIRED" | "NETWORK_ERROR" | "SERVICE_UNAVAILABLE"
        | "RATE_LIMITED" | "SERVER_ERROR" | "INVALID_RESPONSE" | "OPERATION_CANCELLED"
        | "SECURE_STORAGE_ERROR" | "API_ERROR">;
      message: string;
    }>
  | Readonly<{
      code: OrderApiError["code"];
      message: string;
      issues?: readonly OrderApiIssue[];
    }>;

type PendingOrderStoreError = Readonly<{
  code: "PENDING_CONFIRMATION" | "PENDING_STORAGE_UNAVAILABLE" | "INVALID_PENDING_DATA";
  message: string;
}>;

type ConfirmOrderError = OrderRequestError | PendingOrderStoreError
  | Readonly<{ code: "INVALID_CART"; message: string }>;

declare function loadOrders(criteria: OrderListCriteria): Promise<Result<z.infer<typeof listOrdersResponseSchema>, OrderRequestError>>;
declare function loadOrder(id: OrderResponse["id"]): Promise<Result<OrderResponse, OrderRequestError>>;
declare function searchOrderCatalog(search: string): Promise<Result<z.infer<typeof orderCatalogSchema>, OrderRequestError>>;
declare function completeOrder(draft: OrderDraft): Promise<Result<ConfirmOrderOutcome, ConfirmOrderError>>;
declare function resolvePendingOrderConfirmation(companyId: string): Promise<Result<ConfirmOrderOutcome | null, ConfirmOrderError>>;
```

Las firmas muestran los tipos existentes y los inferidos de los esquemas: `OrderApiError` se infiere del esquema de órdenes y `TransportError` ya existe en mobile como salida genérica del cliente HTTP. El adaptador convierte ese error en `OrderRequestError`, limitado a fallos de transporte pertinentes y errores propios de órdenes; no expone `http.body` ni códigos de otras features al caso de uso. Las operaciones devuelven ausencia o error de forma explícita; un `404` de detalle durante recuperación no se presenta como confirmación definitiva de que el `POST` falló. La pantalla conserva la selección y las cantidades como estado de interacción, pero el caso de uso decide si forman una venta válida y construye la petición. La pantalla traduce resultados a mensajes, navegación y estados de carga.

`pending-order-confirmation.ts` usa `expo-secure-store` como cola por empresa: cada venta tiene su clave (`yoyos_pending_order_<companyId>_<id>`) y un índice por empresa (`yoyos_pending_orders_<companyId>`) guarda el orden. La entrada se escribe antes de entrar al índice y sale del índice antes de borrarse, para que el índice nunca apunte a una venta no guardada. Expone `list`, `read`, `save`, `replace`, `clear` y `discard`, valida cada entrada con Zod y conserva la petición exacta, el `shownTotal` del primer guardado y, si core la rechazó, `rejection`. `save` con un ID existente devuelve la entrada original. `discard` elimina solo las entradas ilegibles. La clave anterior de un solo intento por empresa se incorpora a la cola al leerla.

La conexión es obligatoria: cuando se sabe que el dispositivo está desconectado se deshabilita la confirmación y se conserva el carrito. El estado de conectividad no prueba que un envío haya llegado o no a core; después de iniciar `POST`, un fallo de red se trata como resultado incierto. El aviso de diferencia de precio aparece únicamente al completar o recuperar ese intento en el mismo celular; el historial ordinario no conoce el total mostrado.

#### Confirmación y recuperación

1. Al agregar el primer artículo, mobile genera el UUID de la venta. Editar cantidades no cambia ese ID. Se impiden artículos repetidos, cantidades inválidas y monedas mezcladas antes de habilitar la confirmación.
2. Al pulsar «Guardar pedido», se guarda la venta en la cola antes de enviar `POST /api/orders`. Si no se puede guardar, no se envía y se muestra un error recuperable. Un doble toque comparte el mismo envío.
3. Si core devuelve éxito, la venta sale de la cola, se abre su detalle y se compara su total con `shownTotal`. Si difiere, se muestran ambos importes para que el vendedor ajuste el cobro fuera de la app.
4. Un rechazo definitivo en el primer envío saca la venta de la cola, conserva el formulario y muestra la corrección posible.
5. Cualquier otro fallo (`NETWORK_ERROR`, `SERVICE_UNAVAILABLE`, `SERVER_ERROR`, una respuesta inválida, `ORDER_ALREADY_EXISTS`) consulta `GET /api/orders/:id`: si la orden existe en la empresa se presenta como resultado; si no, la venta queda en cola (`kind: "queued"`) y la pantalla avisa que se enviará sola.
6. `createPendingOrderSync` envía la cola de la empresa activa con `syncPendingOrders`: consulta cada ID y reenvía solo tras `ORDER_NOT_FOUND`. Mientras queden ventas sin confirmar, reintenta tras `retryDelay` (jitter completo sobre 2 s·2ⁿ, mínimo 1 s, máximo 5 min); volver a la app, recuperar conexión o encolar otra venta reintenta de inmediato y reinicia la espera.
7. Un rechazo definitivo durante la sincronización guarda `rejection` y detiene los reintentos de esa venta. «Nueva venta» la muestra con su motivo; al revisarla se reconstruye con los productos actuales y, al guardarla otra vez, se reemplaza la petición conservando los IDs de la venta y de los pagos.

`ORDER_ALREADY_EXISTS` tampoco equivale por sí solo a éxito. Mobile consulta el ID; si no puede leerlo dentro de la empresa, muestra conflicto. El cliente HTTP existente puede repetir una petición tras renovar el token: el UUID estable y la unicidad en core impiden un segundo descuento de stock, incluso si el vendedor tuvo que reconstruir el carrito.

## Pruebas

### Pruebas de API

#### Unitarias

| ID | Descripción del test |
| --- | --- |
| AU01 | Los handlers validan las entradas y obtienen empresa y vendedor de la sesión, sin aceptar esos datos desde el cliente. |
| AU02 | El listado convierte los filtros validados en `OrderCriteria` y rechaza combinaciones de cliente, fechas o paginación inválidas. |
| AU03 | Los errores de validación y negocio se traducen a los códigos HTTP acordados, sin devolver datos de otra empresa. |

#### Integración

| ID | Descripción del test |
| --- | --- |
| AI01 | Las rutas de órdenes exigen una empresa autenticada; empresas de países distintos pueden consultar y crear ventas por API con aislamiento entre empresas. |
| AI02 | Registrar una venta por API devuelve la orden completada con el total de core, conserva los datos históricos de cliente y artículos, y descuenta el stock una sola vez. |
| AI03 | Una petición inválida o una venta rechazada por stock o variante devuelve el código acordado y no registra una venta parcial. |
| AI04 | Repetir un ID de venta devuelve `ORDER_ALREADY_EXISTS`; consultar ese ID recupera la venta original sin un segundo descuento de stock. |
| AI05 | El listado aplica juntos los filtros de días y cliente, pagina de forma estable y permite abrir el detalle; una empresa no puede leer ventas de otra. |
| AI06 | La búsqueda de productos devuelve solo opciones disponibles para la empresa autenticada y respeta el límite acordado. |

Las pruebas existentes de core siguen cubriendo las reglas internas de creación, concurrencia y atomicidad; estas descripciones se centran en la nueva API HTTP.

### Pruebas de mobile

#### Unitarias

| ID | Descripción del test |
| --- | --- |
| MU01 | Agregar una variante, cambiar su cantidad y quitarla actualiza una sola línea y el total mostrado sin duplicar artículos. |
| MU02 | Una cantidad inválida, una variante sin stock o una combinación de monedas distintas impide confirmar la venta. |
| MU04 | `CreateOrderRequest` contiene solo `id` e `items` con `variantId` y `quantity`; conserva el mismo `id` al editar o reintentar el carrito. |
| MU05 | El filtro «Desde/Hasta» convierte días inclusivos de Lima en un intervalo UTC con inicio inclusivo y fin exclusivo, y muestra la hora de las ventas en Lima. |
| MU06 | La venta no se envía si falla su guardado en la cola y un doble toque no produce dos envíos. |
| MU07 | Un rechazo por stock o variante conserva el carrito editable y señala qué debe corregir el vendedor. |
| MU08 | Al completar o recuperar una venta, se avisa si el total registrado difiere del mostrado; el aviso no aparece al abrir después esa venta desde el historial. |
| MU09 | Una respuesta perdida deja la venta en cola, empieza una venta nueva y la sincronización la envía con el mismo ID tras consultar core, sin duplicarla. |
| MU10 | La cola sobrevive al reinicio y al cierre de sesión, se muestra solo en su empresa y no bloquea ventas nuevas. |
| MU11 | Salir de «Nueva venta» con artículos pide confirmar el descarte y, al volver, abre un carrito vacío. |
| MU12 | Sin conexión no se puede completar una venta; el carrito sigue editable para continuar cuando vuelva la conexión. |
| MU13 | Una venta guardada ilegible se muestra como error recuperable y puede descartarse sin afectar a las legibles. |

#### Integración

| ID | Descripción del test |
| --- | --- |
| MI01 | El flujo mobile permite buscar productos, elegir variantes, revisar, confirmar y abrir el detalle, y descarta el carrito si el vendedor abandona una venta sin confirmar. |
| MI02 | Tras perder la respuesta y reiniciar, la sincronización confirma la venta sin reenviarla; una venta rechazada se revisa y se guarda con sus IDs originales. |
| MI03 | El historial mobile muestra las ventas ordenadas, permite filtrar y avanzar de página, y distingue lista vacía, filtros sin resultados y error de carga. |
