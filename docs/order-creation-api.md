# Creación de órdenes en la API

## Comportamiento acordado

`POST /api/orders` es el endpoint general de creación que usará mobile. Permite crear órdenes pendientes y ventas completadas a partir de los datos y de los hijos incluidos en el cuerpo. No recibe un campo `mode`, `pending` o `immediateSale`: el pago registrado y la entrega realizada son datos de la operación. Toda creación exitosa responde `201` con `orderAggregateSchema`, tanto si la orden queda activa como si se completa.

El contrato de entrada acepta únicamente datos aportados por el cliente. Core obtiene la empresa y el vendedor de la sesión, consulta precios y stock, calcula importes y asigna fechas y estados. No se acepta el agregado de respuesta como entrada ni se permite que el cliente fije `status`, `stockDeducted`, `total` o `completedAt`.

### Orden pendiente

Mobile envía cliente y productos, sin pago ni entrega:

```json
{
  "id": "<UUID estable generado por el cliente>",
  "contactId": null,
  "items": [{ "variantId": "<UUID>", "quantity": 1 }]
}
```

### Venta completada

Mobile incluye el pago total y la confirmación de entrega en mano:

```json
{
  "id": "<UUID estable generado por el cliente>",
  "contactId": null,
  "items": [{ "variantId": "<UUID>", "quantity": 1 }],
  "payment": { "method": "digital_wallet" },
  "delivery": { "method": "handover" }
}
```

`payment` registra un pago por el total calculado por Core; el endpoint no procesa un cobro externo. Su único campo es `method: digital_wallet`, y el servidor genera el ID del pago. Se usan los precios vigentes del catálogo al crear la orden, aunque difieran de los mostrados en mobile; la respuesta contiene los importes definitivos.

`delivery: { method: handover }` confirma que la entrega en mano ya ocurrió. No configura un envío futuro ni añade un nuevo método de envío persistido: la venta queda con `delivery: null` y `deliveryStatus: delivered`.

| Hijos incluidos | Resultado inicial |
| --- | --- |
| Ninguno | `status: active`, `paymentStatus: pending`, `deliveryStatus: pending`, `stockDeducted: false`, sin pagos y `completedAt: null`. No descuenta ni reserva stock. |
| `payment` y `delivery: handover` | `status: completed`, `paymentStatus: paid`, `deliveryStatus: delivered`, `stockDeducted: true`, un pago por el total y `completedAt` asignado por Core. Todo ocurre en una transacción. |
| Solo uno de ellos | `400 INVALID_INPUT`; no se crea la orden. |

El contrato se validará en `shared/contracts/orders.ts` con objetos estrictos: `contactId` es un UUID de contacto de la empresa o `null` para público general; los productos contienen UUID de variante y cantidad entera positiva, con al menos un producto y sin variantes repetidas. Los contactos y variantes deben pertenecer a la empresa de la sesión. Se rechazan campos adicionales, incluidos importes, estados y fechas calculados por Core.

Este alcance no acepta pagos parciales, varios pagos, un pago con entrega pendiente ni entregas con destino durante la creación. Las acciones posteriores sobre una orden activa conservan sus propias reglas.

## Errores y recuperación en mobile

