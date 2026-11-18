# UX review: móvil – productos y variantes (Expo web 390px, core local :3000)

Cuenta: ver `email.txt`. Capturas en esta carpeta. Scripts: `s*.mjs`, `lib*.mjs` (Playwright + shims SecureStore/Alert; `serve.mjs` = proxy+Metro en :8391/:8392, ya detenido).
Nota de harness: los iconos SF Symbols (chevrones, lupa, flecha atrás, ±, checkboxes) no se pintan en Expo web, y `Alert.alert` se simuló; NO se reportan como bugs.

## Bloqueantes
Ninguno. No hubo crashes, errores de consola ni botones muertos.

## Mayores
Ninguno.

## Menores
1. **Sin confirmación al guardar el producto.** Nuevo producto → nombre «Polo básico», precio, opciones Talla S/M/L → «Guardar». Solo cambia el título a «Editar producto»; no hay mensaje «Producto guardado» (la variante sí muestra «Variante guardada.»). Capturas `08-tras-guardar.png`, `39b-guardado-1s.png`.
2. **Dos «Listo» a la vez en Opciones** (cabecera y dentro de la tarjeta de la opción): confusos. `05-opciones.png`, `06-opciones-llenas.png`.
3. **Pantalla de Opciones:** «Nombre de la opción» sin placeholder (ej. «Talla, color») y el primer valor con placeholder «Agregar otro valor»; los campos de valores son más angostos y centrados que el nombre. `05-opciones.png`, `06-opciones-llenas.png`.
4. **«Desactivar variante» en rojo destructivo**, igual que «Eliminar variante», aunque es reversible. `17-variante-abierta-scroll.png`.
5. **Tras «Guardar variante» el botón sigue diciendo «Cancelar»** y el editor queda abierto; «Variante guardada.» es texto plano sin estilo de éxito. `21-guardado.png`.
6. **Selección masiva poco descubrible:** con una fila expandida, tocar chips (Todas/S/M/L) muestra «1 seleccionada» pero la barra de acciones masivas no aparece (solo con filas cerradas); el encabezado «Seleccionar» no explica para qué. Pasos: Variantes → abrir S → tocar chip «L». `24-filtro-L.png` vs `25-barra-masiva.png`.
7. **Precio inválido (0) en edición inline:** al salir del campo no hay error hasta pulsar «Guardar variante»; el botón se ve activo. `18-precio-invalido.png`, `22-guardar-precio-0.png`.
8. **Orden de valores cambia al guardar:** tras agregar XL con L desactivada, el resumen pasa de «S, L, XL» a «S, XL, L» (inactivas al final). `40-variantes-tras-guardar.png`.

## Probado y correcto
Estado vacío de Productos, búsqueda sin resultados («Limpiar búsqueda»), validación de nombre/precio al guardar vacío (español, bordes rojos), creación con opciones, lista con «Agotado · 3 variantes», edición inline de variante (precio/stock/SKU, validación, «Variante guardada.», total de stock actualizado), confirmación al descartar cambios (al cambiar de fila y al Cancelar con pendientes), desactivar/activar con aviso claro, eliminar con confirmación y bloqueo si hay stock («Tiene 5 unidades…»), agregar valor de opción → fila «Nueva» con «Aplicar/Cancelar/Quitar» que se guarda con el producto, barra masiva (Editar precio/stock/Más). Ancho 1280 sin roturas (`41-escritorio-variantes.png`). Textos todos en español.
No probado: fotos, impresión de etiqueta, hojas de edición masiva, «Ocultar producto».
