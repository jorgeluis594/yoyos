# Órdenes desde mensajes con QR — tareas

Plan de implementación de [`message-to-order.md`](message-to-order.md), pensado para agentes.

- Cada tarea entrega una funcionalidad completa que se puede probar por sí sola: código, pruebas de §7 en TDD, `lint` y `typecheck` en verde.
- Los bloqueantes están aislados en tareas pequeñas (T0a, T0b) para que el resto pueda avanzar en paralelo.
- Cada tarea es una rama o un PR propio sobre `jorgeluis594/message-to-order`. Las referencias §x apuntan al documento de diseño.

## Grafo de dependencias

```text
Ola 0   T0a Esquema, evento y puertos ─┐     T0b Comprador sin teléfono ─┐
        T1  Lectura de imágenes en core (sin dependencias)               │
        T2  Productos desde la foto     (sin dependencias)               │
                                       │                                 │
Ola 1   T3 Imagen del mensaje (core + mobile)   ◄── T0a                  │
        T4 Customer y mensaje de origen         ◄── T0a                  │
        T5 Órdenes desde mensajes (dominio,     ◄── T0a, T0b ────────────┤
           caso de uso y repositorio)                                    │
        T6 Origen WhatsApp en la UI             ◄── T0a, T0b ────────────┘

Ola 2   T7 Handler en el worker             ◄── T1, T2, T4, T5

Ola 3   T8 E2E happy path                   ◄── T3, T6, T7

Ola 4   T9 Prueba manual (pendiente)    ◄── T8
```

| Tarea | Depende de | Tamaño | Puede ir en paralelo con |
| --- | --- | --- | --- |
| T0a | — | S | T0b, T1, T2 |
| T0b | — | S | T0a, T1, T2 |
| T1 | — | S | todas las de las olas 0 y 1 |
| T2 | — | M | todas las de las olas 0 y 1 |
| T3 | T0a | L | T1, T2, T4, T5, T6 |
| T4 | T0a | S | T1, T2, T3, T5, T6 |
| T5 | T0a, T0b | L | T1, T2, T3, T4, T6 |
| T6 | T0a, T0b | M | T1, T2, T3, T4, T5 |
| T7 | T1, T2, T4, T5 | M | T3, T6 |
| T8 | T3, T6, T7 | S | — |
| T9 | T8 | S | — |

Camino crítico: T0a → T5 → T7 → T8 → T9. Con cinco agentes en la ola 1, el tiempo total es aproximadamente T0a + T5 + T7 + T8.

---

## T0a — Esquema, evento y puertos (bloqueante)

**Objetivo:** dejar fijos la base de datos, el nombre del evento y las firmas de los puertos para que las demás tareas compilen sin esperarse.

**Alcance**

- Migración Prisma única de §4 con `prisma migrate dev --create-only --name order_message_source`, siguiendo `.agents/skills/database-migrations/SKILL.md`:
  - `Customer`, `Contact.customerId`, `Order.customerId` y `Order.chatId`, `OrderMessage`, `OrderBuyer.phone` nullable;
  - el CHECK nuevo de la rama móvil.
- Renombrar `whatsapp_message_recorded` a `message_created` (§3.1) y añadir `parseMessageCreated` en `chats/infrastructure/event-payloads.ts`.
- Solo tipos, sin implementación, en sus archivos definitivos:
  - `CustomerId` (`contacts/domain/contact.ts`);
  - `VariantQrCode` (`orders/domain/message-order.ts`);
  - `ImageReadError` y la firma de `readImageBytes` (`shared/images/application/images.ts`);
  - `ReadQrCodes` y `QrCodeReadError` (`orders/infrastructure/qr-code-reader.ts`).

**Pruebas (§7):** `event-payloads.test.ts`, y en todas las pruebas existentes el evento renombrado a `message_created` (§7.5).

**Hecho cuando:** la migración se aplica sobre una base con datos existentes y los mensajes `metadata_only` existentes siguen registrándose igual. El evento se publica como `message_created`.

## T0b — Comprador sin teléfono (bloqueante)

