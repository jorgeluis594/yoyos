# Modalidades de entrega: evidencia de implementación

Revisión del 5 de octubre de 2026. Los tres incrementos están implementados en servidor, web y móvil. La aceptación completa sigue pendiente de ejecutar los recorridos nativos y revisar sus capturas. Las pruebas de pantalla y del adaptador móvil no se cuentan como E2E nativos.

La configuración funciona sin tarifas. La composición normal rechaza la asignación con `DELIVERY_UNAVAILABLE`; los recorridos de asignación que confirman una entrega sustituyen exclusivamente la capacidad de costo. No se habilita esa sustitución mediante una petición pública.

## Fuentes de evidencia

Las abreviaturas de las tablas apuntan a pruebas ejecutables, no a estimaciones de cobertura.

| Clave | Archivo |
| --- | --- |
| Config | [Casos de configuración](../apps/core/src/features/delivery-settings/application/delivery-settings.test.ts) |
| Couriers | [Reglas de couriers](../apps/core/src/features/delivery-settings/domain/couriers.test.ts) |
| Resolver | [Resolución de selección](../apps/core/src/features/orders/application/resolve-delivery-selection.test.ts) |
| Asignar | [Asignación y reemplazo](../apps/core/src/features/orders/application/set-delivery.test.ts) |
| Estado | [Máquina de estados](../apps/core/src/features/orders/domain/order-state-machine.test.ts) |
| JSON | [Contratos JSON](../apps/core/src/features/orders/presentation/order-contracts.test.ts) |
| Config DB | [Configuración, couriers y bloqueos reales](../apps/core/src/features/delivery-settings/infrastructure/delivery-settings-repository.integration.test.ts) |
| Pedido DB | [Pedidos, stock, carreras y commit real](../apps/core/src/features/orders/infrastructure/order-repository.integration.test.ts) |
| Config HTTP | [Autenticación, versión y respuesta perdida](../apps/core/src/features/delivery-settings/presentation/api-routes.integration.test.ts) |
| Pedido HTTP | [Asignación y adaptadores móviles contra API real](../apps/core/src/features/orders/presentation/api-routes.integration.test.ts) |
| Migración | [Ventas anteriores y migraciones posteriores](../apps/core/src/features/orders/infrastructure/order-migration.test.mjs) |
| Web Config | [Configuración desde navegador](../apps/core/tests/e2e/delivery-settings.spec.ts) |
| Web Tienda | [Tienda y domicilio desde navegador](../apps/core/tests/e2e/store-delivery.spec.ts) |
| Web Agencia | [Agencia y estados cerrados desde navegador](../apps/core/tests/e2e/agency-delivery.spec.ts) |
| Web Normal | [Servidor normal sin tarifas](../apps/core/tests/e2e/delivery-without-tariffs.spec.ts) |
| Web Ventas | [Venta inmediata y pedido pendiente](../apps/core/tests/e2e/orders.spec.ts) |
| Móvil Config | [Pantalla de configuración](../apps/mobile/src/features/delivery-settings/presentation/delivery-settings-screen.test.tsx) |
| Móvil Asignar | [Pantalla de asignación](../apps/mobile/src/features/orders/presentation/order-delivery-screen.test.tsx) |
| Móvil Detalle | [Pantalla de detalle](../apps/mobile/src/features/orders/presentation/order-detail-screen.test.tsx) |
| Móvil API | [Adaptador de pedidos](../apps/mobile/src/features/orders/infrastructure/order-api.test.ts), [adaptador de configuración](../apps/mobile/src/features/delivery-settings/infrastructure/delivery-settings-api.test.ts) |

## Matriz unitaria y de presentación

