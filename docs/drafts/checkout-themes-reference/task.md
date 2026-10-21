# Temas de checkout fijos: el comerciante elige uno de cinco temas en lugar de colores

Todoist: 6hphRPP56CR9MR2V

**Tipo:** A, cambio de enfoque de una funcionalidad que ya existe. Lleva producto y arquitectura, con las decisiones ya cerradas en esta descripción. Es solo una capa visual: el flujo, los pasos y las pantallas del checkout no cambian, y no se rediseña nada.
**Repositorio y rama base:** jorgeluis594/yoyos, `main` (revisado en abe09ec, que ya incluye el PR #92).
**Reemplaza a:** 6hpQqCf4X2RX2fr3, ya en Terminado con el [PR #92](https://github.com/jorgeluis594/yoyos/pull/92) mergeado.

**Referencia visual aprobada por Jorge (20-oct-2026)**
- Las maquetas de los cinco temas y el código de referencia están en los comentarios de esta tarea: `temas.css`, con los valores exactos de cada tema, y `checkout.html`.
- **`temas.css` es la fuente de verdad de los valores:** colores, fuentes, tamaños, pesos, radios, sombras, espaciados, bordes y miniaturas. Se traducen a los tokens del tema del checkout real.
- **Las maquetas son solo referencia visual.** Su estructura (390 px, orden de secciones, numeración, etc.) no se copia. El flujo, los pasos y la estructura del checkout real no cambian.
- **Fuentes de las maquetas:**
  - Clásico usa la sans del sistema.
  - Boutique usa Playfair Display en los títulos e Inter en el cuerpo.
  - Antojo usa Fredoka en los títulos y Nunito en el cuerpo.
  - Suave usa Outfit.
  - Noche usa Inter.
  Todas son de licencia libre y se autoalojan (decisión 4).
- **Miniaturas por tema:**
  - Clásico: 56 px, 1:1.
  - Boutique: 56 px, 4:5 (versión compacta; Jorge rechazó las fotos grandes).
  - Antojo: 76 px, 1:1.
  - Suave: 64 px, 1:1.
  - Noche: 48 px, 1:1.

**Objetivo**
El comerciante deja de elegir colores. Elige uno de cinco temas de checkout fijos, definidos en el código, y no edita nada más, ni siquiera el color de acento. Lo único propio del comerciante que se ve en el checkout es su logo y las fotos de sus productos. Cada tema es un conjunto cerrado de valores: colores, fuente, redondeo, sombra, espaciado y forma de las miniaturas, como los temas de Shopify o el `theme` de Stripe. Los cinco temas van en esta primera versión.

**Contexto real (código en main)**
- **Lo que dejó el PR #92:** el comerciante elige un color de marca entre nueve (`CheckoutBrandColor`: yoyos, forest, petrol, ocean, plum, raspberry, terracotta, mustard, graphite) y un fondo (`CheckoutBackground`: soft, medium, brand_tint).
  - Están definidos en `apps/core/src/features/checkout-appearance/domain/checkout-colors.ts`, con paletas OKLCH de 19 tokens por color.
  - Se guardan en las columnas `brandColor` y `background` (`prisma/schema.prisma`). La migración `20261020044730_rename_checkout_backgrounds` renombró white a soft y neutral a medium.
- **Dónde se usa la apariencia:**
  - Se edita en `routes/checkout-appearance-settings.tsx`, con vista previa en `routes/checkout-appearance-preview.tsx`.
  - Se aplica en `CheckoutTheme` (`presentation/checkout-theme.tsx`), que inyecta variables CSS.
  - El checkout la carga en `routes/checkout.tsx` y la pinta en `CheckoutShell` (`app/components/checkout-sections.tsx`).
  - El catálogo público usa `CheckoutTheme surface="catalog"` con la paleta anterior congelada (`catalog-sections.tsx`).
- **Logo:** `CheckoutBrandHeader`, en una caja blanca con borde.
- **Fuente:** global, Inter Variable autoalojada con `@fontsource-variable/inter`.
- **Productos en el checkout:** la lista de `checkout-sections.tsx` muestra nombre, variante, cantidad por precio y subtotal, **sin foto**.
- **Envío:** el envío por agencia (Shalom/Olva) y la entrega inmediata ya están en el checkout (PR de agencias y PR #93).

**Decisiones cerradas (CTO, 20-oct-2026)**
1. **Modelo.** La apariencia guarda el logo y un identificador de tema (`classic`, `boutique`, `antojo`, `suave`, `noche`). Se retiran del producto el color de marca y el fondo: editor, esquema público, dominio y paletas por color. Si las columnas y enums se borran en esta misma migración o en una posterior, lo decide el agente siguiendo el skill de arquitectura. Ningún registro existente puede quedar inválido.
2. **Migración.** Todas las empresas existentes quedan en **Clásico**, que es también el valor por defecto. No se intenta mapear colores a temas.
3. **Modo fijo por tema.** Noche siempre es oscuro y los otros cuatro siempre son claros, sin importar el modo del sistema del comprador.
4. **Fuentes.** Autoalojadas con licencia libre (por ejemplo, paquetes de `@fontsource`), sin CDN externo y sin costo. Se cargan solo las del tema activo. Clásico usa la sans del sistema. Boutique usa serif solo en títulos, nunca en campos, etiquetas, precios ni totales.
5. **Fotos de producto (confirmado por Jorge).** Se agrega una miniatura con la foto del producto a la izquierda de cada fila de la lista de productos del checkout, dentro de la fila que ya existe. Es una miniatura pequeña, con el tamaño y la forma que fija cada tema según `temas.css`. Si el producto no tiene foto, se muestra un marcador neutro con la inicial, como en el catálogo. Es el único agregado de contenido y no cambia la estructura de la pantalla.
6. **Logo.** Cada tema define cómo se presenta el logo para que se lea bien, incluidos los logos transparentes y oscuros sobre el fondo de Noche (por ejemplo, con una placa clara).
7. **Catálogo público (confirmado por Jorge).** No adopta los temas en esta tarea. Queda con el aspecto actual por defecto de Yoyos, sin depender del color de marca que se retira.
8. **Contraste.** Se mantiene el piso de #92: textos con WCAG AA de al menos 4.5:1, y bordes de campos, controles y foco con al menos 3:1. Se verifica con una prueba automática en los cinco temas.

**Los cinco temas**
1. **Clásico (por defecto).** Neutro: fondo blanco, texto casi negro y botón principal negro. Sans del sistema, esquinas de ~8 px, sin sombras, bordes finos grises, densidad media y miniaturas cuadradas pequeñas. Inspiración: el checkout de Shopify con Dawn y el tema `stripe`.
2. **Boutique.** Editorial y elegante: títulos en serif y cuerpo en sans (nunca serif en campos ni precios), esquinas rectas de 0 a 2 px, sin sombras, separadores finos y mucho aire entre secciones. Versión compacta: miniaturas de 56 px en 4:5, no fotos grandes. Paleta hueso o crema con negro. Inspiración: Craft y Studio de Shopify, Atlántico de Tiendanube.
3. **Antojo.** Alegre: sans redondeada y gruesa, títulos grandes, botones y chips en forma de píldora y sombras duras marcadas. Fondo cálido claro con un acento coral fijo y miniaturas redondeadas grandes. Inspiración: Crave de Shopify, Bahía de Tiendanube. Hay que probarlo con logos reales.
4. **Suave.** Calma: degradado sutil en pastel neutro solo en el fondo general, esquinas de ~16 px, sombras suaves y difusas, sans ligera y fotos redondeadas. Campos y botones con contraste alto. Inspiración: Sense de Shopify.
5. **Noche.** Modo oscuro: fondo gris carbón, texto claro y acento frío fijo, esquinas de 6 a 8 px, campos agrupados y compactos, densidad alta. Hay que cuidar el contraste de etiquetas y textos de ayuda, y los logos transparentes sobre fondo oscuro. Inspiración: el tema `night` de Stripe.

**Buenas prácticas móviles en los cinco temas (Baymard)**
- Etiquetas encima de los campos.
- Total visible antes de pagar.
- Recojo en agencia (Shalom/Olva) junto a las opciones de envío, con su costo y plazo.

Lo que ya cumple el checkout actual se conserva y se comprueba en cada tema. Lo que no cumpla se ajusta solo con estilos, sin mover pasos ni pantallas.

**Alcance**
- Definir los cinco temas como conjuntos cerrados de valores en el código.
- Reemplazar en el editor de apariencia el selector de color y fondo por un selector de tema que reutilice los controles y el layout actuales del editor, con una muestra de cada tema. La vista previa muestra el tema elegido.
- Aplicar el tema al checkout del comprador, en todos sus estados.
- Hacer la migración de datos y retirar el modelo de colores (decisiones 1 y 2).
- Agregar la miniatura de producto (decisión 5).
- Actualizar las stories (una por tema), las pruebas y `docs/checkout.md`.

**Criterios de aceptación**
- El comerciante solo puede elegir entre los cinco temas. No hay ningún control de color, fondo ni acento.
- Las empresas existentes quedan en Clásico y su checkout funciona sin intervención.
- Cada tema aplica todos sus valores (colores, fuente, redondeo, sombra, espaciado y miniaturas) en todo el checkout, y nada queda con valores de otro tema.
- Noche es oscuro y el resto claro, sin depender del sistema del comprador.
- En Boutique no hay serif en campos, etiquetas, precios ni totales.
- Los cinco temas cumplen los contrastes de la decisión 8, verificados con una prueba automática.
- En el celular, en los cinco temas, las etiquetas van encima de los campos, el total se ve antes de pagar y el recojo en agencia aparece con las opciones de envío, con su costo y plazo.
- Cada fila de producto muestra su foto, o el marcador si no tiene, con la forma del tema.
- El logo se lee bien en los cinco temas, incluido uno transparente oscuro sobre Noche.
- El flujo, los pasos y las pantallas del checkout no cambian: misma estructura, solo estilos, más la miniatura.
- El catálogo público se ve como hoy.
- Pasan typecheck, lint, las pruebas unitarias y de integración, y las e2e de checkout y checkout-appearance.

**Dependencias**
Ninguna bloquea esta tarea. Parte de main con el PR #92 ya mergeado.

**Cómo verificarla**
- En el editor, elegir cada tema y revisar la vista previa.
- Abrir un checkout real con cada tema, en escritorio y celular, recorriendo los estados: pendiente, envío por agencia, pago y confirmado.
- Probar con un logo transparente oscuro, uno horizontal largo y productos con y sin foto.
- Revisar las stories de los cinco temas lado a lado.
- Verificar la migración con una base que tenga empresas con distintos colores y fondos.
- Adjuntar capturas antes y después de cada tema en el PR.

**Fuera de alcance**
- Editar colores, fuentes o cualquier valor del tema por comerciante.
- Temas creados por el comerciante o más de cinco temas.
- Aplicar los temas al catálogo público o al panel del vendedor.
- Cambiar pasos, campos, textos o el orden del checkout.
- Desplegar o mergear sin el OK de Jorge.