- Un cuerpo inválido o una combinación de hijos no admitida devuelve `400 INVALID_INPUT`. Los errores de dominio conservan sus códigos actuales, como `422 INVALID_ORDER` o `422 CURRENCY_MISMATCH`; un contacto o variante no disponible devuelve `404` con el código correspondiente.
- Una venta completada sin stock suficiente devuelve `409 INSUFFICIENT_STOCK` y revierte creación, pago, descuento y entrega. Crear una orden pendiente no exige stock suficiente porque no lo descuenta ni lo reserva.
- Una indisponibilidad conocida de persistencia devuelve `503 SERVICE_UNAVAILABLE`. Una respuesta perdida o un error técnico no permiten a mobile asumir que la operación no ocurrió.
- Mobile genera y conserva el mismo UUID de orden para todos los intentos de una creación. Si ese ID ya existe en la empresa, el endpoint devuelve `409 ORDER_ALREADY_EXISTS` sin modificar la orden ni repetir pagos o descuentos; no devuelve otro `201`.
- Ante una respuesta incierta o `ORDER_ALREADY_EXISTS`, mobile consulta `GET /api/orders/:id/aggregate` y verifica empresa, ID y el resultado esperado. La pantalla de venta completada exige pago cubierto, entrega realizada y stock descontado; recibir una orden pendiente no confirma esa venta.
- Si la consulta devuelve `ORDER_NOT_FOUND`, mobile puede reintentar con el mismo ID. Si la consulta falla, conserva la operación como incierta. No genera un ID nuevo para resolver un intento incierto.

## Coordinación en Core

El adaptador HTTP valida el cuerpo una vez y usa el caso de uso correspondiente a los hijos presentes: `createOrder` para la orden inicial sin ellos y `registerImmediateSale` para pago y entrega en mano. Ambos ya comparten la construcción de la orden. Esta selección queda en la capa de aplicación o presentación; no se guarda un tipo de orden ni se divide la entidad.

La venta inmediata debe seguir siendo atómica: creación, pago, descuento de stock y entrega se confirman juntos o se revierten juntos. No se implementa llamando en secuencia a los casos de uso públicos `registerPayment`, `deductStock` y `registerDelivery`: `registerPayment` confirma el pago antes de intentar el descuento en otra transacción y tiene una semántica distinta.

## Impacto de migración

- `POST /api/orders/pending` deja de ser necesario. No tiene consumidor de pantalla actual; el adaptador móvil `createPending` existe, pero solo lo usan pruebas.
- La pantalla móvil de venta nueva llama actualmente a `POST /api/orders/immediate-sale`. Debe enviar los hijos al nuevo `POST /api/orders` y seguir verificando el resultado por ID cuando la respuesta sea incierta.
- `POST /api/orders` ya existe para venta inmediata con el cuerpo antiguo y devuelve `orderSchema`, no `orderAggregateSchema`. Ese cuerpo coincide con la nueva creación pendiente, por lo que no se puede distinguir automáticamente entre ambos contratos. Antes de sustituir la ruta hay que actualizar o retirar sus consumidores antiguos. Durante la transición, mobile puede seguir usando `/immediate-sale` hasta adoptar el nuevo contrato; las rutas antiguas se retiran cuando sus consumidores hayan migrado.
- La web de Core llama directamente a `registerImmediateSale`; no usa estas rutas HTTP. Puede conservar ese caso de uso.
- Se actualizan las pruebas de rutas, adaptador móvil, integración y E2E que mencionan los dos paths. `GET /api/orders` y `GET /api/orders/mixed` tienen contratos de lectura distintos y quedan fuera de este cambio de creación.

## Plan de implementación

Los siguientes cambios describen la implementación del contrato acordado.

### 1. Contrato compartido

Archivo: `shared/contracts/orders.ts`.

- Extraer el esquema actual de selección (`id`, `contactId`, `items`) como `orderSelectionSchema`, con su tipo `OrderSelectionRequest`. Será la base común de los dos cuerpos de creación y de los consumidores que solo preparan una selección.
- Convertir `createOrderSchema` y `CreateOrderRequest` en el contrato del endpoint general. Debe admitir exactamente dos formas: selección sin hijos, o selección con `payment: { method: digital_wallet }` y `delivery: { method: handover }`. Validar ambas formas como objetos estrictos; hijos omitidos y valores `null` no son equivalentes.
- Rechazar un solo hijo, métodos diferentes, importes e IDs de pago enviados por el cliente y campos calculados por Core. La validación HTTP debe fallar antes de llamar a un caso de uso.
- Mantener el rechazo de variantes repetidas como `INVALID_ORDER` en los casos de uso actuales; no cambiar ese error a `INVALID_INPUT` al ampliar el contrato.
- Reutilizar `orderAggregateSchema` como respuesta de creación. `orderSchema` continúa siendo el contrato de las lecturas antiguas que todavía lo utilizan.

