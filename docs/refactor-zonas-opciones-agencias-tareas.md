# Tareas del refactor de zonas, opciones, couriers y agencias

Fuente normativa: [refactor-zonas-opciones-agencias.md](refactor-zonas-opciones-agencias.md) (en adelante, “el diseño”). Las referencias `§` y `D` remiten a ese documento.

Estado: plan de trabajo; ninguna casilla implica implementación o pruebas ejecutadas.

## Organización

Cada tarea cubre un **flujo de trabajo completo** (contratos, datos, dominio, aplicación, rutas, UI web y móvil, y pruebas) y termina en un estado verificable que compila. No son tareas por archivo ni por capa.

El plan prioriza el paralelismo. El único bloqueante común es la **tarea 0**, deliberadamente pequeña: deja el esquema y los catálogos listos de forma aditiva, sin romper el código existente. Después avanzan en paralelo las tareas 1 a 4, y la tarea 5 integra las agencias en la venta.

```text
Ola 0   T0 Base aditiva (pequeña) ─────────┐        T1 Eliminar variantes anteriores
                                            │                │
Ola 1   T2 Couriers del catálogo   T3 Zonas con opciones   T4 Catálogo de agencias (lectura)
                │                          │                          │
Ola 2           └──────────── T5 Agencias en opciones y en la venta ──┘ (también requiere T1)
                                            │
Ola 3                              T6 Cierre y regresión
```

| Tarea | Depende de | Puede correr en paralelo con |
| --- | --- | --- |
| T0 Base aditiva | — | T1 |
| T1 Eliminar variantes anteriores | — | T0, T2, T3, T4 |
| T2 Couriers del catálogo | T0 | T1, T3, T4 |
| T3 Zonas con opciones | T0 | T1, T2, T4 |
| T4 Catálogo de agencias (lectura) | T0 | T1, T2, T3 |
| T5 Agencias en opciones y en la venta | T1, T2, T3, T4 | — |
| T6 Cierre y regresión | T5 | — |

### Reglas para trabajar en paralelo

- **Migraciones.** El diseño describe una sola migración (§3.2); este plan la reparte: T0 crea lo aditivo y cada tarea añade su propia migración destructiva. Cada migración se genera con Prisma CLI y sigue `.agents/skills/database-migrations/SKILL.md`. Al integrar, rebasar y regenerar si cambió el orden; no editar migraciones ya integradas.
- **Propiedad de archivos compartidos.** Para reducir conflictos:
  - `shared/contracts/delivery-settings.ts`: T2 solo la parte de couriers; T3 solo zonas y opciones; T4 solo el catálogo de agencias.
  - `shared/contracts/orders.ts`: T1 elimina variantes y redefine `completeOrderSchema`; T3 cambia `deliveryPricingSchema` y `ratedDeliverySelectionSchema` solo en lo necesario para `optionId`; T5 agrega `agencyId` y el snapshot de agencia.
  - `app/routes/delivery-settings.tsx` y `delivery-settings-screen.tsx` (móvil): T3 extrae las zonas a una sección propia; T2 solo modifica la lista de couriers.
- **Estado intermedio aceptado.** Entre T3 y T5, una opción de agencia nunca aplica (no hay agencias asociadas) y la venta por agencia no está disponible. Domicilio y tienda funcionan.
- **Base local.** Los pedidos con snapshots anteriores dejan de leerse; usar `pnpm exec prisma migrate reset` en bases locales (§3.2). No borrar volúmenes.
- **Verificación mínima por tarea:** `pnpm --dir apps/core typecheck`, `lint`, `test:unit` y `sh scripts/run-tests.sh integration`; `pnpm --dir apps/mobile typecheck`, `lint` y `test` cuando la tarea toca mobile o `shared`; E2E de los specs indicados en cada tarea.

## Tarea 0. Base aditiva: esquema nuevo y catálogo de couriers

**Flujo:** desplegar migraciones → seed del catálogo de couriers → provisión de permisos → la app sigue funcionando igual, con las tablas nuevas disponibles.

