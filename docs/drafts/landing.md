# Yoyos landing page: product definition

**Status:** definition ready to implement. Faithful transcription of the Todoist task [6hphRpcXVXJ62qP3 «Implementar la landing page de Yoyos con Astro»](https://app.todoist.com/app/task/6hphRpcXVXJ62qP3) (description) and of its seven comments «Contenido y SEO de la landing de Yoyos (versión vigente, v2.0)», defined by the founder and Marketing, 21-oct-2026. Nothing exists yet: there is no landing and no Astro in the repository. Technical design: [`landing-technical.md`](landing-technical.md).

The copy is kept in Spanish, exactly as written (text between «…» is literal). Only heading levels were adjusted so the task description and the seven comments read as one document. Where the description and the content disagree, the content (part «Contenido y SEO») wins, as the description itself states.

## Parte A. Tarea (descripción de Todoist)

**Tipo:** A, funcionalidad nueva. Lleva producto (el contenido lo definen Marketing y Ventas con Jorge) y arquitectura (dónde vive la app dentro del monorepo). **Esta tarea es solo de implementación:** el despliegue va en otra tarea.
**Repositorio y rama base:** jorgeluis594/yoyos, `main`.
**Ubicación (decisión de Jorge, 20-oct-2026):** módulo aparte del monorepo en **`/landing`**, en la raíz del repo, al lado de `apps/` y `shared/`, y **no** en `apps/landing`.
**Estado:** lista para implementar. El contenido final de Marketing (v2.0), aprobado por Jorge, está en los comentarios de esta tarea.

### Objetivo

Tener la landing page pública de Yoyos, hecha con Astro, rápida y bien posicionable. Sirve para explicar el producto y llevar a los vendedores a registrarse o a contactar a ventas.

### Contexto real (repo y despliegue)

- **Apps del monorepo:** hoy hay dos, `apps/core` (React Router, la app web y el checkout) y `apps/mobile`. No existe ninguna landing ni nada de Astro.
- **Design system:** `DESIGN.md` en la raíz y los tokens en `docs/design-tokens.json`. La fuente de la marca es Inter Variable, autoalojada con `@fontsource-variable/inter`. `PRODUCT.md` describe el producto.
- **Dominio de la primera prueba:** `landing.yoyos.lat`, en Cloudflare. Se despliega en otra tarea, con el OK de Jorge.

### Requisitos técnicos

1. **Stack.** Astro con salida estática (`output: 'static'`), en el módulo **`/landing`** de la raíz del repo. Cómo se integra con el workspace y con la CI lo decide el agente siguiendo el skill de arquitectura, sin romper `apps/core` ni `apps/mobile`. No lleva React ni otro framework de UI salvo islas puntuales que de verdad lo necesiten. Por defecto no se envía JavaScript al cliente.
2. **Marca.** Usa los tokens de `docs/design-tokens.json` y las reglas de `DESIGN.md` (colores, tipografía Inter autoalojada, radios). No copia componentes de `apps/core`, pero se ve coherente con la app.
   - **Referencia visual aprobada por Jorge (solo estilo):** [Eario.ai, SaaS Website Landing Page](https://dribbble.com/shots/26360891-SaaS-Website-Landing-Page). El contenido, las secciones y el copy siguen siendo los de Marketing. El estilo se adapta a Yoyos: colores, tipografía y radios salen de `DESIGN.md` y de los tokens (donde la referencia usa azul, va el acento de Yoyos). Lo que muestra la referencia:
     - Estética SaaS limpia y clara: fondo blanco o gris muy claro, un solo color de acento, mucho aire y títulos grandes de peso regular o medio, sin negrita pesada.
     - Header simple: logo a la izquierda, los enlaces de navegación y un botón de iniciar sesión en píldora gris claro.
     - Hero en dos columnas (en móvil se apilan). A la izquierda: una pastilla de anuncio, un H1 grande en unas 3 líneas, un subtítulo gris corto, el CTA primario en píldora rellena y el secundario en píldora blanca con borde. A la derecha: una tarjeta con esquinas muy redondeadas y fondo suave, con capturas de la app superpuestas en capas.
     - Cada sección abre con una etiqueta pequeña centrada en píldora, un título centrado en unas 2 líneas y un subtítulo gris.
     - Funciones: grilla de 2 columnas (1 en móvil) con tarjetas que llevan una captura de la UI arriba y debajo un título y una descripción corta.
     - Beneficios o «¿por qué Yoyos?»: grilla de 3×2 (1 columna en móvil) de tarjetas pequeñas con borde fino, cada una con un ícono en un cuadrado redondeado, un título y una línea de texto.
     - Precio: en la referencia hay un switch mensual/anual y 3 planes; en Yoyos va **una sola tarjeta destacada** de S/ 50 al mes + IGV, sin switch.
     - Bordes finos grises, sombras mínimas, esquinas de 12 a 16 px y mucho espacio entre secciones.
   - **Adaptaciones obligatorias:** mobile first; en lugar del dashboard de ejemplo, capturas reales de la app de Yoyos (pedidos, checkout y rótulos); mientras no estén, se usan marcadores de imagen claramente identificados como provisionales. No se muestran logos de clientes ni prueba social inventada, así que se omite la fila de logos del hero. Los logos de Shalom, Olva, Yape y Plin sí se pueden usar donde los pone el contenido. Esta referencia no cambia ninguna decisión del contenido.
3. **Rendimiento.**
   - Lighthouse móvil de al menos 95 en Performance, Accessibility, Best Practices y SEO.
   - Core Web Vitals en verde: LCP menor a 2,5 s, CLS menor a 0,1 e INP menor a 200 ms.
   - Imágenes optimizadas con `astro:assets` (AVIF o WebP, tamaños responsivos y `width` y `height` explícitos).
   - Fuentes autoalojadas con `font-display: swap` y precarga solo de la principal.
   - Sin scripts de terceros que bloqueen el render.
   - Presupuesto de la propuesta de Marketing:
     - HTML, CSS y JS críticos de hasta 100 KB gzip, y JS total de hasta 50 KB.
     - Primera vista de hasta 500 KB.
     - LCP de hasta 2,5 s con Slow 4G móvil (meta interna de 2,0 s) y TTFB de hasta 0,8 s.
     - El LCP del hero tiene `fetchpriority="high"` y preload si es una imagen.
     - Assets con hash y `Cache-Control` immutable.
4. **SEO técnico (la base; el contenido SEO lo define Marketing).**
   - Un componente de layout con title, meta description, canonical y Open Graph/Twitter por página, todo configurable por página.
   - `sitemap.xml` (con `@astrojs/sitemap`) y `robots.txt`.
   - Soporte para datos estructurados JSON-LD por página (Organization, WebSite y SoftwareApplication), con valores que se completan desde el contenido.
   - HTML semántico, con un solo `h1` por página y una jerarquía de encabezados correcta.
   - `lang="es-PE"`, favicon y manifest.
   - Página 404 propia.
   - La indexación es configurable por variable de entorno: si está desactivada, todas las páginas llevan `<meta name="robots" content="noindex, nofollow">` y `robots.txt` bloquea el rastreo. El valor para `landing.yoyos.lat` se decide en la tarea de despliegue.
5. **Accesibilidad.** WCAG AA: contraste, foco visible, navegación con teclado y textos alternativos.
6. **Responsive y mobile first.** Se revisa en 360, 768 y 1280 px de ancho.
7. **Llamadas a la acción.** Las URLs de registro e inicio de sesión de la app y el contacto de ventas se configuran por variable de entorno, no se escriben en el código.
   - **WhatsApp de ventas:** por variable de entorno; hoy el valor es `+51977909427`.
   - **Botón de llamada:** sí va, con un enlace `tel:` y el teléfono en su propia variable de entorno, que por defecto toma el mismo número de WhatsApp.
   - Las variables quedan documentadas en un `.env.example` de `/landing`.
8. **Analítica.** Queda preparada para enchufar una herramienta liviana y respetuosa de la privacidad, pero no se activa ninguna que cueste dinero sin el OK de Jorge.
9. **Formulario «Agenda una demo» (CTA secundario).** Los campos, las opciones y los textos son los del contenido. Lleva el checkbox de consentimiento (Ley 29733), que enlaza a `/privacidad`, y un honeypot contra spam. Funciona sin JS (POST nativo). La URL a la que se envía sale de una variable de entorno; si está vacía, el formulario no se muestra y queda solo el CTA de WhatsApp. El endpoint que manda los leads al CRM es la tarea 6hphgH8GpgFhjvgV.
10. **URL del sitio.** La URL canónica (sitemap, canonical y Open Graph) sale de una variable de entorno; para la primera prueba es `https://landing.yoyos.lat`. Esta tarea no despliega nada ni configura Cloudflare.

### Contenido

La fuente única del contenido y del SEO son los comentarios de esta tarea, «Contenido y SEO de la landing de Yoyos (versión vigente)», en varias partes, basados en el copy v2.0 y el handoff v2.0 de Marketing. Ahí van el copy literal de Marketing y lo técnico: metadatos, variables de entorno, JSON-LD, sitemap, robots, estructura de H1 y H2, CTA con eventos y presupuesto de rendimiento. Si algo de esta descripción choca con esos comentarios, mandan los comentarios. Decisiones de Jorge que ya están aplicadas ahí:
- **Solo fotos:** la landing no promete pedidos desde mensajes de texto.
- **Precio:** «S/ 50 al mes + IGV», con la nota «Los precios no incluyen IGV». En el JSON-LD: 50.00 PEN y `valueAddedTaxIncluded: false`. No hay prueba gratis ni piloto.
- **CTA:** «Escríbenos por WhatsApp» como principal, «Agenda una demo» como secundario y el botón de llamada.
- **Página `/privacidad`:** lleva la política de privacidad aprobada por Jorge (texto en los comentarios), con placeholders para razón social, RUC, domicilio y correo. Está en el sitemap y en el footer, y el consentimiento del formulario enlaza a ella. No se publica en producción sin la revisión final de Jorge.
- **Footer:** correo y redes como placeholders. No lleva RUC ni horario de atención.
- **Logos:** se pueden usar los de Shalom, Olva, Yape y Plin.
- **FAQ:** se publica «iPhone próximamente» con su FAQ, la del bloqueo del número y la de impresoras de etiquetas sin nombrar modelo. La FAQ 6 y los testimonios se implementan ocultos.
- **H2 final:** se usa la opción A.
- **«Ingresar»:** sale de una variable de entorno y se oculta si está vacía.
- **Regla:** ningún texto nombra a la competencia ni escribe limitaciones que Jorge no haya confirmado. La app se presenta como disponible para Android.

Lo que todavía no está (capturas reales, datos de la empresa, correo y redes) se implementa con marcadores claramente provisionales.

### Criterios de aceptación

- La app Astro vive en `/landing`, en la raíz del repo, compila de forma estática y está en el monorepo sin romper `apps/core` ni `apps/mobile`.
- Se cumplen los requisitos 1 a 10, con Lighthouse móvil de al menos 95 en las cuatro categorías.
- `sitemap.xml`, `robots.txt`, canonical, Open Graph y JSON-LD válidos, comprobados con el validador de Rich Results y el de schema.org.
- Con la indexación desactivada por variable de entorno, todas las páginas llevan `noindex` y `robots.txt` bloquea el rastreo; con la indexación activada, no.
- Las secciones del contenido (comentarios de esta tarea), incluida `/privacidad`, están implementadas tal como se definieron, con las FAQ y los testimonios ocultos donde se indica.
- El README explica cómo correrla y compilarla localmente, y qué variables de entorno usa.
- El WhatsApp, el teléfono de llamada y la URL del sitio salen de variables de entorno, sin números ni dominios escritos en el código.
- Pasan lint, typecheck y el build en CI.

### Dependencias

- Ninguna bloqueante. El contenido ya está en los comentarios de esta tarea.

### Cómo verificarla

- Correr `astro build` y servir la carpeta `dist`.
- Pasar Lighthouse en móvil.
- Validar el sitemap, `robots.txt` y el JSON-LD.
- Revisar la landing en 360, 768 y 1280 px y navegarla con teclado.
- Compilar con la indexación activada y desactivada, y comprobar el `noindex` y el `robots.txt` en cada caso.

### Fuera de alcance

- Blog o CMS, salvo que Marketing lo pida en el contenido.
- El endpoint que recibe el formulario y crea el lead en el CRM, que es la tarea 6hphgH8GpgFhjvgV.
- Cambios en `apps/core` o en el checkout.
- Desplegar, configurar Cloudflare o tocar DNS: va en la tarea aparte de despliegue (6hphXQVM879x2R2V).
- Mergear sin el OK de Jorge.

## Parte B. Contenido y SEO (comentarios de Todoist, partes 1 a 7)

### Contenido y SEO de la landing de Yoyos (versión vigente, v2.0, 21-oct-2026)

> Reemplaza la propuesta en borrador. Si Marketing entrega un copy final, esta versión se reemplaza por esa.
> - Base: copy final de Marketing v2.0 DEFINITIVA (copy literal) y handoff técnico v2.0 (SEO, variables y CTA), con las decisiones de Jorge aplicadas. Los requisitos técnicos están en la descripción de la tarea.
> - **Cómo leerlo:** el texto entre comillas «…» es **literal** y va tal cual en la página. `{VARIABLE}` es un valor que sale de una variable de entorno; nada de dominios ni números en duro. «[Por completar: …]» es un hueco que la implementación deja listo. En la política de privacidad (§14) los placeholders van en mayúsculas entre corchetes, como los dejó Marketing.
> - **Versión de lanzamiento: solo fotos.** El pedido se arma cuando el cliente manda la foto del producto.
> - **Ocultos** (se implementan, pero no se renderizan): la FAQ 6 y el bloque de testimonios. Las FAQ 9, 10 y 11 son visibles.
> - **`/privacidad`:** texto aprobado por Jorge. La página se implementa, pero no se publica en producción sin la revisión final de Jorge.
> - Referencia de diseño (solo estilo, descrita en la tarea): https://dribbble.com/shots/26360891-SaaS-Website-Landing-Page
> - Módulo: `/landing`, en la raíz del repo. Páginas: `/`, `/privacidad` y la 404. **Idioma:** es-PE. **Tono:** cercano, peruano, de tú, **siempre al vendedor en singular**.

---

#### Reglas de copy (no negociables)
- **Solo fotos:** el pedido se arma cuando el cliente manda la foto del producto, y eso es lo único que se promete en el copy, la meta, el OG y el JSON-LD. Tampoco se escriben limitaciones al respecto; simplemente se habla de las fotos.
- No nombrar a ningún competidor. Nada de "gratis", "prueba", "piloto" ni "acceso anticipado".
- Precio: «S/ 50 al mes + IGV», suscripción mensual, un solo plan, sin comisión por venta. Los precios no incluyen IGV.
- **iPhone:** «Disponible para Android. iPhone próximamente.» Nunca negar el iPhone. No mencionar App Store.
- Siempre al vendedor en singular. Nada de "equipo", "roles" ni "varios vendedores".
- **Vocabulario prohibido:** la palabra «oficial»; "partner de Meta", "sin riesgo", "100 % seguro" y "tu número nunca será bloqueado"; absolutos como "cualquier mensaje" o "sin copiar un solo dato"; promesas sobre audios, pies de foto, tallas o grupos.
- El link de checkout **lo comparte el vendedor**.
- **Regla de Jorge:** lo que no está implementado no se promete ni se escribe como limitación.
- **El copy no afirma nada, ni a favor ni en contra,** sobre: vincular WhatsApp con un solo celular; WhatsApp Business; vistos azules; costo de envío antes del pago; distribución en Android; noindex de la app; búsqueda visual en producción.
- Rótulos: «Imprime los rótulos de tus envíos en lote desde la app», sin modelos de impresora. El rótulo no reemplaza la guía de la agencia.
- Sin cifras de tiempo de arranque. No se inventan testimonios ni métricas.

---

#### 0. Metadatos
- **Title (58 car.):** «Sistema de pedidos por WhatsApp para emprendedores | Yoyos»
- **Meta description (150 car.):** «Tus clientes te mandan la foto por WhatsApp y Yoyos arma el pedido. Cobra con Yape o Plin y envía por Shalom u Olva. S/ 50 al mes + IGV, sin comisión.»
- **og:description:** igual a la meta.
- **twitter:description (107 car.):** «Fotos de WhatsApp convertidas en pedidos, cobro con Yape o Plin y envíos Shalom u Olva. S/ 50 al mes + IGV.»
- El `<head>` completo, el JSON-LD, el sitemap y el robots están en la sección 17.

---

#### 1. Header (fijo)
- Logo: imagen del logo Yoyos · **alt:** «Yoyos» · enlaza a `/`
- Navegación (anclas): «Cómo funciona» → `#como-funciona` · «Funciones» → `#funciones` · «Envíos y pagos» → `#integraciones` · «Precio» → `#precio` · «Preguntas» → `#preguntas`
- Botón primario: «Escríbenos por WhatsApp» → `WHATSAPP_URL` (evento `whatsapp_click`, location `header`)
- Botón o ícono: «Llámanos» → `TEL_URL` (evento `call_click`, location `header`) · **aria-label:** «Llamar a Yoyos al {PUBLIC_PHONE_DISPLAY}»
- «Ingresar» → `{PUBLIC_APP_LOGIN_URL}` (login de la app). Si la variable está vacía, el link no se muestra.
- Menú móvil: «Menú» · **aria-label:** «Abrir menú» / «Cerrar menú»

---

#### 2. Hero (`#inicio`)
- **Etiqueta (eyebrow):** «Hecho para vendedores de TikTok LIVE en Perú»
- **H1:** «Sistema de pedidos por WhatsApp para vendedores de TikTok LIVE»
- **Bajada:** «Automatizamos las ventas por redes sociales: tus clientes te escriben por WhatsApp como siempre y, cuando te mandan la foto del producto, Yoyos arma el pedido para que dejes de copiar pedidos a mano. Tú vendes, nosotros operamos.»
- **Botón primario:** «Escríbenos por WhatsApp» (location `hero`)
- **Botón secundario:** «Agenda una demo» → `#demo` (evento `demo_form_open`, location `hero`). Si el formulario está oculto, el botón no se muestra.
- **Link de llamada:** «¿Prefieres hablar? Llámanos» (location `hero`)
- **Microcopy bajo los botones:** «Disponible para Android. iPhone próximamente. S/ 50 al mes + IGV, sin comisión por venta.»
- **Imagen (LCP):** mockup de un celular con un chat de WhatsApp. El cliente envía la foto de unas zapatillas y al lado aparece la tarjeta del pedido. No muestra tallas ni audios.
  - **alt:** «Chat de WhatsApp en el que un cliente envía la foto de unas zapatillas y Yoyos la convierte en un pedido con su total»
  - [Por completar: mockup basado en la app real. Mientras tanto, marcador de imagen identificado como provisional.]

---

#### 3. Propuesta de valor (franja de 3 ítems, sin H2)
1. **Título:** «Te mandan la foto, Yoyos arma el pedido»
   **Texto:** «Tu cliente te manda la foto del producto por WhatsApp y Yoyos arma el pedido.» · Ícono **alt:** «» (decorativo)
2. **Título:** «Un link para cerrar la venta»
   **Texto:** «Compartes con tu cliente el link de su pedido: confirma sus datos, elige cómo recibirlo y paga desde su celular, sin crear cuenta.»
3. **Título:** «Despacho en orden»
   **Texto:** «Zonas de envío, agencias Shalom y Olva, recojo en tienda y rótulos para tus paquetes.»
- **Frase de cierre:** «Tú vendes, nosotros operamos.»

---

#### 4. Problema (`#problema`)
- **H2:** «¿Terminó tu live y tu WhatsApp es un caos?»
- **Bullets:**
  - «Copias cada pedido a mano en el cuaderno o el Excel.»
  - «Te mandan capturas del live y tienes que adivinar qué producto era.»
  - «Pides la dirección y el distrito una y otra vez.»
  - «Revisas mil capturas de Yape para saber quién ya pagó.»
  - «Escribes cada rótulo a mano antes de ir a la agencia.»
- **Cierre:** «Vender en vivo ya es bastante trabajo. Lo demás déjalo en orden.»

---

#### 5. Beneficios (`#beneficios`)
- **H2:** «Gestión de pedidos por WhatsApp sin copiar a mano»
- **Bajada:** «Vende en tu live y deja que Yoyos ordene lo demás.»
- Tarjetas:
  1. «**Menos tiempo copiando pedidos.** Cuando tu cliente te manda la foto del producto, Yoyos arma el pedido.»
  2. «**Menos errores en el envío.** Tu cliente elige su departamento, provincia y distrito de una lista, y su agencia de destino. Nada de direcciones a medias.»
  3. «**Cobros claros.** Ves qué pedidos tienen pago reportado y cuáles ya verificaste.»
  4. «**Tu marca en cada link.** Catálogo y checkout con tu logo y tu color.»
  5. «**En tu celular y en la compu.** App para Android, iPhone próximamente, y versión web, con modo oscuro para tus lives de noche.»

#### 6. Cómo funciona (`#como-funciona`)
- **H2:** «Cómo funciona Yoyos en 5 pasos»
1. **H3:** «Sube tus productos»
   «Agrega cada producto con su foto y su precio, desde la web o la app. La foto es la que Yoyos usa para reconocer el producto. Si quieres, imprime su etiqueta QR desde la app.»
2. **H3:** «Configura tus entregas y tus datos de pago»
   «Define tus zonas y precios de envío (a domicilio, por agencia Shalom u Olva o recojo en tienda) y agrega tus datos de Yape, Plin o transferencia.»
3. **H3:** «Vincula tu WhatsApp»
   «Abre la app de Yoyos en tu Android y escanea el QR con tu WhatsApp, desde Dispositivos vinculados, como en WhatsApp Web.»
4. **H3:** «Recibe pedidos»
   «Cuando tu cliente te manda la foto del producto, Yoyos arma el pedido. Tu cliente también puede comprar desde tu catálogo, que compartes en Instagram, TikTok o WhatsApp.»
5. **H3:** «Cobra y despacha»
   «Comparte el link del pedido con tu cliente: confirma sus datos, elige cómo recibirlo (a domicilio, en agencia Shalom u Olva o con recojo en tienda) y paga con Yape, Plin o transferencia subiendo su comprobante. Tú verificas el pago e imprimes el rótulo desde la app.»
- **alt de las imágenes de los pasos (si se usan):**
  1. «Pantalla de Yoyos para crear un producto con foto y precio»
  2. «Configuración de zonas de envío y datos de pago con Yape, Plin o transferencia»
  3. «Código QR en la app de Yoyos para vincular WhatsApp desde Dispositivos vinculados»
  4. «Pedido creado a partir de la foto que envió un cliente por WhatsApp»
  5. «Link del pedido con opciones de entrega a domicilio, agencia o recojo y pago con Yape o Plin»
  - [Por completar: capturas reales de la app. Mientras tanto, marcadores provisionales.]

---

#### 7. Funciones (`#funciones`)
- **H2:** «Todo para vender por WhatsApp, Instagram y TikTok LIVE»
- Tarjetas (H3 + texto; grilla de 2 columnas con captura arriba):
  1. «**Pedidos desde las fotos de WhatsApp.** Cuando tu cliente te manda la foto del producto, Yoyos arma el pedido en ese chat.»
  2. «**Búsqueda de productos por imagen o QR.** ¿Te mandaron una captura del live? Yoyos encuentra el producto en tu catálogo por su etiqueta QR o por la imagen.»
  3. «**Catálogo para compartir.** Un link con tus productos, buscador y carrito, listo para tu bio de Instagram o TikTok y tus estados de WhatsApp.»
  4. «**Checkout con zonas y distritos.** Defines tus zonas y precios de envío por departamento, provincia o distrito, y tu cliente ve el costo según dónde vive.»
  5. «**Cobros con Yape, Plin o transferencia.** Tu cliente ve tus datos de pago, sube su comprobante y tú lo verificas.»
  6. «**Rótulos para tus envíos.** Imprime los rótulos de tus envíos en lote desde la app. La guía la sigues sacando en la agencia.»

---

#### 8. Envíos y pagos (`#integraciones`)
- **H2:** «Envíos por agencias Shalom y Olva, cobros con Yape y Plin»
- **Bajada:** «Funciona con lo que ya usas.»
- Ítems:
  - «**WhatsApp.** Vinculas tu WhatsApp desde la app, como en WhatsApp Web. Tus clientes te siguen escribiendo como siempre.»
  - «**Shalom y Olva.** Configura envíos a agencias Shalom y Olva. Tu cliente elige la sede de destino y tú imprimes el rótulo. La guía la sigues sacando en la agencia.»
  - «**Recojo en tienda.** Si tu cliente prefiere recoger, también puede elegirlo.»
  - «**Yape, Plin y transferencia.** Muestra tus datos de cobro y recibe el comprobante en cada pedido.»
- **Logos (autorizados por Jorge):** Shalom, Olva, Yape y Plin, en SVG o PNG optimizado, monocromos o a color según la marca.
  - **alt:** «Logo de Shalom» · «Logo de Olva» · «Logo de Yape» · «Logo de Plin»
  - WhatsApp va como texto o ícono genérico de chat (su logo no está en la autorización).
- **Nota al pie (texto pequeño):** «WhatsApp, Shalom, Olva, Yape y Plin son marcas de sus respectivos dueños. Yoyos no está afiliado a ellas.»

---

#### 9. Prueba social
- **Visible:** franja «Hecho para vendedores de TikTok LIVE en Perú» (opcional, para no repetir el eyebrow).
- **Bloque de testimonios (`#testimonios`): OCULTO.** Se implementa el componente, pero no se renderiza mientras `testimonials.length === 0`.
  - H2 cuando haya datos: «Vendedores de TikTok LIVE que ya ordenan sus pedidos con Yoyos».
  - Cada testimonio: cita, nombre, negocio, rubro, ciudad y foto con permiso · [Por completar: testimonios reales con permiso]. Sin métricas ni cifras.

---

#### 10. Precio (`#precio`)
- **H2:** «Un solo precio: S/ 50 al mes + IGV. Sin comisión por venta.»
- **Tarjeta única destacada (sin switch mensual/anual):**
  - Nombre: «Yoyos»
  - Precio: «S/ 50» + «/ mes + IGV»
  - Nota bajo el precio: «Los precios no incluyen IGV.»
  - Subtexto: «Suscripción mensual. Sin comisión por tus ventas y sin pagos únicos.»
  - Lista «Incluye»:
    - «Pedidos desde las fotos de WhatsApp»
    - «Búsqueda de productos por imagen o QR»
    - «Catálogo para compartir»
    - «Checkout con zonas y distritos del Perú»
    - «Cobros con Yape, Plin o transferencia»
    - «Envíos a agencias Shalom y Olva, y recojo en tienda»
    - «Rótulos para tus envíos, impresos en lote desde la app»
    - «App para Android (iPhone próximamente) y versión web»
  - Botón primario: «Escríbenos por WhatsApp» (location `precio`)
  - Botón secundario: «Agenda una demo» → `#demo` (evento `demo_form_open`, location `precio`)
  - Microcopy: «En la demo te ayudamos a dejar Yoyos listo con tus productos.»

#### 11. Preguntas frecuentes (`#preguntas`)
- **H2:** «Preguntas frecuentes» · Formato: acordeón `<details>` nativo (H3 = pregunta, 0 JS). Evento `faq_open` (prop `q`: número).
- **Visibles: 1, 2, 3, 4, 5, 7, 8, 9, 10 y 11.** La 6 queda oculta (se implementa con un flag, no se renderiza y no va en el JSON-LD).

1. **«Ya lo manejo con WhatsApp y un Excel.»**
   «¡Perfecto, sigue usando WhatsApp! Yoyos no te cambia la forma de vender: tus clientes te escriben como siempre. Lo que te ahorras es pasar cada pedido del chat al Excel: cuando te mandan la foto del producto, Yoyos arma el pedido, y tu cliente completa su dirección y elige el envío en el link que tú le compartes.»
2. **«No tengo tiempo de aprender otra app.»**
   «Lo entendemos: entre lives y despachos no te sobra tiempo. Por eso Yoyos se usa desde tu celular, junto al WhatsApp que ya tienes. En la demo te ayudamos a dejar Yoyos listo con tus productos.»
3. **«¿Cuánto cuesta?»**
   «S/ 50 al mes + IGV. Es una suscripción mensual: no cobramos comisión por tus ventas ni hay pagos únicos. Escríbenos por WhatsApp y te mostramos cómo funciona con tus productos.»
4. **«Hay herramientas gratis que hacen algo parecido.»**
   «Hay opciones gratis que te dan un catálogo o una lista de pedidos. Yoyos va más allá: arma el pedido desde la foto que te manda tu cliente por WhatsApp, cotiza el envío por zona y distrito, te da un link para compartir con tu cliente donde elige agencia Shalom u Olva, domicilio o recojo y sube su comprobante de Yape o Plin, y te deja imprimir los rótulos. Te ahorra trabajo en todo el camino, del chat al despacho.»
5. **«¿Mis clientes tienen que bajar otra app?»**
   «Tus clientes no necesitan bajar nada. Te siguen escribiendo por WhatsApp y, cuando el pedido está listo, les mandas un link para confirmar sus datos y pagar desde el celular, sin crear cuenta.»
6. **«¿Qué pasa con mis datos y los de mis clientes?»** (OCULTA)
   [Por completar: respuesta basada en la política de datos de la app. La política de `/privacidad` cubre solo el formulario de la landing.]
7. **«Vendo poco, todavía no lo necesito.»**
   «Justo cuando empiezas es el mejor momento para ordenarte. Cada pedido que copias a mano del chat al cuaderno, cada dirección que vuelves a pedir y cada captura de Yape que buscas te quitan tiempo que podrías usar para vender. Y cuando un live te va bien, ya tienes todo listo para atender más pedidos sin enredarte.»
8. **«¿Sirve con Yape y Plin?»**
   «Sí. Puedes cobrar con Yape, Plin o transferencia bancaria. Tu cliente ve tus datos de pago en el link del pedido y sube su comprobante, y tú lo verificas.»
9. **«¿Necesito una impresora especial para los rótulos?»**
   «Yoyos imprime en impresoras de etiquetas y estamos sumando más modelos. En la demo te decimos cuál te conviene.»
10. **«¿Funciona en iPhone?»**
    «Yoyos está disponible para Android y en la web, y la app para iPhone viene en camino.»
11. **«¿Me pueden bloquear el número?»**
    «Yoyos se conecta a tu WhatsApp como un dispositivo vinculado, igual que WhatsApp Web, y solo lee los mensajes que te llegan: no envía mensajes, no hace envíos masivos ni escribe en grupos. Yoyos no es un servicio de WhatsApp ni de Meta, así que no podemos garantizar que WhatsApp nunca aplique restricciones, pero Yoyos no hace las acciones que suelen motivarlas, como el spam o los mensajes masivos. Puedes desvincular Yoyos cuando quieras desde la app o desde WhatsApp > Dispositivos vinculados.»

---

#### 12. CTA final + formulario (`#demo`)
- **H2:** «Tu próximo live, con los pedidos en orden» (opción A, definitiva).
- **Bajada:** «Escríbenos por WhatsApp o llámanos, y en la demo te ayudamos a dejar Yoyos listo con tus productos. S/ 50 al mes + IGV, sin comisión por venta.»
- **Botón primario:** «Escríbenos por WhatsApp» (location `cta_final`)
- **Botón de llamada:** «Llámanos» (location `cta_final`) + número visible «{PUBLIC_PHONE_DISPLAY}».
- **Separador:** «o agenda una demo»

##### Formulario «Agenda una demo» (CTA secundario)
- Se envía por POST nativo (funciona sin JS) a `{PUBLIC_DEMO_FORM_ACTION}`. **Si la variable está vacía, el formulario no se muestra** (tampoco el separador ni los botones «Agenda una demo») y quedan solo WhatsApp y la llamada.
- **Título (H3):** «Agenda una demo»
- **Texto:** «Déjanos tus datos y te contactamos para mostrarte Yoyos.»

| # | Campo (`name`) | Tipo | Label | Placeholder / opciones | Obligatorio | Mensaje de error |
|---|---|---|---|---|---|---|
| 1 | `nombre` | text, `autocomplete="name"` | «Tu nombre» | «Ej.: Rosa Quispe» | Sí | «Escribe tu nombre.» |
| 2 | `telefono` | tel, `inputmode="tel"`, `autocomplete="tel-national"`, prefijo fijo «+51» | «Tu WhatsApp o celular» | «9XX XXX XXX» | Sí (9 dígitos, empieza con 9: `^9\d{8}$`; se envía como `+51…`) | «Escribe un celular de 9 dígitos que empiece con 9.» |
| 3 | `rubro` | select | «¿Qué vendes?» | Inicial: «Elige una opción». Opciones: «Ropa» · «Zapatillas» · «Joyería y accesorios» · «Mascotas» · «Cosméticos» · «Otro» | Sí | «Elige qué vendes.» |
| 4 | `contacto_preferido` | radio | «¿Cómo prefieres que te contactemos?» | «Por WhatsApp» (`whatsapp`, marcado por defecto) · «Por llamada» (`llamada`) | Sí | «Elige cómo te contactamos.» |
| 5 | `consentimiento` | checkbox **obligatorio, desmarcado por defecto** | Ver texto abajo | — | Sí | «Para enviar tus datos necesitamos que aceptes la Política de privacidad.» |
| — | `website` | honeypot oculto | (sin label visible; `aria-hidden`, `tabindex="-1"`) | — | No | — |
| — | `consent_text_version` | hidden | — | p. ej. `privacidad-v1-2026-10` | — | — |

- **Label del checkbox de consentimiento (literal):**
  «He leído la [Política de privacidad] y autorizo a Yoyos a usar mis datos (nombre, celular, rubro y forma de contacto) para contactarme por WhatsApp o llamada sobre la demo y la oferta comercial de Yoyos.»
  - «Política de privacidad» es un link a `/privacidad`, que se abre en otra pestaña: `target="_blank" rel="noopener"`.
- **Texto informativo bajo el botón (literal, letra pequeña):** «Tus datos se guardan en nuestro sistema de gestión de clientes y solo los usamos para contactarte sobre Yoyos. Puedes pedir que los corrijamos o borremos, o dejar de recibir contacto, escribiéndonos por WhatsApp o a {PUBLIC_CONTACT_EMAIL}. Más detalles en nuestra [Política de privacidad].»
  - Si `PUBLIC_CONTACT_EMAIL` está vacía, la frase dice «escribiéndonos por WhatsApp».
- **Botón de envío:** «Agendar mi demo» · en envío: «Enviando…». El botón queda habilitado; si falta el consentimiento, se muestra el error del campo.
- **Mensaje de éxito:** «¡Listo! Te contactaremos pronto por {WhatsApp | llamada}. Si prefieres no esperar, escríbenos por WhatsApp.» (con el link de WhatsApp). Se muestra al volver a `/?demo=ok#demo`.
- **Mensaje de error general:** «No pudimos enviar tus datos. Inténtalo de nuevo o escríbenos por WhatsApp.»
- Eventos: `demo_form_submit` (props `rubro`, `contacto_preferido`; **sin datos personales**) y `demo_form_error` (prop `reason`), location `cta_final`.

---

#### 13. Footer
- Logo **alt:** «Yoyos»
- **Frase:** «Sistema de pedidos por WhatsApp para emprendedores que venden por redes en Perú.»
- **Columna "Producto":** «Cómo funciona» · «Funciones» · «Precio» · «Preguntas» · «Ingresar» (→ `{PUBLIC_APP_LOGIN_URL}`; se oculta si está vacía)
- **Columna "Contacto":**
  - «WhatsApp: {PUBLIC_PHONE_DISPLAY}» (`WHATSAPP_URL`, location `footer`)
  - «Llámanos: {PUBLIC_PHONE_DISPLAY}» (`TEL_URL`, location `footer`)
  - «Correo: {PUBLIC_CONTACT_EMAIL}» [Por completar: correo de Yoyos; se oculta si la variable está vacía]
- **Redes:** «TikTok» → `{PUBLIC_TIKTOK_URL}` · «Instagram» → `{PUBLIC_INSTAGRAM_URL}` [Por completar: URLs de las redes de Yoyos; cada una se oculta si su variable está vacía]
- **Legal:**
  - «Política de privacidad» → `/privacidad`
  - «Términos y condiciones» → [Por completar: URL]. Oculto mientras no exista.
  - «Libro de Reclamaciones» → [Por completar: URL]. Oculto mientras no exista.
- **Línea final:** «© 2026 Yoyos. Hecho en Perú.» (sin razón social ni RUC)
- **Aviso de marcas:** «WhatsApp, Shalom, Olva, Yape y Plin son marcas de sus respectivos dueños.»

#### 14. Página de privacidad (`/privacidad`)
- Página aparte en `src/pages/privacidad.astro`, con el layout de la landing (header y footer), un solo H1 y `lang="es-PE"`.
- **Texto aprobado por Jorge.** La página se implementa, pero **no se publica en producción sin la revisión final de Jorge**.
- **Title:** «Política de privacidad | Yoyos» · **Meta description:** «Cómo Yoyos trata los datos que nos dejas en el formulario de demo: para qué los usamos, cuánto tiempo los guardamos y cómo ejercer tus derechos.» · canonical `{SITE}/privacidad`. Va en el sitemap y en el footer, y la enlaza el checkbox del formulario.
- Los datos entre corchetes en mayúsculas son placeholders que se completan antes de publicar. `[CORREO]` sale de `PUBLIC_CONTACT_EMAIL` y el WhatsApp de `PUBLIC_PHONE_DISPLAY`.

##### Texto literal de la página

**H1:** «Política de privacidad»

**Última actualización:** [FECHA DE PUBLICACIÓN]

En Yoyos cuidamos tus datos. Esta política explica qué datos recogemos en el formulario «Agenda una demo» de esta web, para qué los usamos, con quién los compartimos, cuánto tiempo los guardamos y cómo puedes ejercer tus derechos. Se rige por la Ley N.º 29733, Ley de Protección de Datos Personales, y su Reglamento, aprobado por Decreto Supremo N.º 016-2024-JUS.

Esta política aplica **solo a esta página web y a su formulario**. El uso de la app de Yoyos tiene sus propias condiciones.

###### 1. ¿Quién es responsable de tus datos?
El titular del banco de datos personales y responsable del tratamiento es:
- **Razón social:** [RAZÓN SOCIAL]
- **RUC:** [RUC]
- **Domicilio:** [DOMICILIO]
- **Correo para temas de privacidad:** [CORREO]
- **WhatsApp:** {PUBLIC_PHONE_DISPLAY}

En esta política, «Yoyos», «nosotros» o «nos» se refiere a [RAZÓN SOCIAL].

###### 2. ¿Qué datos recogemos?
Cuando llenas el formulario «Agenda una demo», nos das:
- **Tu nombre.**
- **Tu número de WhatsApp o celular.**
- **Qué vendes** (rubro).
- **Cómo prefieres que te contactemos** (WhatsApp o llamada).
- **Tu autorización** (consentimiento), junto con la fecha y la hora en que la diste.

Todos los campos son obligatorios: sin ellos no podemos contactarte para la demo. Si no quieres darlos, no podremos atender tu solicitud por el formulario, pero igual puedes escribirnos por WhatsApp o llamarnos.

Para proteger el formulario del spam usamos medidas técnicas que distinguen personas de bots.

No recogemos datos sensibles. Este formulario no está dirigido a menores de edad.

###### 3. ¿Para qué usamos tus datos?
1. **Contactarte para la demo:** llamarte o escribirte por WhatsApp para coordinar y mostrarte Yoyos.
2. **Gestión comercial:** hacer seguimiento de tu interés, responder tus consultas y enviarte información sobre Yoyos (planes, precio y novedades del servicio), por WhatsApp o llamada.

No usamos tus datos para tomar decisiones automatizadas ni para elaborar perfiles. No los vendemos ni los cedemos a terceros para que hagan su propia publicidad.

###### 4. ¿Con qué base usamos tus datos?
Con tu **consentimiento**, que nos das al marcar la casilla del formulario. El consentimiento es libre, previo, expreso, informado e inequívoco.

Puedes **revocarlo cuando quieras**, de forma sencilla y gratuita, escribiéndonos por WhatsApp o a [CORREO]. Revocarlo no afecta lo que hicimos antes con tus datos.

Si nos pides no recibir más información comercial, lo atendemos en un plazo máximo de 10 días hábiles.

###### 5. ¿Cuánto tiempo guardamos tus datos?
- **Si no contratas Yoyos:** guardamos tus datos hasta **12 meses** desde nuestro último contacto contigo, y luego los borramos.
- **Si contratas Yoyos:** tus datos pasan a regirse por las condiciones del servicio.
- **Si revocas tu consentimiento o pides que los borremos:** los eliminamos, salvo que una ley nos obligue a conservarlos.

###### 6. ¿Quién más trata tus datos? (encargados y transferencias)
Para operar usamos proveedores que tratan tus datos por encargo nuestro, solo para las finalidades de esta política:

| Proveedor | Para qué | Dónde |
|---|---|---|
| **Twenty** (sistema de gestión de clientes, CRM) | Guardar tu solicitud y hacer el seguimiento comercial | [UBICACIÓN DEL SERVIDOR DEL CRM] |
| [PROVEEDOR DE ALOJAMIENTO DE LA WEB] | Alojar esta web y, si aplica, medir visitas sin cookies | [PAÍSES DE LOS SERVIDORES] |
| **WhatsApp (Meta)** | Canal por el que te escribimos si eliges WhatsApp | Según las condiciones de WhatsApp |

- **Flujo transfronterizo:** como algunos de estos proveedores tienen servidores fuera del Perú, tus datos pueden salir del país. Lo hacemos con las garantías que exigen la Ley N.º 29733 y su Reglamento.
- **Otros casos:** no transferimos tus datos a otros terceros, salvo que una autoridad competente lo pida conforme a ley.

###### 7. Tus derechos (ARCO y otros)
Tienes derecho a:
- **Información:** saber cómo y para qué tratamos tus datos.
- **Acceso:** saber qué datos tuyos tenemos.
- **Rectificación (y actualización):** corregir datos inexactos o incompletos.
- **Cancelación (supresión):** pedir que borremos tus datos.
- **Oposición:** oponerte a que usemos tus datos, por ejemplo para la gestión comercial.
- **Tratamiento objetivo** y **portabilidad**, en los términos de la ley.
- **Revocar tu consentimiento** cuando quieras.

**Cómo ejercerlos:** escríbenos a [CORREO] o por WhatsApp al {PUBLIC_PHONE_DISPLAY}. Tu solicitud debe incluir:
- tu nombre;
- copia de tu DNI o documento equivalente (o el documento que acredite a tu representante);
- qué pides;
- un correo o dirección para responderte;
- la fecha.

Es gratis.

**Plazos máximos de respuesta (Reglamento, art. 69), en días hábiles desde el día siguiente a tu solicitud:**

| Derecho | Plazo |
|---|---|
| Información | 8 días |
| Acceso | 20 días |
| Rectificación, cancelación u oposición | 10 días |

Salvo el de información, estos plazos pueden ampliarse una vez por el mismo plazo si se justifica, y te lo avisaríamos.

Si no te respondemos o no estás de acuerdo con la respuesta, puedes presentar un reclamo ante la **Autoridad Nacional de Protección de Datos Personales** (ANPD) del Ministerio de Justicia y Derechos Humanos.

###### 8. Banco de datos
Tus datos se guardan en el banco de datos personales «[NOMBRE DEL BANCO DE DATOS]», de titularidad de [RAZÓN SOCIAL], inscrito en el Registro Nacional de Protección de Datos Personales de la ANPD con el código [CÓDIGO DE INSCRIPCIÓN].

###### 9. Seguridad
Aplicamos medidas técnicas y organizativas para proteger tus datos:
- conexión cifrada (HTTPS);
- acceso al CRM solo para las personas de Yoyos que atienden demos;
- protección contra spam.

###### 10. Cookies y analítica
- Esta web **no usa cookies de publicidad**.
- Para saber cuántas personas la visitan podemos usar una herramienta de analítica **sin cookies**, que no identifica quién eres.
- El proveedor de alojamiento puede usar cookies técnicas, necesarias para la seguridad del sitio.
- Si en el futuro usamos cookies de analítica o publicidad, te pediremos permiso con un aviso antes de activarlas y actualizaremos esta sección.

###### 11. Cambios a esta política
Podemos actualizar esta política, por ejemplo si cambiamos de proveedor o si cambia la ley. Publicaremos la versión nueva en esta página con su fecha de actualización. Si el cambio afecta las finalidades para las que nos diste tu consentimiento, te lo pediremos de nuevo.

###### 12. Contacto
Para cualquier duda sobre tus datos: [CORREO] o WhatsApp {PUBLIC_PHONE_DISPLAY}.

---

#### 15. Página 404
- **H1:** «Esta página no existe»
- **Texto:** «Puede que el link esté mal escrito o que la página se haya movido.»
- **Botones:** «Volver al inicio» (→ `/`) · «Escríbenos por WhatsApp» (location `404`)
- `src/pages/404.astro` con status 404 real.

---

#### 16. Imagen Open Graph (1200×630)
- **Texto en la imagen:** «Tus pedidos de WhatsApp, en orden» + logo Yoyos
- **og:image:alt:** «Foto de un producto enviada por WhatsApp y convertida en pedido en Yoyos»
- PNG o JPG de menos de 300 KB. Probar la vista previa pegando el link en WhatsApp.

#### 17. SEO técnico y configuración

##### 17.1 Variables de entorno (documentadas en `/landing/.env.example`)
| Variable | Valor de ejemplo | Uso |
|---|---|---|
| `PUBLIC_SITE_URL` | `https://landing.yoyos.lat` | `site` en `astro.config.mjs`, canonical, hreflang, OG, JSON-LD, sitemap y robots |
| `PUBLIC_INDEXING` | `true` / `false` | Si es `false`: todas las páginas llevan `<meta name="robots" content="noindex, nofollow">` y `robots.txt` bloquea el rastreo. Si es `true`: `index, follow` |
| `PUBLIC_WHATSAPP_NUMBER` | `51977909427` | Link `wa.me`. Solo dígitos: código de país sin `+`, sin espacios |
| `PUBLIC_WHATSAPP_DEMO_TEXT` | `Hola, quiero una demo de Yoyos` | Texto prellenado de WhatsApp. Se codifica con `encodeURIComponent` |
| `PUBLIC_PHONE_NUMBER` | `+51977909427` | Link `tel:` y `telephone` del JSON-LD (E.164). Si está vacía, toma el número de WhatsApp |
| `PUBLIC_PHONE_DISPLAY` | `+51 977 909 427` | Número visible en la página, en `/privacidad` y en el aria-label de «Llámanos» |
| `PUBLIC_APP_LOGIN_URL` | (vacía por ahora) | Link «Ingresar» al login de la app. Si está vacía, se oculta |
| `PUBLIC_DEMO_FORM_ACTION` | (vacía por ahora) | URL del POST del formulario «Agenda una demo». Si está vacía, el formulario se oculta |
| `PUBLIC_CONTACT_EMAIL` | (vacía por ahora) | Correo del footer, del formulario, de `/privacidad` y `email` del JSON-LD. Si está vacía, se oculta |
| `PUBLIC_TIKTOK_URL` / `PUBLIC_INSTAGRAM_URL` | (vacías por ahora) | Redes del footer y `sameAs` del JSON-LD. Si están vacías, se ocultan |
| `PUBLIC_ANALYTICS_ENABLED` | `false` | Hook de analítica (§17.6). Desactivado por defecto |

> En Astro estático, las variables `PUBLIC_*` se resuelven **en el build**: si cambian, hay que volver a compilar.

```ts
// src/lib/contact.ts
const wa = import.meta.env.PUBLIC_WHATSAPP_NUMBER;          // "51977909427"
const text = import.meta.env.PUBLIC_WHATSAPP_DEMO_TEXT;     // "Hola, quiero una demo de Yoyos"
export const WHATSAPP_URL = `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
// → https://wa.me/51977909427?text=Hola%2C%20quiero%20una%20demo%20de%20Yoyos
const phone = import.meta.env.PUBLIC_PHONE_NUMBER || `+${wa}`;
export const TEL_URL = `tel:${phone}`;                      // tel:+51977909427
```

##### 17.2 Metadatos (`<head>`)
`{SITE}` = `PUBLIC_SITE_URL`. Todo es configurable por página desde el layout.
```html
<html lang="es-PE">
<title>Sistema de pedidos por WhatsApp para emprendedores | Yoyos</title>
<meta name="description" content="Tus clientes te mandan la foto por WhatsApp y Yoyos arma el pedido. Cobra con Yape o Plin y envía por Shalom u Olva. S/ 50 al mes + IGV, sin comisión.">
<link rel="canonical" href="{SITE}/">
<link rel="alternate" hreflang="es-PE" href="{SITE}/">
<link rel="alternate" hreflang="x-default" href="{SITE}/">
<meta name="robots" content="{index, follow | noindex, nofollow según PUBLIC_INDEXING}">
<meta name="theme-color" content="#F7F4EF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1C1B1D" media="(prefers-color-scheme: dark)">

<meta property="og:type" content="website">
<meta property="og:locale" content="es_PE">
<meta property="og:site_name" content="Yoyos">
<meta property="og:title" content="Sistema de pedidos por WhatsApp para emprendedores | Yoyos">
<meta property="og:description" content="Tus clientes te mandan la foto por WhatsApp y Yoyos arma el pedido. Cobra con Yape o Plin y envía por Shalom u Olva. S/ 50 al mes + IGV, sin comisión.">
<meta property="og:url" content="{SITE}/">
<meta property="og:image" content="{SITE}/og/yoyos-1200x630.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Foto de un producto enviada por WhatsApp y convertida en pedido en Yoyos">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Sistema de pedidos por WhatsApp | Yoyos">
<meta name="twitter:description" content="Fotos de WhatsApp convertidas en pedidos, cobro con Yape o Plin y envíos Shalom u Olva. S/ 50 al mes + IGV.">
<meta name="twitter:image" content="{SITE}/og/yoyos-1200x630.png">
```
- Title: 58 caracteres. Meta: 150. La meta y el OG hablan de las fotos.
- `/privacidad`: `<title>Política de privacidad | Yoyos</title>`, la meta de §14 y canonical `{SITE}/privacidad`; respeta `PUBLIC_INDEXING` igual que el resto.
- Canonical autorreferente en cada página, una sola versión (https, sin www) y sin parámetros UTM.
- Favicon, apple-touch-icon (ya existen en `apps/core/public/`) y `manifest.webmanifest`.

##### 17.3 JSON-LD (listo para pegar; los valores salen de las variables)
- `FAQPage` incluye las preguntas visibles: 1, 2, 3, 4, 5, 7, 8, 9, 10 y 11. La 6 queda oculta y fuera del JSON-LD.
- El texto tiene que coincidir con el que se ve en la página (§11). El precio tiene que coincidir con §10.
- `operatingSystem: "Android"`. En la página dice «iPhone próximamente»; se pasa a `"Android, iOS"` cuando la app de iPhone esté publicada.
- Precio: `UnitPriceSpecification` 50.00 PEN al mes con `valueAddedTaxIncluded: false`, que corresponde a «S/ 50 al mes + IGV».
- Sin `aggregateRating` ni `review`. La `description` habla de fotos.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "{SITE}/#organization",
      "name": "Yoyos",
      "url": "{SITE}/",
      "logo": "{SITE}/logo-512.png",
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "sales",
        "telephone": "{PUBLIC_PHONE_NUMBER}",
        "areaServed": "PE",
        "availableLanguage": "es"
      }
    },
    {
      "@type": "WebSite",
      "@id": "{SITE}/#website",
      "url": "{SITE}/",
      "name": "Yoyos",
      "inLanguage": "es-PE",
      "publisher": {
        "@id": "{SITE}/#organization"
      }
    },
    {
      "@type": "SoftwareApplication",
      "@id": "{SITE}/#app",
      "name": "Yoyos",
      "url": "{SITE}/",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Android",
      "description": "Sistema de pedidos por WhatsApp para emprendedores que venden por redes sociales en Perú: pedidos desde las fotos que te mandan por WhatsApp, catálogo, checkout con zonas, cobro con Yape, Plin o transferencia y rótulos para envíos por Shalom y Olva.",
      "inLanguage": "es-PE",
      "areaServed": "PE",
      "publisher": {
        "@id": "{SITE}/#organization"
      },
      "offers": {
        "@type": "Offer",
        "price": "50.00",
        "priceCurrency": "PEN",
        "availability": "https://schema.org/InStock",
        "url": "{SITE}/#precio",
        "priceSpecification": {
          "@type": "UnitPriceSpecification",
          "price": "50.00",
          "priceCurrency": "PEN",
          "billingDuration": "P1M",
          "valueAddedTaxIncluded": false,
          "referenceQuantity": {
            "@type": "QuantitativeValue",
            "value": 1,
            "unitCode": "MON"
          }
        }
      }
    },
    {
      "@type": "FAQPage",
      "@id": "{SITE}/#preguntas",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Ya lo manejo con WhatsApp y un Excel.",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "¡Perfecto, sigue usando WhatsApp! Yoyos no te cambia la forma de vender: tus clientes te escriben como siempre. Lo que te ahorras es pasar cada pedido del chat al Excel: cuando te mandan la foto del producto, Yoyos arma el pedido, y tu cliente completa su dirección y elige el envío en el link que tú le compartes."
          }
        },
        {
          "@type": "Question",
          "name": "No tengo tiempo de aprender otra app.",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Lo entendemos: entre lives y despachos no te sobra tiempo. Por eso Yoyos se usa desde tu celular, junto al WhatsApp que ya tienes. En la demo te ayudamos a dejar Yoyos listo con tus productos."
          }
        },
        {
          "@type": "Question",
          "name": "¿Cuánto cuesta?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "S/ 50 al mes + IGV. Es una suscripción mensual: no cobramos comisión por tus ventas ni hay pagos únicos. Escríbenos por WhatsApp y te mostramos cómo funciona con tus productos."
          }
        },
        {
          "@type": "Question",
          "name": "Hay herramientas gratis que hacen algo parecido.",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Hay opciones gratis que te dan un catálogo o una lista de pedidos. Yoyos va más allá: arma el pedido desde la foto que te manda tu cliente por WhatsApp, cotiza el envío por zona y distrito, te da un link para compartir con tu cliente donde elige agencia Shalom u Olva, domicilio o recojo y sube su comprobante de Yape o Plin, y te deja imprimir los rótulos. Te ahorra trabajo en todo el camino, del chat al despacho."
          }
        },
        {
          "@type": "Question",
          "name": "¿Mis clientes tienen que bajar otra app?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Tus clientes no necesitan bajar nada. Te siguen escribiendo por WhatsApp y, cuando el pedido está listo, les mandas un link para confirmar sus datos y pagar desde el celular, sin crear cuenta."
          }
        },
        {
          "@type": "Question",
          "name": "Vendo poco, todavía no lo necesito.",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Justo cuando empiezas es el mejor momento para ordenarte. Cada pedido que copias a mano del chat al cuaderno, cada dirección que vuelves a pedir y cada captura de Yape que buscas te quitan tiempo que podrías usar para vender. Y cuando un live te va bien, ya tienes todo listo para atender más pedidos sin enredarte."
          }
        },
        {
          "@type": "Question",
          "name": "¿Sirve con Yape y Plin?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Sí. Puedes cobrar con Yape, Plin o transferencia bancaria. Tu cliente ve tus datos de pago en el link del pedido y sube su comprobante, y tú lo verificas."
          }
        },
        {
          "@type": "Question",
          "name": "¿Necesito una impresora especial para los rótulos?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yoyos imprime en impresoras de etiquetas y estamos sumando más modelos. En la demo te decimos cuál te conviene."
          }
        },
        {
          "@type": "Question",
          "name": "¿Funciona en iPhone?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yoyos está disponible para Android y en la web, y la app para iPhone viene en camino."
          }
        },
        {
          "@type": "Question",
          "name": "¿Me pueden bloquear el número?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yoyos se conecta a tu WhatsApp como un dispositivo vinculado, igual que WhatsApp Web, y solo lee los mensajes que te llegan: no envía mensajes, no hace envíos masivos ni escribe en grupos. Yoyos no es un servicio de WhatsApp ni de Meta, así que no podemos garantizar que WhatsApp nunca aplique restricciones, pero Yoyos no hace las acciones que suelen motivarlas, como el spam o los mensajes masivos. Puedes desvincular Yoyos cuando quieras desde la app o desde WhatsApp > Dispositivos vinculados."
          }
        }
      ]
    }
  ]
}
</script>
```
- Si `PUBLIC_CONTACT_EMAIL` tiene valor, agregar `"email"` a `Organization`.
- Si hay redes (`PUBLIC_TIKTOK_URL`, `PUBLIC_INSTAGRAM_URL`), agregar `"sameAs": [...]` a `Organization`.
- Validar con el Rich Results Test y con validator.schema.org.

##### 17.4 Sitemap, robots y 404
- `astro.config.mjs`: `site: PUBLIC_SITE_URL`, `trailingSlash: 'never'` (o `'always'`, pero uno solo) e `integrations: [sitemap()]` → `/sitemap-index.xml`, que incluye **`/` y `/privacidad`** (la 404 queda excluida).
- `robots.txt` generado en el build según `PUBLIC_INDEXING`:
  - Indexación activada:
    ```
    User-agent: *
    Allow: /
    Sitemap: {SITE}/sitemap-index.xml
    ```
  - Indexación desactivada:
    ```
    User-agent: *
    Disallow: /
    ```
- `src/pages/404.astro` con status 404 real (copy en §15).
- El contenido SEO futuro (páginas por caso de uso o blog) va en la landing, no bajo el dominio de la app.

##### 17.5 Estructura (H1/H2 y anclas)
| Ancla | Encabezado |
|---|---|
| `#inicio` | **H1** «Sistema de pedidos por WhatsApp para vendedores de TikTok LIVE» |
| (franja) | Propuesta de valor, 3 ítems con título en `<h3>` o `<p>` destacado (sin H2) |
| `#problema` | H2 «¿Terminó tu live y tu WhatsApp es un caos?» |
| `#beneficios` | H2 «Gestión de pedidos por WhatsApp sin copiar a mano» |
| `#como-funciona` | H2 «Cómo funciona Yoyos en 5 pasos» → 5 × H3 (Sube tus productos · Configura tus entregas y tus datos de pago · Vincula tu WhatsApp · Recibe pedidos · Cobra y despacha) |
| `#funciones` | H2 «Todo para vender por WhatsApp, Instagram y TikTok LIVE» → 6 × H3 |
| `#integraciones` | H2 «Envíos por agencias Shalom y Olva, cobros con Yape y Plin» |
| `#testimonios` | H2 «Vendedores de TikTok LIVE que ya ordenan sus pedidos con Yoyos». **OCULTO** (no se renderiza mientras `testimonials.length === 0`) |
| `#precio` | H2 «Un solo precio: S/ 50 al mes + IGV. Sin comisión por venta.» |
| `#preguntas` | H2 «Preguntas frecuentes» → H3 por pregunta (`<details>`). Visibles: 1–5 y 7–11. Oculta: 6 |
| `#demo` | H2 «Tu próximo live, con los pedidos en orden» + H3 «Agenda una demo» |
| `/privacidad` | **H1** «Política de privacidad» (página aparte, §14) |

##### 17.6 CTA, enlaces, eventos y analítica
| CTA | Enlace | Evento | `location` |
|---|---|---|---|
| «Escríbenos por WhatsApp» | `WHATSAPP_URL` (`target="_blank" rel="noopener"`) | `whatsapp_click` | `header`, `hero`, `precio`, `cta_final`, `footer`, `404` |
| «Llámanos» | `TEL_URL` | `call_click` | `header`, `hero`, `cta_final`, `footer` |
| «Agenda una demo» | `#demo` | `demo_form_open` | `hero`, `precio` |
| «Política de privacidad» (footer y checkbox) | `/privacidad` | — | `footer`, `form` |
| Envío del formulario | POST a `PUBLIC_DEMO_FORM_ACTION` | `demo_form_submit` (props `rubro`, `contacto_preferido`; sin datos personales) | `cta_final` |
| Error del formulario | — | `demo_form_error` (prop `reason`) | `cta_final` |
| Abrir pregunta del FAQ | — | `faq_open` (prop `q`: número) | `faq` |
| «Ingresar» | `PUBLIC_APP_LOGIN_URL` (se oculta si está vacía) | — | `header`, `footer` |

- **Analítica:** queda como un hook configurable (por ejemplo, `src/lib/analytics.ts` con `track(evento, props)`) que dispara estos eventos. Con `PUBLIC_ANALYTICS_ENABLED=false` (el valor por defecto) no se carga ningún script ni se envía nada. Cualquier herramienta futura debe ser liviana y sin cookies; si usara cookies, va con aviso de consentimiento y se actualiza la sección 10 de `/privacidad`.

##### 17.7 Rendimiento (presupuesto)
- Core Web Vitals en móvil (p75): **LCP ≤ 2,5 s** (meta interna ≤ 2,0 s con Slow 4G), **INP ≤ 200 ms**, **CLS ≤ 0,1**, TTFB ≤ 0,8 s.
- Presupuesto: JS total ≤ 50 KB, HTML + CSS + JS críticos ≤ 100 KB gzip y primera vista ≤ 500 KB.
- Imágenes con `astro:assets` `<Picture>` en AVIF + WebP, `width`/`height`, `srcset`/`sizes` y `loading="lazy"` bajo el pliegue. Logos de Shalom, Olva, Yape y Plin optimizados en SVG.
- Hero (LCP): `fetchpriority="high"`, sin lazy, preload, ≤ 80–120 KB, sin video ni carrusel.
- Inter autoalojada en WOFF2 con subset latin (tildes y ñ), `font-display: swap`, ≤ 2 pesos o variable, preload solo del peso principal y fallback con `size-adjust`.
- Tokens de `docs/design-tokens.json` (Caramelo sobrio) y modo oscuro con `prefers-color-scheme`.
- FAQ con `<details>` nativo (0 JS). Sin widgets de chat; WhatsApp va como link. Formulario con POST nativo, sin dependencias pesadas.
- Assets con hash y `Cache-Control: public, max-age=31536000, immutable`.
- Pruebas: Lighthouse móvil en "Slow 4G" y WebPageTest en un Android de gama media desde la ubicación más cercana a Lima. Opcional: Lighthouse CI.
- Accesibilidad: contraste AA, `alt` de este documento, foco visible, un solo H1 y `aria-label` en «Llámanos» y el menú.