La selección contiene datos para construir la orden; los hijos indican operaciones que Core debe realizar durante la creación. No se pasa el cuerpo HTTP completo a los casos de uso internos, porque estos validan una selección estricta.

### 2. Casos de uso de Core

| Archivo o función | Cambio previsto |
| --- | --- |
| `apps/core/src/features/orders/application/create-order.ts`: `createOrder` | Conservar su entrada `CreateOrderInput` y su comportamiento: validar selección, resolver cliente y catálogo, construir snapshots y guardar una orden pendiente en una transacción. |
| Mismo archivo: `createOrderInTransaction` | Conservar la construcción compartida que reutiliza la venta inmediata. |
| `apps/core/src/features/orders/application/register-immediate-sale.ts`: `registerImmediateSale` | Conservar su entrada y su transacción: crear, registrar un pago por el total, descontar todos los productos y confirmar la entrega. El contrato HTTP solo admite el método que este caso de uso ya soporta. |
| `apps/core/src/features/orders/composition.ts` | Reutilizar `orders.create` y `orders.registerImmediateSale` con sus dependencias actuales. |
| `registerPayment`, `deductStock` y las operaciones de entrega | Conservar sus contratos para actuar sobre órdenes existentes. No utilizarlos en secuencia para construir la venta completada. |

**No hace falta cambiar la lógica de un caso de uso de dominio o aplicación para soportar este alcance.** Cambia la entrada pública de creación y su integración con los dos casos de uso existentes. La selección entre ellos se implementará directamente en el adaptador HTTP; no requiere un nuevo caso de uso ni una transacción exterior que envuelva sus transacciones actuales.

La infraestructura actual ya guarda orden, productos, pagos, descuento y cumplimiento. Este cambio de API no requiere migraciones de base de datos ni persistir `handover`, un tipo de orden o un indicador de venta inmediata.

### 3. Adaptador HTTP de Core

Archivo: `apps/core/src/features/orders/presentation/api-routes.ts`.

1. Sustituir el manejador actual de `POST /` por la creación general. Mantener la exigencia de JSON y validar el cuerpo con el nuevo `createOrderSchema`.
2. Adaptar `pendingInput` para recibir la selección común y producir exclusivamente `CreateOrderInput`: `id`, `contactId` e `items`. Puede renombrarse a `toCreateOrderInput`, ya que lo usan ambos flujos.
3. Obtener `companyId` y `userId` con `orderContext(response)`, como hoy.
4. Sin hijos, llamar a `orders.create(input, context)`. Con los dos hijos validados, llamar a `orders.registerImmediateSale(input, context)`.
5. Serializar ambos resultados con `toOrderAggregateJson` de `presentation/order-json.ts` y responder `201`. El nuevo POST deja de usar `toLegacyOrderJson`; ese serializador sigue atendiendo las lecturas antiguas.
6. Reutilizar `operationError` y el manejo de fallos inesperados. Conservar autenticación, aislamiento por empresa, límites de JSON, rechazo de claves duplicadas y `Cache-Control: no-store` configurados en `apps/core/src/app.ts`.

Durante una transición que requiera las rutas `/pending` e `/immediate-sale`, estas deben seguir validando la selección antigua, no el contrato general con hijos. Así una versión anterior de mobile puede seguir utilizando `/immediate-sale` sin cambiar su cuerpo ni su respuesta. Retirar esos manejadores cuando ya no tengan consumidores.

### 4. Integración en mobile

El adaptador de red será general; la operación de aplicación `completeOrder` seguirá representando la venta completada de la pantalla actual.

