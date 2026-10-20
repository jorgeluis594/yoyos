# Análisis de LATAM5S y comparación con Yoyos

Fecha de revisión: 29 de septiembre de 2026, hora de Lima. Algunos archivos y nombres de descarga indican 30 de septiembre porque utilizan UTC.

Este documento describe las funcionalidades de LATAM5S disponibles para una cuenta de emprendedor con plan Pro, su formulario público y su sitio comercial. Las compara con la implementación actual de Yoyos, tanto web como móvil. Está dirigido al equipo que debe evaluar qué necesita un cliente para trasladar su operación a Yoyos.

**Hallazgo principal:** LATAM5S resuelve la captura de datos de destinatarios y la organización del despacho posterior mediante formularios, estados, etiquetas y archivos para couriers. Yoyos tiene catálogo, stock y ventas cobradas y entregadas en el momento. Para un cliente que utiliza LATAM5S para despachar, las brechas decisivas de Yoyos están en la logística posterior a la venta.

## Alcance y calidad de la evidencia

La navegación se realizó con `playwright-cli`, usando las credenciales locales `USER_NUM` y `USER_PASSWORD`. Se recorrieron los tres módulos de la cuenta —Configurar, Compartir y Envíos—, los filtros, los menús de exportación, impresión y estados, las ramas activas del formulario público y la página comercial.

No se guardó configuración, cambió contraseña, activó prueba, contrató plan, creó pedido, cambió estado ni eliminó envío. No se enviaron mensajes de WhatsApp ni se cargaron archivos a couriers. La única descarga operativa fue un Excel local para verificar su estructura; no se incluye porque contiene datos personales.

Después del acceso se bloquearon las solicitudes distintas de GET, HEAD y OPTIONS. Se permitió adicionalmente el POST de autenticación de invitado que necesita el formulario público. Los POST autorizados fueron de autenticación; ninguna solicitud de escritura de pedidos o configuración se ejecutó. Para descubrir las secciones progresivas del formulario se ingresaron datos ficticios en el navegador, sin pulsar **Agendar y ver resumen**. Posteriormente se recargó el formulario para descartarlos.

Las conclusiones utilizan cuatro niveles de evidencia:


| Nivel              | Qué demuestra                                                                              | Qué no demuestra                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Observado          | Pantallas, opciones, búsquedas, filtros y datos devueltos por consultas durante la sesión. | El resultado de una acción de escritura que no se ejecutó.                           |
| Código del cliente | Comportamiento presente en el JavaScript público descargado por el navegador.              | Reglas o garantías del servidor, ni disponibilidad en otros planes o cuentas.        |
| Código de Yoyos    | Rutas, pantallas, contratos, casos de uso y persistencia del repositorio.                  | Que esa versión esté desplegada en producción o funcione en un dispositivo concreto. |
| Inferencia         | Interpretación del flujo apoyada en las evidencias anteriores.                             | Una funcionalidad adicional confirmada.                                              |


Las ausencias atribuidas a LATAM5S significan **no encontradas en las superficies revisadas**, no una afirmación sobre toda su plataforma o todos sus roles. No se exploraron cuentas ajenas, rutas administrativas restringidas ni vulnerabilidades. En Yoyos se examinó el commit `c1b37e149f451975862caba435544b014846103f`; no se ejecutó la aplicación ni sus pruebas durante esta revisión. Los documentos de diseño se contrastaron con el código y no se trataron automáticamente como funcionalidades implementadas.

## Posicionamiento y oferta comercial de LATAM5S