**Dependencias:** ninguna. **Tamaño:** pequeña; desbloquea T2, T3 y T4.

**Alcance**

- Migración **aditiva**: tablas `Courier`, `DeliveryOption`, `DeliveryAgency` y `DeliveryOptionAgency` con sus CHECK, FK compuestas y RLS (§3.1, §3.2 puntos 4–6). `CompanyCourier` gana `courierId` **nullable** y `@@unique([companyId, id])`. No elimina ni renombra columnas existentes.
- `apps/core/prisma/catalog/couriers.json` con Shalom y Olva, y `apps/core/scripts/seed-courier-catalog.ts` idempotente por `code` (§3.3, D14), integrado en el servicio `migrate` de `compose.yaml` y en `scripts/run-tests.sh` (`migrate.ts` → seed → `provision-role.sql`).
- `scripts/provision-role.sql`: excluir `Courier` y `DeliveryAgency` del `GRANT` general y concederles solo `SELECT` (§3.2, notas).
- Carpeta `apps/core/prisma/catalog/` documentada para los scripts SQL de agencias (D5), sin datos reales obligatorios.
- `shared/contracts/peru-location.ts` (§4.2), moviendo el schema privado de `orders.ts` sin cambiar su comportamiento.

**Fuera de alcance**

- Cambiar dominio, repositorios, rutas o UI. Eliminar columnas de `DeliveryZone`, `DeliveryRate` o `CompanyCourier.name`.

**Criterios de aceptación**

- [ ] `prisma migrate dev` aplica la migración sobre una base con datos y el chequeo de drift pasa.
- [ ] El seed ejecutado dos veces no crea filas ni cambia IDs; un JSON inválido termina con código distinto de cero y registra `courier_catalog_seed_failed`.
- [ ] `core_app` puede leer `Courier` y `DeliveryAgency` y no puede escribirlos, también después de `provision-role.sql` (`provision-role.test.ts`).
- [ ] RLS de `DeliveryOption` y `DeliveryOptionAgency` cubierta dentro de la integración existente; una asociación con una opción `home` es rechazada por la FK.
- [ ] Typecheck, lint, unit e integración de core pasan sin cambios en el comportamiento actual.

## Tarea 1. Eliminar variantes de entrega anteriores a las tarifas

**Flujo:** crear, asignar y confirmar entregas (vendedor web y móvil, checkout del comprador) usando solo los contratos con tarifa; leer pedidos sin ramas para formatos anteriores.

**Dependencias:** ninguna.

**Alcance**

- `shared/contracts/orders.ts`: eliminar `deliverySelectionSchema`, `legacy*`, alias `setOrderDeliverySchema`/`SetOrderDeliveryRequest`, `checkoutDeliveryRequest` del agregado y `COURIER_UNAVAILABLE` (D8, D9); redefinir `completeOrderSchema` (§4.5). Exportar las variantes de snapshot con nombre y pasar a `discriminatedUnion`, **manteniendo** por ahora la variante de agencia con tarifa `courier: null, agency: null` (T5 la reemplaza).
- `shared/contracts/order-checkout.ts`: `publicCheckoutDeliverySchema` por variantes con nombre, sin índices (§4.6).
- Core orders: `DeliverySelection`, `parseDeliverySelection`, `legacyDelivery`, guardas `chargeDeliveryToCustomer` en `order-state-machine.ts`, `set-delivery.ts`, `create-complete-order.ts` y el log de `composition.ts`; `checkoutDeliveryRequest` y `readRequestedDelivery` (§7.2). `settingsVersion` de `store` obligatorio.
- Migración que elimina `Order.checkoutDeliveryRequest` (D9).
- Web: `order-new.tsx`, `checkout-delivery-fields.tsx` y `order-detail.tsx` sin ramas de agencia en texto libre.
- Móvil: `pending-order-confirmation.ts` solo `version: 2`; `order-operations.ts` sin rama legacy y con `reviewPendingDelivery`; `new-order-screen.tsx` sin `legacyDelivery`/`legacyAttemptHint` y con salida para descartar un intento inválido; detalle y traducciones (§7.4).
- Pruebas existentes de §8 que usan variantes anteriores; `type-contracts.ts`.

