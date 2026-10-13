# Preparación de despachos y rótulos: diseño técnico

Estado: el refactor de zonas, opciones, couriers y agencias (secciones "Destino y courier" y "Zonas, opciones, couriers y agencias") está implementado y se revisó contra el código el 12 de octubre de 2026. Las tareas A0–A2, B1, B2, C0–C4, D1 y D2 del [plan](preparacion-despachos-rotulos-tareas.md) están implementadas e integradas (estado a 13 de octubre de 2026); lo pendiente está en la sección "Estado de implementación". Complementa las [definiciones de producto](preparacion-despachos-rotulos-definiciones.md) y recoge las decisiones técnicas posteriores. Los nombres nuevos de operaciones, campos y archivos son propuestas de implementación.

## 1. Decisiones confirmadas

- Preparación desde Ventas móvil; impresión Brother solo en Android en este MVP.
- Fecha programada opcional al crear y editable mientras el pedido esté pendiente y no cancelado. Fecha real registrada al despachar.
- Se permiten fechas programadas anteriores a hoy. La entrega directa no asigna fecha real de despacho.
- Se permite reimprimir despachados y entregados con datos completos; los cancelados se excluyen.
- Un rótulo por pedido, solo para domicilio y agencia. Pago e impresión son independientes.
- Impresión conjunta de los pedidos listos; exclusión explicada de los incompletos o cuyo contenido no cabe.
- Brother QL-810W: añadir 62 × 100 mm para despachos y conservar 62 × 29 mm para QR.
- Selección entre páginas; limpiar al cambiar filtros o empresa. Seleccionar todos afecta únicamente la página visible.
- Ubicación con el catálogo oficial de distritos (`shared/peru-geography.ts`); departamento, provincia y distrito obligatorios para domicilio y agencia. Dirección obligatoria para domicilio; referencia opcional.
- Domicilio y agencia se asignan mediante el modelo de zonas, opciones y tarifas. La zona agrupa distritos; cada opción define modalidad, nombre y precio.
- Couriers y agencias son catálogos del sistema (los couriers se cargan con un seed JSON y las agencias se mantienen por SQL). La empresa elige sus couriers del catálogo y asocia agencias a sus opciones de agencia; la agencia tiene nombre, dirección y distrito, y en checkout se elige la opción y una de sus agencias. Sustituyó la agencia como texto libre por pedido.
- Courier y agencia obligatorios para imprimir agencia; documento obligatorio para agencia y opcional para domicilio.
- Se eliminan los contratos y snapshots anteriores a las tarifas, sin compatibilidad ni transformación de pedidos históricos: la app no está en producción. Los pendientes pueden completar sus datos; los despachados mantienen bloqueada la edición.
- Tanda secuencial, progreso solo en memoria, detención entre rótulos y recuperación de errores sin repetir los confirmados.
- Una sola impresión activa en toda la app, incluidos QR. Esta decisión sustituye la postergación previa de la coordinación global.

## 2. Estado actual verificado

`Order` contiene `deliveryStatus`, `deliveredAt` y `completedAt`, pero no fecha programada ni fecha real de despacho. `registerShipment` solo cambia el estado. `registerDelivery` permite entrega directa desde pendiente.

`Order.delivery` guarda un snapshot JSON validado con tarifa (`shared/contracts/orders.ts`, `domain/order-state-machine.ts`); la familia anterior a tarifas ya no existe.

| Domicilio | Agencia | Tienda |
| --- | --- | --- |
| Dirección, indicaciones y `PeruDeliveryDistrict` (`districtCode`, distrito, provincia, departamento) + `pricing`. Sin courier. | `destination` (`PeruDeliveryDistrict` del comprador) + `pricing` + `courier {id, name}` + `agency {id, name, address, location}`, siempre presentes. | Punto de recojo + `settingsVersion`. |

`pricing` contiene `quotationId`, `rateId`, `optionId` y `settingsVersion`. La asignación usa `PUT /:id/delivery` con `ratedDeliverySelectionSchema` (`rateId` + precio esperado; la variante agencia agrega `agencyId`) y `resolveShippingCost` (`application/resolve-delivery-selection.ts`). Una agencia no asociada a la opción, deshabilitada o de un courier deshabilitado produce `RATE_UNAVAILABLE`.

Configuración (`features/delivery-settings`): `DeliveryZone` agrupa distritos; `DeliveryOption` (`home`/`agency`) tiene nombre, estado y precio; `Quotation` y `DeliveryRate` inmutables se generan por opción aplicable; `CompanyDeliverySettings` con métodos habilitados; `CompanyCourier` referencia un `Courier` del catálogo. `DeliveryAgency` es catálogo del sistema (de solo lectura para la app) y `DeliveryOptionAgency` la asocia a opciones de agencia. Una opción de agencia sin agencias elegibles no aplica. La columna `Order.checkoutDeliveryRequest` se eliminó.

