# Productos: propuestas de rediseño

Cada imagen muestra **alta antes de guardar** (izquierda) y **edición de un producto ya guardado** (derecha). Son composiciones raster para decidir jerarquía y ubicación de acciones; no son capturas de la app implementada. La opción anterior aprobada en `.impeccable/mocks/products/` pertenece al alcance anterior de apilar botones y se conserva. El usuario eligió **A** y corrigió la ubicación de Imprimir: un icono accesible junto al título superior, en vez de la pastilla flotante dibujada en el mock.

| Opción | Composición | Acción de impresión |
| --- | --- | --- |
| A | Foto y datos básicos abiertos; precios e inventario agrupados | Pastilla flotante de contraste suave sobre el área inferior |
| B | Filas compactas con divisores; nombre y precio en primer plano | Pastilla flotante delineada |
| C | Resumen de producto y paneles de información, precio y existencias | Pastilla flotante caramelo en espacio reservado |

En todas: Guardar es una acción independiente; Imprimir aparece solo en la pantalla de un producto persistido y debe usar sus datos guardados. El producto se conserva tras guardar correctamente. Los errores de escritura nunca se presentan como éxito ni habilitan impresión de un alta no confirmada. Los campos, número de fotos, navegación y estado real se ajustarán al modelo actual de Yoyos durante implementación; las imágenes contienen simplificaciones conceptuales.

## Evidencia visual y funcional

- Capturas reales Yoyos: `artifacts/mobile-redesign/final/02-producto-alta.png` y `02-producto-edicion.png` en el repositorio del proyecto.
- Captura oficial de la app móvil Shopify, publicada en https://www.shopify.com/au/mobile (imagen de producto: https://cdn.shopify.com/b/shopify-brochure2-assets/3df8d447b185c6286e3e9c504022f59d.png). Muestra medios, título, precio, inventario y Guardar separados en una pantalla nativa. Es una captura promocional; no se infieren comportamientos de impresión.
- Documentación móvil Shopify: https://help.shopify.com/en/manual/products/add-update-products y https://help.shopify.com/en/manual/products/product-media/add-media. Confirma el flujo de crear/editar producto, guardar y añadir medios desde la app.

## Implementación

El formulario real conserva un solo archivo de foto y los campos existentes. `Guardar` solo persiste; tras un alta confirmada se abre el detalle persistido. Allí el icono superior Imprimir ofrece selección de variante cuando corresponde. Las capturas nativas finales están en `artifacts/mobile-redesign/final/02-producto-*-rediseño-*.png` del repositorio del proyecto y en `.impeccable/review/products-v2/` de este worktree.
