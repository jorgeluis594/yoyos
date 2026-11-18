# UX web-productos (Tienda UX, cuenta ux-productos-*@test.local)
Probado: crear producto simple (validación, foto), crear con 2 opciones (6 variantes, stock por variante), edición inline precio/stock en la lista de variantes, validaciones, página de variante, lista de productos, catálogo público (publicado en uxprod532395.localhost:3000) en escritorio y 390px.

## Mayor
1. **Enter en "Agregar otro valor" guarda el producto entero y pierde la opción.** Productos > Nuevo > nombre+precio > "Agregar opciones…" > nombre "Talla" > escribir "S" y Enter → se crea el producto SIN variantes ("Producto guardado correctamente"). Con varios Enter seguidos aparece además "La solicitud contiene campos no permitidos." Captura: 09-enter-en-valor.png (y fallo previo en 07).
2. **Stock inválido marca en rojo el campo de PRECIO.** Editar producto con variantes > stock de "M / Azul" = -3 (o 2.5) > Guardar: sale "Stock no válido" pero el borde rojo queda en el precio, no en el stock. 15-stock-negativo.png.
3. **Móvil 390px: la columna Stock de la tabla de variantes queda fuera de vista** (la tabla se corta tras "Precio de venta"; hay que hacer scroll horizontal dentro de la tarjeta, sin pista). Es el dato clave del flujo. 21-m-editar.png.
4. **Escritorio: con un error de fila el Stock queda cortado.** En la fila con error de precio, el mensaje ensancha la tabla y la columna Stock se recorta (12-edicion-inline-invalida.png). El error general "Revisa 1 variante marcada." aparece abajo, lejos de la fila, sin scroll/foco automático.

## Menor
5. Al abrir una opción nueva ya se muestran errores en rojo ("Escribe el nombre de la opción", "Agrega al menos un valor") antes de que el usuario escriba. 06-variantes-abierto.png.
6. "Stock total" suma valores inválidos (39, 44.5) mientras hay error.
7. Página de variante: el campo Stock está deshabilitado sin explicar cómo cambiarlo (en la lista sí es editable). 14-variante-detalle.png.
8. Layout del formulario nuevo/editar: "Stock inicial/Stock" queda separado y flotando bajo las fotos, lejos de precios. 02-nuevo.png.
9. Tras guardar un producto nuevo se queda en la página de edición con banner; no hay botón claro "Crear otro" (solo "Volver a productos").
10. Variante inexistente devuelve 404 en consola pero la página muestra mensaje correcto (ok).

## Correcto
Validaciones de nombre/precio en español, subida de 1-2 fotos con "Principal", contador 2 de 8, guardado inline de precio/stock por variante persiste, selección múltiple/filtro presentes, lista de productos (móvil sin overflow horizontal de página), catálogo público: tarjetas, "Agotado", selector de variantes, precio por variante, cantidad limitada al stock (5), "Agregado al carrito". Sin errores JS de página.