**Fuera de alcance**

- `optionId`, `agencyId`, snapshot de agencia con courier y agencia.

**Criterios de aceptación**

- [ ] No quedan referencias a `legacy*`, `deliverySelectionSchema`, `checkoutDeliveryRequest`, `COURIER_UNAVAILABLE` ni `chargeDeliveryToCustomer` en `shared`, core y mobile.
- [ ] Un snapshot con agencia en texto libre o sin `pricing` se rechaza al leer con `InvalidStoredDeliveryError`; el checkout público valida sin `recordedBy`.
- [ ] Un intento pendiente guardado con formato anterior en el móvil da `INVALID_PENDING_DATA` y la pantalla permite descartarlo.
- [ ] Verificación mínima de core y mobile; E2E `orders`, `checkout`, `store-delivery`, `rated-order-creation-action`, `rated-order-delivery-action`.

## Tarea 2. Couriers de la empresa desde el catálogo

**Flujo:** el vendedor abre la configuración de envíos → ve el catálogo de couriers → habilita o deshabilita couriers del catálogo → guarda con control de versión → los couriers se muestran con el nombre del catálogo en web y móvil.

**Dependencias:** T0.

**Alcance**

- Migración: `CompanyCourier.courierId` obligatorio, `@@unique([companyId, courierId])` y eliminación de `name` (D4). Limpiar `CompanyCourier` de desarrollo y `agencyEnabled` como indica §3.2 punto 1.
- Contratos de couriers en `shared/contracts/delivery-settings.ts` (§4.3): `courierCatalogSchema`, `companyCourierSchema`, `courierInputSchema` por `courierId`, unicidad.
- Dominio y aplicación: `Courier` con `catalogId`, `CourierInput` sin `name`, `prepareCouriers` contra el catálogo, `getCourierCatalog` (§5.2, §5.3, §7.1). Refine D10 sin cambios.
- Repositorio: `writeCouriers` y `readCourierCatalog`; `P2002` → conflicto `concurrent_creation` (§3.4).
- Rutas: `GET /api/delivery-settings/courier-catalog`; `GET`/`PUT /api/delivery-settings` con la forma nueva (§4.1, §6).
- UI web (`delivery-settings.tsx`) y móvil (`delivery-settings-screen.tsx`, API y traducciones): elegir couriers del catálogo en lugar de escribir nombres.

**Fuera de alcance**

- Zonas, opciones y agencias.

**Criterios de aceptación**

- [ ] Una empresa no puede agregar un courier inexistente, deshabilitado en el catálogo ni duplicado; los existentes se conservan (solo se deshabilitan).
- [ ] Dos guardados concurrentes con la misma versión: uno responde `409 DELIVERY_SETTINGS_CONFLICT`.
- [ ] Renombrar un courier en el JSON y repetir el seed cambia el nombre mostrado sin alterar snapshots de pedidos existentes.
- [ ] Verificación mínima de core y mobile; E2E `delivery-settings`.

## Tarea 3. Zonas con opciones de envío

**Flujo:** el vendedor configura zonas como grupos de distritos con opciones (domicilio o agencia, nombre, precio) → se cotiza un distrito → cada opción aplicable genera una tarifa con su nombre → el comprador o vendedor elige una tarifa de domicilio → se resuelve contra el precio de la opción → el pedido guarda `pricing.optionId`.

**Dependencias:** T0.

**Alcance**

