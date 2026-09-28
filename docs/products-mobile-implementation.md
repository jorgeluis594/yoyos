# Productos en mobile: definición de producto y API

**Estado:** definición para implementar. El módulo de productos de core ya tiene casos de uso y pantallas web; `/api/products` aún no existe. La [arquitectura técnica](products-mobile-architecture.md) desarrolla esta definición.

## Objetivo y fuente de verdad

La persona puede encontrar, crear, consultar y editar los mismos productos de su empresa desde iOS y Android. Mobile adapta la navegación y los controles a cada plataforma, pero conserva las reglas y los resultados de [productos en core](products-implementation.md). Core es la fuente de verdad para validación, identificadores, precios, stock, imágenes y persistencia. La API expone los casos de uso existentes `list`, `get`, `create` y `update`; no implementa otra lógica de negocio.

## Flujo en mobile

1. Tras iniciar sesión y tener una empresa activa, la navegación principal ofrece **Productos** como pestaña principal. Sin sesión o sin empresa, se mantiene el flujo de acceso actual.
2. **Catálogo:** lista de productos de la empresa, ordenados del más reciente al más antiguo. Cada fila muestra nombre, SKU o «Varias variantes»/«Sin SKU», precio de venta o «Desde» cuando las variantes difieren, y stock total. La búsqueda parcial por nombre o SKU ignora mayúsculas; cambiar la búsqueda vuelve a la primera página. Se cargan páginas de 20; el control **Cargar más** solicita la siguiente mientras `total` indique que quedan productos. Al volver desde un producto se conservan la búsqueda, los productos cargados y la posición de la lista. El estado vacío del catálogo, una búsqueda sin resultados y un fallo de carga son estados distintos. Desde aquí se abre un producto o **Nuevo producto**.
3. **Nuevo producto:** formulario con nombre, descripción opcional, foto opcional, SKU opcional, precio de venta, precio de compra opcional y stock inicial opcional. La moneda se muestra según el país de la empresa, sin selector. Mobile genera el ID UUIDv4 del producto al enviar una creación válida; el formulario crea exactamente una variante con `attributes: {}`. Guardar crea el producto y abre su pantalla de gestión; Cancelar vuelve al catálogo sin crear nada.
4. **Gestión del producto:** abre una pantalla editable, como en core, y muestra nombre, descripción, foto, moneda y variantes. Con una variante se editan nombre, descripción, foto, SKU y precios; el stock se ve sin edición. Con varias variantes se ven los atributos, SKU, precios y stock de todas, y solo se editan los datos generales y la foto. Guardar permanece en esta pantalla y confirma el éxito; Cancelar vuelve al catálogo sin guardar. Un producto inexistente o de otra empresa muestra «Producto no encontrado».
5. **Foto:** se puede elegir de la galería o tomar con la cámara. La imagen se sube antes de guardar y se muestra una vista previa. Si se deniega el permiso de cámara, el formulario conserva los datos y permite usar la galería. Un fallo de subida conserva el formulario y permite reintentar. En edición se puede reemplazar o quitar la asociación. Quitarla no borra el archivo. Cancelar después de subir puede dejar una imagen sin asociar, igual que en core.

Si hay cambios sin guardar en creación o edición, Atrás, Cancelar y cambiar de pestaña piden confirmar que se descartarán. Si se elige seguir editando, el formulario permanece intacto; si se confirma, se sale sin guardar. Sin cambios, la salida es directa.

Durante carga y guardado se muestra progreso y se evita un segundo envío. Los errores de campos se muestran junto a su control y se conserva lo escrito. Un fallo de red o del servidor muestra una opción de reintento sin presentar un falso catálogo vacío, un falso «no encontrado» ni una confirmación de guardado. Una respuesta pendiente de una sesión anterior no debe volver a mostrar datos privados tras cerrar sesión.

## Reglas de paridad

