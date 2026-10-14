# Sesiones de brainstorming que definieron documentos de producto

Este documento recopila las sesiones de brainstorming de Yoyos (Codex, vía Orca) en las que se definió un documento de producto o de alcance. Cada entrada incluye el ID de la sesión para reanudarla con `codex resume <ID>` desde el directorio de su workspace.

## Sesiones con documento de producto

### 1. Productos en mobile y su API

- **ID de sesión:** `01a0db8f-fd3b-7dc2-af07-278a148bfda5`
- **Workspace:** `orca/workspaces/yoyos/product-mobile`
- **Documentos generados:** `docs/products-mobile-implementation.md` (flujo de producto) y `docs/products-mobile-architecture.md` (arquitectura y contratos).
- **Decisiones acordadas:**
  - Al abrir un producto, una pantalla de gestión editable, como en core.
  - «Productos» como pestaña principal.
  - Fotos desde galería o cámara, subidas por la API de imágenes de core.
  - Catálogo con «Cargar más» y páginas de 20.
  - Al volver de la gestión, el catálogo conserva búsqueda, lista y posición.
  - Confirmación antes de descartar cambios en crear y editar.
  - Trabajo solo en línea; core confirma cada creación y edición.
  - Core tiene su modelo de producto y mobile tiene otro. Los DTO de `shared/contracts/products.ts` solo describen el JSON de la API.
  - El modelo de mobile incluye solo los campos que usan sus pantallas.
- **Pruebas:** se describieron 13 unitarias y 10 de integración, sin crear archivos de test.
- **Estado al cierre:** definición para implementar; no hubo cambios de código.

### 2. Impresión de etiquetas QR en mobile

- **ID de sesión:** `01a0e8a4-8064-7331-b3c4-d587f2dbfd33`
- **Workspace:** `orca/workspaces/yoyos/printing-integration`
- **Resultado:** el documento separa `features/printing/composition.ts` de `features/products/composition.ts`, siguiendo la estructura que ya usa core.

### 3. Integración de correos

- **ID de sesión:** `01a0e644-b1a4-71f3-a13a-e6b89e0c55b1`
- **Workspace:** `orca/workspaces/yoyos/email-integration`
- **Documentos generados:** `docs/email-integration.md`, `docs/users-email-architecture.md` y `docs/email-integration-tests.md`.

### 4. Órdenes en mobile

- **ID de sesión:** `01a0ea49-6389-7180-9aca-06f003162bc1`
- **Workspace:** `orca/workspaces/yoyos/orders-mobile`
- **Documento generado:** `docs/orders-mobile.md`, que reúne definición de producto (alcance, reglas, pantallas, filtros y recuperación) y arquitectura técnica, con 25 descripciones de pruebas.

### 5. Confirmación manual de pagos

- **ID de sesión:** `01a0f5f5-2e2b-7f13-b40a-9c5ef9c974da`
- **Workspace:** `orca/workspaces/yoyos/pago-confirmacion-manual`
- **Resultado:** estados `reported`, `confirmed` y `voided`, y contratos de los casos de uso `reportPayment`, `registerPayment`, `voidPayment` y `getPaymentReceipt`.

### 6. Modalidades de entrega

- **ID de sesión:** `01a0f5f4-de11-79b3-a119-85be0cf56922`
- **Workspace:** `orca/workspaces/yoyos/modalidades-de-entrega`
- **Documento generado:** `docs/modalidades-de-entrega.md`, con la definición de observabilidad añadida al final.

### 7. Checkout por link

- **ID de sesión:** `01a0f5f5-4173-7790-9d02-590ea0e6fe99`
- **Workspace:** `orca/workspaces/yoyos/checkout-por-link`
- **Resultado:** definición de bloqueos transaccionales para stock y para la confirmación del checkout.

### 8. Librería Expo para WhatsApp (Whatsmeow)

- **ID de sesión:** `01a113af-adc7-75f3-9018-d3b3b6e6b18c`
- **Workspace:** `orca/workspaces/yoyos/add-bailyes`
- **Documento generado:** `docs/whatsmeow-go-expo-implementation.md`, con estructura, sesión cifrada, recepción, imágenes, segundo plano en Android y validaciones pendientes. Es una sesión larga (233 mensajes).

### 9. API de mensajes

- **ID de sesión:** `01a11a1e-a15c-7d53-9128-b9021f6e8adb`
- **Workspace:** `orca/workspaces/yoyos/integrate-message-analizis`
- **Estado:** la sesión tiene un solo mensaje del asistente. No produjo documento.

## Sesiones de skills de segundo cerebro (no son documentos de producto)

- `01a0fae5-3c43-7842-90cd-05cfe256e56c`: skill de captura.
- `01a0fb06-e796-7b13-bb39-ffeefc4cd6f5`: skills de recall y destilado.
- `01a0faf6-8a7c-7d30-b8db-324709ab234a`: subagente organizador.

## Otros proyectos con «documento de producto»

- `019fea6b-386a-7ac3-a0d6-7a8cea845135`: CLI con OpenTUI en `happy-telegram`.
- `01a07f9f-7687-75c2-8dd1-187a27ad46e2`: configuración dinámica en `animo/dynamic-consultation-params`.