- Migración: `DeliveryZone` sin `method`, `priceAmount`, `priceCurrency`; `DeliveryZoneDistrict` sin `method`; `DeliveryRate.zoneId` → `optionId` con FK por `(companyId, method, optionId)`; eliminación de índices y CHECK de §3.2 (puntos 1–3). Limpieza de datos de desarrollo de zonas, cotizaciones y tarifas.
- Contratos de zonas y opciones (§4.3) y tarifa con `optionId`, `name`, `zoneName` (§4.4). Opciones de agencia con `agencyIds` en el contrato, que en esta tarea siempre llega vacío o se valida contra un catálogo vacío. `deliveryPricingSchema` con `optionId` (D6).
- Dominio: `DeliveryOption`, `DeliveryZone` con opciones, `prepareDeliveryZones` con retención, inmutables (D12), nombre único por zona (D11), divisa (§5.2, §5.3); `applicableDeliveryOptions` con las reglas de `home` y, para `agency`, exigiendo agencias elegibles (§5.4); `validateSelectedDeliveryRate` contra la opción (§5.5).
- Aplicación y repositorios: `saveDeliveryZones` sin `method` y con `generateOptionId`; `readDeliveryConfiguration`, `writeDeliveryZones`, `insertQuotationWithRates`, `readRateWithQuotation` (§3.4, §5.6).
- Pedidos: `DeliveryPricing.optionId` y `buildRatedDeliverySnapshot` para domicilio.
- UI web: sección de zonas propia con distritos y opciones (`delivery-zones-section.tsx`, `delivery-settings.tsx`); `rated-delivery-form.tsx` y `checkout-delivery-fields.tsx` muestran `name` (y `zoneName` si hay nombres repetidos) en lugar de “Opción N”.
- UI móvil: editor de zonas con opciones y nombre de la tarifa en `delivery-fields.tsx`, `order-delivery-screen.tsx` y `new-order-screen.tsx`.

**Fuera de alcance**

- Asociar agencias a opciones, selector de agencia y snapshot de agencia (T5).

**Criterios de aceptación**

- [ ] Guardar zonas conserva todas las zonas y opciones existentes; cambiar `zoneId` o `method` de una opción existente se rechaza con `INVALID_DELIVERY_OPTION` e índices correctos.
- [ ] Un distrito en dos zonas con opciones de domicilio produce una tarifa por opción, ordenadas por método, precio e `id`; un distrito sin cobertura produce una cotización vacía.
- [ ] Cambiar el precio de la opción después de cotizar devuelve `TOTAL_CHANGED` con el precio actual; deshabilitar la opción devuelve `RATE_UNAVAILABLE`.
- [ ] El pedido guarda `pricing.optionId` y no se altera al cambiar la configuración.
- [ ] Verificación mínima de core y mobile; E2E `delivery-settings`, `checkout`, `mobile-checkout`, `mobile-order-creation`, `rated-order-*`, `buyer-payment`, `order-fulfillment`.

## Tarea 4. Catálogo de agencias de solo lectura

**Flujo:** el equipo carga agencias por SQL → la app las lee validadas → un vendedor consulta las agencias de un courier que su empresa tiene configurado.

**Dependencias:** T0. Para probar la ruta con un courier de empresa basta crear la fila en la prueba; no requiere T2 terminada.

**Alcance**

- Dominio `delivery-agency.ts`: `DeliveryAgency` y `parseDeliveryAgency` con distrito validado contra el catálogo (§5.2, §5.3).
- Repositorio `agency-catalog-repository.ts`: `readAgencies(ids)` y `readAgencyCatalog(courierId)` (§3.4). Fila inválida → `INVALID_STORED_DATA` con log.
- Aplicación `agency-catalog.ts`: `getAgencyCatalog` comprueba que la empresa tenga el courier.
- Contrato `catalogAgencySchema`, `agencyCatalogSchema` (§4.3) y ruta `GET /api/delivery-settings/agency-catalog?courierId=` con `404` para courier ajeno (§4.1, §6).
- Clientes de lectura del catálogo en web y móvil (adaptador y tipos), sin pantallas.
- Script SQL de ejemplo en `apps/core/prisma/catalog/` con las reglas de D5 (UUID en el script, distrito del catálogo, deshabilitar en lugar de borrar).

**Fuera de alcance**

- Escritura de agencias desde la app (D5), asociación a opciones y cotización.

**Criterios de aceptación**