| Tema | Comportamiento |
| --- | --- |
| Acceso | Cualquier usuario autenticado de la empresa puede crear, ver y editar sus productos. Core obtiene la empresa de la sesión; mobile nunca envía `companyId`. Un ID de otra empresa no revela datos. |
| Nombre y texto | Nombre obligatorio, máximo 200 caracteres; descripción opcional, máximo 5 000. Los nombres repetidos están permitidos. |
| SKU | Opcional y sin generación automática; máximo 100 caracteres. Se recortan espacios al inicio y final y se exige unicidad dentro de la empresa sin distinguir mayúsculas. Puede haber varios productos sin SKU. |
| Precios | Venta mayor que cero; compra opcional y mayor o igual a cero. Máximo 999 999 999,99 y dos decimales. El dinero se expresa en unidades principales, como `{ "amount": 12.50, "currency": "PEN" }`. |
| Moneda | Mobile envía explícitamente la moneda del país de la empresa: PE/PEN, US/USD, CO/COP, AR/ARS, CL/CLP, BR/BRL. Core valida el código enviado. La moneda no se edita después. |
| Stock | Inicial opcional, entero no negativo; ausente equivale a cero. Tras crear, es solo lectura. El total del catálogo suma todas las variantes. |
| Variantes | Todo producto tiene al menos una. El formulario mobile crea una con atributos vacíos. Si el producto tiene varias, mobile las muestra todas y no elige una implícitamente para editarla. |
| IDs y QR | Mobile genera y envía solo el ID UUIDv4 del producto al crear; core valida ese ID y genera los IDs de variantes y los códigos QR. Ningún ID ni QR se edita después. No se muestran ni imprimen códigos QR en este alcance. |
| Cambios | `name`, `description`, `imageId`, `sku`, `salePrice` y `purchasePrice` son editables según el número de variantes. Omitir un campo preserva su valor; `null` limpia los opcionales. Stock, atributos, moneda, estado, IDs y QR no son editables. |

## API de productos por implementar en core

