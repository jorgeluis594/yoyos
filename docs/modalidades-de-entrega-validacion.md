# Modalidades de entrega: evidencia de implementación

Revisión del 6 de octubre de 2026. Los tres incrementos están implementados en servidor, web y móvil. La aceptación completa sigue pendiente de ejecutar los recorridos nativos y revisar sus capturas. Las pruebas de pantalla y del adaptador móvil no se cuentan como E2E nativos.

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
| E01 | Web Config: guardar/reabrir tienda y retener punto deshabilitado sin tarifas. | Android: navegación real, habilitar/guardar/reabrir y deshabilitar/guardar/reabrir comprobados. Base real confirmó versiones 1/2 y punto retenido. El pedido mostró modalidad deshabilitada sin formulario de asignación. También se repitió deshabilitar/guardar/reabrir y reactivar/guardar/reabrir con composición normal sin tarifas, conservando el punto. iOS pendiente. |
| E02 | Web Tienda y Web Ventas: pedido pendiente, destinatario diferente, guardar/reabrir con costo controlado. | Android: pedido preparado por API autenticada; navegación Ventas → pedido mostró “Entrega por definir”. Asignación desde controles nativos y reapertura confirmaron tienda/destinatario/costo 3/cargo 3/total 13. iOS pendiente. |
| E03 | Web Tienda: punto histórico, edición explícita y segundo vendedor. | Pendiente. |
| E04 | Web Agencia: enviado/entregado/cancelado; Web Ventas: venta inmediata nula sin pendiente ni editor. | Android: despachado y entregado consultados en pantalla real, snapshot histórico retenido y sin editor. Tras reconectar, cancelado y venta inmediata se abrieron desde Ventas: sin editor ni “Entrega por definir”; venta inmediata completada/entregada y total 10. iOS pendiente. |
| E05 | Navegación autenticada real web y Android contra `NativeDeliveryReview`; web guardó versión 11. | Android rechazó el borrador obsoleto y conservó el courier nuevo `RejectedCourier`. SQL confirmó solo los dos couriers anteriores; recarga explícita mostró `WebConfirmedStore`. iOS pendiente. |
| E06 | Web Tienda/Agencia: traslado/absorción, pagos previos y descuento único. | Android: pago previo preparado por API; absorber el costo desde controles nativos bajó total de 13 a 10, saldo a 0 y descontó una unidad. Otro guardado mantuvo stock 2 e importes/pago. Falta reapertura posterior a la absorción; iOS pendiente. |
| E07 | Web Tienda/Agencia: indisponibilidad controlada conserva borrador y entrega anterior, corrección explícita posterior. | Android: rechazo controlado con `Unavailable` conservó formulario y agregado anterior completo, comprobado por API. Corregir a `CorrectedRecipient` y guardar explícitamente confirmó la entrega. Falta reabrir entre rechazo y corrección, y ejecutar iOS. |
| E08 | Web Tienda: domicilio, distrito requerido, reapertura y eliminación de campos de tienda. | Android: habilitar desde Configuración, cambiar tienda a domicilio, rechazo de distrito vacío, guardar y reabrir desde Ventas comprobados. API confirmó domicilio sin `pickupPoint`. iOS pendiente. |
| E09 | Web Agencia: courier/configuración conjunta, documento obligatorio y ceros iniciales. | Android: alta real de courier, habilitación de agencia, documento obligatorio, guardado y reapertura con `00-A-001` comprobados. Se repitió el guardado conjunto: versión 7 deshabilitada/un courier → versión 8 habilitada/dos couriers, alta de `NativeAlternate` en la misma operación. iOS pendiente. |
| E10 | Web Agencia: nombre histórico, omisión de inactivos y desactivación concurrente recuperable. | Android: renombrar/desactivar por API conservó `NativeCourier` en detalle; selector mostró solo el activo. Desactivar ese activo mientras el formulario estaba abierto produjo error recuperable, campos retenidos y agregado anterior completo sin cambios. iOS pendiente. |
| E11 | Inicio de sesión → Modalidades/Ventas → pedido reales en web mostraron el destino e importes guardados en Android. | Configuración guardada en web se consultó mediante recarga nativa; entrega guardada en Android se consultó desde Ventas web. Mismo negocio y pedido autenticados; iOS pendiente. |
| E12 | Web Normal: servidor normal, configuración operativa y asignación sin costo inventado. | Android: proceso `src/server.ts` sin resolvedor inyectado; configuración guardada desde la app. Asignación rechazada, borrador retenido, agregado con entrega nula/total 10/stock sin descontar. iOS pendiente. |

