# Tareas de preparación de despachos y rótulos

Fuentes normativas: [definiciones de producto](preparacion-despachos-rotulos-definiciones.md) y [diseño técnico](preparacion-despachos-rotulos-tecnico.md) (en adelante, “el diseño”; las referencias `§` remiten a él).

Estado: plan de trabajo; ninguna casilla implica implementación o pruebas ejecutadas. El refactor de zonas, opciones, couriers y agencias ya está implementado y no forma parte de este plan.

## Organización

Cada tarea termina en un estado que compila y se puede verificar por sí solo. Hay tres frentes independientes —**Core** (fechas y consulta), **Ventas móvil** (captura y selección) y **Printing** (formato, coordinación y renderer)— que solo se juntan en la tanda de impresión.

Los bloqueantes comunes son dos tareas **pequeñas** que fijan contratos sin cambiar comportamiento: **A0** (columnas y contratos HTTP) y **C0** (tipos de rótulo y formato). Pueden hacerse en paralelo el primer día; después casi todo corre en paralelo.

```text
Ola 0   A0 Base de fechas y contratos (pequeña)      C0 Contratos de rótulo y formato (pequeña)
        │                                             │                     C1 Formato Brother 62×100*
        │                                             │                     C2 Reserva única de impresora*
Ola 1   A1 Programación y despacho   A2 Filtros       C3 Renderer y medición
        B1 Fecha en creación/detalle  B2 Filtros y selección en Ventas
                                                      C4 Preparación de rótulos
Ola 2                         D1 Revisión y tanda de impresión
Ola 3                         D2 Cierre, regresión y prueba física
```

`*` C1 y C2 no necesitan C0 para empezar: C1 es dueño de `LabelFormat` y C2 no toca formatos.

| Tarea | Depende de | Puede correr en paralelo con |
| --- | --- | --- |
| A0 Base de fechas y contratos | — | C0, C1, C2 |
| C0 Contratos de rótulo y formato | — | A0, C1, C2 |
| A1 Programación y despacho | A0 | todas salvo D* |
| A2 Filtros de despacho | A0 | todas salvo D* |
| B1 Fecha en creación y detalle (móvil) | A0 | todas salvo D* |
| B2 Filtros y selección en Ventas (móvil) | A0 | todas salvo D* |
| C1 Formato Brother 62 × 100 | — | todas salvo D* |
| C2 Reserva única de impresora | — | todas salvo D* |
| C3 Renderer y medición | C0 | todas salvo D* |
| C4 Preparación de rótulos | A0, C0 | todas salvo D* |
| D1 Revisión y tanda de impresión | B2, C1, C2, C3, C4 | — |
| D2 Cierre y regresión | A1, A2, B1, D1 | — |

Las tareas móviles (B1, B2, C4) trabajan contra los contratos de A0 y fakes del API; no esperan a que A1 o A2 estén integradas. Su verificación contra el servidor real ocurre en D2.

### Decisiones de producto pendientes

Las definiciones dejan abiertos el **courier de domicilio** y la **asignación posterior** de courier/agencia. Este plan avanza con lo que el código ya garantiza, sin bloquear ninguna tarea:

- El rótulo de domicilio no muestra courier (el snapshot no lo tiene). El filtro por courier solo encuentra pedidos de agencia.
- Un pedido de agencia siempre tiene courier y agencia (no existe asignación pendiente en el snapshot), así que la exclusión “agencia sin courier/agencia” queda cubierta por el tipo y no requiere rama propia.

Si el negocio decide otra cosa, se abre una tarea nueva; ninguna de estas debe anticiparlo.

### Reglas para trabajar en paralelo

- **Migraciones.** Solo A0 cambia el esquema. Se genera con Prisma CLI siguiendo `.agents/skills/database-migrations/SKILL.md`. A2 puede añadir índices en su propia migración tras medir (§3).
- **Propiedad de archivos compartidos.**
  - `shared/contracts/orders.ts`: A0 añade todos los campos y schemas nuevos. A1, A2, B1, B2 y C4 los consumen; no los redefinen.
  - `apps/core/src/features/orders/presentation/api-routes.ts`: A1 añade `PATCH /:id/shipping`; A2 solo toca el parser de búsqueda.
  - `apps/mobile/src/features/orders/infrastructure/order-api.ts`: B1 agrega fecha y PATCH; B2 agrega parámetros de búsqueda. Cambios en funciones distintas.
  - `apps/mobile/src/features/printing/domain/printing.ts`: C0 añade el formato de despacho al tipo; C1 añade el perfil y transporte; C2 no lo toca.
  - `presentation/print-provider.tsx`: C2 es dueño; D1 lo extiende después.
  - `order-history-screen.tsx`: B2 es dueño; D1 añade la acción de imprimir sobre la selección.
- **Sin persistencia de impresión.** Ninguna tarea crea tablas de despachos, rótulos, tandas ni `printedAt` (§3).
- **Verificación mínima por tarea:** `typecheck`, `lint` y pruebas unitarias del módulo tocado; `sh scripts/run-tests.sh integration` cuando cambian repositorios o rutas de Core; `pnpm --dir apps/mobile test` cuando se toca mobile o `shared`.

