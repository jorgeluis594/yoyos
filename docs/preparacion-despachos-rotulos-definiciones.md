# Preparación de despachos y rótulos: definiciones de producto

Definiciones acordadas en el brainstorming del 6 y 7 de octubre de 2026 y actualizadas el 11 de octubre de 2026 para alinearlas con el checkout por zonas y tarifas integrado el 8 de octubre.
Complementan [la tarea original](tarea-todoist.md). Este documento define el comportamiento esperado; no acredita su implementación.

El [diseño técnico](preparacion-despachos-rotulos-tecnico.md) desarrolla los contratos, casos de uso, archivos afectados y decisiones posteriores incorporadas a este documento.

## Objetivo y punto de entrada

Permitir que el vendedor organice los pedidos por despachar y prepare sus paquetes usando los datos ya guardados, sin volver a escribir la información del destinatario.

El flujo se realiza desde **Ventas en la app móvil**, aprovechando la consulta y el detalle existentes. No se crea una sección independiente de Despachos.

## Fechas y filtros

Se distinguen tres fechas:

| Fecha | Significado y comportamiento |
| --- | --- |
| Fecha de venta | Dato existente; conserva su filtro actual. |
| Fecha programada de despacho | Día previsto para enviar el pedido. Es opcional al crearlo y puede asignarse o cambiarse desde su detalle mientras esté pendiente de despacho. |
| Fecha real de despacho | Se registra automáticamente cuando el usuario marca el pedido como despachado. |

Ventas conserva los filtros actuales de cliente y fecha de venta, y añade estado de despacho, fecha programada, fecha real y courier. La fecha programada incluye la opción **Sin programar**.

Se permite asignar una fecha programada anterior a hoy para representar pedidos atrasados. Un pedido atrasado conserva su fecha programada hasta que el vendedor lo reprograme. Imprimir no asigna ni modifica fechas.

Si un pedido pasa directamente de pendiente a entregado, se registra la fecha de entrega y la fecha real de despacho queda vacía: no se infiere un evento que no se registró.

## Flujo de preparación e impresión

1. El vendedor entra a Ventas y filtra los pedidos que necesita preparar.
2. Puede abrir el detalle para consultar productos, destinatario y destino, y completar los datos de entrega mientras el pedido siga pendiente de despacho.
3. Selecciona uno o varios pedidos para imprimir sus rótulos juntos.
4. Antes de imprimir, la app informa cuáles tienen los datos necesarios y cuáles requieren correcciones. Por ejemplo: **“8 rótulos listos; 2 pedidos requieren completar datos”**.
5. Para cada pedido excluido, muestra qué falta y permite acceder al pedido para corregirlo.
6. Se imprimen únicamente los rótulos de los pedidos listos. Los incompletos no bloquean al resto de la selección.

Cada pedido lleva **un único rótulo**. La impresión por lote no solicita una cantidad de copias ni incluye numeración de varios paquetes por pedido.

Solo se generan rótulos para domicilio y agencia. Recojo en tienda y pedidos sin entrega asignada se excluyen con un motivo visible. La selección se conserva entre páginas y se limpia al cambiar filtros o empresa; Seleccionar todos afecta únicamente la página visible.

## Independencia respecto del pago y del despacho

“Listo para imprimir” se refiere a contar con los datos necesarios para el rótulo. Se permite imprimir aunque el pedido tenga pagos pendientes.

Imprimir no cambia el estado del pedido ni lo marca como despachado. El usuario realiza el cambio de estado por separado, sujeto a las validaciones existentes de esa operación.

Se permite reimprimir pedidos despachados y entregados si cumplen los requisitos de datos y formato. Los pedidos cancelados quedan excluidos con un motivo visible. Reimprimir no modifica fechas ni estados.

## Contenido del rótulo

Se toma como referencia visual el ejemplo compartido durante el brainstorming: remitente en la cabecera, destinatario destacado, bloque de destino y pie con courier y fecha.

| Bloque | Contenido |
| --- | --- |
| Remitente | Nombre del negocio. |
| Destinatario | Nombre, celular y documento cuando corresponda y esté registrado. |
| Destino | Domicilio: dirección y departamento, provincia y distrito del comprador. Agencia: nombre, dirección y distrito de la agencia elegida. Referencia cuando exista. |
| Pie | Courier cuando corresponda y fecha programada de despacho si está asignada. |

El rótulo usa los datos guardados del pedido. No incluye productos y no se presenta como una guía oficial del courier. Si no existe fecha programada, se omite la fecha del pie.

Los campos necesarios para imprimir se validan según la modalidad de entrega; los datos opcionales ausentes se omiten.

| Dato | Domicilio | Agencia |
| --- | --- | --- |
| Destinatario y celular | Obligatorios | Obligatorios |
| Documento | Opcional | Obligatorio |
| Departamento, provincia y distrito (catálogo) | Obligatorios | Obligatorios |
| Dirección | Obligatoria (del comprador) | Obligatoria (de la agencia) |
| Courier | Pendiente de definir (ver Couriers y agencias) | Obligatorio |
| Agencia | No aplica | Obligatoria |
| Referencia | Opcional | Opcional |

