# Checkout del pedido por link

Definiciones de producto y arquitectura acordadas para [MVP · Checkout del pedido por link](https://app.todoist.com/app/task/6hfvfVX2fwpmcwx3).

Este documento recoge el alcance implementado y sus contratos de producto, arquitectura y observabilidad. La evidencia local y las comprobaciones de despliegue pendientes se detallan al final. Última consolidación: 6 de octubre de 2026.

## Objetivo

Permitir que el vendedor comparta un pedido existente y que el comprador revise sus productos e importes, complete sus datos y confirme su intención de compra desde el navegador móvil, sin cuenta ni instalación.

La confirmación actualiza el mismo pedido. Es independiente de su pago y no registra un cobro, una entrega ni un descuento de stock.

## Alcance y responsabilidades

Esta tarea incluye:

- Habilitar y copiar el enlace de un pedido existente.
- Mostrar productos y cantidades definidos por el vendedor, sin edición por el comprador.
- Precargar los datos disponibles del comprador y permitir completarlos o corregirlos antes de confirmar.
- Guardar el comprador en una tabla propia del pedido.
- Confirmar el pedido de forma atómica e idempotente.
- Mostrar la confirmación en lista y detalle del vendedor, separada del estado de pago.
- Asignar un número visible a todos los pedidos.

| Responsabilidad | Módulo o tarea propietaria |
| --- | --- |
| Seleccionar modalidad, agencia o punto de recojo | Modalidades de entrega; el comprador elige entre las opciones habilitadas. |
| Capturar destinatario y dirección de destino | Modalidades de entrega. |
| Integrar el costo de envío en el pedido | Modalidades de entrega, con las reglas de tarifas correspondientes. |
| Validar cobertura y definir tarifas por zona | Tarea de zonas/cobertura; no se implementa en este worktree. |
| Instrucciones de pago y confirmación manual del cobro | Pago con confirmación manual. |
| Exponer los importes del pedido al comprador | Checkout, leyendo los importes autoritativos del pedido. |

El checkout integra la selección de modalidades habilitadas, destinatario y dirección, además de las instrucciones de cobro configuradas. Si la entrega cambia o se elige por primera vez, el comprador confirma sus datos y la tienda cotiza antes de habilitar el pago. No se calculan tarifas automáticas ni cobertura por zona.

Quedan fuera el catálogo público, carrito editable, creación del pedido desde un chat, pasarela de pago, notificaciones adicionales y cambios de productos. Para cambiar productos se cancelaría el pedido y se crearía otro; ese flujo queda fuera de esta tarea.

Compartir significa obtener y copiar una URL. No se agrega configuración de contacto de WhatsApp, `Company.whatsappContactPhone`, botón de chat ni asociación con una conversación. Después de confirmar, el comprador solicita cambios al vendedor por el canal que ya utilicen.

## Comportamiento del checkout

| Situación | Comportamiento |
| --- | --- |
| Checkout no habilitado | No ofrece acceso público; el vendedor puede habilitarlo si el pedido no está cancelado. |
| Pendiente | Resume datos precargados; permite editar comprador y entrega habilitada antes de confirmar. |
| Confirmado | Datos de solo lectura. Si hay cotización pendiente, espera el costo; en otro caso muestra instrucciones de pago y carga del comprobante. Repetir la confirmación no sobrescribe datos. |
| Cancelado | Muestra la cancelación y bloquea la confirmación, aunque hubiera sido confirmado antes. |

- El enlace no vence automáticamente.
- Volver a solicitar el enlace devuelve la misma URL.
- Un pedido pagado puede usar checkout; pagar y confirmar son acciones independientes.
- No se agrega un cierre del checkout basado en envío o entrega. La propuesta de bloquear por envío fue descartada.
- Los pedidos históricos sin checkout habilitado no se muestran como pendientes de confirmación.
- Confirmar requiere un nombre no vacío y un teléfono válido. No se exige nombre legal completo, apellidos ni un número de palabras.

## Entrega y pago en la misma página

- `checkoutDeliveryRequest` conserva el snapshot solicitado por el comprador, separado de la entrega ya cotizada. Confirmar una solicitud no inventa costo cero ni modifica el total anterior.
- La tienda confirma un importe explícito (incluido cero) e indica si se cobra al comprador desde el detalle del pedido. La operación privada `/api/orders/:orderId/checkout-delivery-quote` valida empresa, estado e importe, actualiza entrega y total y limpia la solicitud en una transacción.
- Mientras hay solicitud pendiente, el checkout muestra productos y «Entrega por confirmar», sin presentar el importe anterior como total final. El comprador puede actualizar el estado desde la misma página.
- Un checkout pendiente de confirmación o cotización oculta las instrucciones y rechaza nuevos avisos de pago en el servidor. Los enlaces de pago históricos de pedidos sin checkout habilitado conservan su funcionamiento.
- Se reutilizan los datos de cobro de la empresa: una billetera configurada (Yape o Plin) y transferencia. Se muestra un medio a la vez y permite copiar cuenta/CCI. Solo se muestra la imagen de pago cargada por la tienda.
- «Ya pagué» requiere una captura JPG, PNG o WEBP de hasta 10 MB. El aviso conserva idempotencia al reintentar y queda pendiente de revisión; únicamente la confirmación del vendedor registra el importe recibido.
- Vista de escritorio con resumen lateral; móvil con productos desplegables. La opción visual aprobada y sus capturas están en `.impeccable/surfaces/apps-core-app-routes-checkout-tsx.md`.

## Identificación y acceso público

La URL acordada es:

```text
/checkout/:companyId/:orderId
```

Ambos parámetros son UUID. El número visible, por ejemplo `Pedido #1001`, no se utiliza para resolver el acceso público.

El enlace actúa como credencial de acceso al checkout: quien lo conoce puede consultar la proyección pública y confirmar si está pendiente. Los UUID deben generarse aleatoriamente; validar su formato por sí solo no constituye autorización.

El servidor:

1. Valida los UUID de ambos parámetros.
2. Establece el contexto de empresa para esa operación pública.
3. Consulta el pedido dentro de ese contexto y verifica su pertenencia a la empresa y que tenga checkout habilitado.
4. Aplica las reglas de consulta o confirmación según el estado actual.

La empresa indicada en la URL solo delimita esta operación pública; no concede acceso a rutas privadas. Cambiarla no permite acceder a un pedido de otra empresa. Se preservan RLS y los filtros por empresa, sin consultas globales de pedidos ni clientes que omitan el aislamiento.

No se usa token firmado, clave adicional ni tabla de enlaces. Esta decisión sustituye la propuesta inicial de `/checkout/:token`.

Las respuestas públicas no se almacenan en caché compartida. Se evita registrar la URL completa que concede acceso. Una combinación inválida, inexistente o sin checkout habilitado muestra el mismo mensaje: “Enlace no disponible”.

## Modelo de datos y persistencia

### Numeración de pedidos

| Campo | Definición |
| --- | --- |
| `Order.id` | UUID interno y referencia del pedido en el enlace. |
| `Order.number` | Entero correlativo por empresa, empezando en 1001. |
| `Company.nextOrderNumber` | Siguiente número disponible; inicialmente 1001. |

- La secuencia continúa de 9999 a 10000 sin reiniciarse ni tener ancho fijo de presentación.
- El número se asigna al crear cualquier pedido, incluidas las ventas inmediatas.
- Se muestra como `Pedido #1001` en listas, detalles, checkout y referencias visibles.
- Es permanente y no se reutiliza al cancelar.
- Un incremento atómico del contador y la creación del pedido ocurren en la misma transacción.
- La base de datos impone unicidad de `(companyId, number)`; no se calcula con `MAX + 1` ni contando pedidos.
- Persistencia usa `BIGINT`; dominio y JSON usan enteros seguros entre 1001 y `Number.MAX_SAFE_INTEGER`. El contador puede llegar a ese máximo más uno para representar agotamiento; se rechazan nuevas asignaciones sin perder precisión. El límite no es 9999.

### Comprador del pedido

`OrderBuyer` guarda una copia de los datos del comprador para un solo pedido. No representa un comprador global reutilizado entre pedidos.

| Campo | Definición |
| --- | --- |
| `orderId` | Clave primaria; como máximo un comprador por pedido. |
| `companyId` | Empresa propietaria, usada en RLS y relaciones compuestas. |
| `contactId` | Referencia opcional a un contacto de esa misma empresa. |
| `name` | Puede ser nulo antes de confirmar, para conservar contactos que solo tienen teléfono. |
| `phone` | Teléfono del comprador. |

Cuando no hay datos de comprador, no existe fila: el agregado expone `buyer: OrderBuyer | null`.

La relación con el pedido incluye `(companyId, orderId)` y la relación opcional con Contact incluye `(companyId, contactId)`. Confirmar exige nombre no vacío y teléfono válido. `contactId` se obtiene del contexto del servidor; el comprador no lo elige desde el formulario público.

Editar el comprador del pedido no modifica automáticamente el Contact global. No se utiliza `ensureContact` para propagar una edición pública a la agenda de contactos.

### Estado de checkout

Se agregan a Order:

- `checkoutEnabledAt`, fecha nullable de habilitación.
- `checkoutConfirmedAt`, fecha nullable de confirmación.

Se deriva el estado interno `not_enabled`, `pending` o `confirmed` de esas fechas. No se persiste otra columna de estado de checkout. La cancelación del pedido tiene precedencia en la vista pública sin borrar las fechas existentes.

Una restricción garantiza que no exista `checkoutConfirmedAt` sin `checkoutEnabledAt`. La existencia de un comprador válido al confirmar se garantiza mediante las reglas de dominio y la transacción; no mediante un CHECK que intente consultar otra tabla.

### Migración

1. Numerar los pedidos existentes por empresa en orden de creación, con un desempate estable por ID, y avanzar sus contadores.
2. Migrar `Order.contactId`, `contactName` y `contactPhone` a `OrderBuyer`, conservando los datos existentes.
3. Actualizar lecturas, escrituras, filtros y consumidores para mantener una sola fuente de datos del comprador; retirar las columnas anteriores al completar la transición.
4. Dejar ambas fechas de checkout en null para los pedidos históricos.
5. Incorporar índices, restricciones, RLS y permisos del rol de aplicación para la nueva tabla.

Durante la migración de numeración deben detenerse las escrituras de pedidos hasta desplegar la aplicación que asigna el contador. El backfill se separa de los bloqueos de DDL, con esperas acotadas e índice único concurrente.

Las migraciones deben generarse con Prisma CLI y revisarse según [database-migrations](../.agents/skills/database-migrations/SKILL.md). No se eliminan datos ni volúmenes para aplicar el cambio.

## Importes e integración con otros módulos

El checkout consume dos importes de tipo `Money` del pedido:

```ts
type CheckoutAmounts = Readonly<{
  itemsTotal: Money;
  total: Money;
}>;
```

`itemsTotal` es el subtotal de productos. `total` es el importe total que corresponde pagar al cliente final, incluidos los conceptos que incorporen los módulos integrados. El checkout no recalcula ese total en el navegador ni muestra el subtotal bajo la etiqueta de total.

Otros módulos actualizan el total autoritativo del pedido al agregar sus conceptos. Los pagos modifican el saldo, no el total de la compra. Esta tarea no agrega el costo de envío ni implementa pagos o dirección de destino.

`expectedTotal` representa el importe y la moneda que el comprador vio al confirmar. Se compara con el total actual bajo el bloqueo del pedido. No establece el precio ni se persiste como fuente de verdad. Si cambió, se conserva el formulario, se presenta el nuevo importe y se requiere una nueva confirmación.

## Casos de uso

### Nuevos

| Caso de uso | Responsabilidad |
| --- | --- |
| `enableOrderCheckout` | Con acceso autenticado del vendedor, verificar pertenencia y cancelación, habilitar una sola vez y devolver la URL estable. |
| `getOrderCheckout` | Con el alcance público de empresa y pedido, verificar habilitación y devolver la proyección pública. |
| `confirmOrderCheckout` | Validar datos y total, guardar comprador y confirmación de manera atómica y devolver el resumen. |

No se crean `previewOrderCheckout`, `DeliveryChargePolicy`, `setCompanyWhatsAppContact` ni un caso de uso independiente para crear compradores.

### Existentes que cambian

| Flujo | Cambio |
| --- | --- |
| `createOrder` / `createOrderInTransaction` | Asignar número y persistir OrderBuyer dentro de la transacción de creación. |
| `registerImmediateSale` | Reutilizar esa creación para número y comprador; no habilitar checkout automáticamente. |
| `readOrderAggregate` | Leer el comprador desde su tabla e incorporar número y fechas de checkout. |
| `listOrderAggregates` | Incorporar esos datos y adaptar los filtros basados actualmente en `Order.contactId`. |
| Cancelación | Mantener sus reglas existentes; el checkout refleja la cancelación y rechaza confirmaciones posteriores. |

Un comprador sin `contactId` no equivale a ausencia de comprador. Se deben adaptar las representaciones y filtros actuales que solo distinguen `general_public` y `contact`.

La tarea parte de pedidos existentes. No agrega por implicación un flujo nuevo de creación de pedidos pendientes en la interfaz del vendedor.

## Tipado y límites de confianza

Se reutilizan `CompanyId`, `OrderId`, `UserId`, `ContactId`, `Money` y `Result`. Se agregan los tipos validados `OrderNumber`, `BuyerName` y `PhoneNumber`, reutilizando las reglas existentes cuando correspondan. Las marcas de TypeScript no sustituyen validación en ejecución.

Formas conceptuales de los contratos de aplicación:

```ts
type OrderAccess = Readonly<{
  companyId: CompanyId;
  userId: UserId;
}>;

type CheckoutAccess = Readonly<{
  companyId: CompanyId;
  orderId: OrderId;
}>;

type EnableOrderCheckoutInput = Readonly<{ orderId: OrderId }>;
type EnableOrderCheckoutOutput = Readonly<{ url: string }>;

type BuyerData = Readonly<{
  name: BuyerName;
  phone: PhoneNumber;
}>;

type ConfirmOrderCheckoutInput = Readonly<{
  buyer: BuyerData;
  expectedTotal: Money;
}>;

type PublicCheckoutState =
  | Readonly<{ kind: "pending" }>
  | Readonly<{ kind: "confirmed"; confirmedAt: string }>
  | Readonly<{ kind: "cancelled" }>;
```

`OrderAccess` representa la identidad autenticada y su empresa, no un sistema nuevo de roles. `CheckoutAccess` delimita una operación pública; poseer un objeto de ese tipo no autoriza por sí mismo el acceso. Los casos de uso verifican pertenencia y habilitación en persistencia.

Los parámetros y cuerpos externos se validan con esquemas estrictos. Los contratos de transporte viven en `shared/contracts/order-checkout.ts`, con tipos inferidos de los esquemas; no importan entidades ni modelos de persistencia de core. Los casos de uso conservan tipos propios y retornan `Result` con errores explícitos. Las fechas del transporte se serializan como texto ISO.

El cuerpo público de confirmación no permite elegir empresa, pedido, contacto, precios ni fecha de confirmación. Empresa y pedido provienen de los parámetros validados de la ruta; la fecha se establece en el servidor.

## Rutas y proyección pública

| Ruta | Acceso | Caso de uso |
| --- | --- | --- |
| `POST /api/orders/:orderId/checkout-link` | Vendedor autenticado; empresa desde la sesión | `enableOrderCheckout` |
| `GET /checkout/:companyId/:orderId` | Público mediante enlace; loader de la página | `getOrderCheckout` |
| `POST /checkout/:companyId/:orderId` | Público mediante enlace; action de la página | `confirmOrderCheckout` |

Las rutas de la página pública se montan fuera de la autenticación de vendedores. No se duplica el flujo con otra API pública equivalente.

La respuesta pública contiene nombre de la tienda, número del pedido, productos, cantidades, precios de venta, `itemsTotal`, `total`, datos disponibles del comprador y estado del checkout. No se devuelve el agregado privado completo, costos internos, identificadores de contactos o vendedores ni registros de pago.

| Resultado | Comportamiento |
| --- | --- |
| Confirmación correcta | Mostrar resumen confirmado. |
| Ya confirmado | Responder con el resumen sin modificar comprador ni fecha. |
| Total desactualizado | Informar el conflicto, actualizar el importe mostrado y pedir nueva confirmación. |
| Pedido cancelado | Mostrar cancelación y bloquear confirmación. |
| Datos inválidos | Mostrar errores asociados a los campos. |
| Enlace no disponible | Respuesta pública uniforme para combinación inválida, inexistente o no habilitada. |
| Fallo de persistencia | No mostrar éxito ni dejar una confirmación parcial; permitir reintento. |

## Transacción de confirmación y concurrencia

1. Establecer el alcance de empresa con los parámetros validados.
2. Abrir una transacción y bloquear el pedido de esa empresa.
3. Verificar existencia, checkout habilitado y ausencia de cancelación.
4. Si ya está confirmado, devolver el resumen sin sobrescribir datos.
5. Validar las reglas del comprador y comparar `expectedTotal` con el total actual.
6. Guardar OrderBuyer y `checkoutConfirmedAt` en la misma transacción.
7. Confirmar todas las escrituras o revertirlas juntas ante un error.

La validación estructural del cuerpo ocurre en el límite HTTP antes de invocar el caso de uso. Las reglas de estado y consistencia se comprueban dentro de la transacción.

Dos confirmaciones simultáneas se serializan por el bloqueo del pedido. La segunda devuelve el resultado existente. Las operaciones que modifiquen comprador, total o cancelación deben respetar ese mismo bloqueo para evitar carreras. Se reutilizan la infraestructura de transacciones y la lectura para actualización existentes.

## Organización y consumidores

La funcionalidad pertenece a `apps/core/src/features/orders/` y sigue [arquitectura](architecture.md), [dominio](domain.md), [persistencia](persistence.md), [RLS](rls-with-prisma.md) y [tipado](programming-style.md).

- Dominio: reglas puras del comprador, número y estado del checkout.
- Aplicación: los tres casos de uso y coordinación transaccional con dependencias explícitas.
- Infraestructura: repositorio de pedidos, persistencia de OrderBuyer y contador por empresa.
- Presentación: endpoint privado y página pública con validación de entrada y adaptación de errores.
- Composición: conectar esas operaciones con las dependencias existentes.
- Contratos compartidos y consumidores web/móvil: adaptar comprador, número y confirmación sin confundirla con recuperación local de operaciones o estado de pago.

El vendedor ve el número del pedido, puede copiar el enlace y distingue “Pendiente de confirmación” de “Confirmado por el comprador”. No se añade una notificación separada.

## Observabilidad: qué registrar y dónde

Esta sección define el contrato de observabilidad para checkout y sus cambios de persistencia. La instrumentación se comprueba con logs reales del servidor y pruebas de fallos; la recepción remota se valida durante el despliegue. Se reutiliza el logger de servidor `log` y la infraestructura descrita en [logging](logging.md) y [convenciones de logging](logging-conventions.md). No se crea otra biblioteca, wrapper, tabla de logs ni sistema de auditoría.

### Análisis del flujo actual y puntos críticos

| Lugar actual o previsto | Riesgo que debe poder diagnosticarse | Decisión de observabilidad |
| --- | --- | --- |
| `src/shared/infrastructure/logger.ts`, montado desde `src/app.ts` en core | Petición fallida o lenta sin correlación; ruta de checkout confundida con el comodín de la aplicación web. | Reutilizar `http_request_completed`, `requestId`, estado HTTP y duración. Identificar la plantilla pública sin incluir los UUID reales. |
| Endpoint privado en `features/orders/presentation/api-routes.ts` | No poder habilitar el enlace o interpretar una repetición como nueva habilitación. | Registrar la primera habilitación después del commit; distinguir reutilización en el resumen HTTP. |
| Loader/action públicos de `app/routes/checkout.tsx` | Enlace no disponible, formulario rechazado, total cambiado o confirmación repetida. | Añadir un resultado de checkout de vocabulario cerrado al resumen HTTP; no emitir un error adicional por cada rechazo esperado. |
| `features/orders/infrastructure/order-repository.ts` | Fallo de lectura, bloqueo o escritura; datos almacenados inválidos. | Reutilizar eventos técnicos existentes para operaciones existentes y definir eventos específicos solo para nuevas operaciones. No registrar filas, SQL ni parámetros. |
| `features/orders/composition.ts` y `src/shared/infrastructure/persistance.ts` | Fallo de commit, rollback y carreras entre confirmar, cancelar o cambiar el total. | Un fallo técnico tiene un único propietario de log. Publicar hitos de éxito únicamente después del commit de la transacción exterior. |
| Creación de pedidos y migración de OrderBuyer | Colisiones de numeración, contador inconsistente o pérdida de datos históricos. | Identificar fallos de asignación e integridad sin registrar compradores; conservar evidencia agregada de la migración. |
| Renderizado de la página y telemetría automática | Una excepción o URL capturada fuera del logger puede revelar el acceso o datos privados. | Verificar también el límite de errores de renderizado, APM y cualquier colector/proxy que registre solicitudes. |

El repositorio ya emite, entre otros, `unable_to_load_order_aggregate`, `unable_to_lock_order`, `unable_to_save_pending_order` y `unable_to_complete_order_transaction`. Se conservan esos nombres. Los datos almacenados inválidos se distinguen de una entrada incorrecta del comprador mediante `order_checkout_data_invalid`: son un problema del servidor.

### Ubicación concreta de la instrumentación

Las rutas siguientes son relativas a `apps/core`. Esta tabla asigna responsabilidades para implementar y revisar; no agrega logging dentro de las reglas puras.

| Archivo y punto | Qué debe registrar o aportar |
| --- | --- |
| `src/shared/infrastructure/logger.ts` → `requestLogging` | Un resumen al terminar la respuesta; generar/validar `requestId`, medir duración y normalizar las dos rutas de checkout. Conservar el estado HTTP realmente enviado. |
| `src/features/orders/presentation/api-routes.ts` → POST de `checkout-link` | Operación `enable_checkout` y resultado de validación/acceso; las excepciones inesperadas pertenecen al límite de error de esta ruta. La autenticación fallida debe quedar en el resumen aunque no se ejecute el handler. |
| Loader/action de la página pública de checkout | Operación `get_checkout` o `confirm_checkout` y resultado final, incluidos validación, conflicto e idempotencia. Si hay varias llamadas internas, el resumen refleja la petición completa, no el último helper ejecutado. |
| `src/features/orders/infrastructure/checkout-repository.ts` → `readCheckout` | Añadir empresa y número únicamente después de comprobar pertenencia y habilitación. Propagar errores de `findOrderAggregate`/`findOrderForUpdate` ya registrados sin repetirlos. |
| Mismo adaptador → `saveCheckoutEnabled`, `saveCheckoutBuyer`, `saveCheckoutConfirmed` | Un error técnico de la escritura que falla, con el evento específico del catálogo. Ningún evento de éxito dentro de estas escrituras. |
| `src/features/orders/composition.ts` → `enableCheckout`, `confirmCheckout` | Hito de primera transición una vez resuelta la transacción exterior. En una repetición, aportar `already_enabled` o `already_confirmed` al resumen. |
| Mismo archivo → `orderTransaction` | Fallos técnicos del límite transaccional; diferenciar una excepción propia del cierre de una causa que el adaptador ya manejó. |
| `src/features/orders/infrastructure/order-repository.ts` → `allocateOrderNumber`, `savePendingOrder` y mapeo de lecturas | Fallos de contador, colisión de número y datos persistidos inválidos; conservar eventos existentes y códigos distinguibles. |
| `app/entry.server.tsx` → errores de renderizado y límite global de errores web | Sustituir la salida cruda de excepciones por el evento saneado del catálogo cuando ese límite sea su propietario. Evitar que el límite global vuelva a emitir el mismo fallo. |

**Caso crítico de renderizado:** si la respuesta ya comenzó, un fallo posterior puede coexistir con un HTTP 200. El error técnico debe seguir siendo visible; no alterar el log para simular que se envió un 500. Si la confirmación ya se persistió, el fallo al renderizar su respuesta tampoco revierte esa confirmación. O07 debe cubrir este caso.

### Contexto permitido y protección del enlace

**La URL completa es una credencial.** Registrar `companyId` y `orderId` en campos separados, incluso en eventos correlacionables, también permitiría reconstruirla. Para el flujo de pedidos afectado por checkout se omite el UUID de pedido en logs y atributos de trazas; se utiliza el número visible para investigar.

| Campo | Cuándo se incluye |
| --- | --- |
| `event`, mensaje y nivel | Siempre; nombres y mensajes estables en inglés, sin interpolar datos del usuario. |
| `requestId` | Contexto existente por solicitud; validar o generar como ya hace el middleware. |
| `companyId` | En rutas privadas, desde la identidad autenticada. En checkout público, solo después de verificar en base de datos la pertenencia del pedido y su habilitación; nunca solo por recibir un UUID bien formado. |
| `orderNumber` | Cuando proviene del pedido leído o creado correctamente. No registrar el número provisional de una creación revertida como si existiera. |
| `userId` | Solo el vendedor autenticado, cuando ayude a investigar la habilitación; no se inventa una identidad para el comprador público. |
| `operation` | Valor cerrado: `create_order`, `enable_checkout`, `get_checkout` o `confirm_checkout`, según corresponda. |
| `outcome` | Resultado cerrado definido abajo, sin mensajes libres. |
| `route`, `method`, `statusCode`, `durationMs` | Resumen HTTP existente, usando plantilla de ruta y duración real de la solicitud. |
| `errorCode`, `err` | Código interno permitido y error por el serializador seguro del logger; no copiar mensajes, stack o metadatos externos a campos adicionales. |
| `trace.id`, `span.id` | Cuando la infraestructura existente de APM los aporte. No generarlos manualmente. |

El contexto de persistencia y el de logging son distintos: la consulta pública necesita establecer la empresa antes de comprobar el pedido, pero no debe etiquetar esa empresa como verificada en logs antes de comprobar el acceso. Si falla esa comprobación, basta con `requestId`, operación, resultado y ruta normalizada. No se realiza una consulta global adicional para averiguar de quién era un enlace inválido.

No registrar nombre, teléfono, dirección, datos de pago, nombre de tienda/productos, comprador serializado, cuerpos de petición/respuesta, cookies, cabeceras, URL de referencia ni parámetros de URL. Tampoco registrar los valores de `expectedTotal` y `total`: para explicar el conflicto basta un código de resultado. La redacción automática es una defensa adicional, no reemplaza la selección explícita de campos.

Las plantillas son `/api/orders/:orderId/checkout-link` y `/checkout/:companyId/:orderId`. La instrumentación debe reconocer la ruta pública aunque el manejador web de Express sea un comodín. No usar la URL cruda como nombre de transacción, atributo de APM, mensaje de excepción o etiqueta de métricas. Revisar esta condición también en las demás rutas que transporten el UUID del pedido; ocultarlo solo en la página pública no protege el enlace si aparece en otra traza.

### Catálogo de eventos y responsables

Esta tabla define los eventos instrumentados y el límite que es responsable de emitirlos.

| Evento | Nivel | Dónde y cuándo | Contexto específico |
| --- | --- | --- | --- |
| `http_request_completed` — existente | `info` | Middleware HTTP al terminar cada solicitud. Enriquecer ese mismo evento desde la ruta, sin emitir un segundo resumen HTTP. | Método, plantilla, estado, duración, `operation` y `outcome`; identidad verificada cuando exista. |
| `order_checkout_enabled` — nuevo | `info` | Composición de orders, después de que termine correctamente la transacción exterior de `enableOrderCheckout`, solo cuando pasó de no habilitado a habilitado. | Empresa verificada, `orderNumber`, vendedor autenticado. Nunca la URL devuelta. |
| `order_checkout_confirmed` — nuevo | `info` | Composición de orders, después del commit exterior de `confirmOrderCheckout`, solo cuando esta operación produjo la primera confirmación. | Empresa verificada y `orderNumber`. Sin comprador ni importes. |
| `unable_to_load_order_aggregate`, `unable_to_lock_order` — existentes | `error` | Adaptador que maneja el fallo de lectura o adquisición del bloqueo. | `operation`, `errorCode`, `err`; contexto verificado disponible. No inventar número si la lectura falló. |
| `unable_to_save_checkout_enabled`, `unable_to_save_order_buyer`, `unable_to_save_checkout_confirmation` — nuevos | `error` | Adaptador que maneja el fallo de la escritura correspondiente. | `operation`, `errorCode`, `err` y referencia segura disponible. No emitir otro error por el rollback provocado por ese mismo fallo. |
| `unable_to_complete_order_transaction` — existente | `error` | Límite transaccional en composición, cuando falla el inicio o cierre de la transacción y no se registró ya esa misma causa. | `operation`, `errorCode`, `err`; referencia segura si existe. No afirmar que hubo commit ni rollback confirmado si el resultado es incierto. |
| `unable_to_allocate_order_number` — nuevo | `error` | Adaptador de asignación del contador ante un fallo técnico, desbordamiento o inconsistencia del contador. | Empresa autenticada, `operation: create_order`, código seguro y `err` si hay excepción. |
| `unable_to_save_pending_order` — existente | `error` | Persistencia de creación ante un fallo al guardar; incluir una colisión de `(companyId, number)` como fallo de integridad de la numeración. | Código seguro que distinga persistencia de conflicto de numeración. Un ID de pedido repetido esperado conserva su tratamiento de duplicado, sin error técnico adicional. |
| `order_checkout_data_invalid` — nuevo | `error` | Adaptador al detectar datos almacenados inválidos, o límite de presentación si la proyección de salida incumple su contrato; solo el primer límite que lo maneja. | Código de invariante permitido y referencia segura, sin fila, proyección ni detalles del validador que contengan valores. |
| `order_api_operation_failed` — existente; `order_checkout_request_failed` — nuevo para la página pública | `error` | Límite final de la ruta correspondiente para excepciones inesperadas que ningún adaptador haya manejado, incluido renderizado cuando sea el propietario final. | `operation`, código interno y `err` saneado. El manejador global no vuelve a emitir la misma excepción. |

El dominio permanece puro. No se registran eventos por cada llamada a una función, consulta SQL, espera de bloqueo, producto ni lectura exitosa. No se agrega un evento por copiar el enlace en el navegador: el servidor puede acreditar que devolvió el enlace, no que se copió o envió a otra persona.

### Resultados esperados, fallos y transacciones

El resumen HTTP utiliza los siguientes valores de `outcome` cuando la petición pertenece al flujo:

| Operación | Resultados |
| --- | --- |
| Habilitar | `enabled`, `already_enabled`, `cancelled`, `unavailable`, `invalid_input`, `unauthenticated`, `technical_failure`. |
| Consultar | `pending`, `confirmed`, `cancelled`, `unavailable`, `technical_failure`. |
| Confirmar | `confirmed`, `already_confirmed`, `total_changed`, `cancelled`, `unavailable`, `invalid_input`, `technical_failure`. |

Las rutas no distinguen públicamente inexistencia, empresa incompatible o falta de habilitación: se agrupan como `unavailable`. Los errores esperados de validación, total cambiado, cancelación e idempotencia no generan `warn` ni `error`; quedan visibles en el resumen HTTP. No hay un caso de `warn` obligatorio en este alcance, porque no se ha definido un mecanismo automático de reintentos o recuperación degradada.

Para no confundir una confirmación existente con una nueva, la composición debe conocer si la operación produjo la transición, usando el resultado interno de esa misma transacción. No debe deducirlo solo del resumen confirmado, ni consultar antes y después fuera del bloqueo. Ese dato interno no obliga a cambiar el contrato público.

Una escritura exitosa dentro de la transacción todavía puede revertirse: no se emite `order_checkout_confirmed` ni `order_checkout_enabled` desde el callback transaccional. Un fallo de commit produce solo el fallo técnico correspondiente, nunca un hito de éxito anticipado.

Si el adaptador registra un error y retorna un `Result` fallido, composición y presentación lo propagan sin repetirlo. Si una excepción no fue manejada, la registra el límite final. El resumen HTTP sigue existiendo y no constituye un segundo log de error. Una pérdida de conexión durante commit puede dejar resultado incierto; no se registra falsamente que todo se revirtió. El reintento consulta el estado persistido mediante la idempotencia ya definida.

### Numeración, migración y señales operativas

- En la migración, conservar en la salida del proceso de despliegue su identificador, inicio/fin, resultado, duración y conteos agregados de pedidos numerados y compradores migrados. Si falla la validación, registrar un código de invariante y conteos; nunca volcar filas ni contactos. No crear un servicio de migración ni logs por pedido.
- La creación habitual no necesita un evento por incremento del contador. Las colisiones de número, desbordamientos y fallos de persistencia sí deben quedar diferenciados para investigar concurrencia o una migración incorrecta.
- Observar solicitudes y latencias por operación, estados HTTP y resultados: proporción de fallos técnicos, cambios de total, enlaces no disponibles y reintentos ya confirmados. Las latencias altas de confirmación justifican revisar las trazas y esperas de base de datos; no se atribuyen automáticamente a bloqueos solo por la duración HTTP.
- Los eventos de transición permiten contar habilitaciones y primeras confirmaciones observadas. Los logs no son un registro de negocio de entrega garantizada: si el proceso cae después del commit y antes del log, puede faltar el evento. Los conteos autoritativos provienen de las fechas persistidas, sin agregar outbox para logging.
- Usar operación, ruta normalizada, resultado y código como dimensiones acotadas. No usar `requestId`, `companyId`, `orderNumber` ni UUID como etiquetas de métricas; los identificadores seguros quedan para investigación en logs.
- Colisiones de numeración y datos almacenados inválidos requieren investigación por posible incumplimiento de invariantes. Las alertas de disponibilidad y latencia necesitan umbrales y ventanas basados en el entorno desplegado; este diseño no inventa un SLA ni configura alertas sin esa evidencia.

Se reutiliza el envío existente a New Relic cuando esté habilitado. En el primer despliegue se debe comprobar recepción, correlación y ausencia de duplicados y URLs sensibles tanto en logs como en trazas y registros del proxy, si existe. El logger de Node no se importa en navegador ni Expo; la telemetría propia de móvil queda fuera de este cambio. Un fallo del colector de observabilidad no debe convertir una confirmación ya persistida en un fallo de negocio.

Para investigar, partir del `requestId` de la respuesta y revisar el resumen HTTP y, si existe, su único error técnico. Para seguir un pedido entre solicitudes, utilizar empresa verificada y `orderNumber`. Ante una respuesta perdida o un commit incierto, comprobar el estado persistido mediante el acceso autorizado: la ausencia de un hito en logs no demuestra que el pedido siga pendiente.

### Pruebas de observabilidad a definir junto con el flujo

Estas definiciones complementan la matriz funcional siguiente. Sus archivos ejecutables y límites de verificación se indican al final.

| ID | Nivel | Escenario y resultado esperado |
| --- | --- | --- |
| O01 | Unitario | Verificar evento, nivel y campos permitidos para transición, rechazo esperado y fallo técnico; no emitir hitos para `already_enabled` o `already_confirmed`. |
| O02 | Unitario | Introducir valores señuelo en comprador, cuerpos, cabeceras, URL, UUID de pedido y errores. Ninguno aparece en la salida; se conserva `err` saneado y la referencia segura permitida. |
| O03 | Integración | Correlacionar solicitud y logs por el mismo `requestId`; intercalar empresas y comprobar que el contexto no se mezcla. Un enlace no validado no añade la empresa recibida como identidad verificada. |
| O04 | Integración | Fallar una escritura y un commit; observar un único error técnico por causa y ningún evento de transición revertida. Al confirmar concurrentemente, emitir un solo hito de primera confirmación y resultados idempotentes para el resto. |
| O05 | Integración | Llamar al endpoint privado y a loader/action públicos, incluidos errores y entradas inválidas: un resumen HTTP por solicitud, ruta normalizada, operación y resultado correctos, sin UUID de pedido ni URL cruda. |
| O06 | Integración | Provocar datos almacenados inválidos y colisión de numeración: distinguirlos de validación de formulario y duplicado esperado de ID; no exponer datos al cliente ni repetir el error en capas superiores. |
| O07 | E2E | Recorrer E01, E05 y E09 y correlacionar los resultados visibles con los logs del servidor; comprobar que ni fallos de renderizado ni respuestas perdidas filtran el enlace o generan una segunda confirmación. |
| O08 | Despliegue | Con el colector habilitado, verificar recepción única, correlación de traza y ausencia de señuelos en logs/APM/proxy; con el colector indisponible, el flujo de negocio sigue funcionando. Esta comprobación remota no se presume completada por pruebas locales. |

## Definición de pruebas

Esta sección especifica escenarios y resultados esperados para pruebas unitarias, de integración y E2E. No incluye código de implementación de tests; su ejecución se registra en la sección de evidencia. La cobertura se refiere a los comportamientos acordados, no a un porcentaje de líneas.

Se siguen las [convenciones de testing](testing-conventions.md): probar cada regla en la capa que la posee y repetirla en otra capa solo cuando exista un riesgo distinto. Las pruebas de dominio y aplicación no necesitan infraestructura; las garantías de RLS, restricciones y transacciones requieren una base de datos real aislada. Las E2E recorren la aplicación real desde el navegador.

### Pruebas unitarias

Cada fila agrupa casos relacionados; las variantes indicadas se deben comprobar por separado cuando tengan resultados distintos.

| ID | Comportamiento y escenarios | Resultado esperado |
| --- | --- | --- |
| U01 | Construir `OrderNumber` con 1001, 9999 y 10000; intentar valores menores a 1001, fraccionarios, no finitos o fuera del rango exacto elegido. | Aceptar enteros válidos sin truncar ni reiniciar la secuencia; rechazar representaciones inválidas o con pérdida de precisión. |
| U02 | Validar nombre de una sola palabra, nombre de varias palabras, vacío y compuesto solo por espacios. | Aceptar los dos primeros; rechazar los vacíos. No exigir apellidos ni un número mínimo de palabras. |
| U03 | Validar teléfonos válidos e inválidos según la regla reutilizada del proyecto; precargar comprador con nombre nulo. | Aceptar el teléfono válido; no permitir confirmar con teléfono inválido o nombre pendiente. El prefill incompleto sí puede consultarse. |
| U04 | Derivar estado con ambas fechas nulas, solo habilitación, ambas fechas y cancelación antes o después de confirmar. | Obtener no habilitado, pendiente y confirmado respectivamente; la cancelación tiene precedencia sin borrar las fechas. |
| U05 | Consultar o confirmar un checkout habilitado con fecha antigua, pedido pagado o entrega enviada/entregada, siempre que no esté cancelado. | No bloquear por antigüedad, pago ni envío/entrega; aplicar únicamente las reglas acordadas del checkout. |
| U06 | Habilitar un pedido propio sin enlace, habilitarlo otra vez y pedir el enlace de uno confirmado. | Devolver la misma URL con UUID de empresa y pedido; conservar la habilitación original y la confirmación existente. |
| U07 | Solicitar habilitación, consulta o confirmación para un pedido inexistente, ajeno, no habilitado cuando corresponda o cancelado. | Aplicar la regla de acceso o estado pertinente y no producir escrituras; la consulta pública de un cancelado habilitado devuelve su cancelación. |
| U08 | Confirmar un pedido pendiente sin comprador o con un comprador precargado, con y sin referencia a Contact. | Crear o actualizar la copia del pedido y establecer confirmación; conservar la referencia derivada del servidor y no modificar el Contact global. |
| U09 | Repetir la confirmación con un cuerpo estructuralmente válido que cambia comprador o contiene un total visto anteriormente. | Devolver el resumen ya confirmado sin cambiar comprador ni fecha; la comprobación de total del primer envío no convierte el reintento en una edición. |
| U10 | Confirmar con `expectedTotal` igual al total actual, con importe distinto o con moneda distinta. | Aceptar solo la coincidencia de importe y moneda para una primera confirmación; en conflicto, no escribir comprador ni confirmación. Nunca tomar el valor recibido como precio. |
| U11 | Proyectar un pedido cuyo `total` difiere de `itemsTotal`, con comprador ausente, incompleto o confirmado. | Conservar ambos importes del pedido, representar correctamente al comprador y exponer únicamente los campos públicos acordados. |
| U12 | Fallar una lectura o escritura requerida por un caso de uso mediante una dependencia controlada. | Retornar un error explícito de `Result`, no devolver éxito ni ocultar el fallo. El rollback real se verifica en integración. |
| U13 | Validar contratos con UUID malformados, datos requeridos ausentes, tipos incorrectos, Money inválido y campos adicionales como `contactId`, precios o fecha de confirmación. | Rechazar entradas fuera del contrato estricto. El cuerpo no reemplaza los parámetros de ruta ni la identidad autenticada del vendedor. |
| U14 | Mapear filas y respuestas con comprador ausente, comprador sin Contact, comprador asociado a Contact y fechas serializadas. | Preservar número, importes, datos y fechas sin confundir comprador sin Contact con público general; rechazar respuestas que incumplan el contrato. |

### Pruebas de integración

Las pruebas de persistencia usan PostgreSQL aislado y el rol restringido de aplicación para verificar RLS. Los casos HTTP ejercitan las rutas y su composición real. Los resultados de concurrencia deben obtenerse coordinando operaciones, sin depender de esperas arbitrarias.

| ID | Comportamiento y escenarios | Resultado esperado |
| --- | --- | --- |
| I01 | Crear pedidos y ventas inmediatas, con comprador y sin él. | Persistir número y copia del comprador cuando exista, conservar las reglas previas de cada flujo y dejar checkout deshabilitado. |
| I02 | Crear los primeros pedidos de dos empresas; avanzar de 9999 a 10000; cancelar un pedido y crear otro. | Cada empresa empieza en 1001 y mantiene su contador independiente; cancelar no libera un número ni modifica el número existente. |
| I03 | Crear varios pedidos simultáneamente en la misma empresa y en empresas distintas. | No duplicar números dentro de una empresa; permitir el mismo número en empresas distintas y conservar un contador consistente con los pedidos persistidos. |
| I04 | Provocar un fallo después de reservar el número y antes de completar la creación del pedido o comprador. | Revertir contador, pedido y comprador juntos, sin registros parciales. Un intento fallido no equivale a un pedido cancelado. |
| I05 | Intentar persistir número duplicado por empresa, dos compradores para un pedido y confirmación sin habilitación. | Las restricciones de base de datos rechazan los estados inválidos, incluso sin pasar por la validación de aplicación. |
| I06 | Intentar relacionar OrderBuyer con un pedido o Contact de otra empresa y acceder a filas bajo un contexto ajeno o sin contexto de empresa. | Las claves compuestas y RLS impiden relaciones, lecturas y escrituras fuera de alcance. El rol de aplicación sí puede operar sobre datos propios. |
| I07 | Habilitar mediante el endpoint privado con sesión válida, sin sesión y con sesión de otra empresa; repetir y ejecutar habilitaciones concurrentes. | Solo el vendedor de la empresa obtiene el enlace. Repeticiones conservan URL y primera fecha, sin reabrir confirmados ni habilitar cancelados. |
| I08 | Ejecutar GET y POST públicos sin sesión con una combinación válida; probar UUID inválidos, pedido inexistente, combinación cruzada y checkout no habilitado. | Acceso público válido sin login; los enlaces no disponibles no revelan existencia ni datos. Conocer el enlace no permite usar rutas privadas. |
| I09 | Intercalar consultas y confirmaciones públicas de empresas distintas. | El contexto de una petición no se filtra a otra y cada operación solo afecta su pedido y empresa. |
| I10 | Confirmar con comprador nuevo y con uno precargado; volver a leer el pedido y su Contact. | Persistir una sola fila de comprador y la fecha en el mismo pedido; conservar Contact, productos, cantidades, precios, pagos, entrega y stock. |
| I11 | Provocar un fallo tras guardar el comprador y antes de guardar la confirmación, tanto con comprador previo como sin él. | Revertir toda la operación: restaurar el comprador anterior o su ausencia y mantener el pedido sin confirmar; un reintento posterior puede completar la operación. |
| I12 | Confirmar varias veces, de forma secuencial y concurrente, enviando datos válidos de comprador diferentes. | Solo la primera confirmación que se confirma en base de datos determina comprador y fecha; las demás devuelven el resumen persistido sin sobrescribir ni crear pedidos. |
| I13 | Cambiar el total antes de confirmar y coordinar una actualización de total concurrente con la confirmación. | Comparar contra el total vigente bajo bloqueo. Si el cambio se confirma primero, rechazar el total antiguo sin escrituras. Si confirma primero el checkout, la comparación corresponde a ese momento; no se redefine aquí la política posterior del módulo de importes. |
| I14 | Cancelar antes de confirmar y coordinar cancelación y confirmación concurrentes. | Si cancela primero, rechazar confirmación. Si confirma primero y después la cancelación es válida, conservar la fecha y mostrar cancelado; nunca dejar un estado parcial ni reabrir el pedido. |
| I15 | Consultar y confirmar pedidos habilitados antiguos, pagados y con entrega enviada/entregada no cancelados. | No introducir expiración ni condiciones adicionales de pago o entrega. Confirmar no registra operaciones en esos módulos. |
| I16 | Consultar por HTTP un pedido con información privada e importes distintos; inspeccionar respuesta, política de caché y registros de la petición. | Exponer solo la proyección pública y el total autoritativo; impedir caché compartida y no registrar la URL completa que concede acceso. |
| I17 | Enviar cuerpos y parámetros inválidos por HTTP; provocar conflictos de total, cancelación y fallos de persistencia. | La ruta realmente valida el contrato y traduce los resultados a errores distinguibles y utilizables por la pantalla, sin éxito falso, detalles internos ni escrituras parciales. |
| I18 | Aplicar la migración a datos históricos de varias empresas, con fechas de creación empatadas, contactos completos, contactos solo con teléfono y pedidos sin comprador. | Conservar cantidades y datos de pedidos, compradores, pagos y entrega; numerar en orden determinista por empresa, avanzar contadores y dejar ambas fechas de checkout nulas. |
| I19 | Tras migrar, crear y consultar pedidos usando el rol de aplicación y los contratos actuales. | El siguiente número continúa correctamente; permisos, relaciones y RLS de OrderBuyer funcionan; ninguna consulta depende de las columnas retiradas. |
| I20 | Listar, filtrar y consultar detalles con los tres casos de comprador: ausente, sin Contact y asociado a Contact. | Los repositorios y adaptadores web/móvil conservan la distinción, el número y el estado de confirmación; la ausencia de `contactId` no elimina un comprador existente. |

### Pruebas E2E

Los recorridos web usan la aplicación y persistencia reales, con sesiones separadas de vendedor y comprador y un tamaño de pantalla móvil para el checkout. Se pueden preparar pedidos existentes como datos de prueba; no se exige construir una interfaz de creación de pedidos pendientes fuera del alcance.

| ID | Recorrido | Resultado observable |
| --- | --- | --- |
| E01 | El vendedor abre un pedido existente, obtiene y copia el enlace; el comprador lo abre en un navegador sin sesión, completa sus datos y confirma; el vendedor vuelve a consultar lista y detalle. | El mismo `Pedido #1001` aparece en todo el recorrido, el comprador recibe el resumen y el vendedor ve “Confirmado por el comprador” con los datos guardados. El pago conserva su estado previo. |
| E02 | Abrir pedidos sin comprador, con comprador completo y con contacto que solo tenía teléfono; editar y confirmar. | Se precargan solo los datos disponibles, se permiten correcciones y un nombre de una palabra; al recargar se conservan los datos confirmados. |
| E03 | Enviar nombre vacío o solo espacios y teléfono inválido; corregir los campos. | Mostrar errores comprensibles asociados a los campos, conservar los demás valores y permitir confirmar después de corregir. El formulario puede utilizarse con teclado y sus controles tienen etiquetas accesibles. |
| E04 | Abrir un pedido con productos y cantidades fijos y un `total` distinto de `itemsTotal`. | Mostrar productos y precios correctos, subtotal y total final claramente diferenciados, sin controles para cambiar el carrito. No exigir dirección, modalidad, pago ni contacto de WhatsApp de los módulos fuera de alcance. |
| E05 | Con el formulario abierto, actualizar el total desde el servidor y luego confirmar con el importe antiguo. | Informar el cambio, conservar nombre y teléfono y mostrar el nuevo total; solo una nueva confirmación explícita guarda el pedido como confirmado. |
| E06 | Confirmar, recargar, volver con el historial del navegador y abrir nuevamente el enlace; intentar doble envío desde una pantalla pendiente. | Mantener un único resultado confirmado y mostrar el resumen de solo lectura, sin permitir modificar al comprador ni duplicar el pedido. |
| E07 | Cancelar un pedido antes de abrir el enlace y mientras el comprador tiene el formulario abierto; abrir también uno cancelado después de confirmar. | Mostrar cancelación al consultar o enviar, bloquear confirmación y no dejar visible un éxito incorrecto ni campos editables. |
| E08 | Abrir URLs malformadas, inexistentes, con empresa y pedido incompatibles o sin checkout habilitado. | Mostrar “Enlace no disponible” sin datos del pedido ni redirección obligatoria a login. |
| E09 | Simular un fallo de confirmación anterior al guardado y, por separado, perder la respuesta después de que el servidor haya confirmado. | No mostrar éxito en el primer caso y permitir reintentar; en el segundo, el reintento o la recarga recupera la confirmación existente sin sobrescribir datos. |
| E10 | Volver a copiar el enlace y abrirlo mucho después de habilitarlo; abrir pedidos habilitados pagados o enviados/entregados sin cancelar. | Conservar la URL y permitir el comportamiento de checkout correspondiente sin expiración ni bloqueo por esos estados. |
| E11 | Recorrer lista y detalle del vendedor con pedidos no habilitados, pendientes, confirmados y numerados antes y después de 10000. | Mostrar número completo, distinguir confirmación y pago, y no etiquetar como pendientes de confirmación los pedidos que nunca habilitaron checkout. |

Los consumidores móviles tienen además pruebas de interacción y adaptación de contratos para número, comprador, copia del enlace y estado de confirmación. Una prueba de pantalla móvil con respuestas simuladas no se considera E2E: el recorrido completo móvil-backend solo queda verificado si se ejecuta contra ambos componentes reales. Se debe repetir E01 y E11 desde la app cuando esas superficies del vendedor estén disponibles en ella, sin agregar pantallas ajenas al alcance para satisfacer una prueba.

### Trazabilidad del comportamiento

| Regla o riesgo | Pruebas que lo cubren |
| --- | --- |
| Numeración, precisión y creación de pedidos/ventas | U01, I01–I05, I18–I19, E01, E11 |
| Comprador separado, validación y conservación de Contact | U02–U03, U08, U13–U14, I06, I10–I11, I18–I20, E02–E03 |
| Estados, habilitación y enlace estable sin vencimiento | U04–U07, I07, I15, E06–E07, E10–E11 |
| Autorización privada y acceso público por UUID con aislamiento | U07, U13, I06–I09, I16–I17, E01, E08 |
| Total autoritativo y revisión de cambios | U10–U11, I13, I16–I17, E04–E05 |
| Confirmación atómica, reintentos y concurrencia | U08–U10, U12, I10–I14, E06, E09 |
| Pago, entrega, stock y productos independientes de confirmar | U05, I10, I15, E01, E04, E10 |
| Cancelación con precedencia, sin cierre por envío | U04–U05, I14–I15, E07, E10 |
| Proyección pública, errores y recuperación | U11–U14, I08, I16–I17, E03, E08–E09 |
| Migración, contratos y consumidores web/móvil | U14, I18–I20, E01–E02, E11 y comprobaciones móviles descritas arriba |

### Condiciones para considerar verificado el alcance

- Cada comportamiento de la matriz tiene evidencia ejecutable en la capa correspondiente; una prueba con dependencias simuladas no acredita garantías de base de datos ni un recorrido E2E.
- Las pruebas son independientes, usan datos aislados y controlan tiempo e identificadores cuando afectan al resultado. No utilizan datos ni credenciales de producción.
- Se comprueba el resultado observable y el estado persistido relevante, no nombres de helpers, cantidad de llamadas o detalles internos sin valor funcional.
- Los casos de migración comprueban conservación de datos, y los de concurrencia y fallos comprueban ausencia de escrituras parciales.
- Los módulos de entrega, cobertura y pagos mantienen sus propias pruebas. Aquí se cubren sus límites y los importes ya persistidos, sin implementar sus funcionalidades para probar checkout.
- Al implementar se informarán los casos ejecutados, sus resultados y cualquier limitación real de entorno; esta definición por sí sola no constituye evidencia de ejecución.

## Evidencia de implementación y verificación local

Verificado el 5 de octubre de 2026 con Node 24, pnpm 12.5.1, PostgreSQL aislado, rol restringido de aplicación y Chromium. Los escenarios anteriores siguen siendo la especificación; las pruebas ejecutables viven en el código.

| Comportamiento | Evidencia ejecutable |
| --- | --- |
| U01–U11: número, comprador, estados, acceso, idempotencia y total | [Dominio](../apps/core/src/features/orders/domain/checkout.test.ts) y [casos de uso](../apps/core/src/features/orders/application/checkout.test.ts). |
| U12–U14: fallos, contratos estrictos y adaptación | [Composición](../apps/core/src/features/orders/composition.test.ts), [contratos](../apps/core/src/features/orders/presentation/checkout-contracts.test.ts), [JSON de pedidos](../apps/core/src/features/orders/presentation/order-json.test.ts) y [rutas públicas](../apps/core/app/routes/checkout.test.ts). |
| I01–I06, I09–I15, I20: numeración, comprador, RLS, restricciones, concurrencia y rollback | [Integración de pedidos](../apps/core/src/features/orders/infrastructure/order-repository.integration.test.ts). Incluye ambos órdenes de adquisición del bloqueo, empresas intercaladas y un fallo real de COMMIT mediante una restricción diferida temporal. |
| I07–I08, I16–I17: acceso privado/público, contratos HTTP y errores | [API de pedidos](../apps/core/src/features/orders/presentation/api-routes.integration.test.ts) y [checkout contra el servidor compilado](../apps/core/tests/e2e/checkout.spec.ts). |
| I18–I19: migración histórica y operación posterior | [Migración de número y comprador](../apps/core/src/features/orders/infrastructure/order-number-migration.integration.test.ts) y [conservación de ventas históricas](../apps/core/src/features/orders/infrastructure/order-migration.test.mjs). Se crean y leen datos con el rol restringido después del backfill y continúa la secuencia. |
| E01–E11: vendedor y comprador en navegador | [Recorridos de checkout](../apps/core/tests/e2e/checkout.spec.ts): portapapeles real, pantalla de 390 px, cambio de total, cancelación, reintento, pérdida de respuesta, historial y pedidos pagados/enviados/entregados. |
| E01/E11 desde la app móvil | [Expo Web contra core real](../apps/core/tests/e2e/mobile-checkout.spec.ts): copia, confirmación anónima y lista/detalle con los cuatro estados, antes y después de 10000. Complementa las pruebas de pantallas, operaciones y adaptadores en `apps/mobile/src/features/orders/`. |
| O01–O06: contexto, privacidad, resultados y propietario único del error | [Logger](../apps/core/src/shared/infrastructure/logger.test.ts), [composición](../apps/core/src/features/orders/composition.test.ts), integración de pedidos y recorridos HTTP anteriores. El logger comparte su contexto entre los módulos fuente de Express y el bundle SSR. |
| O07: correlación y fallos de respuesta/renderizado | [Checkout E2E](../apps/core/tests/e2e/checkout.spec.ts) correlaciona confirmación, cambio de total y respuesta perdida. [Renderizado E2E](../apps/core/tests/e2e/checkout-render-error.spec.ts) inyecta un componente fallido después del shell, usando HTTP, navegador y streaming reales: un error técnico y el HTTP 200 efectivamente enviado. |
| Privacidad de APM y evidencia de migraciones | [Agente local](../apps/core/src/shared/infrastructure/apm-privacy.test.ts) comprueba payloads y nombres, incluidas rutas `.data`. [Despliegue de migraciones](../apps/core/scripts/migrate.test.ts) comprueba identificadores, tiempos, conteos y fallos sin datos privados. |

Validaciones satisfactorias:

- Core: `lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e` y build de producción utilizado por E2E.
- Mobile: `lint`, `typecheck` y `test`. Lint conserva tres advertencias anteriores al checkout, sin errores.
- Shared: las pruebas de utilidades y contratos ejecutadas por CI.

El servicio de migración ejecuta `scripts/migrate.ts`: conserva Prisma deploy y agrega resúmenes seguros. Los conteos representan filas persistidas, no nuevos eventos de negocio. En un fallo se informa la migración incompleta, el código de invariante reconocido y los conteos disponibles; el detalle administrativo permanece en `_prisma_migrations`, sin copiar su columna `logs` a la salida. El procedimiento está en [README](../README.md).

### Comprobaciones que corresponden al despliegue

O08 permanece pendiente del primer despliegue con colector: recepción en New Relic, correlación remota, ausencia de duplicados y credenciales en APM/proxy, y continuidad del negocio cuando el colector no está disponible. La prueba local del agente no demuestra recepción remota. No se realizó despliegue.

El recorrido móvil real se ejecutó mediante Expo Web y core. No equivale a una compilación o prueba en un dispositivo iOS/Android; no había simulador nativo disponible. Las pantallas y el adaptador móvil sí se ejercitaron juntos contra persistencia real.