Las fechas se incorporan al agregado, serializador, respuesta de detalle y resumen. La creación acepta opcionalmente `scheduledDispatchDate`; omitirlo equivale a no programar.

Decisión confirmada para la entrega directa que ya existe: conservar `pending → delivered` sin inventar un despacho; `shippedAt` permanece vacío si no se ejecutó esa transición. No derivarlo de `deliveredAt`.

### Destino y courier

Partir del snapshot con tarifa y eliminar la familia anterior. No se crea una forma de destino paralela: se reutilizan `PeruDeliveryDistrict`, `HomeDestination` (`address`, `instructions`) y `DeliveryPricing` existentes.

```ts
// DeliverySnapshot (solo variantes con tarifa):
// home:   recipient + destination: { address, instructions } & PeruDeliveryDistrict + pricing + recordedBy
//         (+ courier de domicilio: pendiente)
// agency: recipient con documento + destination: PeruDeliveryDistrict + pricing + courier + agency + recordedBy
// store:  recipient + pickupPoint + settingsVersion + recordedBy
```

`instructions` conserva el nombre del campo existente para la referencia opcional. Los nombres de distrito, provincia y departamento se copian del catálogo al asignar; el rótulo los lee del snapshot, no recalcula el catálogo. La validez de un destino no garantiza que quepa en el rótulo: esa comprobación es independiente.

La agencia dejó de ser texto libre. `agency` copia del catálogo su ID, nombre, dirección y `location` (código y nombres del distrito); el rótulo de agencia usa esos datos como destino. El distrito del comprador en `destination` sigue siendo el de la tarifa. Courier y agencia se resuelven bajo el bloqueo de configuración al asignarlos y se guardan como snapshot histórico: deshabilitarlos o renombrarlos no cambia pedidos existentes. No hay asignación pendiente (`courier: null, agency: null`).

Implementado: se eliminaron `legacyDeliverySnapshotSchema`, `deliverySelectionSchema`, `legacySetOrderDeliverySchema` y `legacyCompleteOrderSchema` y sus ramas, sin backfill.

### Zonas, opciones, couriers y agencias

Implementado. Decidido:
- La zona solo agrupa distritos (configuración de la empresa). Cada zona tiene opciones de envío con modalidad, nombre, precio y estado. La tarifa depende solo de la opción.
- Couriers y agencias son catálogos globales: `Courier` (seed `apps/core/prisma/catalog/couriers.json`, upsert por `code`) y `DeliveryAgency` (SQL directo; sin ruta ni UI de escritura). La agencia tiene nombre, dirección y distrito del catálogo, pertenece a un courier y se asocia a opciones de agencia. Su distrito es ubicación, no cobertura, y no se restringe por las zonas.
- Pendientes en las definiciones de producto: courier de domicilio y asignación posterior.

Modelo resultante (sin compatibilidad con datos anteriores):

| Tabla | Contenido |
| --- | --- |
| `DeliveryZone` | `name`, `enabled`; distritos en `DeliveryZoneDistrict` (`companyId`, `zoneId`, `districtCode`), sin `method` |
| `DeliveryOption` | `companyId`, `id`, `zoneId`, `method`, `name`, `enabled`, `priceAmount`, `priceCurrency`; nombre único por zona |
| `Courier` (catálogo) | `id`, `code`, `name`, `enabled`; `CompanyCourier` referencia `Courier` (único por empresa y courier) |
| `DeliveryAgency` (catálogo) | `id`, `courierId`, `name`, `address`, `districtCode`, `enabled`; sin `companyId` ni RLS |
| `DeliveryOptionAgency` | `companyId`, `optionId`, `agencyId`; FK compuesta que limita a opciones `method = "agency"` |
| `DeliveryRate` | `optionId` (sin `zoneId`); el snapshot guarda `pricing.optionId` |

Las tablas por empresa usan `companyId` en PK/FK compuestas y RLS como el resto de delivery-settings. Zonas, opciones y couriers de empresa se deshabilitan, no se borran.