## A0. Base de fechas y contratos (pequeña, desbloquea)

**Flujo:** migración aditiva → el agregado lee y serializa las fechas nuevas (siempre vacías) → los contratos compartidos describen creación, PATCH y filtros. Ningún comportamiento cambia.

**Alcance**

- Columnas `Order.scheduledDispatchDate` (fecha calendario, nullable) y `Order.shippedAt` (instante, nullable). Sin backfill.
- `DispatchDate`: parser de fecha calendario real que devuelve `Result` (§11). En `shared/` porque lo usan ambos runtimes.
- Agregado, mapeo de repositorio, `order-json.ts` y contrato de respuesta (detalle y resumen) con ambas fechas.
- En `shared/contracts/orders.ts`: `scheduledDispatchDate` opcional en creación; schema del PATCH de shipping (al menos un campo, `null` quita la programación, `status` solo `shipped`/`delivered`, campos desconocidos rechazados); parámetros de búsqueda `deliveryStatus`, `courierId`, `scheduledFrom`, `scheduledThrough`, `unscheduled`, `shippedFrom`, `shippedBefore`.
- Actualizar factories y fixtures de pruebas al nuevo agregado.

**Fuera de alcance:** usar los campos en casos de uso, rutas o UI.

**Cierre:** pruebas del parser (fechas inválidas como 2026-02-30) y de los schemas; typecheck de core y mobile en verde.

## C0. Contratos de rótulo y formato (pequeña, desbloquea)

**Flujo:** tipos puros en móvil que permiten construir renderer y preparación en paralelo.

**Alcance**

- `apps/mobile/src/features/orders/domain/dispatch-label.ts`: tipo `DispatchLabel` (remitente, destinatario, destino por modalidad, courier opcional, fecha programada opcional; §11) y la unión de resultado de preparación por pedido: listo, excluido con código (`METHOD_NOT_APPLICABLE`, `DELIVERY_NOT_ASSIGNED`, `CANCELLED`, `MISSING_DATA` con campos, `LABEL_CONTENT_OVERFLOW`) o error de lectura.
- `LabelFormat` admite exactamente 62 × 29 y 62 × 100 (`dispatchLabelFormat`). Las dimensiones imprimibles reales las confirma C1.

**Cierre:** typecheck de mobile; checks de tipos que impidan construir un `DispatchLabel` de agencia sin documento.

## A1. Programación y despacho (Core)

**Flujo:** crear pedido con fecha → reprogramar o quitar la fecha mientras está pendiente → despachar registra `shippedAt` → la entrega directa deja `shippedAt` vacío.

**Alcance**

- Propagar `scheduledDispatchDate` en `create-order.ts` y `create-complete-order.ts` (este arma el input explícitamente, §4).
- `registerShipment` escribe estado y `shippedAt` con el reloj del servidor en la misma transacción; repetir el estado conserva la fecha original.
- `application/update-order-shipping.ts` y `PATCH /:id/shipping` (§4): bloqueo por pedido, programación solo en pendiente/no cancelado, programación antes de la transición en la misma transacción, escrituras acotadas (§11). Fechas pasadas aceptadas.

**Cierre:** pruebas de dominio/aplicación e integración: aislamiento de empresa, despacho concurrente no cambia la fecha dos veces, cancelado rechaza programar, fallo de transición revierte la programación, `pending → delivered` sin `shippedAt`.

## A2. Filtros de despacho (Core)

**Flujo:** Ventas consulta por estado de despacho, courier, fecha programada (rango o Sin programar) y fecha real, combinados con los filtros actuales.

**Alcance**

- Parser de búsqueda que normaliza a `ScheduledDispatchFilter` (§11) y rechaza Sin programar con rango o extremos invertidos.
- Criterios en `list-order-aggregates.ts` y la query de `order-repository.ts`; courier por ID del snapshot. Reutilizar los helpers de zona horaria de Ventas para `shippedFrom`/`shippedBefore`.
- Pendientes de preparar no incluyen cancelados.
- Verificar que la lectura de couriers de la empresa incluye deshabilitados para el selector (§10); si no, exponerlos.
- Índices solo si la medición con la consulta real lo justifica.

**Cierre:** pruebas de integración con tenant, paginación estable y cada filtro combinado.

## B1. Fecha en creación y detalle (móvil)

**Flujo:** el vendedor programa la fecha al crear la venta o la cambia/quita desde el detalle mientras esté pendiente; el detalle muestra fecha programada, fecha real y courier.

**Alcance:** `order-draft.ts`, `new-order-screen.tsx`, `order-detail-screen.tsx`, `order-api.ts` (creación y PATCH). Reutilizar `OrderDayField`. Edición deshabilitada fuera de pendiente.

**Cierre:** pruebas de pantalla con API falsa: crear con y sin fecha, reprogramar, quitar, pedido despachado sin edición.

## B2. Filtros y selección en Ventas (móvil)