| Archivo | Modificación |
| --- | --- |
| `apps/mobile/src/features/orders/infrastructure/order-api.ts` | Hacer que `create(input: CreateOrderRequest)` valide el contrato general y envíe `POST /api/orders`. Mantener la validación de respuesta con `orderAggregateSchema` y el mapeo de errores. El adaptador no añade automáticamente pago ni entrega. |
| Mismo archivo: `createPending` | Retirar el método duplicado cuando se migren sus pruebas. Crear pendiente pasa a ser `create(selection)` sin hijos, mediante el mismo adaptador. |
| `apps/mobile/src/features/orders/domain/order-draft.ts` | Usar `OrderSelectionRequest` y `orderSelectionSchema` para la selección que produce `prepareOrder`. Mantener `shownTotal` como cálculo local para mostrar y comparar con el total definitivo. |
| `apps/mobile/src/features/orders/application/order-operations.ts` | Dentro de `completeOrder`/`send`, añadir los dos hijos a la selección preparada antes de llamar a `api.create`. Conservar la validación de empresa, ID y venta completada, la exclusión de envíos simultáneos y la recuperación por consulta. |
| `apps/mobile/src/features/orders/presentation/new-order-screen.tsx` | Mantener su llamada a `orders.completeOrder`. La pantalla actual sigue confirmando una venta completada; no debe llamar al adaptador directamente ni construir estados calculados por Core. |
| `apps/mobile/src/features/orders/infrastructure/pending-order-confirmation.ts` | Mantener el almacenamiento y su formato actual para recuperar ventas con respuesta incierta. Su nombre se refiere a una confirmación pendiente, no a una orden de negocio sin pagar. |
| `apps/mobile/src/features/orders/composition.ts` | Mantener la conexión entre adaptador, almacenamiento y operaciones; sus dependencias ya permiten esta integración. |

La llamada de aplicación para la pantalla actual será equivalente a:

```ts
const request: CreateOrderRequest = {
  ...prepared.data.request,
  payment: { method: "digital_wallet" },
  delivery: { method: "handover" },
};
const result = await api.create(request);
```

Añadir los hijos en `completeOrder` expresa la intención de esa operación. `prepareOrder` se limita a preparar los datos seleccionados; `api.create` transmite el cuerpo recibido y valida la respuesta. Cambiar únicamente la URL de `api.create` es incorrecto: el cuerpo actual sin hijos crearía una orden pendiente y `completedImmediateSale` rechazaría el resultado.

Se conserva el orden de recuperación actual: guardar la confirmación local antes del POST, enviar con el ID estable y comprobar el agregado tras un conflicto o una respuesta incierta. El almacenamiento existente debe seguir siendo legible tras actualizar mobile, para recuperar ventas enviadas por la versión anterior. La confirmación local se limpia siguiendo el flujo actual de reconocimiento del resultado y los errores definitivos.

#### Creación pendiente desde mobile

El adaptador queda preparado para crearla enviando únicamente la selección. Actualmente no existe una pantalla consumidora de `createPending`; esta migración de la pantalla de venta no añade una pantalla nueva ni un botón para guardar pendientes.

Cuando se integre un consumidor de creación pendiente, deberá tener una operación de aplicación que valide identidad y resultado de creación, y recuperar respuestas inciertas según esa intención. No puede reutilizar `completeOrder`, porque este exige una venta pagada y entregada. Tampoco debe exigir que una orden recuperada siga pendiente para reconocer su existencia: pudo recibir pagos o entregarse después de la creación.

El carrito actual de venta inmediata limita cantidades al stock mostrado. Un consumidor de creación pendiente necesitará validar selección y cantidades positivas sin ese límite, porque crear pendiente no exige disponibilidad. No se deben eliminar las restricciones del carrito de venta inmediata para resolver ese futuro flujo.

### 5. Consumidor web y compatibilidad

Archivo: `apps/core/app/routes/order-new.tsx`.