Comportamiento:
- **Configuración** (web y móvil): editar zonas como conjuntos de distritos y, dentro de cada una, sus opciones y las agencias del catálogo asociadas. Incrementa `version`. `prepareDeliveryZones` valida opciones y agencias.
- **Cotización:** devuelve opciones activas de zonas activas que cubren el distrito. Una opción de agencia solo aplica si `agencyEnabled` y tiene al menos una agencia habilitada con courier habilitado de la empresa. Cada tarifa expone sus agencias elegibles.
- **Selección** (`ratedDeliverySelectionSchema`): la variante agency exige `agencyId`; el courier se deriva de la agencia.
- **Resolución:** `resolveSelectedDeliveryRate` compara el precio de la tarifa con el precio actual de la opción y valida que la agencia esté asociada a la opción, habilitada y con courier habilitado de la empresa, bajo el mismo bloqueo de configuración; si no, `RATE_UNAVAILABLE`.
- **Distrito en varias zonas:** se mantiene permitido. Cada opción aplicable genera una tarifa con su nombre.

### Persistencia y esquema

No crear tablas de despachos, rótulos, tandas ni historial de impresión. No guardar `printedAt` ni estado de impresión en Order.

Agregar las columnas de fechas al esquema requiere un cambio de estructura de base de datos. Al implementar se seguirá el mecanismo del repositorio para generar ese cambio; no se escribirá un backfill ni una capa de lectura compatible para JSON antiguo. Actualizar factories, fixtures y datos de prueba a la nueva estructura. No borrar datos locales automáticamente.

Evaluar índices compuestos encabezados por `companyId` para los filtros de despacho con la consulta real. No duplicar courier en otra columna solo para filtrar: usar el ID del snapshot inicialmente y medir antes de añadir un índice de expresión.

## 4. Casos de uso y contratos

### Actualizar shipping: alcance del MVP

Propuesta de ruta relativa al router existente de pedidos:

```http
PATCH /:id/shipping
Content-Type: application/json

{ "scheduledDispatchDate": "2026-10-15" }
```

La operación acepta `scheduledDispatchDate`, `status` o ambos; exige al menos uno. Un campo omitido se conserva; `scheduledDispatchDate: null` elimina la programación. `status` solo solicita transiciones a `shipped` o `delivered`, no retrocesos. El cliente no puede enviar `shippedAt`, `deliveredAt` ni el estado general derivado.

La operación autentica, valida entrada y carga el pedido de la empresa con bloqueo. Si cambia la programación, exige pendiente/no cancelado. Si también solicita una transición, primero aplica la programación al estado pendiente y después la transición, dentro de la misma transacción; un fallo revierte todo. Cambiar solo la fecha no recalcula envío, pagos ni stock. Las transiciones conservan sus validaciones de negocio y derivan sus fechas con el reloj del servidor. Solicitar el mismo estado no sobrescribe fechas ni evita las reglas de edición de otros campos. Devuelve el agregado actualizado mediante el serializador existente.

