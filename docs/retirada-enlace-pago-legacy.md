# Retirada del enlace de pago legacy `/pago/:orderId`

Inventario de dependencias para eliminar el flujo de pago por enlace `/pago/:orderId`. Todos los pedidos pasan por el checkout `/checkout/:companyId/:orderId`; `/pago` es legacy y debe desaparecer.

Verificado contra `main` en `5f8bb3ee` más el PR #87.

## Por qué

- `/pago/:orderId` solo necesita el UUID del pedido. Si el checkout está habilitado, redirige (301) a `/checkout/:companyId/:orderId`; si no, muestra una página de pago propia donde el comprador ve los medios de pago y sube su comprobante.
- Desde el PR #87 los logs ya no censuran `orderId`. Mientras exista `/pago`, cualquier persona que lea los logs puede abrir el checkout o la página de pago de cualquier pedido.
- El checkout ya cubre todo lo que hace la página legacy: muestra los medios de pago y permite subir el comprobante con el mismo `BuyerPaymentContent`.

## Estado actual del flujo

| Pieza | Qué hace hoy | Quién la usa |
| --- | --- | --- |
| `apps/core/app/routes.ts:13` | Registra `route("pago/:orderId", "routes/buyer-payment.tsx")` | Navegador |
| `apps/core/app/routes/buyer-payment.tsx` | Loader: `resolveBuyerAccess` → si el checkout existe, 301 al checkout; si no, `getBuyerPaymentView` y renderiza la página con `BuyerPaymentContent`, `ErrorBoundary` y cabeceras de privacidad | Solo `/pago` |
| `apps/core/app/routes/order-detail.tsx:115-118` | `buyerLink()`: sin `checkoutEnabledAt` devuelve `/pago/{id}` con la etiqueta `orders.legacyPaymentLink` ("Abrir enlace de pago") | Detalle del pedido en web |
| `apps/core/src/features/orders/domain/checkout.ts:96` | `canAccessBuyerPayment` permite pagar cuando el checkout está `not_enabled` | `getBuyerPaymentView` y `reportPayment` |
| `apps/core/src/shared/infrastructure/logger.ts:6,59,63,73` | Operación `redirect_buyer_payment` y normalización de la ruta a `/pago/:orderId` | Logs de `/pago` |
| `apps/core/newrelic.cjs:11` | Regla `^/pago/[^/]+/?$` → transacción `pago` | APM |

El pedido nace sin checkout salvo los del catálogo: `newPendingOrder` (`order-state-machine.ts:109`) deja `checkoutEnabledAt: null` y `catalog-order.ts:57` lo fija al crear. El vendedor habilita el checkout con `POST /api/orders/:id/checkout-link` (web: acción del detalle del pedido; mobile: `order-api.ts:165`). Por eso hoy existen pedidos sin checkout que solo tienen el enlace legacy.

## Qué se elimina

### Ruta y página

- `apps/core/app/routes.ts`: quitar `route("pago/:orderId", ...)`. `/pago/...` pasa a ser 404 por la ruta catch-all.
- `apps/core/app/routes/buyer-payment.tsx`: eliminar el archivo.
- `apps/core/app/routes/buyer-payment.test.ts`: eliminar el archivo.
- `apps/core/app/locales.ts`: eliminar las claves `buyerPayment.*` (línea 5 y su equivalente en portugués) si, tras borrar la página, ningún otro componente las usa. Comprobar con `grep -rn "buyerPayment\." app src` antes de borrar.

### Enlace del vendedor

- `apps/core/app/routes/order-detail.tsx`: `buyerLink()` deja de devolver `/pago`. Sin checkout habilitado devuelve `null`. El vendedor comparte el enlace con la acción existente que habilita el checkout (`checkoutData.url`, línea 312).
- `apps/core/app/routes/order-detail.test.ts:99`: reemplazar el caso `legacy` por `null`.
- `apps/core/app/locales.ts:111` y `:252`: eliminar `legacyPaymentLink` y limitar el tipo `BuyerLink` a `orders.buyerPaymentLink`.

### Observabilidad

- `apps/core/src/shared/infrastructure/logger.ts`: quitar `redirect_buyer_payment` de `OperationContext`, la variable `buyerPayment`, su rama en `operation` y su rama en `route`.
- `apps/core/src/shared/infrastructure/logger.test.ts`: eliminar el test "normalizes legacy buyer payment URLs with an explicit outcome" (líneas ~119-140) y el caso `/pago` de la línea ~214.
- `apps/core/newrelic.cjs:11`: quitar la regla `pago`. Revisar `apm-privacy.test.ts` por si cubre esa transacción.

