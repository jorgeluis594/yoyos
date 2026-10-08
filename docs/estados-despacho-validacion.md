# Validación de cancelación antes del despacho

Implementación de [la definición técnica](estados-despacho-definicion-tecnica.md), realizada el 7 de octubre de 2026. La cancelación conserva pagos, publica después del commit y delega la restitución al listener transaccional. Los reintentos de cancelación no vuelven a publicar. No se añadió outbox: una publicación perdida después del commit sigue siendo una limitación explícita del MVP.

## Pruebas y correspondencia

Las rutas de esta tabla son relativas a la raíz del repositorio. Cada fila remite a pruebas ejecutables; las dependencias simuladas se usan solo en pruebas unitarias. PostgreSQL, HTTP, autenticación y pg-boss se prueban con sus implementaciones reales en integración.

| Escenarios | Pruebas |
| --- | --- |
| U01–U05 | `apps/core/src/features/orders/domain/order-state-machine.test.ts`: conservación del agregado, pagos y monedas; cancelación antes/después del despacho; repetición. |
| U06–U07, U20 | `apps/core/src/features/orders/application/cancel-order.test.ts`: ausencia, carga/guardado/commit fallidos, publicación posterior al commit y publicación fallida. La evidencia de log y persistencia real está en I14. |
| U08 | `apps/core/app/routes/order-detail.test.ts`: ID y contexto autenticado, sin ejecutar operaciones de pago. |
| U09–U11 | `apps/mobile/src/features/orders/infrastructure/order-api.test.ts`: petición sin cuerpo, UUID, identidad, respuesta cancelada con ambos indicadores de stock, fechas, errores HTTP y autorización. |
| U12–U14 | `apps/mobile/src/features/orders/application/cancel-order.test.ts`: una escritura y una consulta como máximo por operación de aplicación; cancelado, pendiente, enviado/entregado, incertidumbre, ausencia y sesión. |
| U15–U19 | Core: `apps/core/app/routes/order-detail.test.ts`, `apps/core/src/features/orders/presentation/cancellation-client.test.ts` y E2E de cancelación. Mobile: `apps/mobile/src/features/orders/presentation/order-detail-screen.test.tsx` y `apps/mobile/src/components/ui/show-confirmation.test.ts`. Confirmación, bloqueo, conservación de pagos, recarga fallida, cambio de sesión y traducciones ES/PT. |
| U21 | `apps/core/src/features/products/application/restore-cancelled-order-stock.test.ts`: restitución, indicador, duplicados y clasificación de fallos. |
| U22 | `apps/core/src/composition/event-handlers.test.ts`: registro compartido por productor/worker y parser. Contexto e identidad reales: I13. |
| T01–T02 | Casos `@ts-expect-error` en `cancel-order.test.ts` de core y mobile; mapeos acotados y exhaustivos. Validación mediante los typechecks de ambas aplicaciones. |
| T03 | Casos `@ts-expect-error` en los tests de estado de presentación core y mobile. |
| I01–I02, I11–I12 | `apps/core/src/features/orders/infrastructure/order-repository.integration.test.ts`, matriz `queues first cancellation offline and restores once`: sin importe recibido y stock pendiente/descontado; parcial sin/con descuento; completo con descuento. Worker detenido al cancelar, concurrencia, tercera cancelación, entregas durables duplicadas y stock final. El caso sin importe recibido con stock descontado conserva un pago previamente anulado; no inventa un descuento sin pago. El test `restores deducted stock once…` entrega el mismo evento y distintos IDs concurrentemente, y lo reentrega después del efecto. |
| I03 | Mismo archivo, `rolls back every restored item and flag…`: fallo después de la primera modificación real de stock, rollback total y reintento. |
| I04 | Mismo archivo, `%s winning the row lock…`: bloqueos reales y barreras para ambos ganadores. |
| I05, I08 | `apps/core/src/features/orders/presentation/api-routes.integration.test.ts`, `mobile adapter accepts real cancellation…`: adaptador mobile contra HTTP real, éxito, enviado y entregado, agregado/pagos/stock inalterados ante rechazo. |
| I06–I07 | Mismo archivo, `cancellation HTTP validates identity…` y `cancellation rejects a session…`: ausencia de sesión/empresa/verificación, otra empresa, ID malformado/inexistente y repetición validada con Zod. |
| I09 | `order-repository.integration.test.ts` y E2E core/mobile: listado general y filtros operativos. |
| I10 | `order-repository.integration.test.ts`, pruebas de checkout público, capacidades y cancelación; `api-routes.integration.test.ts`, bloqueo de envío y pagos. E2E retira acciones de edición y checkout después de cancelar. |
| I13 | `order-repository.integration.test.ts`, `a cancellation event for another company…`: pedido ajeno rechazado sin tocar stock. |
| I14 | `api-routes.integration.test.ts`, `HTTP cancellation commits and logs a failed publication…`: HTTP real y PostgreSQL; fallo controlado del publicador, log observado, dos respuestas exitosas y una sola publicación, pagos/stock conservados. |

## Recorridos completos

Core utiliza Chromium con la aplicación y API reales. Mobile utiliza Android físico con Expo Go SDK 57, API real, datos propios y worker pg-boss real. La prueba mobile está en `apps/core/tests/e2e/native-order-cancellation.spec.ts` porque el runner Vitest y la preparación de servidor ya viven en core. Controla el dispositivo mediante ADB; no usa Expo Web ni sustituye la pantalla por mocks.