**Flujo:** el vendedor filtra Ventas por despacho, selecciona pedidos en varias páginas y ve el total seleccionado.

**Alcance**

- Modal de filtros con estado de despacho, courier, fecha programada (incluye Sin programar) y fecha real.
- Lista muestra fecha programada y courier cuando existan.
- Selección por ID entre páginas; se limpia al cambiar filtros o empresa; Seleccionar todos solo la página visible. Exponer la selección para que D1 la consuma.

**Cierre:** pruebas de selección entre páginas, limpieza y Seleccionar todos.

## C1. Formato Brother 62 × 100 (Printing + módulo nativo)

**Flujo:** un PNG de 62 × 100 viaja con su formato explícito desde `PrintRequest` hasta Kotlin y se imprime en DK-11202; el QR de 62 × 29 sigue igual.

**Alcance**

- Confirmar en el SDK el enum de papel y el área imprimible de DK-11202 antes de codificarlos (§6, §10).
- Perfil de render por formato; el formato resuelto viaja en `ResolvedPrinter` o el input de envío, nunca inferido del PNG.
- `brother-adapter.ts`, `modules/brother-printer/index.ts` y `BrotherPrinterModule.kt` aceptan los dos formatos; papel incompatible se reporta como error, no como éxito.

**Cierre:** pruebas del adaptador y del puente; prueba en Android con la impresora de ambos rollos (si no hay acceso físico, dejarlo reportado como pendiente).

## C2. Reserva única de impresora (Printing)

**Flujo:** cualquier impresión (QR o tanda) reserva la impresora para la operación completa; una segunda operación recibe “ocupado” sin encolarse.

**Alcance**

- Operación acotada por callback en `printing-operations.ts`: adquirir, ejecutar uno o varios envíos, liberar en `finally` (§11). Eliminar el envío sin coordinación de la API pública.
- Migrar `product-printing.ts` y `print-provider.tsx` a la reserva sin cambiar el contenido ni la cantidad del QR.
- Elegir impresora fuera de la reserva; no mantenerla durante un diálogo.

**Cierre:** pruebas de concurrencia (dos callers a la vez), liberación ante error y flujo QR existente en verde.

## C3. Renderer y medición del rótulo

**Flujo:** `DispatchLabel` → medición (¿cabe?) → PNG de 62 × 100 con la misma distribución.

**Alcance**

- `infrastructure/dispatch-label-renderer.ts` con las dependencias de dibujo ya instaladas; compartir con Products solo medición de líneas y carga de fuente.
- Bloques remitente / destinatario / destino / pie (definiciones, “Contenido del rótulo”); envolver líneas y reducir fuente hasta un mínimo configurable; si no cabe, `LABEL_CONTENT_OVERFLOW`, nunca truncar.
- La medición y el render comparten las mismas reglas de layout. Usa dimensiones provisionales de C0 hasta integrar C1.

**Cierre:** pruebas de medición con nombres y destinos extensos, sin fecha, domicilio sin referencia y agencia.

## C4. Preparación de rótulos

**Flujo:** IDs seleccionados → leer detalles con concurrencia acotada → clasificar cada pedido como listo o excluido con motivo.

**Alcance**

- `application/order-printing.ts`: usa el endpoint de detalle existente y el nombre del negocio de la sesión; recibe la medición como dependencia (C3 la provee en D1).
- Reglas por modalidad (tabla de datos obligatorios en las definiciones); tienda y sin entrega excluidos; cancelados excluidos; despachados y entregados permitidos; pagos ignorados.
- Un fallo de red o una respuesta inválida es error de lectura, no dato faltante.

**Cierre:** pruebas unitarias de cada motivo y de modalidades mixtas.

## D1. Revisión y tanda de impresión (integración)

**Flujo:** desde la selección de Ventas → revisión “N rótulos listos; M pedidos requieren completar datos” con motivos y acceso al detalle → indicación del rollo → envío secuencial con progreso → detener, error, continuar e inciertos.

**Alcance**

- `presentation/dispatch-print-review.tsx` y estado de tanda en memoria por encima de Ventas (§7), con `DispatchPrintState` (§11).
- Toda la tanda dentro de una sola reserva de C2; renderizar y enviar de uno en uno.
- Detener tanda termina el envío en curso; error detiene y continuar salta confirmados; incierto pide revisar la salida y decidir explícitamente. Cambiar de empresa impide nuevos envíos.
- Volver a preparar tras editar un pedido desde la revisión.
- iOS no muestra acción operativa de impresión.

**Cierre:** pruebas con impresora falsa: detener durante envío, error y continuación, incierto, QR bloqueado durante la tanda.

## D2. Cierre y regresión

- Recorrido integrado contra el servidor: pedidos con pago pendiente, completos e incompletos, modalidades mixtas; imprimir no cambia estados ni fechas.
- E2E/integración de Core para PATCH de shipping y filtros.
- Prueba física en Android con ambos rollos y textos extensos; fijar el mínimo tipográfico con el negocio piloto.
- Actualizar el estado del diseño técnico.