### Pruebas e2e

- `apps/core/tests/e2e/buyer-payment.spec.ts`: hoy recorre el flujo legacy (`/pago` sin checkout, 301 con checkout y reporte de comprobante). Reescribirla sobre el checkout o eliminarla si `checkout-appearance-buyer.spec.ts` ya cubre el pago y el comprobante en el checkout.
- `apps/core/tests/e2e/checkout-appearance.spec.ts:325`: entra por `/pago/{id}` para llegar al checkout; cambiar a `/checkout/{companyId}/{id}`.

### Regla de acceso al pago

- `apps/core/src/features/orders/domain/checkout.ts`: `canAccessBuyerPayment` debe rechazar `not_enabled` con `CHECKOUT_UNAVAILABLE`. Sin este cambio, la API `/api/buyer/orders/:orderId/...` sigue permitiendo ver medios de pago y reportar comprobantes de pedidos sin checkout usando solo el UUID, aunque ya no haya página.
- Ajustar las pruebas que cubren ese caso: `api-routes.integration.test.ts` (alrededor de las líneas 160-200 y 780) y las unitarias de `checkout.ts`.

## Qué se conserva

El checkout depende de estas piezas; no se tocan:

- `apps/core/src/features/orders/presentation/buyer-payment-content.tsx` (`BuyerPaymentContent`), usado por `app/components/checkout-sections.tsx`.
- `apps/core/src/features/orders/presentation/buyer-payment-routes.ts`, montado en `src/app.ts:59` como `/api/buyer/orders`. El checkout usa `POST /:orderId/images` y `POST /:orderId/reports`. `GET /:orderId/payment` solo lo usan pruebas (`api-routes.integration.test.ts`, `continue-to-checkout.integration.test.ts`); se puede retirar en la misma tarea o en otra.
- `orders.resolveBuyerAccess` y `orders.getBuyerPaymentView` (`composition.ts:156-172`): los usan el checkout (`checkout.tsx:76`), la API de comprador y `quotation-routes.ts:32`.
- `buyerPaymentViewSchema` en `shared/contracts/orders.ts:143`.

## Precondición de datos

Antes de desplegar, confirmar en producción cuántos pedidos activos (no cancelados ni completados) tienen `checkoutEnabledAt` nulo:

```sql
SELECT count(*) FROM "Order" WHERE "checkoutEnabledAt" IS NULL AND cancelled = false AND "completedAt" IS NULL;
```

Esos compradores pierden su enlace al desplegar. Opciones: habilitar el checkout de esos pedidos con una migración de datos (`checkoutEnabledAt = now()`), o aceptar que el vendedor genere el enlace del checkout desde el detalle. Una migración de datos sigue `.agents/skills/database-migrations/SKILL.md`.

## Documentación y memoria a actualizar

- `docs/apariencia-del-checkout-tareas.md`: T1 describe la redirección que se retira.
- happy-memory: "Buyer payment links preserve order identity and enforce checkout confirmation" (`1f5bf3c1`) y "Checkout observability keeps raw URLs out but Pino logs may carry orderId" (`ebd06653`) mencionan `/pago`; marcar como obsoleta o actualizar al cerrar la tarea.

## Criterios de aceptación

- `GET /pago/{uuid}` responde 404 para cualquier pedido.
- El detalle del pedido no muestra ningún enlace `/pago`; sin checkout habilitado no muestra enlace de comprador.
- La API de comprador rechaza ver medios de pago y reportar comprobantes de pedidos sin checkout habilitado.
- En el checkout, el comprador sigue viendo los medios de pago y subiendo su comprobante como antes.
- `grep -rn "/pago\|redirect_buyer_payment\|legacyPaymentLink" apps/core/app apps/core/src apps/core/tests apps/core/newrelic.cjs` no devuelve resultados.
- Pasan typecheck, lint, unit, integración y e2e de core.

## Fuera de alcance

- Cambiar `BuyerPaymentContent` o el flujo de pago dentro del checkout.
- Habilitar el checkout automáticamente al crear pedidos.
- Mobile: no genera enlaces `/pago`; solo usa `checkout-link`.