| Escenarios | Recorrido |
| --- | --- |
| E01–E04 | `order-cancellation.spec.ts` y `native-order-cancellation.spec.ts`: conservar/cerrar, sin pagos, parcial y completo, pagos intactos, stock y persistencia. |
| E05 | Ambos archivos: regresar al listado, excluir cancelados de «Por cobrar» y «Por entregar», reabrir desde el listado general. |
| E06–E08 | Ambos archivos: despacho desde otra sesión, respuesta perdida después de commit demostrado, consulta automática y recuperación manual después de incertidumbre. |
| E09 | Ambos archivos: respuesta retenida, repetición de pulsaciones y controles incompatibles bloqueados. |
| E10–E11 | Ambos archivos: estados terminales y confirmación ES/PT. Core verifica teclado y viewport de 390 px; Android utiliza el diálogo nativo y su botón seguro, cierre por Atrás y aceptación. |
| E12 | Regresión core: `orders.spec.ts` y recorrido core de `order-fulfillment.spec.ts`. Componentes mobile: suites de creación y detalle. Recorrido Android: pedido pagado pendiente, despacho externo, entrega nativa y consulta del estado completado, conservando pagos. |

La simulación nativa de respuesta perdida valida primero el agregado cancelado recibido desde el servidor y después entrega un cuerpo truncado al dispositivo. Así se comprueba la recuperación de la aplicación sin confundirla con la retransmisión que puede realizar la pila HTTP cuando se cierra una conexión antes de recibir cabeceras. El endpoint sigue siendo idempotente ante cualquier retransmisión.

## Ejecución reproducible

Se usa Node 24.21.0 y pnpm 12.5.1. Los puertos separados evitan interferir con otras worktrees: PostgreSQL 55441, SMTP 1041, Mailpit 8041, core 4181, proxy de prueba nativa 4182 y Metro 8084. Las pruebas crean y limpian datos por empresa; no eliminan volúmenes persistentes.

```sh
mise exec node@24.21.0 -- pnpm --dir apps/core lint
mise exec node@24.21.0 -- pnpm --dir apps/core typecheck
mise exec node@24.21.0 -- pnpm --dir apps/core test:unit
mise exec node@24.21.0 -- pnpm --dir apps/mobile lint
mise exec node@24.21.0 -- pnpm --dir apps/mobile typecheck
mise exec node@24.21.0 -- pnpm --dir apps/mobile test

CORE_TEST_PORT=55441 MAILPIT_SMTP_PORT=1041 MAILPIT_UI_PORT=8041 \
  mise exec node@24.21.0 -- pnpm --dir apps/core test:integration \
  src/features/orders/presentation/api-routes.integration.test.ts \
  src/features/orders/infrastructure/order-repository.integration.test.ts

CORE_TEST_PORT=55441 MAILPIT_SMTP_PORT=1041 MAILPIT_UI_PORT=8041 CORE_E2E_PORT=4181 \
  mise exec node@24.21.0 -- pnpm --dir apps/core test:e2e \
  tests/e2e/order-cancellation.spec.ts tests/e2e/order-fulfillment.spec.ts tests/e2e/orders.spec.ts \
  -t 'core |seller ships|pending order|new order saves|seller completes'
```

Para Android, mantener el dispositivo desbloqueado, conectado por ADB y sin otra interacción durante el recorrido. Ejecutar Metro en una terminal y la prueba en otra:

```sh
EXPO_PUBLIC_CORE_URL=http://127.0.0.1:4182 CI=1 \
  mise exec node@24.21.0 -- pnpm --dir apps/mobile exec expo start --go --localhost --port 8084

NATIVE_ANDROID_TEST=1 CORE_TEST_PORT=55441 MAILPIT_SMTP_PORT=1041 MAILPIT_UI_PORT=8041 CORE_E2E_PORT=4181 \
  mise exec node@24.21.0 -- pnpm --dir apps/core test:e2e tests/e2e/native-order-cancellation.spec.ts
```

La prueba mantiene la pantalla encendida mientras recibe alimentación USB, restaura ese ajuste al terminar, instala redirecciones ADB de sus puertos y cambia temporalmente el idioma del dispositivo para revisar portugués; restaura el idioma previo al terminar. Expo Go toma el idioma nativo de `Intl`, que en este dispositivo no responde al cambio de idioma por aplicación. Las capturas de Android se escriben en `apps/core/test-results/native-cancellation-*.png`; las de core, en `/tmp/order-cancellation-confirm-*.png`.

Estado de cierre: implementación validada. Pasaron lint, typecheck y pruebas unitarias de core y mobile, la integración de pedidos/API indicada arriba, los recorridos Chromium de cancelación y regresión, y el recorrido Android completo con la API y el worker reales. Android verificó ambos idiomas en una misma ejecución exitosa. Mobile mantiene tres advertencias de lint preexistentes, sin errores. No se ejecutó iOS; la evidencia nativa corresponde a Android físico.

La revisión visual de las capturas confirmó que el diálogo completo y sus acciones son legibles en ES/PT y que los pagos parcial y completo permanecen visibles tras cancelar. Los ajustes de idioma y pantalla encendida del teléfono se restauraron al finalizar. La única limitación de consistencia aceptada sigue siendo la publicación perdida tras el commit, descrita al inicio: este MVP no incorpora outbox ni recuperación automática de ese caso.