El concepto shipping podrá abarcar todos los datos de envío. En este MVP se unifican programación y estado; se reutilizan las operaciones de dominio existentes. La edición general de dirección, teléfono y demás datos bajo esta misma operación se difiere a [Ampliar edición de shipping del pedido](https://app.todoist.com/app/task/6hhW82C43r83JPx3). Se mantienen los campos de destino/courier acordados que necesita el rótulo en los formularios existentes; no se construye ahora un editor general adicional.

Aceptar fechas calendario válidas anteriores a hoy tanto al crear como al reprogramar; no imponer una fecha mínima basada en el reloj actual.

La creación guarda la fecha en su transacción actual. `createCompleteOrder` arma explícitamente el input de `create`; hay que propagar el campo allí para que no se pierda.

### Registrar despacho

Extender `registerShipment(order, now)` y su caso de uso para escribir estado y `shippedAt` en una misma transacción. Mantener las validaciones existentes de pago, stock y transición. Dos solicitudes concurrentes no deben cambiar dos veces la fecha.

### Consultar

Ampliar los criterios existentes con estado exacto de entrega, courier, intervalo de fecha programada, opción Sin programar e intervalo de fecha real.

Propuesta de parámetros: `deliveryStatus`, `courierId`, `scheduledFrom`, `scheduledThrough`, `unscheduled`, `shippedFrom`, `shippedBefore`. Los programados son fechas calendario; los reales son instantes con extremo superior exclusivo. Reutilizar los helpers existentes para convertir días de consulta en intervalos de la zona horaria que ya usa Ventas.

Rechazar combinaciones incompatibles de Sin programar con un intervalo programado. Conservar filtros actuales y orden estable. La vista de pendientes para preparar no debe incorporar cancelados por el simple hecho de conservar `deliveryStatus = pending`.

El selector de courier debe incluir opciones históricas/desactivadas necesarias para encontrar pedidos existentes. Verificar si la lectura de configuración existente devuelve esas opciones antes de crear otra consulta.

### Preparar rótulos

Leer los detalles actuales por ID utilizando el endpoint existente. No crear inicialmente un endpoint de lote; mantener concurrencia acotada y medir con el volumen piloto.

Usar `order.delivery`, nunca `checkoutDeliveryRequest` pendiente de aceptación. Obtener el remitente del negocio de la sesión. Conservar una copia de los datos preparados durante la tanda y sus reintentos. Volver a preparar tras editar un pedido.

Clasificar cada seleccionado como listo o excluido, con códigos y campos identificables: modalidad no aplicable, entrega no asignada, datos faltantes (incluida agencia con courier/agencia pendientes), fallo de lectura o contenido que no cabe. No convertir fallos de red en ausencia de datos.

No usar el pago como condición de impresión. Permitir reimpresión de despachados y entregados usando los datos guardados y las reglas de suficiencia de contenido. Excluir cancelados con un motivo explícito. Imprimir o reimprimir nunca modifica estados ni fechas.

## 5. Interfaz móvil

- Extender Ventas y su modal de filtros; mostrar fecha programada y courier cuando existan.
- Mantener selección por ID entre páginas, sin convertir Seleccionar todos en una consulta global.
- Mostrar total seleccionado y una revisión con listos/excluidos, motivos y acceso al detalle.
- Agregar fecha opcional en creación y edición independiente en detalle; reutilizar `OrderDayField`.
- La edición de entrega ya usa distrito del catálogo y tarifa (`order-delivery-screen.tsx`, `delivery-fields.tsx`); añadir la selección de courier y agencia cuando exista su modelo.
- Informar el rollo requerido antes del envío. No confundir esa indicación con detección automática del papel.
- Mostrar progreso, pedido actual, resultados inciertos, pendientes y acción Detener tanda.
- Deshabilitar nuevas impresiones durante un trabajo activo; mantener utilizable el resto de la app.

Los formularios web de entrega y checkout (`presentation/rated-delivery-form.tsx`, `app/components/checkout-delivery-fields.tsx`) también cambian al eliminar las variantes anteriores y añadir courier/agencia, aunque la preparación de despachos sea exclusivamente móvil. iOS no muestra una acción de impresión operativa con esta integración.

## 6. Renderizado y soporte Brother

Orders es dueño del contenido y composición del rótulo. Printing sigue recibiendo formato y función de renderizado, sin conocer destinatarios, couriers ni pedidos.

Crear un renderer de despachos usando las dependencias de dibujo ya instaladas. Compartir con Products solo utilidades pequeñas realmente comunes, como medición de líneas y carga de fuente; no crear un motor de plantillas.

Adaptar la referencia visual a 62 × 100 mm. Realizar medición previa para toda la selección antes de enviar: envolver líneas y ajustar fuente hasta un mínimo legible. Si no cabe, excluir con `LABEL_CONTENT_OVERFLOW`; no truncar nombre, documento, destino ni referencia. El mínimo tipográfico exacto se determina mediante la prueba física del piloto.

El formato debe viajar desde `PrintRequest` hasta el adaptador y el módulo nativo. `ResolvedPrinter` o el input de envío debe conservar explícitamente el formato resuelto; no inferir el papel desde el tamaño del PNG.

Ampliar conjuntamente el tipo `LabelFormat`, la selección de perfil, los literales del puente nativo, las dimensiones aceptadas en Kotlin y la configuración de papel del SDK. Verificar el enum y área imprimible del SDK para DK-11202 antes de codificarlos. No extrapolar dimensiones imprimibles desde 62 × 100 mm físicos.

Conservar validación de identidad de impresora, manejo de papel incorrecto y limpieza de documentos temporales. Renderizar/enviar de uno en uno para no acumular imágenes de toda la tanda; la medición previa comparte las mismas reglas de layout con el renderer.

## 7. Coordinación, detención y reintentos

Representación mínima del progreso por pedido:

```ts
type DispatchPrintStatus =
  | "pending"
  | "sending"
  | "confirmed"
  | "not-sent"
  | "unknown";
```

`confirmed` significa confirmación del SDK, no verificación física del contenido pegado al paquete. Excluidos se conservan por separado de los trabajos enviados.

El servicio compartido reserva la impresora para una operación completa: QR individual o tanda. No adquirir y liberar el bloqueo entre etiquetas. Rechazar otra operación con un error explícito de ocupado, sin encolarla. Todos los puntos de entrada usan esa coordinación; los botones por sí solos no son garantía.

Liberar la reserva mediante `finally` al terminar, detener o fallar. Si falta elegir impresora, salir de la operación y reintentar adquiriendo nuevamente la reserva cuando se seleccione. No mantenerla por un diálogo abierto indefinidamente.

El usuario puede detener la tanda entre rótulos. Si hay un envío en curso, esperar su resultado, guardarlo y no iniciar otro. Cerrar sesión/cambiar empresa impide nuevos envíos y elimina la presentación de los datos de la sesión anterior; no declara cancelado un envío físico ya iniciado. La reserva sigue protegiendo ese envío hasta que retorne.

Ante fallo de envío, detener la tanda y conservar resultados. Al continuar, saltar confirmados. Si el resultado es incierto, pedir revisar la salida física y decidir explícitamente entre darlo por impreso o reenviarlo con riesgo de duplicado; nunca resolverlo con reenvío automático.

El progreso vive en memoria de la sesión, por encima de la pantalla de Ventas para tolerar navegación. Cerrar la app pierde la tanda y no dispara reanudación al abrirla. No implementar almacenamiento local, cola persistente ni procesamiento en segundo plano en este MVP.

## 8. Mapa de archivos

Rutas de grupos abreviadas: Core Orders = `apps/core/src/features/orders`; Mobile Orders = `apps/mobile/src/features/orders`; Printing = `apps/mobile/src/features/printing`.

| Área | Archivos existentes | Cambio |
| --- | --- | --- |
| Base de datos | `apps/core/prisma/schema.prisma` | Nuevas fechas y cambio de esquema generado según reglas del repo. |
| Contratos | `shared/contracts/orders.ts`, `shared/contracts/order-checkout.ts` | Fechas y filtros; eliminar schemas `legacy*` y `deliverySelectionSchema`; courier/agencia en la selección y snapshot de agencia. |
| Dominio Core Orders | `domain/order-state-machine.ts`, `domain/type-contracts.ts` | Programación, fecha real, eliminación de variantes anteriores y asignación de courier/agencia. |
| Creación Core Orders | `application/create-order.ts`, `create-complete-order.ts` | Propagar fecha opcional y guardarla atómicamente. |
| Entrega Core Orders | `application/fulfill-order.ts`, `set-delivery.ts`, `resolve-delivery-selection.ts` (`resolveShippingCost`), `checkout.ts` | Despacho con reloj; resolución de courier/agencia en la asignación con tarifa. |
| Delivery settings | `apps/core/src/features/delivery-settings/**`, `apps/mobile/src/features/delivery-settings/**` | Separar zona y opción; tablas de opciones, agencias y opción–agencia; configuración web/móvil; cotización y `resolveSelectedDeliveryRate` por opción y agencia. |
| Lectura/persistencia Core Orders | `application/list-order-aggregates.ts`, `infrastructure/order-repository.ts`, `checkout-repository.ts` | Nuevos criterios, mapeo, escrituras y snapshot de checkout. |
| API Core Orders | `presentation/order-json.ts`, `api-routes.ts`, `composition.ts` | Serialización, ruta de programación y composición. |
| Formularios web | Core Orders `presentation/rated-delivery-form.tsx`; `apps/core/app/components/checkout-delivery-fields.tsx`; `apps/core/app/routes/order-detail.tsx` | Courier/agencia y eliminación de variantes anteriores, sin crear impresión web. |
| Estado/API Mobile Orders | `domain/order-draft.ts`, `application/order-operations.ts`, `infrastructure/order-api.ts`, `composition.ts` | Creación, fechas, filtros y preparación de impresión. |
| Pantallas Mobile Orders | `presentation/new-order-screen.tsx`, `order-history-screen.tsx`, `order-detail-screen.tsx`, `order-delivery-screen.tsx`, `order-delivery-form.ts`, `delivery-fields.tsx`; `infrastructure/pending-order-confirmation.ts` | Fecha, selección, filtros, courier/agencia y eliminación de ramas anteriores. |
| Servicio Printing | `domain/printing.ts`, `application/contracts.ts`, `application/printing-operations.ts`, `composition.ts` | Segundo formato y exclusión mutua por trabajo completo. |
| UI Printing | `presentation/print-provider.tsx`, `translations.ts` | Integración con reserva, progreso de sesión y reintentos; preservar flujo QR. |
| Brother | Printing `infrastructure/brother-adapter.ts`; `apps/mobile/modules/brother-printer/index.ts`, `android/src/main/java/expo/modules/brotherprinter/BrotherPrinterModule.kt` | Transportar y validar formato; configurar papel y dimensiones. |
| Products | `apps/mobile/src/features/products/application/product-printing.ts` y callers | Usar coordinación compartida; conservar contenido/cantidad del QR. |

Archivos nuevos propuestos, además de las pruebas correspondientes:

- Core Orders `application/update-order-shipping.ts` (coordina programación y transiciones existentes).
- Mobile Orders `domain/dispatch-label.ts`.
- Mobile Orders `application/order-printing.ts`.
- Mobile Orders `infrastructure/dispatch-label-renderer.ts`.
- Mobile Orders `presentation/dispatch-print-review.tsx`.

El mapa identifica los puntos afectados, no exige editar archivos cuyo contrato final no cambie. Revisar todos los callers y fixtures al introducir campos obligatorios.

## 9. Validación y orden de implementación

1. **Datos y contratos:** eliminar variantes sin tarifa; añadir fechas, creación y fixtures. Comprobar conservación de campos y rechazo de entradas incompletas en vendedor/checkout.
1b. **Zonas, opciones y agencias:** migración zona → opciones, tablas de agencias, configuración, cotización por opción, selección en checkout/vendedor y snapshot con `optionId` y agencia.
2. **Programación y consulta:** comprobar aislamiento de empresa, concurrencia con despacho/cancelación, Sin programar, intervalos, courier histórico y paginación.
3. **Captura y selección móvil:** creación con fecha, edición pendiente, selección entre páginas y limpieza al cambiar filtros/empresa.
4. **Formato Brother y renderer:** validar QR anterior, nuevo perfil/papel, texto extenso, desbordamiento y limpieza temporal. Verificar físicamente salida y corte.
5. **Tanda y coordinación:** comprobar que QR y despacho no se superponen; selección inicial de impresora, detener durante envío, liberación ante error, continuar sin repetir confirmados y tratamiento explícito de inciertos.
6. **Recorrido integrado:** seleccionar pedidos con pago pendiente, destinos completos/incompletos y modalidades mixtas; imprimir únicamente los aplicables sin cambiar fechas ni estados.

Usar los frameworks y pruebas existentes. Ejecutar typecheck y lint de módulos afectados, pruebas focalizadas de dominio/aplicación, integración de persistencia y API para cambios transaccionales y una validación Android con la impresora real. No considerar la aprobación del SDK como sustituto de la prueba física de legibilidad.

Incluir comprobaciones de las decisiones finales: programación pasada aceptada en creación y edición, entrega directa con `shippedAt` vacío, reimpresión permitida de despachados/entregados sin mutaciones y exclusión de cancelados.

## 10. Límites y puntos a verificar durante implementación

- Confirmar constantes del SDK y dimensiones imprimibles del formato nuevo.
- Elegir el mínimo tipográfico con el negocio piloto y muestras de direcciones largas.
- Comprobar disponibilidad de couriers desactivados para el filtro (`CompanyCourier.enabled`).
- Cerrar los pendientes de couriers y agencias (courier de domicilio, asignación posterior) antes de fijar contratos.
- Validar carga de detalles por selección con el volumen real antes de añadir un endpoint por lote.
- La detención no revierte un envío iniciado; el cierre de la app no permite asegurar si el último rótulo salió.
- No se añaden soporte iOS, impresión web, persistencia de tandas, guías oficiales ni integración con couriers. El catálogo geográfico ya existe y se reutiliza.

## Estado de implementación

**Implementado y probado**

- Core: fechas programada/real, `PATCH /api/orders/:id/shipping` (programación y transiciones atómicas, despacho concurrente una sola vez, aislamiento por empresa) y filtros de despacho (estado, courier, Sin programar, intervalos programado y real). Cubiertos por pruebas de integración HTTP en `api-routes.integration.test.ts`, que incluyen que leer pedidos mixtos (agregados y listados con filtros, pagados y pendientes, completos e incompletos, despachados y cancelados) no cambia estados, pagos ni fechas.
- Móvil: fecha en creación y detalle, filtros y selección entre páginas en Ventas, revisión y tanda de impresión con impresora falsa. La fila de Ventas muestra el courier del snapshot junto a la fecha programada.
- Imprimir no escribe en el servidor: la preparación solo lee, por lo que no cambia estados ni fechas.

**Pendiente**

- Prueba física en Android con ambos rollos (QR anterior y Brother 62 × 100) y textos extensos: no es posible en el entorno de desarrollo; verificar salida, corte y legibilidad.
- Fijar el mínimo tipográfico con el negocio piloto y muestras de direcciones largas.
- Courier de domicilio y asignación posterior (decisión de producto abierta): el rótulo de domicilio no muestra courier y el filtro por courier solo encuentra pedidos de agencia.
- Edición general de shipping (dirección, teléfono): diferida a la tarea de Todoist ya referenciada.
- Menores conocidos: el recorrido de impresión se prueba con impresora falsa; el cierre de la app no permite saber si el último rótulo salió.

## 11. Tipado fuerte y contratos entre capas

Los ejemplos de esta sección son contratos de diseño, no código incorporado a la aplicación. Refinan los tipos resumidos anteriormente.

### Autoridad y representación

| Capa | Tipos y responsabilidad |
| --- | --- |
| HTTP compartido | Schemas de entrada/salida en `shared/contracts`; tipos inferidos de esos schemas. Ningún DTO manual duplicado. |
| Dominio Core Orders | Reutilizar `OrderId`, `CompanyId`, `CourierId`, `Recipient`, `AgencyRecipient`, `DeliveryAuthor` y `Result`. Reglas puras y errores propios. |
| Aplicación | Inputs pequeños, contexto autenticado y dependencias explícitas; sin Request, Response, navegación o cliente de base de datos. |
| Persistencia | Convertir columnas/JSON a dominio con validación. Un JSON inválido es error de datos almacenados, no un pedido vacío. |
| Móvil | Parsear respuestas antes de usarlas; transformar datos válidos en el modelo específico de rótulo. No importar tipos privados de Core. |
| Puente nativo | Validar respuesta del módulo y entrada en Kotlin; conservar la distinción entre no enviado y resultado incierto. |

No usar `any`, `Partial<OrderAggregate>` para escrituras ni conversiones `as` que den por validados datos externos. Los discriminantes de dominio deben resolverse exhaustivamente. Una marca de TypeScript no sustituye la validación en ejecución.

### Fecha calendario y filtros normalizados

Introducir un tipo validado `DispatchDate` para distinguir el día programado de un instante. Su parser comprueba una fecha calendario real y devuelve `Result`; no solo una expresión regular. Reutilizar validación y utilidades existentes de fechas; colocar el parser en Orders y compartirlo solo si ambos runtimes lo necesitan.

```ts
type DispatchDate = string & { readonly __brand: "DispatchDate" };

type UpdateOrderShippingInput = Readonly<{ orderId: OrderId }> & (
  | Readonly<{
      scheduledDispatchDate: DispatchDate | null;
      status?: "shipped" | "delivered";
    }>
  | Readonly<{
      status: "shipped" | "delivered";
      scheduledDispatchDate?: DispatchDate | null;
    }>
);

type ScheduledDispatchFilter =
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "unscheduled" }>
  | Readonly<{ kind: "from"; from: DispatchDate }>
  | Readonly<{ kind: "through"; through: DispatchDate }>
  | Readonly<{ kind: "between"; from: DispatchDate; through: DispatchDate }>;
```

El parser de búsqueda transforma los query params en esta unión y valida el orden de los extremos. El repositorio recibe criterios normalizados: nunca `unscheduled: true` junto con fechas. No es necesario cambiar la representación de todos los filtros antiguos para introducir este contrato.

`undefined` significa omisión: en creación deja el pedido sin programar; en PATCH conserva el valor existente. `null` significa quitar la programación. El PATCH vacío se rechaza y solo admite campos del alcance actual. Los campos obligatorios del destino no llevan `?` ni defaults vacíos para ocultar consumidores sin actualizar.

### Variantes de entrega

Reutilizar `RatedDeliverySelection` y los IDs existentes en el dominio; la selección solo cambia en agencia:

```ts
type RatedAgencySelection = Readonly<{
  method: "agency";
  recipient: AgencyRecipient;
  rateId: DeliveryRateId;
  districtCode: PeruDistrictCode;
  agencyId: AgencyId;     // el courier se deriva de la agencia
}>;

type CourierSnapshot = Readonly<{ id: CourierId; name: string }>;
type AgencySnapshot = Readonly<{ id: AgencyId; name: string; address: string; district: DeliveryDistrict }>; // DeliveryDistrict: código y nombres del catálogo
type AgencyAssignment =
  | Readonly<{ kind: "pending" }>
  | Readonly<{ kind: "assigned"; courier: CourierSnapshot; agency: AgencySnapshot }>;
```

`AgencyAssignment` sustituye el par actual `courier: null; agency: null` | ambos presentes por una unión explícita. El cliente envía IDs; el servidor copia nombres y decide `recordedBy`. Domicilio conserva `RatedDeliverySelection` actual salvo lo que se decida sobre su courier.

### Escrituras acotadas y transacciones

```ts
type DispatchScheduleChange = Pick<OrderAggregate, "scheduledDispatchDate">;
type FulfillmentChange = Pick<
  OrderAggregate,
  "deliveryStatus" | "shippedAt" | "deliveredAt" | "completedAt"
>;
```

Los repositorios reciben estos cambios específicos en lugar de aceptar actualizaciones arbitrarias del agregado. Mantener el patrón existente de transacción y bloqueo por pedido. Programar y despachar concurrentemente se resuelven sobre el estado bloqueado; ninguna validación depende solo de la pantalla.

La transición de despacho produce estado shipped y fecha válida juntos. La estructura actual del agregado puede mantenerse plana, con invariantes comprobadas en las transiciones y al leer datos; no hace falta convertir todos los estados/pagos/fechas del sistema en una unión combinatoria.

### Preparación y resultados de impresión

El tipo `DispatchLabel` contiene únicamente contenido necesario para dibujar: remitente, destinatario, destino, modalidad, courier aplicable y fecha programada. Excluye pagos, stock y objetos de red. El renderer no recibe un `OrderAggregate` completo.

La preparación retorna una unión por pedido: listo con su `DispatchLabel`, excluido con motivo funcional, o error de lectura con el error del adaptador. Fallar al consultar un pedido no debe etiquetarlo como incompleto. Si la validación estricta de la respuesta detecta un destino inválido, se reporta como respuesta inválida, sin convertirlo mediante un cast en un destino parcial.

Refinar el enum de progreso de la sección 7 con payload obligatorio en cada resultado:

```ts
type DispatchPrintState =
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "sending" }>
  | Readonly<{ status: "confirmed"; receipt: PrintReceipt }>
  | Readonly<{ status: "not-sent"; error: PrintFailure }>
  | Readonly<{ status: "unknown"; error: SendError }>
  | Readonly<{ status: "confirmed-by-user" }>;
```

En implementación, acotar el error de `not-sent` y `unknown` al correspondiente `outcome` del contrato existente mediante los tipos de variante, sin permitir combinaciones contradictorias. `confirmed-by-user` distingue la revisión física de una confirmación del SDK; ambos se omiten al continuar. Cada entrada conserva ID del pedido y contenido preparado; la UI no reconstruye el rótulo en un reintento.

La reserva compartida debe exponer una operación acotada por callback: adquirir, ejecutar y liberar en `finally`. Dentro del callback se permite enviar uno o varios documentos sin volver a adquirir el bloqueo. El método de envío sin coordinación no debe quedar como alternativa pública para Products u Orders. No construir una cola ni un gestor persistente de trabajos.

El formato físico admite exactamente las dos variantes soportadas. El formato resuelto viaja hasta el envío; el render profile contiene dimensiones imprimibles y DPI. El identificador de papel específico de Brother pertenece al adaptador, no al dominio de pedidos.

## 12. Refactors concretos y criterios de cierre

| Refactor | Qué se reutiliza | Criterio verificable |
| --- | --- | --- |
| Simplificar snapshots | Uniones con tarifa, resolver y parser existentes | No queda ninguna variante sin tarifa en contratos, dominio, móvil ni web; una agencia sin documento o distrito del catálogo no construye una entrada válida. |
| Asignar courier y agencia | Configuración de couriers, cotización y `resolveShippingCost` | Courier y agencia deshabilitados o ajenos a la empresa/opción se rechazan; el snapshot conserva nombres históricos. |
| Añadir programación | Transacción, bloqueo, reloj y serializador existentes | Crear/programar/despachar conservan la fecha; impresión no escribe en Order. |
| Extender consulta | `AggregateCriteria`, query parametrizada y paginación actuales | Filtros se combinan sin omitir tenant ni incluir cancelados en pendientes operativos. |
| Separar revisión de impresión de Ventas | Lista y detalle existentes | Ventas conserva selección; un componente específico muestra preparación y resultados. |
| Coordinar Printing | Una instancia compartida y contratos de resultados actuales | No se solapan QR y tandas aunque dos callers invoquen el servicio a la vez. |
| Extender Brother | Descubrimiento, identidad y transporte existentes | Dos formatos explícitos de extremo a extremo; papel incompatible no se interpreta como éxito. |
| Añadir renderer de despachos | Dibujo, fuente y helpers de texto instalados | Mismos cálculos para preflight y render; contenido largo se excluye sin truncamiento. |

Ampliar `apps/core/src/features/orders/domain/type-contracts.ts` para cubrir la asignación de agencia, documento obligatorio de agencia y fecha calendario validada. Complementar esos checks de compilación con pruebas de ejecución: typecheck no acredita validez del JSON ni seguridad transaccional.

La implementación se considera cerrada cuando los contratos compilan en todos sus consumidores, pasan los checks focalizados del apartado 9 y existe evidencia Android de ambos formatos con la impresora. Si la validación física no está disponible, reportar esa limitación sin presentarla como comprobada.