### Ubicación, tarifas y agencias

- **Ubicación con catálogo.** Departamento, provincia y distrito provienen del catálogo oficial de distritos del Perú (`shared/peru-geography.ts`, INEI 2026). No se acepta texto libre para la ubicación; la dirección y la referencia siguen siendo texto.
- **Domicilio y agencia usan el modelo de tarifas.** Ambas modalidades se asignan mediante una tarifa generada desde una opción de envío configurada; el pedido guarda la tarifa elegida y el distrito del catálogo.
- **Couriers y agencias forman parte del modelo.** La empresa registra sus couriers y las agencias de cada courier. En el checkout, agencia es una opción más de la zona de envío del comprador: se elige la opción y una de sus agencias. Esta definición sustituye la decisión anterior de escribir el nombre de la agencia como texto libre en cada pedido.
- **Sin variantes anteriores.** La app no está en producción: se eliminan los contratos y snapshots anteriores a las tarifas (domicilio y agencia sin tarifa, agencia con nombre libre) en lugar de mantener compatibilidad o transformar pedidos antiguos.

Una agencia con tarifa cuyo courier y agencia aún no estén asignados se excluye de la impresión con el motivo de datos faltantes.

Si el contenido no cabe tras ajustar líneas y fuente hasta un mínimo legible, el pedido se excluye con el motivo “El contenido excede el espacio del rótulo”; no se recorta información.

Los pendientes pueden completar sus datos; después del despacho la edición del destino continúa bloqueada.

## Impresora y formato

- Se utiliza la **Brother QL-810W** de la integración actual de códigos QR.
- La impresión del MVP está limitada a **Android**.
- Se amplía el soporte para rótulos de despacho de **62 × 100 mm**, correspondientes al formato de etiquetas Brother **DK-11202**.
- Se conserva el formato actual de QR de **62 × 29 mm**, identificado en la integración como **DK-1209**.
- Al imprimir se indica qué rollo debe estar colocado. Alternar entre ambos formatos requiere cambiar el rollo.
- El diseño debe mantener legibles los datos del destinatario y el destino, sin recortar información necesaria para la entrega.

La ampliación para esta impresora concreta es una definición posterior al alcance original, que no exigía compatibilidad con un modelo específico.

## Progreso, errores y detención

Los rótulos se envían secuencialmente y el progreso se conserva solo en memoria durante la sesión. Al cerrar la app se pierde la tanda; el usuario selecciona los pendientes al volver.

Solo puede existir un trabajo de impresión activo en la app, incluidos los QR. El resto de la app permanece disponible. Al terminar o detenerse por error se libera la impresora y se conserva el progreso de la tanda durante la sesión.

Detener tanda permite terminar el envío en curso y evita iniciar el siguiente. Ante un error se detiene la tanda; continuar no repite los confirmados. Si el resultado de un envío es incierto, el usuario revisa la salida antes de decidir si reimprime; no se reenvía automáticamente.

## Fuera de alcance

- Impresión desde la web en esta primera versión.
- Impresión desde iOS y recuperación de tandas después de cerrar la app.
- Excel para carga a couriers, reporte general y agrupación con conteos.
- Cambios de estado por lote.
- Guías oficiales e integración con couriers.
- Productos en el rótulo y múltiples paquetes por pedido.

## Validación pendiente

Validar con el negocio piloto una impresión real en la Brother con etiquetas de 62 × 100 mm, incluyendo nombres y destinos extensos, para comprobar legibilidad, distribución y corte.

Definir el mínimo tipográfico con muestras reales de nombres y destinos extensos.

## Couriers y agencias

Decisiones del 11 de octubre de 2026:

- **Alcance.** El modelo de couriers y agencias (configuración, opciones de la zona y selección en checkout) y la separación entre zona y opción se construyen dentro de esta tarea.
- **Datos de la agencia.** Cada agencia registra nombre, dirección y distrito del catálogo, y pertenece a un courier. El bloque Destino del rótulo de agencia muestra esos datos de la agencia elegida.
- **Zona, opción y tarifa (modelo tipo Shopify).** La zona es configuración de cada empresa y solo agrupa distritos. Cada zona tiene una o más opciones de envío; cada opción define modalidad (domicilio o agencia), nombre, precio y si está activa. Ejemplo: zona “Lima” con “Domicilio S/10”, “Agencia Shalom S/8” y “Agencia Olva S/9”. Al cotizar un distrito, cada opción activa de las zonas que lo cubren genera una tarifa. Sustituye el modelo actual en que cada zona es una única opción con modalidad y precio.
- **Tarifa por opción.** El precio depende solo de la opción. Elegir una agencia dentro de la opción no cambia la tarifa.
- **Agencias por opción.** Una opción de agencia se asocia a una o más agencias, que son las que el comprador puede elegir con esa tarifa.
- **Zona y distrito son relaciones distintas.** La zona es configuración de la empresa y define dónde se ofrecen sus opciones. El distrito de la agencia es parte del sistema (catálogo geográfico): es su ubicación física, no define cobertura y no depende de las zonas configuradas.