- [ ] La ruta devuelve solo agencias habilitadas del courier, ordenadas por departamento, distrito y nombre, con `location` del catálogo.
- [ ] Un courier que la empresa no tiene responde `404`; una agencia con distrito inexistente en el catálogo produce `500 INTERNAL_ERROR` y log, no una lista parcial.
- [ ] La misma agencia es visible para dos empresas que tienen su courier.
- [ ] Verificación mínima de core y mobile.

## Tarea 5. Agencias en las opciones y en la venta

**Flujo:** el vendedor asocia agencias del catálogo a una opción de agencia → se cotiza un distrito → la tarifa de agencia lista sus agencias elegibles → comprador o vendedor elige tarifa y agencia → se resuelve bajo bloqueo → el pedido guarda courier y agencia → web y móvil muestran el detalle.

**Dependencias:** T1, T2, T3, T4.

**Alcance**

- Configuración: `prepareDeliveryZones` valida `agencyIds` (existentes, sin duplicados, de un courier que la empresa tiene; agencias deshabilitadas aceptadas); `writeDeliveryZones` reemplaza asociaciones; `GET /zones` devuelve las agencias referenciadas (§4.3, §5.3).
- Cotización: `applicableDeliveryOptions` con `EligibleAgency` y `QuotedDeliveryRate`; respuesta con `agencies` y `location` (§4.4, §5.4).
- Selección y resolución: `ratedDeliverySelectionSchema` con `agencyId`; `ResolveSelectedRateInput` y `ResolvedDeliveryRate` de agencia; agencia no elegible → `RATE_UNAVAILABLE` (D8, §5.5); `resolveShippingCost` pasa `agencyId`.
- Snapshot: variante de agencia con `courier` y `agency` (con `location`); eliminar `courier: null, agency: null` (D7, §4.5, §5.7). Logs con `optionId`/`agencyId` y `observed.courierId` desde el snapshot (§6).
- UI web: selector de agencias por courier con búsqueda en el editor de zonas; selector de agencia en `rated-delivery-form.tsx` y `checkout-delivery-fields.tsx`; detalle en `order-detail.tsx`; advertencia en opciones de agencia sin agencias elegibles.
- UI móvil: selector de agencias en el editor de zonas; selector de agencia al asignar y crear; verificación de `agency.id` en `order-api.ts`; detalle en `order-detail-screen.tsx`.

**Fuera de alcance**

- Rótulos de despacho y filtros por courier (tarea de despachos).

**Criterios de aceptación**

- [ ] Una opción de agencia sin agencias elegibles no aparece en la cotización; con una agencia elegible, aparece con su courier y ubicación.
- [ ] Elegir una agencia no asociada a la opción, deshabilitada o de un courier deshabilitado devuelve `RATE_UNAVAILABLE` y la UI recotiza.
- [ ] Concurrencia: deshabilitar la asociación mientras se asigna se resuelve bajo el bloqueo de configuración sin snapshots incoherentes.
- [ ] El snapshot guarda courier `{id, name}` y agencia `{id, name, address, location}`; `destination` sigue siendo el distrito del comprador.
- [ ] Verificación mínima de core y mobile; E2E `agency-delivery` rehecho y `checkout`, `mobile-checkout`, `rated-order-*`.

## Tarea 6. Cierre y regresión

**Flujo:** recorrido completo de configuración, cotización y venta por domicilio, agencia y tienda en web y móvil, con documentación y memorias actualizadas.

**Dependencias:** T5. **Tamaño:** pequeña.

**Alcance**

- Ejecutar todos los E2E de §8 y corregir regresiones.
- Actualizar `docs/modalidades-de-entrega-validacion.md` (U06, U13, E09, E10) y las memorias de §1 del diseño para describir el estado nuevo como actual.
- Revisar que el diseño y [preparacion-despachos-rotulos-tecnico.md](preparacion-despachos-rotulos-tecnico.md) coincidan con lo implementado.

**Criterios de aceptación**

- [x] Typecheck, lint, unit, integración y E2E de core, y typecheck, lint y test de mobile pasan en la rama integrada.
- [x] No quedan referencias a `zoneId` en tarifas o snapshots, ni a agencia en texto libre.
- [x] Documentación y memorias actualizadas.