## Observabilidad y evidencia visual

Los resúmenes `delivery_settings_saved` y `order_delivery_saved` se aplazan hasta el commit exterior. Config DB, Pedido DB y las pruebas de aislamiento transaccional comprueban que no aparecen tras rollback. Los triggers diferidos comprueban errores reales en commit, un único evento técnico, `transactionOutcome: unknown`, ausencia de éxito y reintento posterior. Una excepción de observación posterior al commit no prueba que la base haya revertido.

Los eventos usan IDs/versiones/etapas/flags acotados. Las pruebas comprueban que no se copian destinatario, documento, dirección, agencia, nombres de courier ni importes. El [serializador compartido](../apps/core/src/shared/infrastructure/logger.test.ts) sanea causas técnicas sin mensajes privados/SQL. Las actions se identifican como `web_action`; API como `api`. Se conserva la correlación HTTP existente, sin logger en Expo, historial de snapshots ni plataforma nueva de telemetría.

Las capturas web revisadas están en [.impeccable/review](../.impeccable/review/): configuración, tienda, domicilio, agencia y estado sin asignación, a 1280/390 en apariencia clara. Los reviewers emitieron `ship` dentro de ese alcance. No acredita apariencia oscura ni estados no capturados. Los briefs de superficies conservan los alcances y resultados exactos. El reviewer nativo emitió `recapture`: faltan capturas por OS, apariencia clara/oscura, texto ampliado, teclado, recuperación y tablet si corresponde.

## Validaciones y pendiente de entorno

Se ejecutaron los comandos configurados de core (`lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`) y móvil (`lint`, `typecheck`, `test --runInBand`). Cada commit de implementación se creó después de sus checks afectados. La suite web completa pasó con 21 tests; las ampliaciones posteriores de estados cerrados pasaron en la suite focalizada. La suite móvil completa pasó tras incorporar agencia y sus pruebas de pantalla. Lint móvil conserva tres warnings previos y cero errores.

El entorno observado es macOS ARM64. El 6/10/2026 se conectó un Samsung SM-A566E autorizado por ADB, Android API 36, con Expo Go 57.0.9. Metro ejecuta la app SDK 57; el dispositivo accede al backend aislado en puerto 4173 mediante `adb reverse`. El backend usa la composición E2E de costo controlado y `NODE_ENV=development`, que habilita el origen de Expo Go según la configuración existente. No se cambió código para permitir el acceso.

Se inició sesión desde los controles reales con una cuenta de prueba verificada y se creó `NativeDeliveryReview` desde el formulario nativo. Desde la pestaña Configuración se guardó `NativeStore` / `Av. Prueba 123`, se volvió desde Inicio y se verificaron los campos persistidos. Tras deshabilitar y guardar, una consulta a la base aislada confirmó versión 2, `storeEnabled=false` y ambos datos retenidos; al volver a Configuración, el interruptor permaneció desactivado. Las capturas [tienda activa](../.impeccable/review/android-store-settings-dark.png) y [tienda desactivada](../.impeccable/review/android-store-disabled-dark.png) provienen de `adb screencap` y se inspeccionaron. Solo acreditan esos estados Android en apariencia oscura; no constituyen aprobación visual completa.

La instalación del emulador/imagen Android sigue sin completar por las licencias de Google; el celular permite continuar sin esa instalación. La verificación iOS necesita Xcode/simulador o dispositivo compatible: `xcrun simctl` no está disponible con las Command Line Tools actuales. Continúan pendientes los recorridos de pedidos Android, E05/E11 contra el mismo negocio, E12 con composición normal, las variantes visuales y los recorridos iOS. Las pruebas de pantalla y del adaptador no sustituyen esas ejecuciones.

