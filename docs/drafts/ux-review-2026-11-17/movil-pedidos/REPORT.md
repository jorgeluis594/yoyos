# UX review — movil-pedidos (Expo web, 390px y 1280px)
Cuenta: ver email.txt. Expo en :8299, proxy en :8298 (/api → core :3000). Capturas en esta carpeta; scripts en scripts/.
Limitación del arnés: en Expo web `Alert.alert` no hace nada, así que no se pudo probar «Cancelar pedido» (usa showConfirmation). Datos: pedidos sin envío a domicilio/agencia (RATE_UNAVAILABLE en el setup), sí recojo en tienda.

## Mayor
1. **Un pago mayor al total se registra sin validar.** Pedido #1005 (total S/ 60.00) → Registrar pago → «Otro monto (adelanto)» → 999 → «Registrar S/ 999.00» (el botón está habilitado) → el detalle queda «Pagado S/ 999.00 · Saldo S/ 0.00». No hay mensaje ni tope. Captura: 09-pago-monto-excesivo.png (pantalla antes de lo guardado; el resultado se leyó en el texto de la página; tras guardar muestra «Pagado S/ 999.00»).
2. **«Anular pago» actúa al instante, sin confirmación**, pegado a «Cobrar saldo». Pedido #1006 → tocar «Anular pago» → el pago pasa a «Anulado» y el pedido a «Pendiente». Código: order-detail-screen.tsx:598 llama voidPayment directo (sin showConfirmation). Capturas: 11-anular-pago.png.

## Menor
3. Pestañas superiores (Inicio/Productos/Pedidos/Configuración) se cortan a 390px: el logo «Yoyos» queda recortado a «os» y «Configuración» al borde derecho (02-pedidos.png, 03-detalle-1002-parcial.png). Solo web móvil.
4. Al abrir el detalle de un pedido la app llama POST /api/orders/:id/checkout-link y recibe **409 Conflict** cada vez (consola roja «Failed to load resource 409») cuando la tienda aún no eligió su link; la UI lo trata bien («Pendiente de confirmación»), pero es ruido/reintento en cada visita.
5. Lista de pedidos: un pedido con pago parcial dice «Pago pendiente» (p. ej. #1002 con S/ 30 de S/ 90) mientras el detalle dice «Pago parcial» (02-pedidos.png vs 03-detalle-1002-parcial.png).
6. Registrar pago con monto 0 o «abc»: el botón queda deshabilitado sin ningún mensaje que explique por qué (08-pago-otro-monto.png).
7. Dos botones «Cerrar» accesibles en la hoja Registrar pago (fondo + botón): ambiguo para lectores de pantalla.
8. Tras «Guardar pedido» en Nueva venta navega directo al detalle sin aviso de «Venta guardada» (23-venta-guardada.png); el feedback es implícito. En pagos sí aparece «Pago registrado.».
9. Selector de productos: sin búsqueda y muestra «1 variante ›» incluso para productos simples; la variante se llama «Variante» (14-selector-productos.png, 15-variante-stock-0.png).
10. Pantalla de revisión de Nueva venta: el botón superior dice «Editar productos» al lado del título «Nueva venta», parece una acción de la pantalla y no un volver (20-revision-venta.png). Campo «Despacho» muestra «mm/dd/yyyy» (formato del navegador, no español) (30-escritorio-detalle.png).
11. LogBox de dev: «<button> cannot contain a nested <button>» en lista y detalle de pedidos (solo desarrollo web); cubre botones en capturas.
12. Iconos en blanco (cuadrados vacíos) en la revisión de venta y ausencia de flecha «atrás» visible en el detalle (fuentes de iconos no cargan en web; probablemente solo web).

## Probado y OK
Inicio (accesos Nueva venta/Ver pedidos/productos), lista de pedidos (filtros Todos/Por cobrar/Por entregar, búsqueda por cliente y número, estado «Sin resultados»), detalle de pedido (pendiente, parcial, pagado, enviado), registrar pago completo («Pago registrado.»), adelanto con saldo calculado y redondeo, cobrar saldo, Nueva venta completa (cliente con validaciones en español, productos con aviso de stock 0, pago, guardar → pedido #1010), marcar como enviado, escritorio 1280px (layout correcto; 28–30 *.png).
No bloqueantes encontrados.