La acción web seguirá validando su selección con `orderSelectionSchema` y llamando directamente a `orders.registerImmediateSale`. Su formulario actual no incluye hijos; conservar la validación de selección evita acoplarlo al contrato HTTP general. Debe actualizarse el import al extraer el esquema, aunque su comportamiento de venta inmediata no cambie.

Antes de sustituir el contrato antiguo de `POST /api/orders`, revisar todos sus consumidores y datos de prueba. Los cuerpos destinados a completar ventas deberán incluir los dos hijos; los destinados a crear pendientes deberán omitirlos. No basta con reemplazar los paths en todas las pruebas.

Si hay versiones de mobile publicadas que usan `/immediate-sale`, desplegar primero el nuevo endpoint manteniendo esa ruta, después publicar mobile con el nuevo cuerpo y retirar la ruta antigua cuando la política de versiones lo permita. La compatibilidad de un consumidor que aún use el POST raíz antiguo debe resolverse antes de sustituirlo, porque su cuerpo coincide con una creación pendiente.

### 6. Pruebas y criterios de aceptación

Actualizar las pruebas existentes para demostrar los siguientes resultados:

| Pruebas | Qué verificar |
| --- | --- |
| Core: `presentation/order-json.test.ts` | Aceptar los dos cuerpos; rechazar hijos incompletos, `null`, métodos no admitidos y campos adicionales tanto en la raíz como en hijos y productos. |
| Core: `presentation/api-routes.test.ts` | Comprobar que cada cuerpo selecciona solo su caso de uso, pasa únicamente la selección y obtiene empresa y vendedor de la sesión. Ambos responden con el agregado, y los cuerpos inválidos no ejecutan casos de uso. |
| Core: `presentation/api-routes.integration.test.ts` | Crear pendiente sin pagos ni descuento, incluso sin stock suficiente; completar venta con pago y descuento; verificar reversión por stock insuficiente, conflicto por ID y aislamiento entre empresas. Adaptar las expectativas antiguas de importes numéricos a los objetos `Money` del agregado en respuestas de creación. |
| Core: pruebas existentes de `create-order`, `register-immediate-sale` y repositorio | Conservar la cobertura de invariantes y atomicidad. Ampliarla solo si la integración revela una garantía que no esté cubierta. |
| Mobile: `infrastructure/order-api.test.ts` | Ambos cuerpos usan `POST /api/orders`; el adaptador transmite los hijos recibidos y valida el agregado. Migrar las pruebas de `createPending` al método general. |
| Mobile: `domain/order-draft.test.ts` | `prepareOrder` devuelve selección sin hijos y conserva el total mostrado, el ID estable y las validaciones del carrito de venta inmediata. |
| Mobile: `application/order-operations.test.ts` | `completeOrder` añade pago y entrega; mantiene la recuperación ante respuesta perdida, reinicio y `ORDER_ALREADY_EXISTS`; no acepta una orden pendiente como venta completada. Actualizar los transportes simulados que reconocen `/immediate-sale`. |
| Mobile: `presentation/new-order-screen.test.tsx` | La pantalla sigue mostrando éxito, error o confirmación incierta según el resultado de `completeOrder`; adaptar los mocks que dependan del cuerpo o la ruta. |
| Core E2E: `tests/e2e/orders.spec.ts` | Conservar la venta desde la web y sus garantías. Actualizar únicamente las llamadas HTTP de creación y expectativas que dependan del contrato cambiado. |

Validar la implementación con las comprobaciones del proyecto:

```sh
pnpm --dir apps/core lint
pnpm --dir apps/core typecheck
pnpm --dir apps/core test:unit
pnpm --dir apps/mobile lint
pnpm --dir apps/mobile typecheck
pnpm --dir apps/mobile test
```

Desde `apps/core`, ejecutar además `sh scripts/run-tests.sh integration` y `sh scripts/run-tests.sh e2e` con los servicios requeridos disponibles.