Mobile llama estas rutas con `Authorization: Bearer <token>` y una empresa activa, como `/api/images`. Core conserva su middleware de autenticación API, que también acepta la sesión web por cookie. Las peticiones de escritura usan `Content-Type: application/json` y aceptan hasta 100 kB de JSON; las fotos se suben por multipart a `/api/images`. Las respuestas son JSON, con `Cache-Control: no-store`; las fechas del detalle se serializan como ISO 8601 UTC. Core aplica el contexto de empresa y sus restricciones de base de datos. Mobile usa su cliente HTTP autenticado existente y valida las respuestas antes de mostrarlas. La [frontera HTTP y serialización](products-mobile-architecture.md#frontera-http-y-serialización-json) precisa el procesamiento en Express.

Las versiones mobile publicadas siguen aceptando campos adicionales de respuesta y muestran un fallo genérico si core introduce un código de error nuevo. Core mantiene estables los campos y códigos existentes; las peticiones de escritura conservan validación estricta. La [política de compatibilidad](products-mobile-architecture.md#compatibilidad-entre-versiones-mobile-y-api) permite evolucionar esta API sin exigir una actualización simultánea de la app.

| Operación | Ruta | Éxito |
| --- | --- | --- |
| Catálogo | `GET /api/products?search=&page=1&pageSize=20` | `200` con `items`, `page`, `pageSize`, `total` |
| Detalle | `GET /api/products/:productId` | `200` con `{ product, image? }` |
| Crear | `POST /api/products` | `201` con `{ id }` |
| Editar | `PATCH /api/products/:productId` | `200` con `{ id }` |

### Catálogo y detalle

`search` es opcional y se recortan solo sus extremos. `page` empieza en 1, `pageSize` por defecto es 20 y su máximo es 100. No se aceptan parámetros desconocidos ni repetidos. La búsqueda coincide parcialmente con el nombre o con cualquier SKU, sin duplicar productos. Una coincidencia de SKU no reduce las variantes que participan en el resumen. El orden es `createdAt` descendente y luego ID. `total` cuenta productos distintos de la empresa que coinciden. El [tipo de criterios de mobile y sus errores](products-mobile-architecture.md#criterios-del-catálogo) se mantiene separado de los campos de producto.

```json
{
  "items": [{
    "id": "7a1c5145-00ad-4d64-babd-10621af06fb1",
    "name": "Polo",
    "variantCount": 1,
    "sku": "POLO-01",
    "minSalePrice": { "amount": 49.9, "currency": "PEN" },
    "hasDifferentPrices": false,
    "totalStock": 8
  }],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

`sku` se omite en la fila si no existe o si hay varias variantes. El detalle expone los campos públicos acordados del producto, todas sus variantes y el stock de cada una mediante una [proyección explícita a DTO](products-mobile-architecture.md#presenter-de-la-api-y-datos-de-pantalla), sin serializar la entidad de core directamente. `image` se omite cuando no hay foto; si existe contiene `{ "id": "…", "url": "https://…" }`. La URL sirve para mostrar la imagen; el producto conserva `imageId`, no la URL. Las propiedades opcionales ausentes se omiten; no se convierten en `null` en la respuesta. La API devuelve datos como precio mínimo y si los precios difieren; mobile decide cómo presentarlos en texto.

```json
{
  "product": {
    "id": "7a1c5145-00ad-4d64-babd-10621af06fb1",
    "name": "Polo",
    "description": "Algodón",
    "imageId": "d53aa07c-5483-475c-8bf6-9b57045db671",
    "currency": "PEN",
    "qrCode": "2b38df10-34e0-46ba-adad-88ee783ac277",
    "status": "active",
    "createdAt": "2026-09-25T12:00:00.000Z",
    "updatedAt": "2026-09-25T12:00:00.000Z",
    "variants": [{
      "id": "e4446057-ff8e-4ca8-a14c-6dd0f2ac2e34",
      "productId": "7a1c5145-00ad-4d64-babd-10621af06fb1",
      "attributes": {},
      "sku": "POLO-01",
      "salePrice": { "amount": 49.9, "currency": "PEN" },
      "purchasePrice": { "amount": 20, "currency": "PEN" },
      "qrCode": "100872d1-4ca2-444f-8a2e-7110de62e0f1",
      "status": "active",
      "stock": { "variantId": "e4446057-ff8e-4ca8-a14c-6dd0f2ac2e34", "quantity": 8 }
    }]
  },
  "image": { "id": "d53aa07c-5483-475c-8bf6-9b57045db671", "url": "https://images.example.com/polo.webp" }
}
```

### Crear

```json
{
  "id": "7a1c5145-00ad-4d64-babd-10621af06fb1",
  "name": "Polo",
  "description": "Algodón",
  "imageId": "d53aa07c-5483-475c-8bf6-9b57045db671",
  "currency": "PEN",
  "variants": [{
    "attributes": {},
    "sku": "POLO-01",
    "salePrice": 49.9,
    "purchasePrice": 20,
    "initialStock": 8
  }]
}
```

`description`, `imageId`, `sku`, `purchasePrice` e `initialStock` pueden omitirse. La API acepta una o más variantes conforme al caso de uso de core; la pantalla inicial de mobile envía una sola. Core valida todas las variantes, la unicidad de SKU y combinaciones de atributos, y crea producto, variantes y stock en una operación atómica. El cliente recibe únicamente el ID para abrir el detalle.

El `id` del JSON es el UUIDv4 que genera mobile para **ese producto**. Core valida el formato antes de crear y lo usa como ID persistido. El primer `POST` con ese ID puede crear el producto y devuelve `201 { id }`; cualquier `POST` posterior con el mismo ID devuelve `409 PRODUCT_ID_CONFLICT`, aunque el cuerpo sea idéntico. La autenticación y el aislamiento por empresa siguen siendo obligatorios; conocer un ID no concede acceso. Un `id` ausente o inválido devuelve `400 INVALID_INPUT`. Los IDs de variantes y los QR siguen siendo responsabilidad de core. La [restricción de unicidad](products-mobile-architecture.md#creación-con-id-aportado-por-mobile) se detalla en la arquitectura.

### Editar

```json
{
  "name": "Polo clásico",
  "description": null,
  "imageId": null,
  "variants": [{
    "id": "e4446057-ff8e-4ca8-a14c-6dd0f2ac2e34",
    "sku": null,
    "salePrice": 54.9,
    "purchasePrice": 0
  }]
}
```

La actualización es un parche: cada variante enviada se identifica por `id`; las omitidas permanecen iguales. Un arreglo `variants` vacío no modifica variantes. `null` limpia descripción, foto, SKU o precio de compra; un campo omitido permanece igual. El formulario con varias variantes no envía `variants`. Core rechaza IDs de variantes ajenas o repetidas y campos desconocidos o no editables. Los cambios se guardan atómicamente; un parche sin cambios válidos responde con éxito sin actualizar `updatedAt`.

### Imagen

Tanto una foto elegida de la galería como una tomada con la cámara usan la [API de imágenes existente](images-api.md): `POST /api/images` con una sola parte multipart `file` devuelve `201 { id, url }`. Acepta JPG, PNG o WebP estáticos de hasta 10 MB y los límites de dimensiones documentados allí. Después mobile envía solo `imageId` a crear o editar. Core verifica que la imagen pertenezca a la empresa; quitar la asociación envía `imageId: null` y no llama a una ruta de borrado.

### Errores y contrato de transporte

La API mantiene el sobre compartido `{ "code": "…", "error": "…" }`; `error` es un mensaje técnico y mobile elige el texto visible por `code` y, cuando corresponda, por `issues`. Los códigos nuevos deben incorporarse al esquema compartido de errores y al transporte mobile. Los errores de campos añaden `issues` sin perder `scope`, `field`, `index`, `reason` ni parámetros como `maxLength`, para que mobile pueda asociarlos al control correcto. Un error de formato JSON o de tipos/campos desconocidos también identifica los campos afectados. No se comparan cadenas de `error` para decidir la interfaz.

Por ejemplo, un error de dominio puede responder `{ "code": "VALIDATION_ERROR", "error": "Invalid product", "issues": [{ "scope": "product", "field": "name", "reason": "TOO_LONG", "maxLength": 200 }] }`. Los errores de formato usan ubicaciones de entrada como `variants.0.salePrice`. Mobile debe conservar `issues` al procesar el sobre de error; su cliente HTTP actual solo conserva `code` y `error`.

| Condición | HTTP | `code` propuesto |
| --- | --- | --- |
| Sin sesión | 401 | `UNAUTHENTICATED` |
| Sin empresa activa | 409 | `COMPANY_REQUIRED` |
| JSON mal formado, tipo/formato de consulta o ID inválido, o campo desconocido | 400 | `INVALID_INPUT` |
| Cuerpo JSON mayor que 100 kB | 413 | `PAYLOAD_TOO_LARGE` |
| Tipo de contenido de escritura distinto de JSON | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Regla de producto o rango de criterio de listado incumplido | 422 | `VALIDATION_ERROR` |
| SKU usado por otra variante de la empresa | 409 | `DUPLICATE_SKU` |
| ID de producto ya existente, con cualquier contenido | 409 | `PRODUCT_ID_CONFLICT` |
| Producto ausente o de otra empresa | 404 | `PRODUCT_NOT_FOUND` |
| Imagen ausente o de otra empresa al asociarla | 404 | `IMAGE_NOT_FOUND` |
| Servicio o almacenamiento no disponible | 503 | `SERVICE_UNAVAILABLE` |
| Error inesperado o respuesta interna inválida | 500 | `INTERNAL_ERROR` |

Un ID de ruta con formato inválido usa `400 INVALID_INPUT`. Un fallo técnico al resolver una imagen asociada se trata como indisponibilidad, no como producto ausente. La API de imágenes conserva sus propios códigos. En mobile, los fallos de red, respuesta inválida y operación cancelada por cambio de sesión siguen siendo errores locales de transporte. Mobile no reintenta escrituras automáticamente ante un fallo de red. Si una creación queda incierta, el formulario conserva su ID; un reintento con ese ID puede recibir `409 PRODUCT_ID_CONFLICT`. Mobile muestra el conflicto y ofrece revisar el catálogo antes de iniciar otra creación; no lo presenta como éxito ni genera otro ID automáticamente. Una edición `PATCH` conserva el tratamiento de resultado incierto y permite consultar el detalle antes de reenviar.

## Integración y alcance

- En core, añadir un adaptador HTTP para estas cuatro rutas que reutilice la composición actual de productos, las reglas de entrada estricta de creación/edición, la autenticación API y el contexto de empresa. Definir contratos JSON compartidos para peticiones y respuestas; convertir `Date` a ISO y verificar la salida en el límite HTTP. Usar la clave primaria existente de `Product` para rechazar IDs duplicados; no hay migración para este contrato. Ajustar el manejo de JSON mal formado para que estas rutas devuelvan `INVALID_INPUT` (el manejador API actual devuelve `INVALID_COMPANY`).
- En mobile, consumir las rutas mediante el cliente autenticado existente y validar las respuestas. Adaptar el modelo propio de `apps/mobile/src/features/products/` a los campos que usan estas pantallas y mapearlo desde los contratos JSON compartidos. El modelo preliminar hoy exige SKU, contempla `category` y `photo` como URL, separa `stocks` y genera también IDs de variantes y QR en el dispositivo, en desacuerdo con core. Se reemplaza el generador local por una generación puntual del ID UUIDv4 del producto para la petición de creación.
- Quedan fuera categorías, ajustes de inventario, edición/creación de varias variantes en el formulario, selección o cambio de moneda, eliminación/archivo de productos y uso visible de QR.

## Criterios de aceptación

1. Crear desde mobile con campos mínimos usa el ID generado por mobile y produce una variante sin atributos, stock cero y moneda del país; el producto aparece en el catálogo y se abre su detalle.
2. Buscar por nombre o SKU, paginar y abrir un producto conserva los resúmenes de todas las variantes; un producto multivariante permite editar solo datos generales y foto.
3. Elegir una foto de la galería o tomarla con la cámara, reemplazarla o quitarla al editar, y guardar refleja el mismo resultado que core; stock, moneda, QR e IDs permanecen iguales. Denegar el permiso de cámara permite seguir con la galería.
4. Errores de validación, SKU duplicado, imagen ajena y producto ajeno se muestran correctamente y no dejan escrituras parciales ni datos de otra empresa.
5. Un fallo de red, subida o servidor conserva el formulario. Si el usuario reintenta una creación ya confirmada, core devuelve `409 PRODUCT_ID_CONFLICT`; mobile muestra el error y permite revisar el catálogo sin crear otro producto. Atrás, Cancelar y cambiar de pestaña confirman antes de descartar cambios; salir no guarda el producto.