**Objetivo:** que una orden pueda tener un comprador sin teléfono en el dominio, los contratos y la lectura.

**Alcance**

- `orders/domain/order.ts` (`OrderCustomer.contact.phone: string | null`, `buildOrder`) y `domain/checkout.ts`.
- `shared/contracts/orders.ts` (líneas 15 y 17) y `order-checkout.ts` (`buyer.phone` nullable).
- `order-repository.ts`: quitar el guard `!row.buyer.phone` en `findOrderAggregates`.
- `application/read-orders.ts`.
- Ajustes mínimos de UI (web y mobile) para que compilen y no muestren `null`. La presentación final es de T6.

**Pruebas (§7):**

- `order.test.ts`: builds an order whose contact buyer has no name or phone.
- `order-contracts.test.ts` / `checkout-contracts.test.ts`: null phone.

**Hecho cuando:** el checkout sigue exigiendo un teléfono válido al confirmar y las órdenes existentes no cambian.

## T1 — Lectura de imágenes en core

**Objetivo:** que core lea los bytes de una imagen de la empresa (§3.2, lectura).

**Alcance**

- `ImageStorage.read(key)` en `r2-image-storage.ts`.
- `readImageBytes` en `shared/images/application/images.ts`, con la traducción de errores de §3.2. Exportarlo en `index.ts`.
- `compose.prod.yaml`: variables `R2_*` en el servicio `worker`.

**Pruebas (§7.1):** `images.test.ts` y `r2-image-storage.test.ts`.

**Hecho cuando:** `readImageBytes` devuelve los bytes y el `contentType` de una imagen pública o privada, y los fallos de configuración se clasifican como reintentables.

## T2 — Productos desde la foto

**Objetivo:** pasar de los bytes de una foto a las variantes vendibles de la empresa (§3.4, §3.8 products).

**Alcance**

- `zxing-wasm@3.1.5` en `apps/core/package.json` y en el lockfile.
- `orders/infrastructure/qr-code-reader.ts`: carga perezosa del `.wasm` local y conversión con `sharp`.
- Fixtures JPEG y WebP: un QR, dos QR, ninguno, QR no UUID y una etiqueta real generada con el renderizador de etiquetas.
- `findSellableVariantsByQrCodes` en `products/infrastructure/order-stock.ts`, con el mapper `toCatalogItem` compartido. Exportarla en `index.ts`.

**Pruebas (§7):** `qr-code-reader.test.ts` y `products/infrastructure/repository.integration.test.ts` (findSellableVariantsByQrCodes).

**Hecho cuando:** la foto de una etiqueta impresa devuelve el UUID de su variante y la búsqueda respeta RLS y el estado de la variante.

## T3 — Imagen del mensaje (core + mobile)

**Objetivo:** que mobile suba la imagen de cada mensaje y core la guarde como `ready` con su `imageId` (§3.2 registro, §3.3).

Core y mobile van en una sola tarea porque el cambio de contrato rompe los dos lados a la vez. Dentro de la tarea se puede repartir entre dos agentes: el contrato se cambia primero y después core y mobile avanzan en paralelo.

**Alcance core**

- `shared/contracts/whatsapp-messages.ts`: `imageId` obligatorio, sin `mimeType` ni `size`, y `whatsAppMessageIdentitySchema`.
- `register-mobile-message.ts`: comprueba la imagen; si no existe responde 404 `IMAGE_NOT_FOUND`.
- `store-mobile-message.ts`, `domain/mobile-message.ts`, `domain/message.ts`.
- `mobile-message-repository.ts`: `storedRowSchema`, `mapMobileMessage` e inserción con `ready`.
- `mobile-message-routes.ts`, `mobile-message-schemas.ts`.

**Alcance mobile**

- `shared/infrastructure/image-api.ts`, extraído de `product-api.ts`, que envía el `mimeType` real.
- SQLite v3 incremental y `coreImageId` en el store.
- Subida dentro de `sync-messages.ts`.
- `RejectCode` `IMAGE_UNAVAILABLE` y la decisión `reupload` en `sync-policy.ts`.
- `message-api.ts` envía `imageId`.
- `composition.ts`.