El servidor E2E conecta ahora el mismo resolvedor controlado a las composiciones web y API (`c2e72d8`); el escenario de composición normal permanece separado. Pasaron los E2E focalizados de tienda y sin tarifas, lint y typecheck. La app guardó y reabrió el pedido `485cdced-61aa-419b-9f47-bb2fa80976d7`: la API confirmó snapshot vendedor, punto `NativeStore`, destinatario, costo/cargo 3, total 13 y stock pendiente. La [captura de detalle Android](../.impeccable/review/android-store-order-dark.png) acredita ese estado. El [rechazo controlado](../.impeccable/review/android-delivery-unavailable-dark.png) conserva los campos y presenta el error; la consulta posterior fue idéntica al agregado anterior. Ambas capturas fueron inspeccionadas, sin atribuirles cobertura clara/iOS/teclado ni aprobación del reviewer.

La ejecución descubrió una caída del servidor por un temporizador de aborto programado antes de inicializar el renderizado. `b8e84da` mueve su programación después de obtener `abort` y cancela al fallar el shell. Pasaron los tests unitarios completos, lint, typecheck y build; una ruta desconocida devolvió 404 y la API permaneció operativa después del plazo de aborto.

En Android se habilitó domicilio desde Configuración y se cambió la entrega de tienda a domicilio desde Editar entrega. Guardar con dirección pero sin distrito mostró “Completa la dirección y el distrito de entrega.” Después de completar `Miraflores`, guardar y reabrir desde Ventas conservó `Calle Destino 789`, distrito y destinatario. El agregado real contenía únicamente la variante `home`, sin `pickupPoint`. La [captura de domicilio reabierto](../.impeccable/review/android-home-order-dark.png) fue inspeccionada; acredita ese estado oscuro Android, sin aprobación visual completa.

Se preparó un pago de 10 mediante API autenticada. Desactivar “Cobrar el costo de entrega al cliente” y guardar en la app confirmó total 10, pago 10, saldo 0, cargo 0 y stock descontado. La consulta SQL del producto confirmó stock 2 (inicial 3); volver al editor y guardar otra vez lo mantuvo en 2. La API confirmó importes y pago retenidos. Estas precondiciones API se distinguen de las acciones reales de edición nativa.

En Android se dio de alta `NativeCourier` desde Configuración: la base confirmó versión 5 y UUID del servidor `65c7d4ca-a662-4c6e-9f4f-34c6563b8c19`. Se habilitó agencia en un guardado posterior. En el editor del pedido se seleccionó agencia/courier y se escribió `Agencia Central`. Guardar sin documento mostró el error de validación; seleccionar documento de identidad y escribir `00-A-001` permitió guardar. Volver a Ventas y reabrir conservó documento, agencia y nombre del courier. La API confirmó snapshot `agency`, autor vendedor y total 10. La [captura de agencia reabierta](../.impeccable/review/android-agency-order-dark.png) fue inspeccionada y solo acredita ese estado Android oscuro. Falta repetir alta de courier + habilitación en el mismo guardado para cerrar E09; no se atribuye esa prueba a los dos guardados realizados.

Se completó en Android el guardado conjunto de E09: deshabilitar agencia confirmó versión 7 con un courier; habilitarla y añadir `NativeAlternate` en un único guardado confirmó versión 8 con ambos couriers activos. Los eventos reales `delivery_settings_saved` confirmaron esas versiones, flags y cantidades.

Para E10 se renombró `NativeCourier` a `RenamedCourier` y se desactivó mediante API autenticada, conservando el alternativo activo. El detalle nativo mantuvo el nombre histórico `NativeCourier`; el selector solo ofreció `NativeAlternate`. Con ese courier seleccionado y el formulario abierto, una segunda operación API lo desactivó y reactivó el otro courier. Guardar desde la app rechazó la selección obsoleta, actualizó las opciones, mantuvo documento/destinatario/agencia y mostró “El courier ya no está disponible. Selecciona otro courier activo.” La consulta real posterior fue idéntica al agregado anterior completo. La [captura del rechazo de courier](../.impeccable/review/android-courier-unavailable-dark.png) se inspeccionó; solo acredita el estado oscuro Android mostrado.

