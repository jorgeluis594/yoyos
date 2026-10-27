# Productos con variantes: definición de producto

**Estado:** definición lista para implementar, 2026-10-26. Las preguntas las decidió la revisión de implement-task (ver «Preguntas decididas por la revisión»); el fundador las confirma en el pull request final.

**Qué existe hoy:**
- Un producto tiene 1..n variantes. Cada variante tiene atributos libres, SKU opcional, precios, QR inmutable, stock propio y un estado que siempre vale «activa».
- El catálogo público, los pedidos, el checkout y mensaje→pedido ya trabajan por variante ([Productos](../products.md), [Catálogo público](../public-catalog.md), [Pedidos](../orders.md), [Checkout](../checkout.md), [Mensaje a pedido](../message-to-order.md)).
- Los formularios web y móvil solo crean una variante sin atributos, y son de solo lectura cuando hay varias.

**Relación con otros documentos:** complementa [Productos](../products.md) y, al integrarse, se reescribe dentro de él.

**Origen:** tarea de Todoist `6hr2gX45WXrP7363` «Crear y editar productos con variantes». Mockups aprobados el 2026-10-26 (`mockups-variantes-v2-2026-10-26`). Si el texto y un mockup no coinciden, manda este texto (ver «Diferencias con los mockups»).

**Textos de la interfaz:** cuando el documento dice «como hoy», el texto es el que ya existe y se cita literal. Los textos nuevos se marcan como cambio donde reemplazan a uno existente.

## Problema y situación

Una vendedora de polos recibe por WhatsApp «¿tienes el básico en L azul?». En Yoyos el «Polo básico» es un solo producto, con un solo precio y un solo stock. Para saber si queda L azul tiene que revisar el estante o una nota del celular.

Para vender por talla y color tendría que crear seis productos: «Polo básico S Negro», «Polo básico S Azul», y así con el resto. Cada uno tendría su foto, su etiqueta y su ficha en el catálogo. El catálogo se llena de duplicados y el comprador no puede elegir talla y color en una sola página.

Yoyos ya maneja variantes por dentro, pero ningún formulario permite crearlas ni corregirlas. Cuando llega una talla nueva, un color cambia de nombre o un modelo deja de fabricarse, no hay forma de reflejarlo sin perder los pedidos y las etiquetas QR ya impresas.

## Objetivo

La vendedora crea, desde la web o el celular, un producto con opciones ordenadas, por ejemplo Talla S/M/L y Color Negro/Azul. Yoyos genera cada combinación como una variante, con su propio precio, stock, SKU y QR. Después la vendedora puede:

- agregar tallas, colores u opciones;
- renombrar y reordenar;
- corregir combinaciones;
- desactivar lo que ya no vende.

Nada de esto hace perder pedidos ni etiquetas.

Hipótesis: si funciona, las empresas de ropa o calzado dejan de crear un producto por cada talla o color. Se notaría en dos cosas: suben los productos con más de una variante y bajan los productos de nombre casi igual dentro de una misma empresa.

## Usuarios y superficies

| Usuario | Necesidad | Superficie |
| --- | --- | --- |
| Vendedora cargando un producto nuevo con tallas y colores, con la mercadería al lado | Definir las opciones una vez y cargar precio y stock por combinación sin teclear seis veces | Web `/products/new`, móvil «Nuevo producto» |
| Vendedora que recibió una talla nueva o cambió un color | Agregar o renombrar el valor sin perder pedidos, QR ni stock | Web `/products/:productId`, ficha de producto en móvil |
| Vendedora que dejó de vender una combinación, o un producto con opciones completo | Que ya no se pueda pedir, sin borrar su historial | Detalle de la variante (web y móvil). Un producto sin opciones no se puede retirar en esta versión (ver «Fuera de esta versión») |
| Vendedora imprimiendo etiquetas para la mercadería nueva | Imprimir el QR de cada variante, varias copias, sin entrar a cada variante | Móvil: hoja «Imprimir etiqueta» de la ficha (impresora Brother), también abierta desde el detalle de la variante. Web: diálogo de impresión del navegador desde el detalle de la variante |
| Comprador que abrió el catálogo desde un link | Elegir talla y color en un orden lógico y ver solo lo que está a la venta | Catálogo público, checkout |

## Alcance de la primera versión

Todo esto entra en la misma entrega, en web y en móvil, con el mismo comportamiento:

1. **Crear con opciones:** hasta 3 opciones, cada una con un nombre y valores ordenados. Yoyos genera todas las combinaciones, y la vendedora puede quitar las que no vende antes de guardar. Precio de venta, precio de compra, stock inicial y SKU se cargan por variante: en la fila, en el detalle de la variante o en masa, seleccionando por valor. Un producto sin opciones se crea igual que hoy.
2. **Agregar a un producto existente:**
   - Un valor nuevo crea solo las combinaciones que lo contienen.
   - Una opción nueva no divide las variantes existentes: reciben el valor que elija la vendedora.
   - Un producto sin opciones también puede recibir opciones. Su única variante pasa a ser una de las combinaciones.
3. **Editar atributos:** renombrar opciones y valores, reordenarlos y corregir la combinación de una variante, aunque tenga pedidos. El precio de venta, el precio de compra y el SKU se editan por variante también cuando hay varias.
4. **Desactivar, reactivar y eliminar variantes:**
   - Una variante desactivada sale del catálogo público y de la creación de pedidos, y se conserva en los pedidos que ya la tienen.
   - Desactivar todas las variantes de un producto con opciones es la forma de dejar de venderlo.
   - Solo se elimina una variante que nunca estuvo en un pedido y no tiene stock.
5. **Orden guardado** de opciones y valores. El mismo orden se usa en:
   - las fichas web y móvil;
   - el selector de variante de «Nueva venta»;
   - la hoja de impresión;
   - el catálogo público, el checkout y los pedidos nuevos.
6. **Límites validados en core:** 3 opciones, 30 valores por opción y 100 variantes por producto.
7. **Página de detalle de la variante** en web y en móvil, con QR, **Imprimir** y **Desactivar variante**. Solo existe para productos con opciones.
8. **Documentación:** `docs/products.md` se actualiza en Model, Rules y Screens con las opciones ordenadas, la desactivación y la edición de atributos.

Puntos de encuentro con otras tareas:

- **Editar el stock de variantes existentes** (`6hj7HpVmhfCCHrC3`): esta tarea solo define el stock inicial de las variantes nuevas. El stock del detalle de variante y el de la tabla quedan en solo lectura para las variantes guardadas. Cuando llegue esa tarea, esos mismos campos pasan a editables, sin pantallas nuevas.
- **Variante desde texto de WhatsApp** (PR #150, tarea `6hq77XxMVfMp7wc3`): al 2026-10-26 no está en `main` y esta tarea no depende de él. Cuando entre, `resolveVariant` debe ignorar las variantes desactivadas, y los avisos «Falta la variante» deben nombrar opciones y valores en el orden guardado. El PR de esta tarea lo deja anotado.
- **Foto por color** (`6hqMVjGfqcR7rF6V`): va después de esta tarea. Necesita que «Color» sea una opción con valores y orden estables, que es lo que esta tarea deja guardado.

## Fuera de esta versión

- **Editar el stock de variantes existentes:** entra con `6hj7HpVmhfCCHrC3`.
- **Fotos por color o por variante y búsqueda visual por color:** entran con `6hqMVjGfqcR7rF6V`. La foto sigue siendo una por producto.
- **Categorías, archivado o borrado de productos:** no hay tarea.
  - Mientras tanto, un producto con opciones se retira desactivando todas sus variantes.
  - Un producto sin opciones no se puede retirar.
  - Si la vendedora necesita retirar productos simples, se crea la tarea de archivado.
- **Importación masiva por CSV o Excel:** no hay tarea.
- **Selector de moneda:** no hay tarea.
- **Autogenerar SKU:** no hay tarea.
- **Desactivar o eliminar varias variantes de una vez:** entra cuando la vendedora lo pida. Retirar un producto de 12 variantes son 12 desactivaciones.
- **Elegir una intersección con los chips** («las L que además son Azul»): se resuelve con **Filtrar por valor** más un chip (ver «Variantes»). Un selector combinado entra si la vendedora lo pide.
- **Agregar una opción a un producto grande sin generar todas sus combinaciones:**
  - Ejemplo: 60 variantes más «Manga» con 2 valores darían 120, y el editor lo bloquea aunque la vendedora pensara quitar la mayoría.
  - Agregar los valores de a uno tampoco evita el bloqueo, porque cada valor nuevo genera todas sus combinaciones.
  - Es una consecuencia aceptada del límite de 100.
  - Entra cuando alguna vendedora choque con él: por ejemplo, generando solo las combinaciones que elija.
- **Imprimir etiquetas de productos sin opciones desde la web:** la web hoy no imprime etiquetas de productos simples, y sigue sin hacerlo. Esos productos se imprimen desde la ficha en móvil, como hoy. Entra cuando una vendedora sin Android o sin impresora Brother necesite imprimirlas desde la web.
- **Abrir el detalle de una variante guardada sin perder los cambios sin guardar de la ficha:** abrirlo pide la confirmación de descarte, así que la vendedora guarda primero o descarta. Entra si la vendedora lo pide.
- **Imprimir varias variantes distintas en un solo envío:** la hoja de impresión imprime una variante por vez, con sus copias, como hoy. Entra cuando la vendedora lo pida.

## Flujo

### Crear un producto con opciones

1. Productos → **Nuevo producto**. La vendedora escribe nombre, descripción, foto, precio de venta, precio de compra y stock inicial, como hoy.
2. Toca **Agregar opciones como talla o color**. Se abre el editor de la primera opción, con los campos «Nombre de la opción» y «Valores de la opción». Cada vez que escribe un valor aparece otro campo vacío, «Agregar otro valor».
3. Escribe «Talla» con S, M y L y toca **Listo**. La opción queda resumida, con sus valores como chips. Con **Agregar otra opción** agrega «Color» con Negro y Azul.
4. Yoyos muestra las 6 combinaciones en el orden de opciones y valores: S / Negro, S / Azul, M / Negro, M / Azul, L / Negro, L / Azul.
   - Cada una copia el precio de venta, el precio de compra y el stock inicial escritos antes de agregar opciones. Un stock vacío cuenta como 0.
   - El SKU no se copia, porque es único por empresa.
   - Si el stock copiado es mayor que 0, la tabla muestra «Se copió el stock 4 a cada combinación. Corrige las que tengan otra cantidad.».
   - Ese aviso desaparece cuando la vendedora edita el stock de cualquier fila, cuando aplica **Editar stock** en masa o cuando guarda.
5. Desde ese momento el formulario ya no muestra SKU, precio ni stock del producto. «Stock» pasa a ser un total de solo lectura: «Suma del stock de las variantes».
6. Ajusta por fila o en masa. Por ejemplo: chip «L», **Editar precio**, 42.90 y **Aplicar a 2 variantes**.
7. Toca la papelera de la fila S / Azul. La fila queda marcada «Se quitará», con **Deshacer**.
8. Toca **Guardar producto**. Se crean el producto y sus 5 variantes, y se abre la ficha del producto.

Mientras el producto no está guardado, la vendedora puede cambiar las opciones sin perder lo que editó (ver «Cambios de opciones antes de guardar» en Reglas):

- Renombrar y reordenar conservan todo.
- Agregar un valor o una opción conserva lo editado en las combinaciones que ya estaban.
- Quitar un valor, una opción o una combinación la marca con **Deshacer** hasta guardar.

Caminos alternativos:

- **Sin opciones:** si la vendedora no toca **Agregar opciones**, el producto se crea como hoy, con una variante sin atributos.
- **Quitar la única opción antes de guardar:**
  - Se pide confirmación: «¿Quitar las opciones? Se descartarán las 6 combinaciones y lo que editaste en ellas.», con **Quitar opciones** y **Conservar opciones**.
  - Al confirmar, el formulario vuelve a mostrar SKU, precio de venta, precio de compra y stock inicial con los valores que tenía antes de agregar opciones.
  - Es la única eliminación que confirma en lugar de marcar, porque cambia la forma del formulario.
- **Abandonar:** salir con cambios pide confirmación con los textos de hoy («¿Descartar cambios?»). No queda borrador.

### Agregar a un producto existente

1. En la ficha del producto, la vendedora toca **Editar** en «Talla», escribe «XL» en «Agregar otro valor» y toca **Listo**.
2. Al final de la tabla aparecen XL / Negro y XL / Azul, marcadas «Nueva», con stock 0. Copian el precio de venta y el precio de compra según la regla «Precios de combinaciones nuevas»: XL / Negro copia de S / Negro. Las variantes existentes no cambian.
3. Ajusta precio y stock de las nuevas y toca **Guardar cambios**. Después de guardar, la tabla sigue el orden guardado y las nuevas quedan intercaladas en su lugar.

Para agregar una opción nueva, por ejemplo «Manga» con Corta y Larga:

1. Toca **Agregar otra opción** y escribe «Manga» con sus valores. Aparece «Valor de Manga para las 6 variantes actuales», con el primer valor preseleccionado.
2. Elige «Corta». Las 6 variantes existentes pasan a ser «… / Corta» y conservan id, QR, SKU, precios, stock, estado y pedidos.
3. Se crean las 6 combinaciones con «Larga», marcadas «Nueva» y con stock 0.
   - Cada una copia los precios de la variante existente de la que sale: S / Negro / Larga copia de S / Negro / Corta.
   - Todas las nuevas se crean activas. Si alguna sale de una variante desactivada, la tabla avisa: «2 combinaciones nuevas salen de variantes desactivadas y se pondrán a la venta. Quítalas si no las vendes.».
4. Toca **Guardar cambios**.

Un producto sin opciones que recibe su primera opción sigue el mismo camino. Su única variante recibe el valor elegido de cada opción, y las demás combinaciones se crean nuevas.

### Renombrar, reordenar y corregir

- **Renombrar:** en el editor de la opción, la vendedora cambia «Azul» por «Azul marino». Debajo se ve «Antes «Azul». Los pedidos anteriores conservan el nombre «Azul».». El cambio se aplica al guardar.
- **Reordenar:** en web arrastra la opción o el valor por su asa o usa las flechas; en móvil usa **Subir** y **Bajar** (ver «Reordenar sin arrastrar»). La tabla de variantes se reordena al instante, y el orden se guarda con **Guardar cambios**.
- **Corregir la combinación de una variante:**
  1. En el detalle de la variante, **Cambiar combinación**.
  2. La vendedora elige un valor por opción, entre los existentes o con **Otro valor…** para escribir uno nuevo.
  3. Toca **Guardar combinación**.
  - Ejemplo: la cargó como M / Negro pero era XL, que todavía no existe. Elige **Otro valor…**, escribe «XL» y guarda. XL se agrega al final de «Talla» con esa sola variante. Las demás combinaciones con XL aparecen en «combinaciones sin crear».
  - Si otra variante, activa o desactivada, ya tiene esa combinación, se rechaza.

### Quitar y eliminar valores, opciones y combinaciones

Hay un solo gesto, la papelera (o **Eliminar** en el editor de opción, o **Quitar** en la barra de selección), con un único patrón en productos nuevos y guardados. Lo quitado no desaparece: queda marcado en el editor y en la tabla, con **Deshacer**, hasta guardar.

1. La vendedora toca la papelera de «Azul» en el editor de «Color».
2. En un producto guardado, el editor revisa en ese momento si las variantes con «Azul» se pueden eliminar; la ficha ya sabe cuáles tienen pedidos o stock.
   - Si alguna tiene pedidos o stock, el valor no se marca. Junto a él aparece «No se puede eliminar «Azul»: 2 variantes tienen pedidos o stock. Desactívalas desde cada variante.».
   - En un producto nuevo esta comprobación no aplica, porque nada está guardado.
3. Si se puede, el valor queda tachado en el editor con la línea:
   - producto nuevo: «Azul se quitará al guardar · **Deshacer**»;
   - producto guardado: «Azul se eliminará al guardar con 3 variantes y sus QR · **Deshacer**».
4. En la tabla, sus filas siguen visibles con la marca «Se quitará» (no guardadas) o «Se eliminará» (guardadas). Sus campos se deshabilitan y quedan fuera de los totales, del contador y de la selección en masa.
5. **Deshacer** devuelve el valor y sus filas tal como estaban, con lo editado. Lo editado después en otras filas se conserva. **Deshacer** está disponible hasta guardar o salir.
6. Al tocar **Guardar** se aplica todo junto. Si core rechaza una eliminación (por ejemplo, porque entró un pedido de M / Azul mientras tanto):
   - no se guarda nada y el formulario queda intacto;
   - la línea del valor muestra «No se puede eliminar «Azul»: ahora tiene pedidos o stock.»;
   - la vendedora toca **Deshacer** y vuelve a guardar.

Quitar una combinación con la papelera de su fila, o varias con **Quitar** en la barra de selección (o con **Quitar** en el detalle de una variante no guardada), sigue el mismo patrón por fila: la fila marcada muestra **Deshacer** en lugar de sus campos. Una fila marcada porque se marcó su valor u opción no tiene **Deshacer** propio; se deshace solo desde la línea del valor u opción, en el editor. Si una fila ya estaba marcada por sí misma y luego se marca su valor, deshacer el valor la deja marcada por sí misma. En un producto guardado solo las filas «Nueva» tienen papelera; las variantes guardadas se eliminan desde su detalle.

Una opción se quita con **Eliminar**, en su editor:

- **Producto nuevo con varias opciones:**
  - La opción queda marcada: «Manga se quitará al guardar. Quedan las combinaciones con «Corta». · **Deshacer**».
  - Las filas con los demás valores de Manga quedan marcadas «Se quitará».
  - Si es la única opción, se aplica «Quitar la única opción antes de guardar».
- **Producto guardado con más de un valor en la opción:** se muestra «Deja un solo valor en «Color» para eliminar la opción.» y la opción no se marca.
- **Producto guardado con un único valor en la opción:**
  - La opción queda marcada: «Manga se eliminará al guardar. Las variantes pierden «Corta» y conservan todo lo demás. · **Deshacer**».
  - Si es la última opción, la variante que queda tiene que estar activa. Si está desactivada, se muestra «Activa la variante antes de eliminar la última opción.».
  - Al guardar, el producto pasa a ser un producto sin opciones, y la ficha vuelve a mostrar SKU, precio de venta, precio de compra y stock (este último de solo lectura) de esa variante.

### Desactivar, reactivar y eliminar

1. En el detalle de la variante, la vendedora toca **Desactivar variante**.
2. En web aparece la ventana «¿Desactivar L / Azul?»; en móvil, el alert nativo con el mismo texto. Si la variante tiene stock, el mensaje lo avisa.
3. Toca **Desactivar**. La variante queda «Desactivada» y deja de ofrecerse en el catálogo y en «Nueva venta». Si era la última activa del producto, la ficha muestra «Ninguna variante está a la venta…» y la lista de productos, «Sin variantes activas».
4. Para volver a venderla: **Activar variante**, sin confirmación.
5. **Eliminar variante** aparece solo si la variante cumple tres condiciones: nunca estuvo en un pedido, tiene stock 0 y no es la única del producto.
   - En web la confirmación es una ventana; en móvil, el alert nativo con el botón en estilo destructivo.
   - Al confirmar, la variante se borra con su QR.
   - Si no cumple alguna condición, el detalle muestra el motivo.

## Pantallas

**Nuevo producto (web `/products/new`; móvil a pantalla completa sin barra de pestañas):**
- **Sin opciones (w1, m1a):** igual que hoy, más la tarjeta «Variantes» con **Agregar opciones como talla o color** y una ayuda:
  - web: «Úsalo si vendes este producto en varias versiones. Cada combinación tendrá su propio precio, stock y QR.»;
  - móvil: «Úsalo si vendes este producto en varias tallas o colores.».
- **Con opciones, en web (w2, w3):** la tarjeta «Variantes» muestra:
  - las opciones, una abierta en edición o todas resumidas con **Editar**;
  - **Agregar otra opción**, con la ayuda «Hasta 3 opciones, como talla, color o manga.»;
  - la barra «Seleccionar:», con un chip **Todas** y un chip por valor;
  - **Filtrar por valor** y el contador «6 de 100 variantes»;
  - la tabla Variante / Precio de venta / Stock, que termina con la fila «Stock total».

  A la derecha, «Stock» de solo lectura, con «Suma del stock de las variantes.».
- **Con opciones, en móvil (m1b):** la tarjeta «Variantes» lleva **Editar** y resume cada opción con sus valores («Talla — S, M, L»). La fila «6 variantes · 26 en stock · desde S/ 39.90» abre la pantalla «Variantes». Debajo dice «El precio, el stock y el SKU se cargan en cada variante.».
- **Acción principal:** **Guardar producto** en web y **Guardar** en móvil, como hoy. Mientras guarda, el botón se deshabilita y muestra «Guardando…».

**Confirmación de descarte (web y móvil):**
- Se usa al salir de un formulario con cambios, al abrir el detalle de una variante guardada desde una ficha con cambios, en **Recargar producto** y **Recargar variante** con cambios, y en **X** de «Opciones».
- Usa los textos que móvil tiene hoy:
  - título: «¿Descartar cambios?»;
  - texto: «Se perderán los cambios que no guardaste.»;
  - botones: **Descartar** y **Seguir editando**.
- **Cambio en web:** hoy los formularios de productos de la web no piden confirmación. Ahora la piden con estos mismos textos dentro de la app. Al cerrar la pestaña o recargar el navegador, se muestra el aviso propio del navegador.

**Editor de opción (web, dentro de la tarjeta; móvil, pantalla «Opciones», m2):**
- **Campos:** «Nombre de la opción» y «Valores de la opción», con un valor por fila. Cada valor tiene un asa para mover y una papelera. El último campo vacío dice «Agregar otro valor».
- **Botones:** **Eliminar** (la opción) y **Listo** (cierra la edición de esa opción).
- **Otras opciones:** se ven resumidas, con **Editar**. Abajo está **Agregar otra opción**. Con 3 opciones, ese botón se reemplaza por «Llegaste al máximo de 3 opciones.». Una opción marcada para quitar o eliminar sigue contando hasta que se guarda o se deshace.
- **Móvil:**
  - El **Listo** de la cabecera aplica todas las opciones y vuelve al producto. Se deshabilita mientras alguna opción tenga errores o se supere el límite de variantes.
  - El **Listo** de la tarjeta solo cierra esa opción.
  - La **X** vuelve al producto sin aplicar y, si hubo cambios, pide la confirmación de descarte.
  - Al pie se muestra «Hasta 3 opciones · Se crearán 6 variantes (máximo 100).» en un producto nuevo y «Hasta 3 opciones · 2 variantes nuevas · 8 de 100.» en uno guardado.
- **Opción nueva en un producto guardado (w5c):** «Valor de <opción> para las 6 variantes actuales», un selector y «Conservan su QR, stock y pedidos. Solo se crean las 6 combinaciones nuevas con «Larga».».
- **Valor renombrado en un producto guardado (w5d):** «Antes «Azul». Los pedidos anteriores conservan el nombre «Azul».».
- **Quitar o eliminar:** se marca con **Deshacer**, como se describe en «Quitar y eliminar valores, opciones y combinaciones».
- **Errores:** aparecen junto al campo, con lo escrito intacto. El **Listo** de esa opción se deshabilita mientras tenga errores.
  - «Escribe el nombre de la opción.»
  - «Ya tienes una opción «Talla».»
  - ««M» ya está en esta opción.»
  - «Agrega al menos un valor.»
  - «Máximo 30 valores por opción.»
  - «Máximo 30 caracteres.»
  - Más de 100 variantes (w6): «Máximo 100 variantes», seguido de:
    - en un producto nuevo: «Con estos valores serían 120 combinaciones (5 tallas × 6 colores × 4 mangas). Quita algún valor para continuar.»;
    - en un producto guardado: «Con estos valores serían 104 variantes (98 actuales y 6 nuevas). Quita algún valor para continuar.».

**Reordenar sin arrastrar (web y móvil):**
- El asa de cada opción y de cada valor es un botón con nombre accesible, por ejemplo «Mover «M», posición 2 de 3».
- **Web:** con el asa enfocada, las flechas arriba y abajo mueven el elemento un lugar, y el lector de pantalla anuncia la nueva posición. Con el ratón también se puede arrastrar.
- **Móvil:**
  - En esta versión no hay arrastre en móvil (decisión del coordinador): el resto de la tarjeta hace scroll normal.
  - Tocar el asa abre un menú con **Subir**, **Bajar** y **Cancelar**.
  - VoiceOver y TalkBack ofrecen **Subir** y **Bajar** como acciones del elemento.
- **Subir** no aparece en el primer elemento, ni **Bajar** en el último.

**Variantes (web, tabla de la tarjeta; móvil, pantalla «Variantes», m3a):**
- **Fila en web:**
  - casilla;
  - combinación como enlace;
  - precio de venta editable;
  - stock: editable en las variantes aún no guardadas y de solo lectura en las guardadas, con texto de contraste normal, no atenuado;
  - papelera (solo en filas no guardadas);
  - chevrón al detalle, decorativo: lo que lleva al detalle es el enlace de la combinación, así que con teclado o lector de pantalla hay una sola parada por fila.
  - Cada campo tiene nombre accesible por fila, por ejemplo «Precio de venta de S / Negro».
- **Tarjeta en móvil:** combinación, «Stock 5» o «Agotado» y precio. Tocar la tarjeta abre el detalle. En las filas no guardadas, **Quitar** está en el detalle de esa variante y en la barra de selección.
- **Etiquetas de fila:** «Nueva» (aún no guardada), «Desactivada», «Se quitará» y «Se eliminará». Se muestran como texto, no solo como color.
- **Variante desactivada:** su precio se muestra como texto y su casilla está deshabilitada. Se edita desde el detalle.
- **Orden de filas:** el orden guardado. En un producto guardado, las combinaciones nuevas aparecen al final, juntas, hasta que se guarda; después quedan en su lugar.
- **Contador:** cuenta todas las variantes, incluidas las desactivadas y las nuevas, y no cuenta las marcadas «Se quitará» o «Se eliminará». Ejemplo: «6 de 100 variantes · 1 desactivada».
- **Selección en masa:**
  - Un chip de valor es un interruptor: activado selecciona las variantes con ese valor; tocado otra vez, las deselecciona. Varios chips activos suman sus selecciones.
  - **Todas** selecciona todo; si ya está todo seleccionado, deselecciona.
  - Los chips y **Todas** nunca seleccionan variantes desactivadas ni marcadas.
  - El chip activo muestra un ícono de check además del relleno, y se anuncia como «seleccionado».
- **Filtrar por valor (web):**
  - Muestra solo las filas con ese valor.
  - Con el filtro activo, los chips y **Todas** seleccionan solo dentro de lo visible. Así, «L» filtrado más el chip «Azul» selecciona L / Azul.
  - Si hay seleccionadas fuera del filtro, la barra lo dice: «3 seleccionadas (1 oculta por el filtro)». Las ediciones en masa alcanzan a todas las seleccionadas, y la ventana de edición lo repite.
- **Barra de selección:**
  - texto «3 seleccionadas»;
  - **Editar precio**, **Editar stock** y **Editar precio de compra** (en móvil, esta última va en el menú **⋮**);
  - **Quitar**, solo para variantes no guardadas;
  - **Quitar selección**.
- **Editar precio:**
  - Contenido: «Editar precio de venta», «Aplicar a las 3 seleccionadas (color Azul).», «Reemplaza el precio actual de cada variante.» y **Aplicar a 3 variantes**.
  - En web es una ventana (w4b); en móvil, una hoja inferior con **Aplicar a 3** (m3b).
  - Los cambios quedan en el formulario hasta **Guardar**.
- **Editar stock con variantes guardadas en la selección:** se aplica solo a las nuevas y lo dice: «Se aplica a las 2 variantes nuevas. El stock de las variantes guardadas no se edita aquí.». Si todas las seleccionadas están guardadas, el botón se deshabilita.
- **Fila final «Stock total»:** suma de las variantes activas.
- **Combinaciones sin crear** en un producto guardado:
  - Con una sola, se muestra la línea «1 combinación sin crear: S / Azul», con **Agregar**, que la suma como «Nueva».
  - Con varias, se muestra «12 combinaciones sin crear», con **Ver**. **Ver** despliega la lista en el orden guardado, de 50 en 50 con **Ver más** al final, y cada combinación tiene su **Agregar**.
  - **Agregar** sigue el límite de 100: al llegar, se deshabilita y muestra «Máximo 100 variantes».
- **Pantalla «Variantes» en móvil:**
  - Se muestran aquí, sobre la lista: el aviso de stock copiado, el aviso de combinaciones que salen de variantes desactivadas, «combinaciones sin crear» y el motivo de rechazo de cada fila.
  - La flecha vuelve a la ficha y conserva las ediciones pendientes, que se guardan con **Guardar** en la ficha.
  - Si el guardado se rechaza por errores de variantes, la fila «6 variantes» de la ficha muestra «2 con errores» para indicar dónde corregir.
- **Rechazo al guardar:** cada fila con error muestra el motivo debajo de la combinación, por ejemplo «SKU en uso por otra variante» o «Falta el precio». Al abrir su detalle, el campo aparece marcado.
- **Tamaño mínimo de chips, **Editar** y controles de fila:** 44 px de alto en móvil y 32 px en web (valor inicial, ajustable).

**Detalle de variante guardada (web `/products/:productId/variants/:variantId`, w5a; móvil a pantalla completa, m4):** existe solo en productos con opciones. Si la ruta apunta a la única variante de un producto sin opciones, lleva a la ficha del producto.
- **Estados de carga:**
  - Cargando: «Cargando variante…».
  - Error de carga: «No se pudo cargar la variante. Revisa tu conexión e inténtalo otra vez.», con **Reintentar**.
  - No encontrada: «Esta variante ya no existe.» Si el producto de la ruta existe en la empresa (variante eliminada o de otro producto), ofrece **Volver al producto**. Si no existe o es de otra empresa, ofrece **Volver a productos**. Nunca revela si existe en otra empresa.
- **Cabecera:** el título es la combinación en el orden guardado («L / Azul»). Debajo, en web, «Variante de Polo básico»; en móvil, el nombre del producto aparece en la tarjeta «Opciones».
- **«Opciones»:** solo lectura, una fila por opción, con **Cambiar combinación**. También está disponible en variantes desactivadas.
- **«Precio» e «Inventario»:**
  - Precio de venta, obligatorio.
  - Precio de compra, opcional.
  - Stock, de solo lectura.
  - SKU, opcional.
  - En una variante desactivada, precios y SKU también se pueden editar.
- **«QR de la variante»:** el QR, «Es fijo: no cambia aunque edites el precio, el SKU o el nombre del valor.» y **Imprimir**.
  - **Móvil:** **Imprimir** abre la hoja «Imprimir etiqueta» de hoy, con esta variante elegida (ver «Hoja de impresión»).
  - **Web:** abre el diálogo de impresión del navegador con la etiqueta de esta variante. Las copias y la impresora se eligen en ese diálogo.
- **Navegación:**
  - **Web:** lista «Variantes de Polo básico», con el stock de cada una y la actual resaltada.
  - **Móvil:** la flecha vuelve a «Variantes».
- **Acciones:**
  - **Guardar cambios** y **Cancelar** en web, **Guardar** en móvil. Guardan al momento solo el precio de venta, el precio de compra y el SKU de esta variante.
  - **Cancelar** en web vuelve a la ficha del producto, con la confirmación de descarte si hay cambios.
  - **Desactivar variante**, o **Activar variante** si está desactivada.
  - **Eliminar variante**, o el motivo por el que no se puede. Se muestra el primero que aplique:
    1. «Tiene pedidos, por eso no se puede eliminar.»
    2. «Tiene 6 unidades en stock, por eso no se puede eliminar.»
    3. «Es la única variante del producto, por eso no se puede eliminar.»
- **En curso:** mientras una acción espera respuesta, su botón se deshabilita y muestra «Guardando…» (texto actual de core), «Desactivando…», «Activando…» o «Eliminando…». Las demás acciones del detalle también se deshabilitan.
- **Desactivada:** arriba aparece «Variante desactivada. No aparece en tu tienda ni al crear pedidos.».

**Detalle de variante no guardada (producto nuevo, o fila «Nueva» en uno guardado):**
- En web es una ventana sobre el formulario, como w4b, titulada con la combinación («S / Azul»). En móvil es una pantalla completa dentro del flujo de crear o editar. El formulario no se pierde.
- Muestra precio de venta, precio de compra, stock y SKU editables, y «El QR se crea al guardar el producto.».
- Tiene **Quitar** y no tiene desactivar.
- **Listo** vuelve con los cambios aplicados en la fila. **Cancelar** vuelve sin aplicarlos.

**Cambiar combinación (web en ventana, móvil en hoja inferior):**
- Título «Cambiar combinación de L / Azul».
- Un selector por opción, con los valores existentes y al final **Otro valor…**, que abre un campo de texto. El valor nuevo sigue las reglas de nombres y límites, y se agrega al final de la opción.
- Ayuda: «Los pedidos anteriores conservan «L / Azul».».
- Si un valor queda sin variantes, se agrega: ««L» se quitará de Talla porque no le quedan variantes.».
- Botones **Guardar combinación** y **Cancelar**.
- Rechazo: «Ya existe la variante M / Azul. Elige otra combinación.».

**Desactivar (web en ventana, w5b; móvil con alert nativo):**
- Título «¿Desactivar L / Azul?».
- Texto «Dejará de venderse y no aparecerá en tu tienda. Conserva su QR y sus pedidos, y puedes volver a activarla.».
- Con stock mayor que 0 se agrega «Todavía tiene 6 unidades en stock. Mientras esté desactivada, ese stock no se podrá vender.».
- Si es la última activa se agrega «Es la última variante a la venta: el producto dejará de verse en tu tienda.».
- Botones **Desactivar** y **Cancelar**.

**Eliminar variante (web en ventana; móvil con alert nativo y botón destructivo):**
- «¿Eliminar L / Azul?» y «Se borra con su QR. Las etiquetas impresas dejarán de reconocerse.».
- Si un valor queda sin variantes, se agrega ««XL» se quitará de Talla porque no le quedan variantes.».
- Botones **Eliminar variante** y **Conservar variante**.

**Hoja de impresión (móvil, «Imprimir etiqueta»):**
- Se mantiene la hoja de hoy, en la ficha de todo producto, con:
  - selector de variante;
  - copias (de 1 a 99), impresora y **Cambiar**;
  - el aviso «La etiqueta usará los datos guardados, sin incluir los cambios de este formulario.»;
  - los mensajes de impresora de hoy.
- **Cambios:**
  - El selector nombra cada variante con su combinación en el orden guardado («L / Azul»), no «Talla: M · Color: Azul».
  - Las variantes desactivadas aparecen marcadas «Desactivada» y se pueden imprimir.
  - Abierta desde el detalle de una variante, esa variante viene elegida.
- **Productos sin opciones:** igual que hoy.
- La impresión sigue disponible solo en Android, como hoy: «La impresión está disponible en Android con una app compatible.».

**Etiqueta (móvil y web):**
- Lleva el nombre del producto, la combinación en el orden guardado («L / Azul») debajo del nombre, el SKU y el QR. Antes no llevaba la combinación.
- Un producto sin opciones no lleva combinación.
- Si el contenido no cabe, no se imprime y se muestra el texto de hoy, «El contenido no cabe completo en esta etiqueta.».

**Ficha de producto (web `/products/:productId`, w5c y w5d; móvil a pantalla completa sin barra de pestañas):**
- La misma tarjeta «Variantes» del formulario de creación, con **Guardar cambios** en web y **Guardar** en móvil.
- «Stock» de solo lectura, con «Suma del stock de las variantes activas.».
- Sin variantes activas, arriba se muestra «Ninguna variante está a la venta. Activa una para volver a venderla en tu tienda y en «Nueva venta».».
- **Producto sin opciones:** igual que hoy. En móvil, el QR y la impresión siguen en la ficha. En web no hay impresión (ver «Fuera de esta versión»).

**Lista de productos (web y móvil):**
- Igual que hoy, pero «Desde» y el stock total se calculan solo con las variantes activas.
- Un producto sin variantes activas muestra «Sin variantes activas» en lugar del precio, en web y en móvil.

**Nueva venta (web y móvil):**
- El buscador no ofrece productos sin variantes activas, y el selector de variante muestra solo las activas.
- Opciones y valores van en el orden guardado.
- Cada plataforma mantiene su formato de hoy: web «M · Azul», móvil «Talla: M · Color: Azul».

**Catálogo público:**
- Un selector por opción, en el orden guardado, con los valores en su orden.
- No se pueden elegir combinaciones que no existen, desactivadas ni agotadas.
- Un valor cuyas variantes están todas desactivadas no se muestra.

**Checkout y pedidos (web y móvil):** cada ítem muestra la combinación copiada al crear el pedido, en el orden guardado en ese momento y con el formato de hoy de cada pantalla.

## Reglas

| Aspecto | Comportamiento |
| --- | --- |
| Opción | Nombre y lista ordenada de valores. Hasta 3 opciones por producto y 30 valores por opción. Reemplaza deducir las dimensiones de los «atributos», porque no hay dónde guardar el orden ni renombrar un valor en todas sus variantes a la vez. |
| Nombres y valores | Son obligatorios y miden de 1 a 30 caracteres tras quitar los espacios de los extremos (valor inicial, ajustable). Dos opciones, o dos valores de una misma opción, no pueden coincidir ignorando mayúsculas y espacios: «m» y «M » son el mismo valor. |
| Límite de variantes | Un producto tiene como máximo 100 variantes. Cuentan las activas, las desactivadas y las nuevas sin guardar; no cuentan las marcadas para quitar o eliminar. Cada variante ocupa una combinación. Al crear, como se generan todas las combinaciones, el editor no deja que el producto de los valores pase de 100 (5 × 6 × 4 = 120). En un producto guardado, el editor no deja que las existentes más las nuevas que se generarían pasen de 100. |
| Qué valida core al crear | Hasta 3 opciones y hasta 30 valores por opción, con nombres y valores válidos y sin repetir. Entre 1 y 100 variantes. Cada variante tiene exactamente un valor de cada opción, o ningún atributo si el producto no tiene opciones. Sin combinaciones repetidas. Precios, stock y SKU válidos. No exige que estén todas las combinaciones: las quitadas no se crean. |
| Qué valida core al editar | Lo mismo, sobre el resultado final con las variantes existentes, las nuevas y las eliminadas. Además: las variantes existentes conservan su identidad; cada variante que se elimina nunca estuvo en un pedido y tiene stock 0; el producto conserva al menos una variante; el stock de las variantes guardadas no cambia. Todos los errores se informan juntos, por campo, opción y variante. |
| Combinación | En un producto con opciones, cada variante tiene exactamente un valor de cada opción. Dos variantes, activas o desactivadas, no pueden tener la misma combinación. |
| Producto sin opciones | Tiene una sola variante sin atributos. SKU, precios y stock están en el formulario del producto, como hoy. Su variante siempre está activa y no tiene página de detalle. |
| Valores base al crear | Al agregar la primera opción, las combinaciones generadas copian el precio de venta, el precio de compra y el stock inicial escritos antes. El SKU nunca se copia. Si el stock copiado es mayor que 0, se avisa que el stock es por combinación, hasta la primera edición de stock o hasta guardar. |
| Cambios de opciones antes de guardar | Una combinación no guardada se identifica por sus valores, no por su texto. Renombrar o reordenar conserva todo lo editado. Agregar un valor no cambia las combinaciones que ya estaban. Al agregar una opción, las combinaciones existentes reciben su primer valor y conservan todo; las que llevan los demás valores copian los precios de la combinación de la que salen, el stock base y un SKU vacío. Quitar un valor, una opción o una combinación la marca con **Deshacer** hasta guardar. Al guardar se descarta lo marcado. Si se quita una opción de varias, sobreviven las combinaciones con su primer valor, con lo editado en ellas. |
| Precios de combinaciones nuevas | Al agregar un valor, la combinación nueva copia el precio de venta y el precio de compra de la primera variante, en el orden actual, que comparte los demás valores. Prefiere una activa; si no hay ninguna activa, usa una desactivada. Si ninguna comparte los demás valores, copia de la primera variante del producto. En un producto nuevo sin otras combinaciones, usa los valores base. Al agregar una opción, copia de la variante de la que sale. El stock empieza en 0 en un producto guardado y en el stock base en uno nuevo. El SKU empieza vacío. Todo se puede editar antes de guardar. |
| Estado de las nuevas | Toda variante nueva se crea activa, aunque salga de una desactivada. La tabla lo avisa antes de guardar. |
| Precio, stock y SKU con opciones | Son de cada variante. El stock del producto es la suma de las variantes activas y es de solo lectura. |
| Precio obligatorio | Cada variante necesita un precio de venta mayor que cero. Si falta, se rechaza el guardado y se marcan las filas. |
| Stock | Se define solo al crear la variante, en un producto nuevo o como «Nueva» en uno guardado. Después cambia solo con los pedidos, como hoy. |
| SKU | Es opcional por variante, sin autogeneración, y único en la empresa ignorando mayúsculas y espacios, como hoy. Si dos filas del mismo guardado tienen el mismo SKU, se rechazan las dos. |
| QR | Uno por variante e inmutable. Lo genera core al guardar. No cambia al renombrar, reordenar, cambiar la combinación, desactivar ni reactivar. |
| Orden | Lo define la vendedora: por defecto, el orden en que escribió opciones y valores. Se cambia arrastrando (solo web), con las flechas (web) o con **Subir** y **Bajar** (móvil), y se guarda con el producto. Lo usan las fichas, la tabla de variantes, el nombre de la variante («L / Azul»), la hoja y la etiqueta de impresión, «Nueva venta», el catálogo público, el checkout y los pedidos nuevos. |
| Agregar valor | Crea solo las combinaciones que contienen el valor nuevo. No vuelve a crear las combinaciones que la vendedora quitó. Un valor nuevo creado desde **Cambiar combinación** no genera combinaciones: solo mueve esa variante. |
| Agregar opción | Las variantes existentes, activas o desactivadas, reciben el valor elegido y conservan id, QR, SKU, precios, stock, estado y pedidos. Las demás combinaciones se crean nuevas. |
| Renombrar | Opciones y valores se renombran en todas sus variantes. Los pedidos y checkouts ya creados conservan su texto, y los nuevos usan el nombre nuevo. Las etiquetas impresas muestran el nombre anterior, y su QR sigue funcionando. |
| Cambiar combinación | Se puede aunque la variante tenga pedidos o esté desactivada, siempre que la combinación no sea la de otra variante. Los pedidos conservan su copia. Se guarda al momento. |
| Eliminar variante | Requiere tres condiciones: que nunca haya estado en un pedido, incluidos los pedidos del catálogo sin confirmar; que tenga stock 0; y que no sea la única variante del producto. Se borran la variante, su QR y su stock en 0. Una variante con pedidos o con stock se desactiva; nunca se elimina. |
| Eliminar un valor | Elimina todas sus variantes, así que exige que cada una cumpla las condiciones de «Eliminar variante». El editor lo comprueba al tocar la papelera, y core lo vuelve a comprobar al guardar. |
| Eliminar una opción | Solo si tiene un único valor. Las variantes pierden ese atributo y conservan todo lo demás. Si es la última opción, la variante que queda debe estar activa, y el producto pasa a no tener opciones. |
| Quitar (no guardadas) | Quitar combinaciones, valores u opciones aún no guardados no es eliminar. No se crean y no exigen condiciones. |
| Valor sin variantes | Cualquier guardado (ficha, **Cambiar combinación** o **Eliminar variante**) quita de la opción el valor que se queda sin ninguna variante, contando también las desactivadas. Una opción sin valores también se quita. Si pasa por **Cambiar combinación** o **Eliminar variante**, la confirmación lo avisa. |
| Desactivar | Solo en productos con opciones, incluso en la última variante activa. La variante sale del catálogo público, de «Nueva venta», de la búsqueda por QR o por foto de mensaje→pedido, y del cálculo de «Desde» y del stock total. Conserva QR, SKU, precios, stock y pedidos. Con stock mayor que 0, avisa sin bloquear. La búsqueda por foto agrega un producto solo si tiene exactamente una variante vendible, así que un producto que queda con una sola variante activa pasa a reconocerse por foto. |
| Producto sin variantes activas | No aparece en el catálogo público ni en «Nueva venta», y mensaje→pedido no lo reconoce. Sigue en la lista de productos con «Sin variantes activas». Vuelve a la venta al activar cualquier variante o al agregar una nueva. |
| Pedidos con una variante desactivada | Los pedidos que ya la tienen siguen funcionando: se ven, se pagan (con descuento de stock) y se cancelan (con restauración de stock). Esto incluye un pedido del catálogo sin confirmar que el comprador reabre con **Continuar**: lo puede confirmar y pagar, y la vendedora lo resuelve por chat si ya no tiene la variante. No se pueden crear pedidos nuevos con ella desde web, móvil, catálogo ni mensaje→pedido. |
| Reactivar | **Activar variante** la devuelve al catálogo y a «Nueva venta» con el stock que tenga. |
| Desactivada en la ficha | En la tabla se ve «Desactivada», con el precio como texto, y queda fuera de la selección en masa. Sus precios y su SKU se editan desde el detalle. |
| Selección en masa | Los chips son interruptores por valor, y varios chips activos suman sus selecciones. Con **Filtrar por valor**, seleccionan solo dentro de lo visible. Las ediciones en masa reemplazan el valor de cada variante seleccionada y quedan pendientes hasta **Guardar**. |
| Guardado de la ficha | **Guardar cambios** guarda junto todo lo editado en la ficha: opciones, valores, orden, variantes nuevas, lo marcado para quitar o eliminar, precios y SKU. Se guarda todo o nada. |
| Guardados inmediatos | En el detalle de la variante, estas acciones se guardan al confirmar: **Guardar cambios** (precio de venta, precio de compra y SKU de esa variante), **Cambiar combinación**, **Desactivar variante**, **Activar variante** y **Eliminar variante**. |
| Paridad | Web y móvil aplican las mismas reglas, límites, textos y códigos de error. Core es la fuente de verdad. |
| Concurrencia | No hay bloqueo de edición, como hoy. Si otro guardado cambió las opciones, los valores o las variantes del producto desde que se abrió la ficha (en otro dispositivo, o un guardado propio que sí se aplicó antes de un reintento), **Guardar cambios** se rechaza y el formulario queda intacto. Los cambios de precio y SKU de otras personas no lo rechazan: gana el último guardado, como hoy. Si el guardado choca con otra variante, un límite o un pedido nuevo, se rechaza con el motivo y el formulario queda intacto. **Recargar producto** pide la confirmación de descarte si hay cambios. |

## Estados

| Estado | Significado | Qué lo provoca | Qué se puede hacer | Qué ve la vendedora | Qué ve el comprador |
| --- | --- | --- | --- | --- | --- |
| Activa | Se vende | Crearla, o **Activar variante** | Editar, vender, cambiar la combinación y desactivar. Eliminar, si nunca estuvo en un pedido, tiene stock 0 y no es la única | La variante con su precio y su stock | La combinación, elegible si tiene stock |
| Desactivada | Se dejó de vender y se conserva | **Desactivar variante** | Ver, editar precios y SKU desde el detalle, imprimir su QR, cambiar la combinación y activar. Eliminar, con las mismas condiciones | «Desactivada» en la ficha, en la lista de variantes y en la hoja de impresión | Nada en el catálogo. En un pedido existente, el ítem igual que antes |

- **Transiciones:** Activa → Desactivada y Desactivada → Activa. Eliminar no es un estado: la variante deja de existir.
- **Marcas:** «Nueva», «Se quitará» y «Se eliminará» no son estados. Son marcas de cambios aún no guardados.
- **Lo que existe hoy:** el estado ya existe en las variantes y hoy siempre vale «activa». Esta tarea agrega «desactivada» y las acciones para cambiarlo. Las variantes que ya existen siguen activas.

## Cuando algo falla

| Situación | Qué ve la vendedora | Qué puede hacer |
| --- | --- | --- |
| Guardar producto o cambios: éxito | Al crear, se abre la ficha del producto. Al editar, «Cambios guardados», como hoy, y se queda en la ficha | Seguir |
| Guardar: rechazo conocido (combinación repetida, límite, valor vacío, SKU en uso, precio faltante, eliminación no permitida) | El formulario intacto, cada error junto a su campo, opción o fila, y arriba un resumen: «Revisa 2 variantes marcadas.» | Corregir, o tocar **Deshacer** en lo marcado, y volver a guardar |
| Guardar: no salió (sin conexión) | «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.», como hoy, con el formulario intacto | **Reintentar** |
| Crear producto: resultado dudoso | «No se pudo confirmar si se creó este producto. Revisa el catálogo antes de iniciar otra creación.», el texto de hoy en móvil, que ahora usa también web. Reintentar con el mismo producto no lo duplica: si ya existía, se muestra el conflicto y se ofrece revisar la lista, como hoy | **Reintentar** o volver a la lista. Mientras tanto no se puede iniciar otro guardado del mismo producto |
| Guardar cambios: el producto cambió desde que se abrió la ficha | «Este producto cambió desde que lo abriste. Recarga el producto para ver los cambios.» sobre el formulario, que queda intacto. No se guarda nada | **Recargar producto**, con la confirmación de descarte |
| Editar producto: resultado dudoso | «Puede que se hayan guardado los cambios. Recarga el producto para revisarlos.» Los cambios siguen en pantalla | **Recargar producto**, con la confirmación de descarte |
| Detalle de variante, **Guardar cambios**: éxito | «Variante guardada»; se queda en el detalle | Seguir |
| Detalle de variante, guardar: rechazo conocido | El campo marcado, con lo escrito intacto: «Este SKU ya lo usa otra variante.», «Escribe un precio mayor que 0.» o «Usa como máximo 2 decimales.» | Corregir y guardar |
| Detalle de variante, guardar: sin conexión | «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.», con lo escrito intacto | **Reintentar** |
| Detalle de variante, guardar: resultado dudoso | «Puede que se hayan guardado los cambios. Recarga la variante para revisarlos.», con lo escrito intacto | **Recargar variante**, con la confirmación de descarte. Repetir no duplica nada |
| Cambiar combinación: éxito | «Combinación cambiada». Se cierra la ventana y el título del detalle pasa a la combinación nueva («M / Azul») | Seguir |
| Cambiar combinación: rechazo (ya existe, valor repetido, límite de 30 valores) | El motivo junto al selector, con la selección intacta: «Ya existe la variante M / Azul. Elige otra combinación.», ««XL» ya está en esta opción.» o «Máximo 30 valores por opción.» | Elegir otra |
| Cambiar combinación: sin conexión | «No se pudo cambiar la combinación. Revisa tu conexión e inténtalo otra vez.», con la selección intacta | **Reintentar** |
| Cambiar combinación: resultado dudoso | «No se pudo confirmar el cambio. Recarga la variante para ver su combinación.» Nunca se muestra como éxito | **Recargar variante**. Repetir la misma combinación no tiene efecto si ya se aplicó |
| Desactivar: éxito | «Variante desactivada» y aparece el aviso de desactivada | Seguir, o **Activar variante** |
| Activar: éxito | «Variante activada» y desaparece el aviso de desactivada | Seguir |
| Eliminar: éxito | «Variante eliminada» y vuelve a la ficha del producto | Seguir |
| Eliminar: rechazo porque mientras tanto entró un pedido o cambió el stock | «Tiene pedidos, por eso no se puede eliminar. Puedes desactivarla.» o «Tiene 6 unidades en stock, por eso no se puede eliminar. Puedes desactivarla.» | **Desactivar variante** |
| Desactivar, activar o eliminar: sin conexión | «No se pudo desactivar la variante. Revisa tu conexión e inténtalo otra vez.» (o «activar», o «eliminar») | **Reintentar** |
| Desactivar, activar o eliminar: resultado dudoso | «No se pudo confirmar el cambio. Recarga la variante para ver su estado.» Nunca se muestra como éxito | **Recargar variante** y repetir si hace falta. Repetir no duplica nada: desactivar una variante ya desactivada no tiene efecto |
| Abrir un detalle de variante que ya no existe | «Esta variante ya no existe.» | **Volver al producto** si el producto existe en la empresa; si no, **Volver a productos** |
| **Eliminar variante** muestra «Tiene pedidos…» y el único pedido es uno del catálogo que el comprador no confirmó | El mismo motivo. Esos pedidos son invisibles para la vendedora, como hoy, y los que no tienen pagos se borran a los 7 días. Después de eso la variante se puede eliminar. No es un error | **Desactivar variante**, o esperar |
| Crear un pedido con una variante que se desactivó mientras se armaba (web, móvil o cola de ventas pendientes del móvil) | La venta vuelve a revisión con el ítem marcado: «L / Azul ya no está disponible.» | Quitar o cambiar el ítem y confirmar otra vez |
| El comprador tiene L / Azul en el carrito y la variante se desactiva | Al tocar **Continuar** para un pedido nuevo, la línea indica que ya no está disponible y no se crea el pedido (regla actual de carrito rechazado). Si **Continuar** reabre un pedido pendiente que ya existía, se conserva (ver Reglas) | Quitar la línea |
| Llega por WhatsApp la foto de la etiqueta de una variante desactivada o eliminada | El ítem no se agrega y queda registrado como producto no encontrado (regla actual de mensaje→pedido) | Agregar a mano otra variante si la quiere vender |
| La impresión falla en móvil | Los mensajes de impresora de hoy, por ejemplo «No se pudo imprimir. Revisa la impresora y la conexión.». La variante no cambia | **Reintentar** |
| Abandonar a mitad | La confirmación de descarte. No queda borrador | — |

## Quién ve y hace qué

| Actor | Puede ver | Puede hacer | No puede |
| --- | --- | --- | --- |
| Usuario autenticado de la empresa (web o móvil) | Todas las variantes de sus productos, activas y desactivadas, con QR, SKU, precios y stock | Crear, editar, desactivar, activar y eliminar, según las reglas | Ver ni tocar productos de otra empresa. Se comportan como inexistentes, también en el detalle de variante y en **Cambiar combinación** |
| Comprador sin cuenta (catálogo y checkout) | Opciones, valores y precio de las variantes activas. En su pedido, los ítems que ya tiene aunque luego se hayan desactivado | Elegir combinaciones activas con stock | Ver variantes desactivadas, SKU, stock exacto, precio de compra ni QR |

No se agrega ninguna protección nueva. El acceso es el mismo de productos hoy.

## Información que se conserva

- **Se copia en el pedido y no cambia:** el nombre del producto, la combinación con sus nombres y valores en el orden de ese momento, el SKU y el precio, como hoy. Renombrar, reordenar, cambiar la combinación, desactivar o eliminar después no cambia ningún pedido ni checkout.
- **Pedidos anteriores a esta función:** muestran sus atributos como hoy, sin orden guardado, y no se reordenan. Probablemente ninguno tenga atributos, porque los formularios nunca los crearon.
- **Siempre se muestra lo actual:** en la ficha, el catálogo, «Nueva venta», la hoja de impresión y las etiquetas nuevas se ven las opciones, los valores, el orden, los precios y el estado actuales.
- **Datos nuevos de la empresa:** las opciones de cada producto, con sus valores en orden. El estado de la variante ya existía y ahora admite «desactivada». No se guarda historial de nombres anteriores: «Antes «Azul»» solo se ve mientras se edita.
- **Lo que ya existía:** los productos actuales quedan como productos sin opciones, con su variante, QR y stock. Hoy los formularios solo crean productos de una variante sin atributos, y todavía no hay datos de clientes, así que no se convierte ningún atributo (decisión del fundador, 2026-10-26).
- **Versiones anteriores de la app móvil:** no se mantiene compatibilidad con ellas. Todavía no hay clientes, así que la app y core cambian juntos.
- **Lo efímero:** no se guardan las combinaciones generadas y no guardadas, las ediciones en masa pendientes, lo marcado «Se quitará» o «Se eliminará», la selección ni el filtro de la tabla. Copias e impresora siguen siendo preferencias del teléfono, como hoy.

## Vocabulario

- **Opción:** una dimensión en la que varía el producto, como «Talla», «Color» o «Manga». En la interfaz: «Nombre de la opción», «Agregar otra opción».
- **Valor:** cada alternativa de una opción, como «S», «M» o «Azul». En la interfaz: «Valores de la opción», «Agregar otro valor».
- **Variante:** lo que se vende, se cuenta en stock y lleva QR. Es una combinación de un valor por opción, o la única variante de un producto sin opciones. En la interfaz: «Variantes», «6 variantes».
- **Combinación:** los valores de una variante, en el orden guardado y separados por « / »: «L / Azul». En la interfaz: «Cambiar combinación», «combinaciones sin crear».
- **Atributos:** el nombre técnico actual de la combinación. No aparece en la interfaz.
- **Desactivada:** variante que se dejó de vender y se conserva.
- **Eliminar y quitar:** eliminar borra una variante, un valor o una opción guardados, y tiene condiciones. Quitar descarta algo que todavía no se guardó. Los dos se marcan con **Deshacer** hasta guardar, también **Quitar** en el detalle de una variante no guardada. La excepción es el detalle de la variante, donde se aplican al momento.
- **Precio de compra y costo:** son el mismo dato. La web y este documento dicen «Precio de compra». El campo compacto de móvil dice «Costo», como hoy.

## Diferencias con los mockups

Si un mockup y este texto no coinciden, manda el texto:

- **Stock de variantes guardadas:** w5a, w5c, w5d y m4 lo muestran editable (en m4, con stepper). Aquí es de solo lectura; lo hace editable `6hj7HpVmhfCCHrC3`.
- **Texto del QR en m4:** dice «el precio o el SKU». Debe llevar el texto completo: «el precio, el SKU o el nombre del valor».
- **«Valores» en m2:** se mantiene como etiqueta corta de móvil y equivale a «Valores de la opción».
- **X y los dos Listo en m2:** se comportan como dice «Editor de opción».
- **Chip activo de w4a:** además lleva un ícono de check.
- **Elementos que ningún mockup muestra.** Se construyen con los componentes de hoy: texto en línea, botones, ventanas, hojas y alerts.
  - **Eliminar variante** y los motivos por los que no se puede.
  - Las marcas «Se quitará» y «Se eliminará» con **Deshacer**.
  - El menú **Subir** / **Bajar**.
  - **Otro valor…**.
  - El aviso de producto sin variantes activas.
  - Los estados de carga del detalle.
  - «Combinaciones sin crear» con **Ver** y la pista «2 con errores» en la ficha móvil.

## Decisiones cerradas

| Decisión | Por qué |
| --- | --- |
| Límites de 3 opciones, 30 valores por opción y 100 combinaciones (variantes) por producto, validados en core | Cubren ropa y calzado y mantienen manejables la tabla y el catálogo |
| Las variantes con pedidos o con stock nunca se borran: se desactivan, con aviso si tienen stock. Solo se borra una variante sin pedidos y sin stock | El historial de pedidos, la mercadería contada y las etiquetas impresas no se pierden |
| Una opción nueva no divide las variantes existentes: reciben el valor elegido y conservan id, QR, SKU, precios, stock y pedidos | Las etiquetas y los pedidos siguen apuntando a la misma variante |
| El precio y el stock base se copian a las combinaciones generadas, editables por fila y en masa por valor | La vendedora no teclea lo mismo seis veces |
| QR por variante e inmutable. SKU opcional por variante, sin autogeneración y único por empresa | El QR identifica lo que se vende; el SKU es un dato de la vendedora |
| El orden lo define la vendedora y se guarda explícitamente | S/M/L no es un orden alfabético |
| Renombrar valores está permitido; los pedidos conservan el texto vendido | El pedido describe lo que se acordó |
| Cambiar la combinación de una variante con pedidos está permitido si no repite otra | Corrige errores de carga sin perder la variante |
| Con opciones, precio, stock y SKU pasan a las variantes; el stock del producto es un total de solo lectura | Hay un solo lugar donde se cargan |
| Cada variante tiene su página de detalle, con las opciones en solo lectura | Es el lugar del QR, la impresión y la desactivación |
| En móvil, crear y editar son pantallas completas sin barra de pestañas; «Desactivar» usa el alert nativo | Es la convención de la plataforma |
| Paridad completa entre web y móvil en la misma entrega | La vendedora opera desde las dos |
| El estilo visual se mantiene tal cual, sin rediseño | Decisión del fundador |
| El stock de las variantes guardadas sigue de solo lectura en esta tarea | Editarlo es parte de `6hj7HpVmhfCCHrC3` |
| Se puede desactivar la última variante activa | Es la única forma de dejar de vender un producto con opciones mientras no exista el archivado |

## Criterios de aceptación

1. En web, la vendedora escribe «Polo básico» con precio 39.90 y stock inicial 4, y agrega Talla S/M/L y Color Negro/Azul.
   - Ve 6 variantes en orden S / Negro, S / Azul, M / Negro, M / Azul, L / Negro, L / Azul, cada una con S/ 39.90 y stock 4, y el aviso «Se copió el stock 4 a cada combinación. Corrige las que tengan otra cantidad.».
   - No hay campos de SKU, precio ni stock del producto, y «Stock» muestra 24 en solo lectura.
   - Al cambiar el stock de una fila, el aviso desaparece.
2. Selecciona el chip «L», toca **Editar precio**, escribe 42.90 y toca **Aplicar a 2 variantes**. L / Negro y L / Azul quedan en S/ 42.90 y las demás no cambian. Al tocar «L» otra vez, esas dos se deseleccionan.
3. Antes de guardar, con L / Negro en 42.90 y SKU «POLO-L-N»:
   - renombra «Negro» a «Negro carbón» y mueve Color antes de Talla, y la variante pasa a llamarse «Negro carbón / L», con 42.90 y el SKU;
   - agrega «Manga» con Corta y Larga: «Negro carbón / L / Corta» conserva 42.90 y el SKU, y «Negro carbón / L / Larga» copia 42.90, con stock 4 y sin SKU;
   - toca **Eliminar** en «Manga»: las filas con «Larga» quedan marcadas «Se quitará» y, al guardar, quedan las combinaciones con «Corta», ya sin Manga, con lo editado.
4. Toca la papelera de la fila S / Azul, que queda marcada «Se quitará» con **Deshacer**, y el contador y el stock total la descuentan. Toca **Deshacer**, vuelve con lo editado, la marca otra vez y guarda. El producto queda con 5 variantes, la lista muestra «Desde S/ 39.90» con el stock de las 5, y la ficha muestra las variantes en el orden definido. En web y en móvil, la marca y el **Deshacer** son texto y botón en línea, sin avisos pasajeros.
5. Los mismos casos hechos en móvil se ven en la web con las mismas variantes, orden y precios, y al revés.
6. Un producto creado sin tocar **Agregar opciones** queda con una variante sin atributos, igual que hoy, en web y en móvil.
7. Límites:
   - Con Talla de 5 valores, Color de 6 y una tercera opción de 4, el editor muestra «Máximo 100 variantes» con «Con estos valores serían 120 combinaciones (5 tallas × 6 colores × 4 mangas).», y los dos **Listo** quedan deshabilitados.
   - En un producto guardado con 98 variantes, agregar un valor que generaría 6 muestra «Con estos valores serían 104 variantes (98 actuales y 6 nuevas).».
   - Core rechaza crear o editar con 4 opciones, 31 valores, 101 variantes, una combinación repetida, un valor vacío o una opción repetida, con todos los errores juntos por campo y variante, y los mismos códigos en web y móvil.
8. SKU:
   - Dos variantes nuevas con el SKU «POLO-01» en el mismo guardado se rechazan, y las dos filas muestran «SKU en uso por otra variante».
   - Un SKU que ya usa otro producto de la empresa se rechaza igual.
   - El mismo SKU en otra empresa se acepta.
9. A un «Polo básico» con S/M/L × Negro/Azul y un pedido de M / Negro, la vendedora agrega «XL». Al final aparecen XL / Negro (S/ 39.90, copiado de S / Negro) y XL / Azul, marcadas «Nueva» y con stock 0. Al guardar quedan intercaladas, y M / Negro conserva su QR, su stock y su pedido.
10. Al mismo producto le agrega «Manga» con Corta y Larga y elige «Corta» para las variantes actuales. Las 8 variantes existentes pasan a «… / Corta» con el mismo QR, SKU, precio, stock y pedidos, y se crean 8 con «Larga» y stock 0. Si L / Azul estaba desactivada, la tabla avisa que L / Azul / Larga saldrá a la venta.
11. Un producto sin opciones, con stock 5 y un pedido, recibe Talla S/M y la vendedora elige «S» para la variante actual. S conserva su QR, su stock 5 y su pedido, y M se crea con stock 0.
12. Renombra «Negro» a «Negro carbón». El pedido anterior de M / Negro y su checkout siguen mostrando «Negro», y un pedido nuevo de esa variante muestra «Negro carbón».
13. Mueve «Color» antes de «Talla» y «L» antes de «S», una vez arrastrando en web, otra solo con teclado en web (asa enfocada y flechas) y con **Subir** / **Bajar** en móvil. La ficha, la lista de variantes de móvil, la hoja de impresión, el selector de «Nueva venta», el catálogo público, un pedido nuevo y su checkout muestran Color primero y L antes que S.
14. Cambiar combinación:
    - Cambiar M / Negro, que tiene pedidos, a M / Azul, que ya existe, se rechaza con «Ya existe la variante M / Azul. Elige otra combinación.».
    - Cambiarla con **Otro valor…** a «XL», que no existía, la guarda como XL / Negro. Muestra «Combinación cambiada», el título cambia, «Talla» suma XL al final, el pedido sigue mostrando «M / Negro» y XL / Azul aparece en «combinaciones sin crear».
15. Desactivar L / Azul con 6 unidades avisa «Todavía tiene 6 unidades en stock.». Después:
    - L / Azul no aparece en el catálogo ni en «Nueva venta», y el stock total baja en 6;
    - un pedido existente con L / Azul se ve, se paga y se cancela como antes;
    - un pedido del catálogo sin confirmar que la tiene se puede confirmar y pagar, y descuenta su stock.
16. Eliminar variante:
    - con pedidos, muestra «Tiene pedidos, por eso no se puede eliminar.»;
    - sin pedidos pero con 3 unidades, muestra «Tiene 3 unidades en stock, por eso no se puede eliminar.»;
    - sin pedidos y con stock 0, **Eliminar variante** la borra con su QR, y si era la única XL, la confirmación avisa que «XL» se quitará de Talla;
    - si es la única variante del producto, muestra «Es la única variante del producto, por eso no se puede eliminar.».
17. Eliminar valores y opciones en un producto guardado:
    - Si S / Azul tiene stock y M / Azul tiene pedidos, la papelera de «Azul» muestra al momento «No se puede eliminar «Azul»: 2 variantes tienen pedidos o stock. Desactívalas desde cada variante.».
    - Si ninguna tiene pedidos ni stock, queda «Azul se eliminará al guardar con 3 variantes y sus QR · Deshacer», con sus filas marcadas «Se eliminará». **Deshacer** lo devuelve y **Guardar cambios** lo elimina.
18. Una combinación quitada antes (S / Azul) aparece en «1 combinación sin crear: S / Azul». **Agregar** la suma como «Nueva» y, al guardar, queda creada con QR propio.
19. En un producto con una sola opción, «Talla: Única», y una sola variante activa:
    - **Eliminar** de la opción marca «Talla se eliminará al guardar…» y, al guardar, el producto pasa a ser simple, con SKU, precios y stock en la ficha.
    - Si esa variante está desactivada, se muestra «Activa la variante antes de eliminar la última opción.» y la opción no se marca.
20. Desactivar las 6 variantes de un producto:
    - la ficha muestra «Ninguna variante está a la venta…»;
    - las listas web y móvil muestran «Sin variantes activas»;
    - el producto no aparece en el catálogo ni en «Nueva venta».

    Al activar una, vuelve a aparecer.
21. En el detalle de una variante:
    - un SKU en uso muestra «Este SKU ya lo usa otra variante.» junto al campo;
    - sin conexión, muestra «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.» con lo escrito intacto;
    - un SKU válido muestra «Guardando…» en el botón y después «Variante guardada»;
    - sin conexión, **Desactivar** muestra «No se pudo desactivar la variante. Revisa tu conexión e inténtalo otra vez.».
22. Abrir el enlace de una variante eliminada o de otro producto de la empresa muestra «Esta variante ya no existe.» con **Volver al producto**. Abrir el de una variante de otra empresa muestra el mismo texto con **Volver a productos**.
23. Venta y mensaje→pedido con variantes desactivadas:
    - Una venta de móvil en cola con L / Azul, desactivada mientras tanto, vuelve a revisión con «L / Azul ya no está disponible.» y no crea el pedido.
    - Una foto por WhatsApp de la etiqueta de L / Azul no agrega el ítem.
24. En el catálogo público:
    - los selectores siguen el orden definido;
    - no se pueden elegir S / Azul (no creada) ni L / Azul (desactivada);
    - una variante con stock 0 se ve agotada;
    - una compra de M / Negro llega al checkout, descuenta stock al pagarse y lo restaura al cancelarse.
25. Impresión:
    - En móvil, la vendedora abre **Imprimir** desde el detalle de XL / Negro. La hoja «Imprimir etiqueta» viene con XL / Negro elegida y conserva copias e impresora.
    - La etiqueta impresa muestra «Polo básico», «XL / Negro», el SKU y el QR.
    - Una foto de esa etiqueta enviada por WhatsApp agrega XL / Negro al pedido del chat.
    - Desde la ficha, la misma hoja permite elegir cualquier variante, desactivadas incluidas, marcadas «Desactivada».
26. En web, **Imprimir** en el detalle de una variante abre el diálogo de impresión del navegador con una etiqueta que lleva el nombre, la combinación, el SKU y el QR. La ficha web de un producto simple no tiene **Imprimir**, igual que hoy.
27. En móvil, «Nuevo producto», la ficha de edición, «Opciones», «Variantes» y el detalle de variante se abren a pantalla completa sin la barra de pestañas. **Desactivar variante** y **Eliminar variante** confirman con el alert nativo. **X** en «Opciones», después de un cambio, muestra «¿Descartar cambios?».
28. En web y móvil, salir de la ficha con cambios o abrir una variante guardada desde ella muestra «¿Descartar cambios?» y «Se perderán los cambios que no guardaste.», con **Descartar** y **Seguir editando**. **Seguir editando** conserva los cambios.
29. Un guardado sin conexión muestra «No se pudo guardar. Revisa tu conexión e inténtalo otra vez.» con el formulario intacto. Reintentar la creación de un producto que sí se creó no lo duplica.
30. Las pantallas nuevas usan los componentes de hoy de web y móvil (campos, botones, tarjetas, ventanas, hojas, chips, alerts y texto en línea), con los colores, las tipografías y el espaciado actuales, sin estilos ni componentes nuevos.
31. `docs/products.md` describe en Model, Rules y Screens las opciones ordenadas, la desactivación y la edición de atributos.

## Preguntas decididas por la revisión

1. **¿Se puede desactivar la última variante activa de un producto con opciones?**
   - **Respuesta:** (1) Sí.
   - **Quién decidió:** los dos revisores del gate, UX/UI y producto, consolidado por el coordinador. Ambos la confirmaron en r2.
   - **Por qué:** es la única forma de dejar de vender un producto con opciones mientras no exista el archivado. Es coherente con la decisión cerrada 2. Además, el catálogo, «Nueva venta» y la búsqueda visual ya ocultan los productos sin variantes activas.
   - **Qué se agregó:**
     - el aviso «Ninguna variante está a la venta…» en la ficha;
     - «Sin variantes activas» en las listas web y móvil;
     - eliminar sigue sin poder borrar la última variante;
     - sin variantes activas, las combinaciones nuevas copian el precio de una desactivada.
   - **Alternativa descartada:** (2) No permitirlo, porque la vendedora tendría que seguir ofreciendo un producto que ya no vende.

2. **¿La ficha web de un producto sin opciones suma la tarjeta QR con Imprimir?**
   - **Respuesta:** No; queda fuera de esta versión.
   - **Quién decidió:** el coordinador, a partir de la sugerencia S4 de la revisión de producto r3.
   - **Por qué:** achica el alcance. La tarea pide **Imprimir** solo en el detalle de variante, la web hoy no imprime productos simples y móvil sigue imprimiéndolos desde la ficha.
   - **Qué queda:** está anotado en «Fuera de esta versión», con su disparador.
   - **Alternativa descartada:** sumarla en esta versión, reutilizando la etiqueta web del detalle. Es barato, pero agrega alcance que la tarea no pidió.

## Decisiones de rutina para confirmar en el pull request

No quedan preguntas abiertas. Estas decisiones de rutina, aceptadas por la revisión, se listan para que el fundador las confirme en el pull request final:
- **Copia de valores base:** las combinaciones generadas copian el precio de venta, el precio de compra y el stock inicial (decisión cerrada 4), con un aviso de que el stock es por combinación. El aviso desaparece con la primera edición de stock o al guardar. El SKU nunca se copia.
- **Quitar y eliminar:** valores, opciones y combinaciones siguen un único patrón en productos nuevos y guardados. Quedan marcados «Se quitará» o «Se eliminará» con **Deshacer** en línea hasta guardar, sin avisos pasajeros. En un producto guardado, la comprobación de pedidos y stock se hace al tocar la papelera. La única confirmación previa es al quitar la única opción de un producto nuevo.
- **Cambios antes de guardar en un producto nuevo:** renombrar y reordenar conservan lo editado. Una opción nueva da su primer valor a las combinaciones existentes, y las demás combinaciones copian precios de la combinación de la que salen.
- **Combinaciones nuevas en un producto guardado:** copian precios de la primera variante que comparte los demás valores, activa si hay alguna y si no desactivada. Empiezan con stock 0, sin SKU y activas, con aviso si salen de una variante desactivada.
- **Primera opción en un producto sin opciones:** su única variante pasa a ser una combinación y conserva QR, stock y pedidos.
- **Eliminar una opción guardada:** solo cuando le queda un único valor. Si es la última, la variante que queda debe estar activa y el producto vuelve a ser simple.
- **Valor sin variantes:** se quita en cualquier guardado (ficha, **Cambiar combinación** o **Eliminar variante**), con aviso en la confirmación.
- **Cambiar combinación:** desde el detalle, también en variantes desactivadas. Permite **Otro valor…** para un valor nuevo y se guarda al momento.
- **Variantes desactivadas:** sus precios y su SKU se editan desde el detalle. La tabla las muestra como texto y fuera de la selección en masa. Cuentan para el límite de 100.
- **Desactivar, activar y eliminar:** **Activar variante** no pide confirmación. **Desactivar** existe solo en productos con opciones. Las tres acciones son de a una variante.
- **Estado en curso:** botones deshabilitados con «Guardando…», «Desactivando…», «Activando…» o «Eliminando…». Sin conexión se separa del resultado dudoso.
- **Límite de 100:** es único y cuenta variantes. El editor lo comprueba con el producto de los valores al crear y con «actuales + nuevas» en un producto guardado. Core valida el resultado final. Agregar una opción a un producto grande puede quedar bloqueado (límite aceptado).
- **Reordenar sin arrastrar:** en web, el asa se enfoca y se mueve con las flechas. En móvil, **Subir** y **Bajar** al tocar el asa y como acciones del lector de pantalla; no hay arrastre en móvil en esta versión.
- **Chips:** son interruptores y se suman. Con **Filtrar por valor**, seleccionan solo lo visible. El chip activo lleva ícono de check y se anuncia «seleccionado».
- **Filas nuevas:** quedan al final hasta guardar y después se intercalan.
- **Detalle de variante no guardada:** en web, una ventana; en móvil, una pantalla completa. Tiene **Quitar**.
- **Productos sin opciones:** no tienen detalle de variante. El QR y la impresión siguen en la ficha de móvil, y la web sigue sin imprimirlos.
- **Fila web de la tabla:** el chevrón es decorativo; el enlace es la combinación.
- **Filas marcadas por su valor u opción:** se deshacen desde la línea del editor, no desde la fila.
- **Móvil, pantalla «Variantes»:** concentra los avisos, «combinaciones sin crear» y los rechazos por fila. La flecha conserva las ediciones. La ficha muestra «2 con errores» cuando un guardado se rechaza por variantes.
- **Combinaciones sin crear:** con varias, se pliegan en «N combinaciones sin crear» con **Ver**. **Agregar** respeta el límite de 100.
- **Pedidos del catálogo sin confirmar:** cuentan como pedidos para **Eliminar variante**, aunque la vendedora no los vea.
- **Impresión:** la hoja móvil de hoy se mantiene, con copias e impresora, y el detalle la abre con la variante elegida. Nombra las variantes «L / Azul» en el orden guardado e incluye las desactivadas marcadas. La etiqueta suma la combinación. En web se imprime con el diálogo del navegador.
- **Confirmación de descarte:** usa los textos de hoy de móvil, «¿Descartar cambios?», con **Descartar** y **Seguir editando**. En web es un cambio, porque hoy no confirma.
- **Formato de la combinación:** en «Nueva venta», pedidos y checkout no cambia, y solo se ordena.
- **Resultado dudoso al crear:** web usa el texto de hoy de móvil.
- **Pedido de catálogo sin confirmar con una variante luego desactivada:** se puede confirmar y pagar, y la vendedora lo resuelve por chat.
- **Mensaje→pedido:** no reconoce variantes desactivadas ni productos sin variantes activas. Un producto que queda con una sola variante activa pasa a reconocerse por foto.
- **Productos existentes:** quedan como productos sin opciones. No se convierten atributos, porque todavía no hay datos de clientes.
- **Versiones anteriores de la app:** no se mantiene compatibilidad. Todavía no hay clientes, así que la app y core cambian juntos (decisión del fundador, 2026-10-26).
- **Totales:** el stock total, «Desde» y «Agotado» se calculan solo con variantes activas.
- **Tamaños y nombres:** controles de al menos 44 px en móvil y 32 px en web. Nombres y valores de hasta 30 caracteres. Son valores iniciales, ajustables.
- **PR #150:** al entrar, `resolveVariant` y «Falta la variante» se conectan al orden guardado y excluyen las desactivadas. Queda anotado en el PR.