**Documentación:** `docs/whatsapp-mobile-message-processing.md`: línea 27, decisión nueva, tabla de mapeo y nombres de pruebas.

**Pruebas (§7):**

- Core: `mobile-message-schemas.test.ts`, `register-mobile-message.test.ts`, `mobile-message-routes.test.ts`, `mobile-message-dispatch(.integration).test.ts` y `mobile-message-repository.integration.test.ts`.
- Mobile: todo §7.2 salvo las pantallas de órdenes, y §7.3 mobile.
- Existentes: E01–E03 de `tests/e2e/mobile-messages.spec.ts` (§7.5).

**Hecho cuando:**

- un mensaje de imagen recibido en el teléfono llega a core con `imageStatus = ready` y publica `message_created`;
- un 404 hace que mobile vuelva a subir la imagen;
- una base SQLite v2 con mensajes pendientes migra a v3 sin perderlos.

## T4 — Customer y mensaje de origen

**Objetivo:** las lecturas y escrituras de contacts y chats que necesita el caso de uso (§3.8).

**Alcance**

- `contacts`: `ensureCustomerForContact(contactId)` con `withLockedForUpdate`; crea un `Customer` vacío y lo vincula si el contacto no tiene uno. Exportarla en `index.ts`.
- `chats`: `findOrderSourceMessage(messageId)` (mensaje, chat, `contactId`, dirección, uploader, `imageId`). Exportarla en `chats/index.ts`.

**Pruebas (§7.3):** `contact-repository.integration.test.ts` (ensureCustomerForContact), más una prueba de `findOrderSourceMessage` en `mobile-message-repository.integration.test.ts` que cubra las filas `ready`, las `metadata_only` y el aislamiento entre empresas.

**Hecho cuando:** dos llamadas concurrentes para el mismo contacto crean un solo customer.

## T5 — Órdenes desde mensajes: dominio, caso de uso y repositorio

**Objetivo:** el núcleo de la funcionalidad. Dado un mensaje, añade sus productos a la orden abierta del chat o crea una nueva (§3.5, §3.6, §3.8 orders).

**Alcance**

- `orders/domain/message-order.ts`: `selectProductCode` e `isOpenForMessageItems`.
- `orders/domain/order-state-machine.ts`: `appendItems`.
- `orders/application/add-message-products-to-order.ts`, con dependencias estructurales tipadas con los puertos de T0a.
- `order-repository.ts`:
  - `findProcessedMessage`, `findOpenChatOrderCandidate`, `saveAddedItems`, `recordProcessedMessage`;
  - `savePendingOrder` con `customerId` y `chatId`.

**Pruebas (§7):**

- §7.1: `message-order.test.ts`, `order-state-machine.test.ts` (appendItems) y `add-message-products-to-order.test.ts`.
- §7.3: `order-repository.integration.test.ts`, incluida «lists, filters and searches orders whose buyer has no phone», y `add-message-products-to-order.integration.test.ts`.
- El test de integración del caso de uso usa la base real con fakes de imagen y QR. Para la parte de customer usa la función de T4 si ya está integrada; si no, un fake con bloqueo equivalente, y se cambia por la real en T7.

**Hecho cuando:** pasan todos los casos borde de §6 de la parte de órdenes, incluidos la concurrencia (dos fotos, pago, cancelación y checkout) y la idempotencia.

## T6 — Origen WhatsApp en la UI

**Objetivo:** mostrar las órdenes de chat con el icono de WhatsApp y un comprador que puede no tener datos (§3.9).

**Alcance**

- `orderAggregateSchema` y `orderSchema` añaden `source`, derivado de `chatId`.
- Web: `order-list.tsx`, `order-detail.tsx` y `locales.ts`.
- Mobile: `order-history-screen.tsx`, `order-detail-screen.tsx` y traducciones.
- El comprador se muestra como `name ?? phone`; si ambos faltan, solo se ve el icono.

**Pruebas (§7):** `order-contracts.test.ts` (source) y las pruebas de las pantallas de mobile (§7.2). Para comprobarlo se puede sembrar a mano una orden con `chatId`, sin esperar a T5.