E05/E11 se ejecutaron con navegación real en Chromium y el Samsung contra `NativeDeliveryReview`. Web inició sesión desde `/login` y abrió Modalidades de entrega mediante navegación principal. Ambos clientes cargaron versión 10; el celular mantuvo un borrador y alta `RejectedCourier`, mientras web guardó `WebConfirmedStore` como versión 11. Guardar desde el celular presentó conflicto y conservó el alta sin guardar. SQL confirmó versión 11, el punto de web y únicamente los dos couriers existentes. Recargar explícitamente desde el celular mostró `WebConfirmedStore`. La [captura del conflicto entre clientes](../.impeccable/review/android-web-conflict-dark.png) fue inspeccionada.

Desde Ventas web se abrió el pedido guardado en Android: se verificaron el courier histórico `NativeCourier`, `Agencia Central`, documento `00-A-001`, costo 3, cargo 0, total 10 y pago 10. La navegación pasó por las entradas reales autenticadas, sin sustituir el celular por un viewport de navegador. Esto acredita E05/E11 con Android; iOS sigue pendiente.

Para E04 se despachó el pedido mediante API autenticada como precondición. Al volver desde el editor nativo, el detalle mostró “Pago cubierto · Despachado”, conservó la agencia histórica y no ofreció Editar entrega en la sección de entrega. Tras marcarlo entregado por API y volver desde Configuración, la pantalla mostró “Pago cubierto · Entregado” y tampoco ofreció el editor.

Se prepararon por API un pedido cancelado de total 20 y una venta inmediata entregada de total 10 con entrega nula. La lista nativa mostró ambos registros, pero ADB perdió el dispositivo antes de abrirlos. La extracción posterior falló y su XML anterior correspondía a la lista; no se usa como evidencia de los detalles cancelado/inmediato. Esos casos permanecen pendientes.

Tras reconectar el Samsung, se abrieron desde la lista Ventas el pedido cancelado (total 20) y la venta inmediata (total 10). Los árboles nativos mostraron respectivamente “Orden cancelada” y “Venta completada” / “Pago cubierto · Entregado”, sin Asignar entrega, Editar entrega ni Entrega por definir en sus detalles. La venta inmediata conservó artículos, pago y stock descontado. La extracción se ejecutó con el dispositivo conectado; no se reutilizó el XML de la interrupción anterior. Expo Go mostraba un aviso de conexión a su CLI, por lo que esta evidencia es funcional y no se añadió una captura como aprobación visual.

Sobre el código final hasta `3348de9` pasaron las suites unitarias completas de core y móvil, lint y typecheck de ambas aplicaciones. Móvil conserva los tres warnings anteriores y cero errores. Los cambios posteriores son documentación de ejecución real.

E12 Android se ejecutó tras detener el servidor E2E y arrancar un proceso nuevo con `tsx src/server.ts`, sin parámetro de resolvedor ni mutación del objeto de composición. Desde Configuración nativa se guardó correctamente. Se preparó un pedido pendiente mediante API autenticada y se abrió desde Ventas; Asignar entrega permitió escribir `NormalRecipient` y teléfono. Guardar presentó indisponibilidad y conservó los campos. La API confirmó `delivery=null`, total 10 y `stockDeducted=false`: los importes de entrega permanecieron en su valor inicial y no acreditan una asignación de costo cero. La [captura del rechazo en composición normal](../.impeccable/review/android-normal-delivery-unavailable-dark.png) fue inspeccionada, con alcance Android oscuro.

E01 se repitió sin tarifas contra `src/server.ts`: desactivar tienda y guardar desde la app confirmó versión 13, `storeEnabled=false`, `WebConfirmedStore` y `Av. Prueba 123` retenidos. Volver desde Inicio a Configuración mostró los mismos datos y el interruptor desactivado. Reactivar, guardar y volver desde Inicio mostró el interruptor activado y el punto conservado. No se cambió el resolvedor de costo para este recorrido.
