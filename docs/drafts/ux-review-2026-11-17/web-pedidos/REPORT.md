# Revisión UX – web-pedidos (core web, localhost:3000)

Cuenta aislada ux-pedidos-<ts>@test.local (creds.env). Escritorio 1280px y móvil 390px. Sin errores de consola ni crashes. Sin desbordes horizontales en móvil (lista, detalle, nueva venta).

## Bloqueantes
Ninguno.

## Mayores
Ninguno.

## Menores
1. **Enter en el selector de producto no agrega.** Nueva venta → Agregar producto → escribir "Polo" → Enter: no pasa nada; hay que pulsar ↓ antes. El pie dice "Enter agregar". Esperable: con un solo resultado (o el primero) Enter lo agrega. Capturas: desktop-21-after-enter.png, desktop-22-after-down-enter.png.
2. **Lista de ventas: estados solo con iconos.** En la fila de #1001 el estado de pago y de entrega son dos iconitos sin texto; debajo solo aparece "Pendiente de confirmación" (estado del pedido) aunque ya hay un pago de S/ 20. No se distingue pagado/parcial ni enviado/pendiente sin abrir el detalle ni se ve el saldo. desktop-60-list.png, mobile-80-list.png.
3. **Badge "Pago pendiente" con pago parcial.** Pedido con S/ 20 de S/ 55 cobrados (confirmado) muestra "Pago pendiente", mientras la tarjeta dice "Pago parcial · falta S/ 35.00". desktop-53-saved.png.
4. **Tarifa de entrega no se autoselecciona** cuando solo hay una opción (Motorizado) para el distrito; el error "Selecciona una tarifa" aparece al guardar. desktop-41-save-incomplete.png.
5. **Formato de teléfono inconsistente.** Cliente muestra 987654321 con selector PE +51, pero "Teléfono del destinatario" (igual que el cliente) muestra +51987654321. desktop-53-saved.png.
6. **Campos requeridos sin marca visual previa:** al fallar el guardado el Departamento (vacío) no se marca en rojo como Dirección/Nombre/Teléfono; solo el banner "revisa 5 campos". desktop-41-save-incomplete.png.
7. **Copy "Enlace del pedido: Pendiente de confirmación / Elige el link de tu tienda…"** confuso: el vendedor no entiende qué debe confirmar; hay que ir a Apariencia de la tienda. desktop-53-saved.png.
8. **Marcar enviado con pago parcial** (S/ 20 de 55) se ejecuta sin confirmación (queda "Enviada" + "Pago pendiente"). Puede ser intencional (cobro contraentrega); si no, pedir confirmación. desktop-70-mark-sent-partial.png.
9. Móvil: la etiqueta "Buscar por nombre, teléfono o número de pedido" ocupa dos líneas y el campo queda estrecho junto a Filtros. mobile-80-list.png.

## Probado y OK
Login, lista vacía (mensaje), nueva venta (estado vacío, selector con búsqueda/stock, cantidades, validación de entrega con banner y campos rojos, pago parcial + "descontar stock", cliente, domicilio con departamento/provincia/distrito/tarifa), guardado con redirección y "Venta guardada.", detalle (productos, pagos, estado 1-2-3, entrega, anular pago), marcar enviado, venta sin entrega ni pago, cantidad sobre stock (aviso "Disponible: 3…" y pedido espera stock), pestañas Todos/Por cobrar/Por entregar, búsqueda y panel Filtros (abre, campos cliente/fechas). Todo en español.

No cubierto por tiempo: agencia/recojo en tienda (solo configuré domicilio), cancelar pedido, impresión de rótulo, aplicar filtros con varios pedidos, paginación con >1 página.