**Hecho cuando:** una orden con `chatId` muestra el icono con la etiqueta accesible «WhatsApp» en web y mobile, y las órdenes manuales no cambian.

## T7 — Handler en el worker

**Objetivo:** conectar las piezas para que `message_created` produzca órdenes en el worker (§3.7, §6.1).

**Alcance**

- Composición de las dependencias reales en `orders/composition.ts`: T1, T2, T4 y T5, y la transacción con `withTenantIsolation`.
- Adaptador del handler: clasifica cada error como reintentable o permanente y escribe los logs `orders_message_order_*`.
- Registro en `composition/event-handlers.ts` con `{ concurrency: 2, retries: 8 }`.
- Log de publicación con `messageId` en `composition/event-bus.ts`.
- Runbook de reproceso (§6.1) y `docs/event-bus-quick-start.md`.

**Pruebas (§7):** `orders/composition.test.ts`, `event-handlers.test.ts` y `event-handlers.integration.test.ts`.

**Hecho cuando:** un `message_created` publicado en el bus real crea la orden, un fallo reintentable se reintenta y uno permanente deja el job fallido con su log.

## T8 — E2E happy path

**Objetivo:** demostrar el flujo completo con piezas reales.

**Alcance:** `apps/core/tests/e2e/message-to-order.spec.ts` con el bus en el proceso de la prueba (como en `mobile-messages.spec.ts`), el lector QR real y la foto de una etiqueta impresa.

**Pruebas (§7.4):** los tres escenarios de E2E.

**Hecho cuando:** pasan `sh scripts/run-tests.sh e2e` y la suite completa de §7.

## T9 — Prueba manual (pendiente)

Estado: **pendiente**. La hace una persona con un teléfono real; no la ejecuta un agente. La funcionalidad no se da por terminada hasta completarla.

**Preparación:** core y worker levantados con R2 configurado, la app mobile vinculada a una cuenta de WhatsApp y productos con etiquetas impresas.

**Recorrido**

- [ ] Desde otro número, enviar al chat la foto de una etiqueta. En la web y en mobile aparece una orden con el icono de WhatsApp, la variante, el vendedor que subió el mensaje y un comprador sin datos.
- [ ] Enviar la foto de otra etiqueta en el mismo chat: se añade a la misma orden y el total se actualiza.
- [ ] Enviar otra vez la primera etiqueta: la cantidad sube a 2.
- [ ] Enviar una foto con dos etiquetas: se añaden dos ítems.
- [ ] Enviar una foto sin QR y un QR de Yape/Plin: no cambia ninguna orden y queda el log `orders_message_order_skipped`.
- [ ] Enviar una foto desde el teléfono del vendedor (saliente): no cambia ninguna orden.
- [ ] Registrar un pago de la orden y enviar otra etiqueta: se crea una orden nueva.
- [ ] Habilitar el checkout, enviar otra etiqueta y confirmar con el enlace abierto antes: la página muestra el nuevo total.
- [ ] Recibir una foto con el teléfono sin conexión y reconectar: la orden se crea al sincronizar, una sola vez.
- [ ] Revisar que los logs no contienen teléfonos, IDs de WhatsApp ni bytes.

**Hecho cuando:** todos los puntos están marcados. Los fallos se registran como tareas nuevas.

---

## Reglas para los agentes

- Escribir primero las pruebas de §7 que pertenecen a la tarea, verlas fallar e implementar después.
- No tocar archivos de otra tarea salvo para resolver conflictos de integración. Si una tarea necesita un puerto que no existe, se usa la firma de T0a; si no basta, la firma se actualiza en el documento de diseño antes de cambiarla.
- Antes de entregar, ejecutar `pnpm --dir apps/core test:unit`, `sh scripts/run-tests.sh integration` (si la tarea toca persistencia), `pnpm --dir apps/mobile test` (si toca mobile), y `lint` y `typecheck` en las apps afectadas.
- Commits con asunto imperativo y conciso, siguiendo el historial del repositorio.