| ID | Evidencia y resultado |
| --- | --- |
| U01 | Config: versión virtual 0 sin escritura; falla de lectura conservada. |
| U02 | Config: punto completo o nulo según estado; se rechazan parciales. |
| U03 | Config, Couriers, JSON y Resolver: normalización, vacíos y límites/excesos. Nombre/teléfono/documento del destinatario no reciben máximos arbitrarios. |
| U04 | Config y Config DB: indicadores independientes y datos retenidos al deshabilitar. |
| U05 | Config: versión nueva y conflicto sin sobrescritura. |
| U06 | Couriers y Config: último courier y agencia se deshabilitan juntos. |
| U07 | Couriers y Config: IDs del servidor; rechazo de repetidos, desconocidos, ajenos y omitidos, incluidos inactivos. |
| U08 | Estado, Resolver y JSON: destinatario requerido, documento obligatorio en agencia, tipos admitidos y ceros iniciales. |
| U09 | Resolver y JSON: variantes estrictas sin campos residuales ni autoridad del cliente. |
| U10 | Resolver y Config DB: modalidad deshabilitada y configuración corrupta fallan explícitamente. |
| U11 | Resolver: copia independiente del punto y destinatario. |
| U12 | Resolver: domicilio escrito, distrito requerido e indicaciones opcionales. |
| U13 | Resolver: courier activo autorizado, copia histórica y rechazo antes de calcular costo. |
| U14 | Estado y Pedido DB: creación pendiente con entrega nula e importes existentes. |
| U15 | Asignar, Estado y Pedido HTTP: reemplazo único y cambio de variante completo. |
| U16 | Asignar y Estado: inexistente, cancelado, enviado y entregado sin escritura válida. |
| U17 | Asignar, Resolver y Pedido HTTP: autor del contexto; edición por otro vendedor reemplaza autoría. |
| U18 | Resolver y Estado: costo positivo/cero confirmado; negativo, NaN, precisión inválida y moneda diferente rechazados. |
| U19 | Asignar, Pedido DB y pruebas de commit diferido: sin éxito ni actualización parcial ante fallo. |
| U20 | Asignar y Pedido DB: igualdad/exceso, pagos insuficientes, descuento faltante y descuento previo. |
| U21 | Estado y Pedido HTTP: agregado completo con costo/cargo, total, pagos, saldo y stock coherentes. |
| U22 | JSON y Móvil API: selección, snapshot, autor vendedor requerido y comprador representable. |
| U23 | JSON y actions/API: rechazo de negocio, autoría, importes y destinos autoritativos suministrados. |
| U24 | Móvil API y pruebas del cliente HTTP compartido: respuestas inválidas, errores conocidos y fallas de transporte; sin reintento automático. |
| U25 | Móvil Config y Web Config: carga/error/borrador, guardado conjunto y adopción de versión/IDs canónicos. |
| U26 | Móvil Config y Web Config: conflicto conserva borrador; envío pendiente impide duplicados. |
| U27 | Móvil Asignar, Web Tienda y Web Agencia: opciones habilitadas, campos por modalidad y retención ante rechazo. |
| U28 | Móvil Asignar/Detalle y Web Tienda: resultado confirmado y recarga; error no presenta borrador como snapshot. |
| U29 | Móvil Detalle, Web Agencia, Web Ventas y Web Normal: histórico, entrega por definir solo cuando corresponde y estados bloqueados. |
| U30 | Couriers, Móvil Config y Web Config: quitar solo altas sin guardar; conservar existentes inactivos e IDs confirmados. |
| U31 | Web Normal y Pedido HTTP: composición normal sin tarifa ficticia; configuración utilizable. |

Los [contratos estáticos](../apps/core/src/features/orders/domain/type-contracts.ts) verifican IDs nominales, autoría, unión de snapshots y punto requerido de tienda habilitada mediante `typecheck`.

## Matriz de integración

| ID | Evidencia y resultado |
| --- | --- |
| I01 | Config DB: ausencia sin inserción, primera versión 1 e incrementos confirmados. |
| I02 | Config DB, Config HTTP y Pedido HTTP: flags, punto y conjunto completo de couriers persistidos. |
| I03 | Config DB: unicidad, referencias, versión positiva y punto coherente protegidos por SQL. |
| I04 | Config DB y Pedido DB: aislamiento de negocios. Couriers comprueba además rol no propietario, sin superusuario ni bypass RLS, FORCE RLS y rechazo de lecturas/escrituras/movimientos ajenos. |
| I05 | Config DB: barrera en dos primeras lecturas; exactamente un ganador y un courier persistido. |
| I06 | Config DB: edición concurrente con un ganador; lector bloqueado durante escritura recibe una sola versión completa, incluidos couriers. |
| I07 | Config HTTP: pérdida simulada del resultado después del commit real; reenvío obsoleto devuelve conflicto y recarga recupera los mismos IDs. |
| I08 | Config DB: fallo tras editar un courier e insertar otro revierte flags/versión/edición/alta. Desactivación conjunta validada por configuración y HTTP. |
| I09 | Pedido HTTP: tres modalidades, respuesta inmediata igual a consulta posterior y reemplazo completo. |
| I10 | Pedido HTTP y Web Agencia/Tienda: cambios de configuración no alteran snapshots pendientes. |
| I11 | Pedido DB: tienda y courier, asignación primero y desactivación primero; barreras y espera real de bloqueos, sin pausas usadas para decidir el ganador. |
| I12 | Pedido DB: edición contra despacho/cancelación en ambos órdenes y dos ediciones con snapshot/autor/importes indivisibles. |
| I13 | Pedido DB: reducción cubierta descuenta una vez; falla de un producto posterior revierte descuentos anteriores. |
| I14 | Pedido DB: falla de escritura de entrega y commit diferido; rollback real y reintento válido. |
| I15 | Pedido DB: asignación concurrente con descuento existente; stock consumido como máximo una vez. |
| I16 | Config HTTP, Pedido HTTP y autenticación compartida: sesión/contexto autorizado y rechazo de manipulación. |
| I17 | Rutas y actions unitarias más Config/Pedido HTTP: validación, conflicto, disponibilidad, estado, inexistencia y errores recuperables. |
| I18 | Config/Pedido HTTP usan adaptadores móviles reales contra API autenticada, con conflictos/rechazos y consulta del agregado. Esto no es E2E nativo. |
| I19 | Migración: negocios/ventas anteriores, importes/stock/entregas nulas preservados y primer punto sin backfill. Config/Pedido DB rechazan datos persistidos corruptos. |
| I20 | Condicionado: inspección de `core_test` local en puerto 55433 el 5/10/2026 devolvió 0 órdenes con `delivery IS NOT NULL`. No se encontraron formatos históricos para anonimizar en esa base. No acredita otros entornos ni compatibilidad con formatos no inspeccionados. |
| I21 | Pedido HTTP y Web Normal ejecutan composición normal; los demás recorridos sustituyen únicamente la capacidad de costo por composición de pruebas. |