La [web comercial de LATAM5S](https://www.latam5s.com/) presenta la propuesta de convertir los datos de envío en rótulos y Excel para carga masiva. Su recorrido comercial enlaza un formulario de demostración, el acceso de clientes y solicitudes de contratación por WhatsApp. No se contactó al proveedor.


| Plan anunciado | Precio publicado durante la revisión | Funciones anunciadas                                                                                          |
| -------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Básico         | S/ 0                                 | Link personalizado, envíos organizados en WhatsApp y despacho por agencias. Incluye siete días de prueba Pro. |
| Pro            | S/ 49.90 al mes                      | Lo anterior, rótulos imprimibles, documentos para carga masiva y panel centralizado.                          |


La cuenta examinada mostraba **PLAN PRO**. El código del panel también contiene una oferta de historial ilimitado y prueba Pro de siete días. En la rama del plan Gratis, el cliente oculta los registros recibidos y muestra un contador de envíos ocultos. Ese comportamiento se identificó en el código; no se cambió de plan ni se verificó una sesión Básico o la autorización del servidor.

La web declara más de 100 mil envíos y más de 500 negocios. Son afirmaciones comerciales del proveedor, no métricas auditadas. Tampoco se verificó la promesa comercial de eliminar el error humano: la revisión sí demuestra selección de agencias y distritos desde listas, pero no exactitud de todos los datos ingresados.

**Inferencia:** la venta del producto se apoya en ahorrar trabajo administrativo de despacho. El formato para couriers y las etiquetas son resultados centrales, más que un catálogo de productos o una caja de ventas.

## Mapa funcional de la cuenta


| Superficie         | Funciones encontradas                                                                                                                                  | Evidencia                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Acceso             | WhatsApp y contraseña; acceso para socios registrados; cierre de sesión.                                                                               | Pantalla de acceso y panel. El cierre no se ejecutó como operación del servidor. |
| Configurar         | Nombre público, WhatsApp comercial, cambio de contraseña, métodos de entrega, días de despacho, hora de corte, anticipación y estados avanzados.       | Pantalla y consulta de configuración; sin cambios.                               |
| Compartir          | Formulario personalizado activo, enlace, copiar link, compartir por WhatsApp y abrir en otra pestaña.                                                  | Pantalla; se abrió el formulario mediante navegación, sin enviar mensajes.       |
| Envíos             | Listado agrupado por courier, resumen de cantidades, búsqueda, fecha, estados, selección, actualización, etiquetas, Excel y eliminación por selección. | Navegación y código público. Las escrituras no se ejecutaron.                    |
| Formulario público | Captura progresiva de WhatsApp, modalidad de entrega, destino, identidad, nombre y fecha.                                                              | Ramas activas recorridas sin enviar.                                             |
| Web comercial      | Explicación del flujo, planes, demostración y contacto por WhatsApp.                                                                                   | Página pública.                                                                  |


La navegación del panel cambia vistas dentro de la misma pantalla y mantiene la URL `/login`. No se encontraron en el menú de esta cuenta módulos separados de productos, inventario, caja, facturación, clientes, compras, reportes financieros o administración de equipo.

## Configuración logística

### Datos públicos y seguridad

La configuración contiene el nombre del emprendimiento y su WhatsApp, con prefijo peruano `+51`. La pantalla indica que el número debe comenzar con 9. El nombre aparece en el formulario del cliente y se utiliza como remitente en etiquetas y mensajes preparados.

La sección Seguridad incluye una nueva contraseña y un botón Actualizar. El botón Guardar de la configuración es independiente. Se identificaron ambos controles, sin ingresar ni guardar cambios en esta sección.

### Métodos de entrega

La pantalla ofrece las siguientes opciones:


| Método           | Tipo de destino identificado en el código | Situación durante la revisión                                                                  |
| ---------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shalom           | Agencia                                   | Activo; formulario y búsqueda de sedes recorridos.                                             |
| Olva Courier     | Agencia                                   | Activo; formulario y búsqueda de sedes recorridos.                                             |
| Marvisur         | Agencia                                   | Opción de configuración e historial existente; no activo para nuevos registros de esta cuenta. |
| Dinsides         | Domicilio                                 | Opción y rama en código; no activo en esta cuenta.                                             |
| Delivery         | Domicilio                                 | Activo; distrito, dirección y referencia recorridos.                                           |
| Retiro en tienda | Tienda                                    | Opción y rama en código; no habilitado ni probado en la cuenta.                                |
| Encomienda       | Agencia                                   | Opción y lista prevista en código; no habilitado ni probado en la cuenta.                      |
|                  |                                           |                                                                                                |


No se activaron métodos adicionales para explorarlos. El historial puede contener couriers que ya no están habilitados para nuevos formularios: se observaron registros de Marvisur aunque la configuración actual solo habilita Shalom, Olva y Delivery.

### Calendario y preparación

El comerciante puede definir los días de despacho de lunes a domingo, una hora de corte y una anticipación mínima en días. La cuenta tenía martes como día habilitado, corte a las 23:00 y anticipación de tres días. Son valores observados de esa cuenta, no valores universales del producto.

El código del formulario calcula un margen inicial con la anticipación y agrega un día cuando ya pasó la hora de corte. Desde ese margen examina una ventana de catorce días y ofrece solo los días de despacho habilitados. Durante la sesión aparecieron martes 6 y martes 13 de octubre.

La lógica consultada utiliza la fecha y hora local del navegador. No se verificó una regla equivalente en el servidor ni el comportamiento en todas las zonas horarias. La existencia de un calendario restringido queda demostrada; la garantía de cumplimiento en el backend queda pendiente.

### Estados avanzados

El interruptor observado estaba habilitado y su explicación indica que incorpora **EN PREPARACIÓN, EMPAQUETADO y CANCELADO**. La interfaz mantiene también PENDIENTE y ENVIADO.

Esto permite distinguir preparación, empaque y despacho. No se encontró un estado de entrega efectiva al destinatario ni prueba de que el courier actualice automáticamente estos estados.

## Captura de datos del cliente

### Distribución del formulario

El módulo Compartir entrega una URL personalizada con el patrón `/form?merchant=<identificador>`. Ofrece copiarla, enviarla por WhatsApp o abrirla en otra pestaña. El informe omite el identificador real y los teléfonos de la cuenta.

El formulario público muestra el nombre del negocio, la hora de corte y una instrucción para registrar los datos antes de esa hora. No solicita una cuenta de usuario ni una contraseña al comprador en las ramas examinadas. La página obtiene una credencial de invitado para cargar la configuración y permitir el registro.

### Flujo progresivo

1. El cliente ingresa su WhatsApp. Al alcanzar nueve dígitos se revela la selección del tipo de entrega.
2. Elige entre los métodos habilitados por el comerciante. En esta cuenta eran Shalom, Olva Courier y Delivery para Lima.
3. Ingresa o selecciona el destino correspondiente a la modalidad.
4. Completa los datos personales requeridos y su nombre.
5. Selecciona una fecha entre las opciones calculadas con el calendario del negocio.
6. Pulsa **Agendar y ver resumen**. Según el código público, este botón intenta guardar el envío y después muestra el resumen.
7. Desde el resultado puede preparar un mensaje para el WhatsApp del negocio. El envío del mensaje requiere la acción del usuario en WhatsApp.

Los pasos 1 a 5 se recorrieron sin envío. Los pasos 6 y 7 se describen a partir del código, porque ejecutarlos habría creado un registro o abierto una comunicación.

**Implicación de UX:** “Agendar y ver resumen” no funciona como una vista previa previa al guardado. El código invoca la creación del pedido antes de mostrar el resumen. No debe pulsarse en una exploración de solo lectura.

### Campos por modalidad


| Modalidad        | Campos encontrados                                                 | Comportamiento observado o identificado                                      |
| ---------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Agencia          | WhatsApp, agencia, DNI/CE para recoger, nombre y apellidos, fecha. | Búsqueda de sedes con ubicación y dirección; selección desde catálogo.       |
| Delivery         | WhatsApp, distrito, dirección exacta, referencia, nombre y fecha.  | Búsqueda de distritos; selección desde lista; dirección y referencia libres. |
| Retiro en tienda | WhatsApp, nombre y fecha.                                          | Rama del código sin agencia ni dirección; no habilitada en la cuenta.        |


Para Shalom y Olva se comprobaron búsquedas de sedes en Miraflores. Los resultados incluyen también otras localidades que coinciden con el texto buscado. La selección conserva el nombre de la agencia y su dirección. Los catálogos se cargan mediante GET de archivos JSON públicos; no se encontró una consulta directa al courier en ese flujo.

Para Delivery se verificó búsqueda y selección de distrito. El código contempla una lista de cobertura específica para Dinsides cuando ese método está activo. Si existen varios métodos de domicilio, el formulario los agrupa en una opción de delivery y prioriza Dinsides como courier de domicilio cuando está habilitado. Esa prioridad se identificó en código, sin modificar la configuración para probarla.

### Validaciones y datos recurrentes

El cliente valida un celular peruano de nueve dígitos que comienza con 9, un nombre de al menos tres caracteres, modalidad y fecha seleccionadas. Para agencias exige una selección coincidente con su catálogo. Para delivery exige distrito de la lista y referencia de al menos tres caracteres; dirección y otros campos usan también restricciones del formulario.

El documento de identidad se presenta como obligatorio para agencia y admite hasta quince caracteres en la interfaz examinada. No se identificó en la función de envío una comprobación adicional de formato de DNI/CE; esto no demuestra que el backend carezca de ella.

El código guarda datos del destinatario en el almacenamiento local del navegador, indexados por teléfono. Al volver a introducir un teléfono conocido en ese navegador puede recuperar nombre, modalidad y destino, dejando la fecha sin seleccionar. No se verificó esta recuperación guardando un cliente, porque hacerlo habría requerido ejecutar el registro. Es evidencia de código, no una consulta demostrada a un CRM remoto.

### Qué representa un registro

El objeto que construye el formulario contiene destinatario, teléfono, courier, fecha, instante de creación y destino. El campo `product` se asigna como `N/A` en la función examinada. No aparecen líneas de productos, cantidades comerciales, precios, total de venta ni comprobación de pago en ese flujo.

**Inferencia:** el cliente probablemente acuerda la compra por otro canal y usa LATAM5S para proporcionar los datos del despacho. La evidencia no permite reconstruir cómo se cobra o cómo se enlaza ese envío con una venta fuera de la aplicación.

## Operación del comerciante en Envíos

### Listado y datos disponibles

Los envíos se agrupan por courier. Cada tarjeta muestra destinatario, estado, teléfono, fecha de creación, fecha de envío y destino. Cuando existe, también muestra el documento de identidad. El destino puede ser agencia, domicilio o retiro en tienda. Cada tarjeta incluye una selección y un acceso para preparar un resumen por WhatsApp.

El panel lateral resume las cantidades por courier y el total de la lista filtrada. En la consulta agregada había 1.413 registros: 24 pendientes y 1.389 enviados. La vista inicial de pendientes contenía siete de Delivery y diecisiete de Shalom. Estos números describen la cuenta en el instante de consulta y no se utilizan como métricas generales del proveedor.

Los registros consultados contienen identificadores y campos de creación y actualización. Eso demuestra que esos campos existen en la respuesta; no demuestra un historial de auditoría visible, una bitácora inmutable ni la identidad verificada de cada operador.

### Filtros y búsqueda


| Control    | Comportamiento comprobado                                                                     |
| ---------- | --------------------------------------------------------------------------------------------- |
| Estado     | Pendientes, en preparación, empaquetados, enviados, cancelados y todos.                       |
| Fecha      | Filtra por fecha de envío. La fecha 3 de octubre devolvió trece pendientes durante la sesión. |
| Buscar     | Buscar Shalom en pendientes devolvió diecisiete registros.                                    |
| Actualizar | Control de recarga del listado, identificado en código como consulta de pedidos.              |
| Resumen    | Se recalcula con los resultados filtrados.                                                    |


Se recorrieron todos los filtros de estado. En preparación, empaquetados y cancelados mostraron cero resultados; enviados mostró 1.389 tarjetas. La falta de registros en un estado no elimina la funcionalidad del filtro.

Según el código, la búsqueda consulta nombre, teléfono, documento, distrito, agencia, dirección, referencia, courier, estado y diferentes representaciones de la fecha de creación. Los filtros se aplican en el navegador sobre los pedidos descargados. No se encontró paginación en este listado. La consulta y la vista de todos los registros respaldan ese comportamiento; no se realizó una prueba de rendimiento.

### Selección y operaciones por lote

Se puede seleccionar un envío o utilizar Todo para seleccionar los visibles. El código utiliza la selección como origen de las operaciones; cuando no hay selección, exportación e impresión utilizan los visibles. Cambiar filtros limpia la selección.

El menú Estado se abrió con un solo envío seleccionado y mostró opciones para marcarlo como pendiente, en preparación, empaquetado, enviado o cancelado. No se pulsó ninguna opción de cambio. El código indica que el cambio pide confirmación y luego envía una actualización por lote.

Existe un control de eliminación por selección. Su código solicita confirmación y llama a un endpoint específico de eliminación. El cliente reconoce también el estado interno ELIMINADO, pero no se verificó si eliminar implica baja lógica, borrado definitivo o posibilidad de recuperación en el backend. No se ejecutó ni abrió una confirmación de eliminación.

### Comunicación por WhatsApp

El control de cada tarjeta genera un enlace `wa.me` con el teléfono del cliente y un texto que incorpora nombre, negocio, estado, fecha, courier y destino. Para retiro en tienda cambia el texto del resumen. Se identificó esta generación en el código, sin abrir enlaces de comunicación.

No se encontró en ese recorrido una bandeja de conversaciones, envío automático mediante API, campañas, plantillas de Meta o registro de entregas de mensajes. **Preparar un enlace de WhatsApp no demuestra una integración automática de mensajería.**

## Etiquetas y exportaciones

### Etiquetas de despacho

Etiquetas abre un diálogo con una o dos columnas por hoja. Se verificó el diálogo sin iniciar impresión. Según el código, las etiquetas incluyen remitente, destinatario, documento cuando existe, celular, agencia o domicilio, referencia, courier y fecha.

El código excluye de la impresión los estados ENVIADO, CANCELADO y ELIMINADO. Los pendientes, en preparación y empaquetados pueden servir como origen. Utiliza la impresión del navegador; no se verificó ninguna impresora física ni el resultado en papel.

No se identificó un código de seguimiento del courier ni un código de barras de transporte en el diseño consultado. Son rótulos de destinatario para preparar bultos; no se deben considerar guías oficiales emitidas por el courier sin verificación adicional.

### Excel y carga masiva

El diálogo Excel identifica los couriers presentes en la selección o listado filtrado y ofrece sus formatos. En la vista de todo el historial mostró Shalom, Olva y Reporte General. El código tiene también un formato Dinsides, condicionado a que existan registros de ese courier. No se encontró un formato específico Marvisur aunque había registros históricos.


| Formato  | Contenido identificado                                                                                                | Nivel de verificación                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| General  | Fecha de creación, fecha de envío, courier, cliente, teléfono, agencia/distrito, dirección/referencia, DNI y estado.  | Descarga real y estructura del XLSX comprobadas; veinticuatro filas de datos.        |
| Shalom   | Documento y teléfono del destinatario, destino, campos de contacto, origen, mercadería, dimensiones, peso y cantidad. | Opción visible y transformación del código examinada; no se cargó al courier.        |
| Olva     | Modalidad, ubicación o tienda, datos del destinatario, empaque, artículo, valor, peso y dimensiones.                  | Opción visible y transformación examinada; no se cargó al courier.                   |
| Dinsides | Nombre, teléfono, distrito, dirección, fecha, observación y campos de producto, cobro y pago.                         | Transformación presente en código; sin registros activos para probarla en la cuenta. |


La exportación se construye en el navegador y descarga un archivo `.xlsx`. No se observó una transmisión automática del archivo a Shalom, Olva o Dinsides. **Inferencia operativa:** alguien debe cargarlo o utilizarlo fuera de LATAM5S para completar el proceso del courier.

Las plantillas incluyen valores predefinidos, por ejemplo cantidad uno y dimensiones/peso cero en Shalom; peso uno, dimensiones de diez centímetros y valor cero en Olva; monto a cobrar cero en Dinsides. El código de Olva también fija departamento y provincia como Lima. Esos campos no proceden de un catálogo comercial ni de una medición del paquete en el flujo revisado. La aceptación del archivo por el courier y la necesidad de completar campos externos no fueron verificadas.

Esto limita la interpretación de “listo para carga masiva”: se comprobó la generación de archivos, pero no su aceptación sin intervención en el sistema del transportista.

## Flujo de trabajo reconstruido

### LATAM5S

1. El comerciante define identidad pública y reglas de despacho. Los controles existen; no se modificaron durante la revisión.
2. Comparte su enlace personalizado por su canal comercial.
3. El comprador registra destinatario, modalidad, destino y fecha permitida.
4. El registro aparece como envío en el panel. La creación y el estado inicial se infieren del código y del listado, sin una creación de prueba.
5. El comerciante filtra el día de despacho y prepara los envíos por courier.
6. Puede marcar preparación y empaque, imprimir rótulos y generar Excel.
7. Gestiona la operación con el courier fuera del flujo automático observado y marca enviado.
8. Puede preparar un resumen para el cliente por WhatsApp.

Hay soporte para cancelación y eliminación, pero no se verificaron sus efectos. No se encontró un recorrido de cobro, factura o confirmación de entrega final.

### Yoyos

1. El vendedor accede a su empresa y registra productos con precio, foto y stock inicial opcional.
2. Abre Nueva venta y busca productos del catálogo.
3. Selecciona variantes y cantidades y puede asociar un contacto o vender a público general.
4. Revisa el total y confirma manualmente el cobro por billetera digital y la entrega en el momento.
5. El backend obtiene los precios vigentes, calcula el total y guarda la venta junto con el descuento de stock dentro de una transacción.
6. El vendedor consulta el historial y el detalle de la venta completada.

La venta se persiste como completada; no hay un pedido comercial pendiente que luego transite por preparación, despacho y entrega. Por tanto, los “pedidos” de LATAM5S y las `Order` actuales de Yoyos representan momentos y datos distintos de la operación.

## Funcionalidades actuales de Yoyos

### Web y API

El mapa de rutas web contiene acceso, registro, verificación de correo, recuperación de contraseña, inicio, productos y ventas. El backend expone operaciones de productos, ventas, imágenes, acceso y creación de empresa. El inicio privado muestra un saludo; no es actualmente un tablero de indicadores comerciales.

Productos tiene creación, catálogo, detalle y edición, nombre, descripción, foto, SKU, precio de venta y precio de compra opcional. El dominio y la API soportan variantes con atributos y códigos QR. Los formularios actuales crean una variante simple; cuando el producto tiene varias variantes, la pantalla web permite editar los datos generales y deja esas variantes en consulta. No se debe confundir soporte del modelo/API con un editor completo de combinaciones de variantes.

El stock inicial es opcional y se muestra después de crear. La edición no ofrece ajuste de existencias. Las ventas completadas descuentan stock mediante una operación condicionada a disponibilidad suficiente; un fallo revierte la transacción completa. No se encontró un módulo de movimientos manuales, compras, almacenes o reposición.

Ventas permite búsqueda de productos por nombre, variantes y cantidades, cliente opcional, confirmación manual de billetera digital, listado paginado y detalle. Los filtros del historial incluyen cliente y fechas de venta. Conserva datos históricos del producto, precio, cliente y vendedor.

El precio final lo obtiene el backend del catálogo. No hay modificación libre de precio ni descuento en la venta actual. No se encontró cancelación de una venta completada, cobro parcial, contraentrega, devolución, comprobante fiscal o entrega posterior. La billetera digital se registra por confirmación del vendedor; no hay una integración bancaria demostrada que confirme automáticamente el dinero.

### Móvil

La aplicación móvil tiene navegación a Inicio, Productos y Ventas. Incluye catálogo, búsqueda por nombre o SKU, creación y gestión de producto, captura de foto mediante cámara o galería, pantallas de nueva venta, historial y detalle. Utiliza el mismo backend para productos y ventas.

Para etiquetas de productos existe renderizado con nombre, SKU y QR, y operaciones de impresión con un adaptador Brother habilitado en Android. El código contempla selección de impresora y copias. No se verificó impresión física ni compatibilidad efectiva en este análisis. Estas etiquetas identifican productos; no sustituyen los rótulos de destinatario de LATAM5S.

El móvil contempla una confirmación pendiente local cuando la respuesta de creación de venta es incierta y consulta la venta por ID para resolverla. Esto protege el seguimiento de una confirmación de red; no constituye un pedido pendiente de despacho ni una capacidad general de ventas sin conexión.

### WhatsApp y contactos

El backend tiene un webhook de WhatsApp con validación de firma, conexión asociada a empresa, recepción de texto e imagen, creación/actualización de contacto y persistencia de conversaciones y mensajes. Las conexiones requieren configuración de entorno. Esa implementación es distinta de abrir un enlace `wa.me`.

No se encontró una bandeja de chats en las rutas web o móviles revisadas ni una interfaz de conexión de WhatsApp para el usuario. Tampoco se identificó envío de mensajes desde esas pantallas. Es una capacidad implementada en backend cuya puesta en servicio depende de configuración; no una experiencia completa de mensajería ya demostrada para el comerciante.

### Países y aislamiento

Los contratos enumeran Perú, Estados Unidos, Colombia, Argentina, Chile y Brasil con su moneda correspondiente. Las rutas web contemplan locales por país. Eso demuestra soporte en datos y rutas, no traducción completa o despliegue comercial en todos esos mercados.

La empresa y el vendedor de la venta provienen del acceso autenticado. El repositorio implementa aislamiento por empresa y operaciones transaccionales. No se hizo una auditoría de seguridad ni se compararon garantías del servidor de LATAM5S con las de Yoyos.

## Comparación funcional

En esta tabla, “no encontrado” se refiere al alcance de la cuenta y superficies examinadas; “sin implementación encontrada” se refiere al código actual de Yoyos, no a sus planes futuros.


| Capacidad                            | LATAM5S                                                                | Yoyos actual                                                                 | Implicación para el cliente                                     |
| ------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Formulario público para destinatario | Observado, personalizado por negocio.                                  | Sin implementación encontrada.                                               | Yoyos requeriría recoger esos datos por otro canal.             |
| Enlace para compartir                | Observado, con controles de copia y WhatsApp.                          | Sin enlace logístico equivalente encontrado.                                 | Falta el punto de entrada del comprador para despacho.          |
| Catálogo comercial                   | No encontrado en el recorrido; formulario usa producto `N/A`.          | Web, API y móvil implementados.                                              | Yoyos gestiona qué se vende.                                    |
| SKU, precios y variantes             | No encontrados como gestión comercial.                                 | Modelo/API; UI de creación simple y edición limitada de múltiples variantes. | Ventaja de Yoyos para controlar el producto.                    |
| Stock y descuento por venta          | No encontrados.                                                        | Stock inicial y descuento transaccional; sin ajustes manuales.               | Yoyos vincula venta y existencias, con límites de reposición.   |
| Venta con artículos e importe        | Registro logístico sin líneas o total en el flujo revisado.            | Venta completada con líneas y total calculado.                               | Son entidades distintas; no basta copiar un estado.             |
| Cobro                                | No encontrado en el formulario.                                        | Billetera confirmada manualmente.                                            | Ninguno demuestra conciliación bancaria automática aquí.        |
| Cliente o destinatario               | Datos por envío y cache local del navegador.                           | Contactos por empresa, selección en venta e historial.                       | Yoyos tiene identidad comercial; falta dirección logística.     |
| Agencias y distritos                 | Búsquedas de catálogos observadas.                                     | Sin catálogos logísticos encontrados.                                        | Brecha directa para envíos nacionales y delivery.               |
| Fecha futura de despacho             | Calendario con días, corte y anticipación.                             | Sin implementación encontrada; venta y entrega inmediatas.                   | Brecha central para preparar y despachar después.               |
| Preparación, empaque y enviado       | Opciones observadas, actualización por lote en código.                 | Sin ciclo logístico encontrado.                                              | Yoyos no puede representar ese trabajo operativo actual.        |
| Cancelación y eliminación            | Controles y llamadas en código; efectos no ejecutados.                 | Sin anulación de ventas completadas encontrada.                              | No asumir que ambos cancelan o revierten lo mismo.              |
| Agrupación por courier               | Observada, con conteos.                                                | Sin implementación encontrada.                                               | Falta organizar el día de despacho por transportista.           |
| Filtros                              | Estado, fecha de envío y búsqueda amplia; cliente filtra en navegador. | Cliente, fechas de venta y paginación del historial.                         | Buscan eventos distintos: despacho frente a venta.              |
| Rótulos de envío                     | Diálogo de una/dos columnas y generación en código.                    | Sin implementación encontrada.                                               | Las etiquetas de producto de Yoyos no cubren destinatarios.     |
| Etiquetas de producto con QR         | No encontradas.                                                        | Impresión móvil Brother en Android implementada en código.                   | Ventaja de Yoyos para identificar mercadería.                   |
| Excel para couriers                  | Opciones Shalom/Olva; Dinsides en código.                              | Sin implementación encontrada.                                               | Brecha para evitar volver a digitar datos de despacho.          |
| Exportación general                  | Descarga XLSX de pendientes verificada.                                | Sin exportación equivalente encontrada.                                      | El cliente perdería un soporte operativo externo.               |
| Integración automática con courier   | No demostrada; se observan listas y archivos.                          | Sin implementación encontrada.                                               | No hay evidencia de compra de guía o tracking automático.       |
| Resumen por WhatsApp                 | Enlace preparado desde código; sin envío automático observado.         | Webhook receptor en backend; sin bandeja ni envío en UI encontrados.         | Capacidades distintas, todavía sin equivalencia de experiencia. |
| Entrega final y tracking             | No encontrados en el flujo revisado.                                   | Sin implementación logística encontrada.                                     | “Enviado” no prueba recepción del destinatario.                 |
| App móvil dedicada                   | No verificada; formulario web con diseño para móvil.                   | Expo/React Native en el repositorio.                                         | Yoyos dispone de un canal móvil propio en código.               |
| Finanzas y comprobantes fiscales     | No encontrados.                                                        | Sin módulo encontrado.                                                       | Ninguno cubre esas necesidades con la evidencia actual.         |
| Métricas                             | Conteos logísticos y oferta comercial de historial.                    | Inicio sin métricas; historial de ventas.                                    | No se demostró un tablero financiero avanzado.                  |
| Planes de suscripción                | Básico y Pro anunciados; cuenta Pro observada.                         | Sin módulo comercial de planes encontrado.                                   | Diferencia de oferta, no requisito automático de producto.      |


## Brechas para reemplazar la operación de LATAM5S

### Captura y despacho posterior

La principal brecha es un flujo para recoger datos del destinatario y llevar un envío hasta su despacho. Yoyos necesita poder representar agencia o domicilio, documento de retiro, referencia, courier y fecha, además de la relación con la venta cuando exista.

**Recomendación:** evaluar primero ese flujo con el cliente antes de ampliar pagos, analítica o múltiples integraciones. Debe definirse cuándo nace el envío respecto de la venta y qué sucede con stock, cobro y cancelación. El informe no propone convertir una venta completada en un envío modificando solo su campo de estado.

### Preparación y trabajo por lotes

LATAM5S permite ver pendientes por fecha y courier, preparar un grupo y obtener sus etiquetas o archivo. Esa secuencia constituye una unidad de trabajo útil para quien despacha decenas de paquetes.

**Recomendación:** si el cliente necesita sustituir esa operación, priorizar una vista de pendientes con filtros de despacho, agrupación por courier, selección y rótulos de destinatario. La conveniencia de preparación/empaque por separado debe confirmarse con su operación real; la cuenta revisada habilita esos estados, pero no tenía registros en ellos.

### Archivos para los couriers utilizados

La cuenta utilizaba Shalom, Delivery y Olva en su configuración actual y tenía Marvisur en el historial. Para sustituir su proceso no basta una exportación genérica si hoy utiliza una plantilla del transportista.

**Recomendación:** confirmar qué archivos carga realmente el cliente y qué campos completa después. Implementar los formatos necesarios con ejemplos autorizados y requisitos vigentes del courier; no copiar como garantía los valores de peso, dimensiones o importes predefinidos de LATAM5S. Esta revisión no validó esos formatos contra documentación del transportista.

### Comunicación y estados

Un resumen preparado por WhatsApp puede cubrir una necesidad inmediata sin requerir automatización de Meta. Sin embargo, no aporta por sí mismo trazabilidad de envío o entrega de mensajes.

**Recomendación:** decidir con el cliente si necesita un enlace manual o mensajería automática. Reutilizar el backend receptor de Yoyos cuando resulte pertinente, sin presentar su mera existencia como una interfaz terminada de conversaciones.

### Capacidades que Yoyos ya aporta

Yoyos puede complementar la logística con catálogo, precios, stock y ventas históricas. La oportunidad consiste en vincular venta y despacho para reducir duplicación de datos. Esa relación aún no está implementada y no debe anunciarse como una ventaja disponible hoy.

Si el cliente solo necesita coordinar envíos de compras realizadas por WhatsApp, el POS inmediato de Yoyos no reemplaza LATAM5S por sí solo. Si también necesita inventario y ventas, Yoyos aporta una base que LATAM5S no mostró en el recorrido, pero sigue pendiente cubrir el despacho.

## Límites y preguntas para la evaluación del cliente

No se comprobó la creación de un envío, una actualización de estados, una cancelación, una eliminación o una modificación de configuración. No se debe realizar una prueba de esas acciones en esta cuenta para cerrar las incertidumbres. La validación de escrituras requeriría un entorno de pruebas autorizado distinto de producción.

Quedaron sin verificación: recepción efectiva por el courier, aceptación de archivos de carga, impresión física, entrega final, reglas del backend, funcionamiento del plan Básico, permisos de otros roles, facturación de la suscripción, app móvil propia de LATAM5S y garantías de seguridad o disponibilidad. La pantalla “Enlace no válido” que apareció inicialmente al abrir el formulario fue consecuencia del bloqueo de autenticación de invitado; no se trata como defecto del producto.

Para decidir el alcance de una sustitución conviene obtener respuestas del cliente a estas preguntas:

1. ¿Dónde registra artículos y cobros antes de agendar el envío?
2. ¿Cuál es la relación entre una compra y sus envíos: uno a uno, parciales o agrupados?
3. ¿Usa etiquetas y Excel o solo el formulario y WhatsApp?
4. ¿Qué couriers utiliza hoy y qué información debe completar fuera de LATAM5S?
5. ¿Necesita preparación y empaque separados, o solo pendiente y enviado?
6. ¿Cómo gestiona cambios de dirección, duplicados y cancelaciones?
7. ¿Qué confirma la entrega al destinatario y quién actualiza el sistema?

Estas preguntas son para una decisión posterior de producto. No condicionan ni reducen la exploración de solo lectura realizada.

## Fuentes y evidencia verificable

### LATAM5S

Las superficies se consultaron con el navegador durante la revisión. Los assets públicos corresponden a la versión servida en esa fecha; pueden cambiar posteriormente.


| Fuente                                                                           | Evidencia utilizada                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Web comercial](https://www.latam5s.com/)                                        | Propuesta, planes, precios publicados y canales de contacto.                                           |
| [Acceso de clientes](https://www.latam5s.com/login)                              | Login y navegación autenticada de la cuenta; contenido privado no publicado en este informe.           |
| Formulario personalizado de la cuenta                                            | Campos y ramas activas; se omite el identificador del negocio.                                         |
| [Código público del panel](https://www.latam5s.com/assets/login-CDk8jSsS.js)     | Filtros, selección, estados, mensajes, exportaciones, impresión y ramas por plan.                      |
| [Código público del formulario](https://www.latam5s.com/assets/form-B-F_SX8m.js) | Captura progresiva, calendario, validaciones, cache local y secuencia de guardado/resumen.             |
| [Cliente HTTP público](https://www.latam5s.com/assets/rest-client-DgUmF1dG.js)   | Distinción entre autenticación, consultas y endpoints de escritura que no se ejecutaron.               |
| Consultas GET de configuración y pedidos                                         | Configuración activa y conteos agregados; no se incluyen datos personales.                             |
| Reporte General descargado                                                       | XLSX local verificado: nueve columnas y veinticuatro registros pendientes; archivo privado no adjunto. |


El archivo [evidencia-latam5s.json](evidencia-latam5s.json) conserva un resumen sin datos personales de superficies, comprobaciones, conteos y métodos HTTP. Las capturas y archivos operativos originales se mantienen fuera del repositorio y no forman parte de la entrega.

### Yoyos


| Fuente del repositorio                                                                                                                                                                                                                                                       | Qué respalda                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Rutas web](../../apps/core/app/routes.ts) y [servidor de aplicación](../../apps/core/src/app.ts)                                                                                                                                                                                  | Superficies disponibles y endpoints montados.                           |
| [Inicio web](../../apps/core/app/routes/dashboard.tsx)                                                                                                                                                                                                                          | Inicio actual sin tablero de métricas.                                  |
| [Nueva venta web](../../apps/core/app/routes/order-new.tsx), [listado](../../apps/core/app/routes/order-list.tsx) y [detalle](../../apps/core/app/routes/order-detail.tsx)                                                                                                            | Recorrido, filtros y consulta de ventas.                                |
| [Creación de venta](../../apps/core/src/features/orders/application/create-order.ts) y [dominio de orden](../../apps/core/src/features/orders/domain/order.ts)                                                                                                                     | Venta completada, cálculo, cliente y coordinación transaccional.        |
| [Stock de venta](../../apps/core/src/features/products/infrastructure/order-stock.ts)                                                                                                                                                                                           | Consulta del catálogo y descuento condicionado por existencias.         |
| [Formulario de producto](../../apps/core/src/features/products/presentation/product-form.tsx) y [gestión web](../../apps/core/app/routes/product-detail.tsx)                                                                                                                       | Stock inicial, edición y límites de variantes en UI.                    |
| [Dominio de producto](../../apps/core/src/features/products/domain/product.ts) y [schema](../../apps/core/prisma/schema.prisma)                                                                                                                                                    | Productos, variantes, stock, contactos, mensajes y órdenes persistidas. |
| [Navegación móvil](../../apps/mobile/src/components/app-tabs.tsx) y [operaciones de venta móvil](../../apps/mobile/src/features/orders/application/order-operations.ts)                                                                                                            | Acceso móvil a ventas y resolución de confirmaciones inciertas.         |
| [Composición de productos móvil](../../apps/mobile/src/features/products/composition.ts), [render de etiqueta](../../apps/mobile/src/features/products/infrastructure/product-label-renderer.ts) y [composición de impresión](../../apps/mobile/src/features/printing/composition.ts) | Etiquetas de productos con QR y adaptador Android.                      |
| [Webhook WhatsApp](../../apps/core/src/features/chats/presentation/whatsapp-webhook.ts) y [registro de mensajes](../../apps/core/src/features/chats/application/record-message.ts)                                                                                                 | Recepción autenticada de eventos y persistencia.                        |
| [Países y monedas](../../shared/country.ts)                                                                                                                                                                                                                                     | Países y monedas admitidos por los contratos.                           |


La revisión no modificó el código de Yoyos. El único contenido añadido al repositorio para esta tarea es el informe y su evidencia resumida.