Pendiente de definir:

1. **Courier de domicilio.** Con domicilio dentro del modelo de tarifas, ¿se conserva un courier opcional asignado por el vendedor, se configura en la zona, o se elimina del rótulo de domicilio?
2. **Asignación posterior.** ¿El vendedor puede asignar o cambiar courier y agencia de un pedido pendiente, por ejemplo cuando el comprador no la eligió? Hoy existe el estado de agencia pendiente de asignar.

## Límite de la edición de shipping

Programación y estado se actualizan mediante shipping; las fechas reales y el estado resultante se determinan por lógica de negocio. Repetir el estado actual conserva sus fechas originales.

La edición general unificada de dirección, teléfono y otros datos de envío queda para la tarea [Ampliar edición de shipping del pedido](https://app.todoist.com/app/task/6hhW82C43r83JPx3). El MVP reutiliza la asignación de entrega con tarifa existente (`PUT /:id/delivery` con `rateId` y precio esperado) para los datos que necesitan los rótulos.

## Pruebas de integración y E2E

Títulos de las pruebas que acreditan el comportamiento definido en este documento. Siguen la convención del repositorio (títulos en inglés, en `*.integration.test.ts` colocados junto al código y en `apps/core/tests/e2e/*.spec.ts`). Las pruebas E2E de mobile usan las operaciones móviles contra la API real e impresora falsa, como `mobile-product-printing.spec.ts`; la impresión física en la Brother sigue en la validación pendiente.

### Integración (Core, base de datos real)

Fechas y shipping:

- `stores the scheduled dispatch date given at order creation and leaves it empty when omitted`
- `accepts a scheduled dispatch date earlier than today at creation and when rescheduling`
- `rejects a scheduled dispatch date that is not a real calendar day`
- `reschedules and unschedules a pending order without changing shipping cost, payments or stock`
- `rejects scheduling an order that is cancelled or already shipped`
- `records the dispatch date once when the order is marked as shipped`
- `keeps the original dispatch date when two shipments of the same order race`
- `keeps the original dates when the current status is requested again`
- `leaves the dispatch date empty when a pending order is delivered directly`
- `reverts the new schedule when the status change requested with it fails`
- `does not let a company schedule or ship another company's order`

Consulta de Ventas:

- `filters orders by dispatch status without including cancelled orders as pending`
- `filters orders by scheduled dispatch date range`
- `returns only unscheduled orders when the Sin programar filter is used`
- `rejects combining Sin programar with a scheduled date range`
- `filters orders by real dispatch date range with an exclusive upper bound`
- `filters orders by courier, including disabled couriers of existing orders`
- `combines the new dispatch filters with the existing customer and sale date filters`
- `paginates filtered orders in a stable order`
- `lists only orders of the current company for every dispatch filter`

Datos de entrega para el rótulo:

- `keeps the courier and agency snapshot when they are later renamed or disabled`
- `lets a pending order complete its delivery data and blocks it after dispatch`

### E2E

Fechas y estado (Core y app móvil contra la API real):

- `seller schedules a dispatch date when creating an order and sees it in the order detail`
- `seller reschedules, unschedules and schedules an overdue date for a pending order`
- `seller cannot change the scheduled date once the order is shipped`
- `seller ships an order and sees the real dispatch date while the scheduled date is kept`
- `seller delivers a pending order directly and no dispatch date is shown`
- `seller finds orders to prepare with dispatch status, scheduled date, Sin programar, real date and courier filters`

Selección y revisión de rótulos (mobile):

- `seller keeps the selected orders across pages and loses them when filters change`
- `seller loses the selection when switching company`
- `select all only selects the orders on the visible page`
- `print review reports ready labels and orders that need completing, with what is missing`
- `print review excludes store pickup, unassigned delivery and cancelled orders with a visible reason`
- `print review excludes an agency order without courier or document`
- `print review excludes an order whose content does not fit the label`
- `seller opens an excluded order from the review, completes its data and it becomes ready`
- `orders with pending payments are ready to print`

Impresión por lote (mobile, impresora falsa):

- `prints one label per ready order and skips the excluded ones`
- `home and agency labels show the stored sender, recipient, destination and footer without products`
- `label footer omits the date when the order has no scheduled dispatch`
- `printing tells which roll to load for dispatch labels and for QR labels`
- `printing a batch does not change order statuses or dates`
- `shipped and delivered orders can be reprinted without changing statuses or dates`
- `stopping the batch finishes the label being sent and does not start the next one`
- `a failed label stops the batch and continuing skips the confirmed ones`
- `an uncertain label is not resent until the seller decides after checking the output`
- `QR printing is rejected while a dispatch batch is printing and the rest of the app stays usable`
- `the printer is released after a batch finishes or stops on error`