## Matriz E2E

| ID | Web | Móvil nativo |
| --- | --- | --- |
| E01 | Web Config: guardar/reabrir tienda y retener punto deshabilitado sin tarifas. | Pendiente. |
| E02 | Web Tienda y Web Ventas: pedido pendiente, destinatario diferente, guardar/reabrir con costo controlado. | Pendiente. |
| E03 | Web Tienda: punto histórico, edición explícita y segundo vendedor. | Pendiente. |
| E04 | Web Agencia: enviado/entregado/cancelado; Web Ventas: venta inmediata nula sin pendiente ni editor. | Pendiente. |
| E05 | Conflicto web y compatibilidad del adaptador probados; recorrido simultáneo entre interfaces web y nativa pendiente. | Pendiente contra el mismo negocio. |
| E06 | Web Tienda/Agencia: traslado/absorción, pagos previos y descuento único. | Pendiente. |
| E07 | Web Tienda/Agencia: indisponibilidad controlada conserva borrador y entrega anterior, corrección explícita posterior. | Pendiente. |
| E08 | Web Tienda: domicilio, distrito requerido, reapertura y eliminación de campos de tienda. | Pendiente. |
| E09 | Web Agencia: courier/configuración conjunta, documento obligatorio y ceros iniciales. | Pendiente. |
| E10 | Web Agencia: nombre histórico, omisión de inactivos y desactivación concurrente recuperable. | Pendiente. |
| E11 | API/adaptadores intercambian datos reales; navegación autenticada entre ambas interfaces pendiente. | Pendiente contra el mismo negocio. |
| E12 | Web Normal: servidor normal, configuración operativa y asignación sin costo inventado. | Pendiente con composición normal. |

## Observabilidad y evidencia visual

Los resúmenes `delivery_settings_saved` y `order_delivery_saved` se aplazan hasta el commit exterior. Config DB, Pedido DB y las pruebas de aislamiento transaccional comprueban que no aparecen tras rollback. Los triggers diferidos comprueban errores reales en commit, un único evento técnico, `transactionOutcome: unknown`, ausencia de éxito y reintento posterior. Una excepción de observación posterior al commit no prueba que la base haya revertido.

Los eventos usan IDs/versiones/etapas/flags acotados. Las pruebas comprueban que no se copian destinatario, documento, dirección, agencia, nombres de courier ni importes. El [serializador compartido](../apps/core/src/shared/infrastructure/logger.test.ts) sanea causas técnicas sin mensajes privados/SQL. Las actions se identifican como `web_action`; API como `api`. Se conserva la correlación HTTP existente, sin logger en Expo, historial de snapshots ni plataforma nueva de telemetría.

Las capturas web revisadas están en [.impeccable/review](../.impeccable/review/): configuración, tienda, domicilio, agencia y estado sin asignación, a 1280/390 en apariencia clara. Los reviewers emitieron `ship` dentro de ese alcance. No acredita apariencia oscura ni estados no capturados. Los briefs de superficies conservan los alcances y resultados exactos. El reviewer nativo emitió `recapture`: faltan capturas por OS, apariencia clara/oscura, texto ampliado, teclado, recuperación y tablet si corresponde.

## Validaciones y pendiente de entorno

Se ejecutaron los comandos configurados de core (`lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`) y móvil (`lint`, `typecheck`, `test --runInBand`). Cada commit de implementación se creó después de sus checks afectados. La suite web completa pasó con 21 tests; las ampliaciones posteriores de estados cerrados pasaron en la suite focalizada. La suite móvil completa pasó tras incorporar agencia y sus pruebas de pantalla. Lint móvil conserva tres warnings previos y cero errores.

El entorno observado es macOS ARM64. Se instalaron Java 21 mediante mise y las herramientas de línea de comandos Android en `~/Library/Android/sdk/cmdline-tools/latest`, sin modificar la configuración del repositorio. La instalación del emulador/imagen Android está detenida en la solicitud de aceptación de las licencias de Google, cuya autorización se pidió al usuario. No hay dispositivo conectado ni AVD preparado; `xcrun simctl` no está disponible con las Command Line Tools actuales. No se ejecutó ningún E2E nativo.

Para continuar, hace falta la autorización de licencia y completar el emulador Android; la verificación iOS necesita Xcode/simulador o dispositivo compatible. Los recorridos E05/E11 requieren ambos clientes autenticados contra el mismo negocio. Preparar esos entornos, ejecutar E01–E12 por plataforma y recapturar las superficies sigue siendo trabajo pendiente, no una aprobación implícita ni una sustitución por viewport móvil de Chromium.
