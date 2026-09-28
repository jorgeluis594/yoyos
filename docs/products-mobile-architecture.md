# Productos en mobile: arquitectura técnica

**Estado:** diseño para implementar. La [definición de producto y API](products-mobile-implementation.md) fija el comportamiento; este documento fija las responsabilidades y los contratos de código. La primera versión funciona **en línea**: core confirma cada escritura. No hay cola local ni sincronización posterior. Mobile genera el ID del producto al crearlo; core genera los IDs de variantes y códigos QR.

## Límites y flujo

```text
Pantallas mobile → operaciones de productos → adaptador HTTP → /api/products
        │                                                           │
        └→ cámara/galería → carga de imagen → /api/images            ↓
                                                  casos de uso existentes de core
                                                               ↓
                                                   repositorio con aislamiento de empresa
```

- Core conserva las reglas de producto, la validación de negocio, la transacción, la unicidad de SKU y la autorización. El adaptador HTTP traduce JSON y resultados; no contiene otra implementación de esas reglas.
- Mobile posee su propio modelo tipado de producto, estado de pantalla, captura de foto, conversión de controles a peticiones y mensajes. Puede validar para ayudar al usuario, pero la respuesta de core decide el resultado.
- `shared/` contiene solo contratos JSON y utilidades realmente usadas por ambas apps. Ninguna app importa el código fuente de la otra.
- Las operaciones con fallos esperados devuelven `Result<T, E>`; los fallos técnicos inesperados llegan al límite HTTP, se registran y se presentan sin detalles internos.

## Estructura propuesta

```text
shared/contracts/products.ts                     # Esquemas Zod y tipos DTO inferidos
shared/contracts/registration.ts                 # Sobre HTTP existente; ampliar códigos de producto

apps/core/src/features/products/
  domain/                                        # Entidad, reglas y errores existentes
  application/                                   # create/get/list/update existentes
  infrastructure/repository.ts                   # Persistencia existente
  presentation/input.ts                          # Parser web: usa la forma compartida
  presentation/api-routes.ts                     # GET/POST/PATCH y estados HTTP
  presentation/product-presenter.ts              # Proyección explícita de resultados a DTO
  composition.ts                                 # Reutiliza los casos de uso existentes
apps/core/src/app.ts                             # Registra /api/products

apps/mobile/src/app/products/
  index.tsx                                      # Ruta del catálogo
  new.tsx                                        # Ruta de creación
  [productId].tsx                                # Ruta de gestión editable
apps/mobile/src/components/app-tabs.tsx          # Pestaña principal Productos
apps/mobile/src/features/products/
  domain/product.ts                               # Modelo mobile de producto y variante
  application/product-operations.ts              # Preparar create/update y tipos de fallos
  infrastructure/product-api.ts                  # JSON, mapeo al modelo mobile y errores HTTP
  presentation/catalog-screen.tsx                # Búsqueda, páginas y estados
  presentation/product-management-screen.tsx    # Detalle y edición
  presentation/product-form.tsx                  # Campos compartidos con creación
  presentation/product-photo.tsx                 # Cámara, galería y vista previa
apps/mobile/src/composition/products.ts          # Conecta API y operaciones
```

Los nombres de pantalla pueden ajustarse al implementar las rutas; la responsabilidad de cada archivo es el límite importante. No se añade una clase de repositorio, contenedor de dependencias ni capa de caché. Los componentes genéricos existentes (`Field`, `Input`, `Textarea`, `Button`, estados de pantalla) se reutilizan; solo los controles propios de productos viven en la feature.

## Tipado y validación

### Contratos entre apps y modelo mobile

Un **DTO** es el objeto de datos que viaja como JSON entre las apps. `shared/contracts/products.ts` define sus esquemas Zod; no define la entidad de core ni el modelo que usa la pantalla mobile:

| Contrato | Contenido |
| --- | --- |
| `createProductRequestSchema` | ID UUIDv4 de producto obligatorio, nombre, opcionales, moneda y arreglo no vacío de variantes; cada variante tiene `attributes`, precios y stock inicial opcional. |
| `updateProductRequestSchema` | Parche estricto, con `null` solo donde se puede limpiar; variantes identificadas por `id`. |
| `productListQuerySchema` | `search`, `page`, `pageSize`; convierte cadenas de URL a tipos y rechaza formatos o claves desconocidas. Los rangos los valida `listProducts` de core. |
| `productListResponseSchema` | Página, total y filas con `Money`, número de variantes y stock total. |
| `productDetailResponseSchema` | Producto completo, variantes y stock por variante; fechas ISO, imagen opcional con `id` y `url`. |
| `productIdResponseSchema` | `{ id }` para crear y editar. |
| `productApiErrorSchema` | Códigos estables y `issues` estructurados cuando hay errores de entrada o de negocio. |

Los tipos del JSON se derivan con `z.infer`; no se escriben copias manuales de esos contratos. Los esquemas de **petición** son estrictos para que campos desconocidos o no editables fallen. Los de **respuesta** validan los campos conocidos y permiten que un mobile antiguo ignore campos nuevos opcionales de la API; el presenter de core sigue enumerando y validando exactamente los campos que emite. Ningún esquema importa entidades de core, Prisma, React ni Expo. Una propiedad opcional ausente sigue ausente. En actualización, `null` significa limpiar y un campo omitido significa conservar.

`apps/mobile/src/features/products/domain/product.ts` define tipos propios y de solo lectura para el catálogo y la gestión. El modelo contiene lo que mobile necesita mostrar o editar: producto, foto opcional, variantes, precios y stock. No incorpora el DTO completo por obligación ni importa `Product` de core. Por ejemplo:

```ts
type ProductVariant = Readonly<{
  id: VariantId;
  attributes: Readonly<Record<string, string>>;
  sku?: string;
  salePrice: Money;
  purchasePrice?: Money;
  stock: number;
}>;

type Product = Readonly<{
  id: ProductId;
  name: string;
  description?: string;
  currency: Currency;
  photo?: Readonly<{ id: ImageId; url: string }>;
  variants: readonly ProductVariant[];
}>;

type ProductListItem = Readonly<{
  id: ProductId;
  name: string;
  variantCount: number;
  sku?: string;
  price: Money;
  priceFrom: boolean;
  stock: number;
}>;
```

El catálogo usa `ProductListItem` porque la lista y el detalle tienen datos distintos. La presentación representa la elección de foto con la unión `{ kind: "keep" } | { kind: "set"; imageId: ImageId } | { kind: "remove" }` y la traduce al comando de guardado. `set` aporta `imageId`, `remove` envía `imageId: null` solo al editar y la creación sin foto omite ese campo. El identificador de `set` procede de una respuesta validada de `/api/images`.

Los identificadores viajan como UUID validados. Mobile genera el `ProductId` al crear; core valida el UUIDv4 de entrada, lo adapta a su tipo nominal y genera los IDs de variantes. Mobile define sus propios `ProductId`, `VariantId` e `ImageId` y los construye al generar o mapear valores validados. La entidad de core conserva `Date`; el DTO usa cadenas ISO. El DTO devuelve `Money` como `{ amount: number, currency }`, sin convertir precios a texto. Mobile reutiliza las primitivas compartidas `Money`, `Currency` y `Result`, pero no el tipo de entidad de core. Las cadenas de los controles se validan y convierten a números antes de construir la petición; no se usan aserciones `as` para ocultar datos incompletos.

`product-api.ts` valida cada respuesta `unknown` con el esquema compartido y la transforma al modelo mobile. También transforma las peticiones tipadas de mobile al DTO de escritura y las valida antes de enviarlas. Este mapeo concentra diferencias deliberadas, por ejemplo `imageId` más `image.url` en JSON frente a `photo` en mobile, y `stock.quantity` en JSON frente a `stock` en la variante mobile. Los campos de respuesta que la pantalla no usa, como QR y marcas de tiempo, no tienen que existir en el modelo mobile.

### Criterios del catálogo

La operación de mobile recibe criterios tipados, distintos de las cadenas de la URL y de los campos de un producto:

```ts
type ProductListCriteria = Readonly<{
  search?: string;
  page: number;
  pageSize: 20;
}>;

type ProductListCriteriaIssue = Readonly<{
  field: "search" | "page" | "pageSize";
  reason: "INVALID_TYPE" | "INVALID_RANGE" | "UNSAFE_PAGINATION";
  message: string;
}>;

type ProductListInputIssue = Readonly<{
  field: string; // Puede nombrar un parámetro desconocido.
  reason: "INVALID_TYPE" | "UNKNOWN_FIELD" | "DUPLICATE_FIELD";
}>;

type ProductTransportError = Readonly<{
  code:
    | "UNAUTHENTICATED" | "COMPANY_REQUIRED" | "NETWORK_ERROR"
    | "SERVICE_UNAVAILABLE" | "RATE_LIMITED" | "SERVER_ERROR" | "API_ERROR"
    | "INVALID_RESPONSE" | "OPERATION_CANCELLED" | "SECURE_STORAGE_ERROR";
  message: string;
}>;

type ListProductsError =
  | Readonly<{ code: "INVALID_INPUT"; issues: readonly [ProductListInputIssue, ...ProductListInputIssue[]]; message: string }>
  | Readonly<{
      code: "VALIDATION_ERROR";
      issues: readonly [ProductListCriteriaIssue, ...ProductListCriteriaIssue[]];
      message: string;
    }>
  | ProductTransportError;
```

`loadProducts(criteria: ProductListCriteria)` solicita una página y devuelve `Promise<Result<ProductPage, ListProductsError>>`. La pantalla envía `page: 1` al iniciar o cambiar la búsqueda y suma uno al pulsar **Cargar más**; el tamaño es 20 en esta versión. El adaptador recorta los extremos de `search`, omite el parámetro si queda vacío y serializa `page` y `pageSize` como texto en la URL. La API rechaza un formato no numérico como `400 INVALID_INPUT`; `listProducts` valida que la página sea un entero seguro positivo, que el tamaño esté entre 1 y 100 y que el cálculo de paginación sea seguro, devolviendo `422 VALIDATION_ERROR` cuando falla una regla de rango. Core conserva sus valores por defecto (`page: 1`, `pageSize: 20`) cuando otro cliente omite los parámetros. Un fallo de criterio se vincula a `search`, `page` o `pageSize`, nunca a `ProductField`.

### Comandos y resultados mobile

Los controles mantienen texto mientras se edita. La presentación valida y convierte los números antes de invocar operaciones; sus comandos no contienen cadenas numéricas ni `companyId`. Una forma mínima es:

```ts
type CreateProductCommand = Readonly<{
  id: ProductId;
  country: Country;
  name: string;
  description?: string;
  imageId?: ImageId;
  sku?: string;
  salePrice: number;
  purchasePrice?: number;
  initialStock?: number;
}>;

type UpdateProductCommand = Readonly<{
  current: Product;
  name?: string;
  description?: string | null;
  imageId?: ImageId | null;
  variant?: Readonly<{
    id: VariantId;
    sku?: string | null;
    salePrice?: number;
    purchasePrice?: number | null;
  }>;
}>;

type ProductPage = Readonly<{
  items: readonly ProductListItem[];
  page: number;
  pageSize: number;
  total: number;
}>;
```

`CreateProductCommand.id` es el UUIDv4 del **producto**, generado con la plataforma y validado antes de construir el tipo nominal mobile. Viaja en el JSON; no hay encabezado adicional de idempotencia. El comando produce la petición con moneda derivada de `country` y una variante con `attributes: {}`. `UpdateProductCommand` permite solo un parche de la variante única visible; la operación comprueba que su `id` pertenezca a `current` y que `current` tenga exactamente una variante. Con varias variantes, el formulario no ofrece ese parche y el JSON omite `variants`; un comando que intente modificar una variante en ese estado falla localmente en vez de ignorarse. El servidor vuelve a validar ambas peticiones y conserva los campos omitidos.

Los esquemas compartidos verifican la **forma de JSON** en la entrada y la salida. Las reglas de negocio, incluidos límites de precios/texto, normalización y unicidad de SKU, propiedad de imagen y variantes válidas, permanecen en los casos de uso y dominio de core. El parser web existente reutiliza la forma del producto de `createProductRequestSchema` **sin** el `id` obligatorio de la API, porque el formulario web llama directamente al caso de uso y core genera allí su ID; conserva su traducción propia a mensajes del formulario web.

### Errores tipados

El sobre HTTP común `{ code, error }` ya existe en `shared/contracts/registration.ts`; se amplían allí los códigos necesarios, sin crear otro sobre genérico. `productApiErrorSchema` en `shared/contracts/products.ts` añade los detalles propios de productos y distingue `INVALID_INPUT`, `VALIDATION_ERROR`, `DUPLICATE_SKU`, `PRODUCT_ID_CONFLICT`, `PRODUCT_NOT_FOUND`, `IMAGE_NOT_FOUND` y los errores compartidos de autenticación/servicio. `VALIDATION_ERROR` conserva cada `scope`, `field`, `index`, `reason` y parámetro tipado; `INVALID_INPUT` conserva la ruta del campo, por ejemplo `variants.0.salePrice`. Los criterios de listado tienen sus propios campos y razones; no entran en la unión de validación de producto.

El cliente HTTP mobile actual valida `{ code, error }` pero descarta `issues`. Se amplía su `TransportError` con `http?: { status: number; body: unknown }`, presente solo para fallos HTTP; conserva su firma `Result<unknown, TransportError>` y los consumidores de autenticación/empresa siguen usando `code` y `message`. Un código HTTP desconocido se traduce a `API_ERROR` y conserva el cuerpo dentro de `http`. `product-api.ts` valida ese cuerpo con `productApiErrorSchema`, comprueba que código y estado correspondan a la operación y lo transforma en errores tipados de mobile; una respuesta conocida inválida produce `INVALID_RESPONSE`. Las operaciones eliminan `http` al entregar el error a presentación. Ni la pantalla ni los casos de uso reciben JSON sin validar. El texto visible se elige por código y razón, nunca comparando el mensaje técnico.

Los tipos de fallo de `list`, `get`, `create` y `update` siguen separados. Por ejemplo, `create` puede devolver validación, SKU duplicado o imagen inexistente; `get` puede devolver producto inexistente o indisponibilidad. No se introduce un `ProductError` universal que permita estados imposibles en una operación.

Los errores HTTP `413 PAYLOAD_TOO_LARGE` y `415 UNSUPPORTED_MEDIA_TYPE` pertenecen solo a `create` y `update`; sus uniones tipadas incluyen esos códigos aunque la pantalla normal envíe JSON pequeño y el encabezado correcto. Un `400 INVALID_INPUT` de JSON mal formado puede llevar `issues` con `field: "body"`; un error de campo identifica la ruta precisa. La API no exige `issues` para autenticación, ausencia, conflicto de SKU ni fallos técnicos.

| Operación mobile | Firma de éxito | Errores esperados propios |
| --- | --- | --- |
| `loadProducts(criteria: ProductListCriteria)` | `Promise<Result<ProductPage, ListProductsError>>` | Criterios inválidos. |
| `loadProduct` | `Promise<Result<Product, GetProductError>>` | Producto no encontrado. |
| `createProduct` | `Promise<Result<ProductId, CreateProductError>>` | Entrada o reglas inválidas, SKU duplicado, ID ya existente, imagen no disponible. |
| `updateProduct` | `Promise<Result<ProductId, UpdateProductError>>` | Entrada o reglas inválidas, SKU duplicado, imagen o producto no encontrado, o un parche de variante no editable en mobile. `PRODUCT_ID_CONFLICT` solo pertenece a creación. |

Cada error de operación suma únicamente los fallos de transporte aplicables (sin sesión, sin empresa, red, servicio, respuesta inválida u operación cancelada). `VALIDATION_ERROR` lleva una lista no vacía de razones y campos tipados; `DUPLICATE_SKU` conserva su código para asociarlo al SKU. Un código conocido en una operación donde no corresponde, o un error conocido con forma incorrecta, produce `INVALID_RESPONSE`. Un código nuevo con un sobre `{ code: string, error: string }` válido se traduce a un fallo genérico seguro para conservar compatibilidad; no se fuerza con `as` a una unión conocida.

## Casos de uso y API en core

No se crean casos de uso nuevos en el servidor. El adaptador HTTP invoca los existentes:

| Caso de uso | Entrada | Resultado de aplicación |
| --- | --- | --- |
| `listProducts` | Criterios normalizados y paginación | `Result<ListOutput, ListError>` |
| `getProduct` | `ProductId` | `Result<Detail \| null, DetailError>` |
| `createProduct` | `CreateInput` con una o más variantes | `Result<ProductId, CreateError>` |
| `updateProduct` | `ProductId` y `UpdateInput` explícito | `Result<ProductId, UpdateError>` |

Los cuatro contratos de entrada y error mantienen sus dueños actuales en `application/`; no se fusionan con el DTO ni entre sí. `CreateInput` admite `id?: ProductId`: la API exige y valida el ID UUIDv4 recibido, mientras que el formulario web existente lo omite y `createProduct` sigue generándolo con `newId`. Los IDs de variantes y QR se generan siempre en core. La composición existente suministra repositorio, reloj, generador de IDs y capacidades de imagen.

`api-routes.ts` registra `GET /api/products`, `GET /api/products/:productId`, `POST /api/products` y `PATCH /api/products/:productId` después de `loadApiAccess` y `requireApiCompany`. El middleware actual acepta Bearer JWT para mobile y cookie de Better Auth para web; un encabezado `Authorization` inválido no se sustituye por una cookie válida. El contexto de empresa se obtiene allí y el repositorio mantiene el aislamiento por empresa. Ningún cuerpo o query acepta `companyId`.

Cada handler sigue el mismo orden:

1. Validar ruta, query o cuerpo con el esquema compartido y traducir errores de forma a `400 INVALID_INPUT` con ubicaciones de campo.
2. Invocar la operación `products.list/get/create/update` existente, sin duplicar reglas ni escribir directamente en Prisma.
3. Traducir los errores esperados al código y estado de la [API definida](products-mobile-implementation.md#errores-y-contrato-de-transporte). Producto ajeno y ausente comparten `404 PRODUCT_NOT_FOUND`; imagen ajena y ausente comparten `404 IMAGE_NOT_FOUND` al asociar.
4. Convertir el resultado a DTO, validar el JSON de salida y responder. Un dato interno inválido se registra y produce un error seguro, nunca una respuesta parcial.

La creación y actualización siguen usando las transacciones actuales. Una actualización sin cambios conserva el comportamiento `no-op` de core. Los fallos inesperados se registran y se traducen en el límite API. Si `getProduct` detecta una imagen referenciada que ya no se puede resolver, la API informa indisponibilidad; no presenta el producto como ausente. El manejador global de JSON mal formado en `app.ts` hoy responde `INVALID_COMPANY`; debe distinguir las rutas de productos para cumplir `INVALID_INPUT` sin cambiar el contrato de empresa.

La foto usa `POST /api/images` existente. La API de productos recibe solo `imageId` y el caso de uso existente verifica que pertenezca a la empresa. `Product.id` ya es clave primaria; no se añade persistencia para controlar IDs repetidos.

### Frontera HTTP y serialización JSON

En Express 5, `express.json()` lee un cuerpo con `Content-Type: application/json`, hace el parseo y deja el resultado en `request.body`; **no valida** que sea una petición de producto. `response.status(201).json(dto)` convierte el DTO con `JSON.stringify`, establece el tipo de respuesta JSON y lo envía. No se hace `JSON.stringify` manual. `Date` puede convertirse automáticamente por `JSON.stringify`, pero el mapeo de detalle genera de forma explícita cadenas ISO 8601 UTC para que el contrato sea independiente de la entidad de core. Véase la [API oficial de `express.json()`](https://expressjs.com/en/5x/api/express#express.json) y [la de `res.json()`](https://expressjs.com/en/5x/api/response#res.json).

### Presenter de la API y datos de pantalla

La conversión tiene tres responsabilidades diferentes:

| Paso | Responsable | Ejemplo |
| --- | --- | --- |
| Calcular datos del negocio | Casos de uso de core | `minSalePrice`, `hasDifferentPrices`, `totalStock` y coincidencias de búsqueda de `listProducts`. |
| Proyectar el resultado público | `product-presenter.ts` en core | Elegir campos de producto y variantes, convertir `Date` a ISO y formar el DTO de catálogo o detalle. |
| Dar formato para mostrar | Presentación mobile/web | «Desde 49,90 PEN», «Varias variantes», «Sin SKU», fechas locales y mensajes de error. |

El presenter es una función pura y explícita por forma de respuesta: `toProductListResponse(output: ListOutput)`, `toProductDetailResponse(detail: Detail)` y, si aporta claridad, `toProductIdResponse(id: ProductId)`. Devuelve objetos JSON planos tipados con `z.infer<typeof ...ResponseSchema>` y validados por el esquema de salida antes de `res.json()`. Recorre cada variante cuando construye el detalle, transforma sus valores anidados y enumera los campos que forman parte del contrato. No devuelve directamente `Product`, el resultado del repositorio ni `...product`: un campo interno nuevo no debe publicarse por accidente. No consulta la base, no aplica reglas de negocio y no genera textos localizados.

Por ejemplo, la fila del caso de uso ya contiene `minSalePrice`, `hasDifferentPrices` y `totalStock`; el presenter los copia al DTO. Mobile convierte `hasDifferentPrices` en «Desde» según su idioma. El detalle mantiene `salePrice` como `{ amount, currency }`, `stock` como dato numérico y `createdAt` como ISO; no envía precios preformateados. El presenter tampoco inventa stock ni recalcula el precio mínimo: esos datos pertenecen a `listProducts`.

Existen librerías de transformación como [`class-transformer`](https://github.com/typestack/class-transformer), que usan metadatos y decoradores para clases, y serializadores como [`SuperJSON`](https://github.com/flightcontrolhq/superjson), que transportan tipos JavaScript adicionales. Son opciones válidas para esos casos, pero este producto usa objetos TypeScript planos y un contrato JSON consumido por mobile. Las funciones de proyección y los esquemas Zod ya cubren la selección de campos y la validación sin introducir otro formato de transporte ni decoradores. Esta elección es una decisión de arquitectura para Yoyos, no una obligación de Express.

El trayecto de una petición de escritura es `HTTP → express.json() → esquema Zod del DTO → adaptación a CreateInput/UpdateInput → caso de uso → mapeo a DTO de respuesta → esquema Zod de salida → res.status(...).json(dto)`. `request.body`, `request.params` y `request.query` se tratan como datos externos; una anotación TypeScript sobre `Request` no sustituye su validación. El handler no serializa directamente entidades de core, objetos Prisma ni errores de excepción. El DTO enumera los campos públicos, convierte `Date` a ISO y deja ausentes los opcionales no presentes; `null` solo aparece en peticiones de edición para limpiar un campo. Los precios viajan como números en unidades principales, sin `Decimal`, `BigInt` ni formato monetario de pantalla.

`app.ts` ya instala `express.json()` sobre `/api` antes de autenticar. Se mantiene ese parser y su límite predeterminado de **100 kB** para JSON; las fotos siguen por multipart en `/api/images`. Para `POST` y `PATCH` de productos, un tipo de contenido distinto de `application/json` (admitiendo el parámetro `charset`) da `415 UNSUPPORTED_MEDIA_TYPE`; un cuerpo que excede el límite da `413 PAYLOAD_TOO_LARGE`; JSON mal formado da `400 INVALID_INPUT`. El manejador global de errores debe reconocer el error de tamaño y las rutas de productos. La ruta `/api/company` conserva `INVALID_COMPANY` para su JSON mal formado. Un JSON válido con forma incorrecta, como un arreglo, campos extra o un tipo equivocado, produce `400 INVALID_INPUT` con `issues` de ubicación. El cuerpo de error también se envía con `res.status(...).json(...)`. Para cubrir también fallos de parseo y autenticación, el middleware que establece `Cache-Control: no-store` en `/api/products` se registra **antes** del parser JSON.

Para `GET /api/products`, se leen las entradas de la URL como cadenas mediante `URLSearchParams`; `getAll` permite detectar repeticiones antes de convertirlas en un objeto. Se rechazan parámetros desconocidos, repetidos o con formato numérico inválido mediante `400 INVALID_INPUT`; `search` se pasa como texto. Luego `listProducts` conserva sus defaults y valida rangos y paginación segura, que dan `422 VALIDATION_ERROR`. `:productId` debe ser UUID; un formato inválido es `400 INVALID_INPUT`. Los IDs nominales de core se construyen **después** de validar la cadena. Las peticiones no aceptan `companyId`: el middleware toma la empresa del acceso autenticado y el repositorio aplica su aislamiento.

| Ruta | DTO de éxito | Estados específicos |
| --- | --- | --- |
| `GET /api/products` | `200 productListResponseSchema` | `400` forma de query; `422` criterios fuera de rango. |
| `GET /api/products/:productId` | `200 productDetailResponseSchema` | `400` ID inválido; `404` ausente o ajeno; `503` fallo al resolver foto asociada. |
| `POST /api/products` | `201 productIdResponseSchema` | `400` cuerpo o ID de producto inválido; `409` SKU duplicado o ID ya existente; `404` imagen por asociar ausente o ajena; `422` regla de dominio; `413`/`415` cuerpo HTTP. |
| `PATCH /api/products/:productId` | `200 productIdResponseSchema` | `400` cuerpo o ID inválido; `409` SKU duplicado; `404` producto o imagen por asociar ausente o ajena; `422` regla de dominio; `413`/`415` cuerpo HTTP. |

Todas las rutas privadas de productos envían `Cache-Control: no-store`, incluso los errores, para evitar que una caché HTTP guarde datos de otra sesión. Los errores `401 UNAUTHENTICATED` y `409 COMPANY_REQUIRED` llegan de los middleware existentes. El adaptador traduce cada `Result` esperado a un estado y código estable; los fallos de repositorio o almacenamiento van a `503 SERVICE_UNAVAILABLE` y las excepciones o DTO de salida inválidos a `500 INTERNAL_ERROR`, con registro interno sin filtrar detalles al cliente. `IMAGE_NOT_FOUND` significa `404` al **asociar** una imagen en create/update y `503` al intentar resolver una imagen ya asociada durante get.

El helper `apiError` actual solo emite `{ code, error }` y el cliente mobile actual descarta detalles. Se amplían el código y esquema común de error para aceptar `issues` **solo en las respuestas que lo requieren**. El transporte comprueba `{ code: string, error: string }` sin limitar el código a una enumeración conocida, adjunta `http.status` y el cuerpo `unknown`, y conserva su traducción actual de errores conocidos. Los códigos de producto conocidos se validan con `productApiErrorSchema`; un código nuevo se reduce a `API_ERROR`. Una respuesta conocida que no cumple el esquema de la operación se trata como `INVALID_RESPONSE` en mobile. No se añade una segunda capa de serialización: cada handler construye y valida el DTO y lo entrega a `res.json()`.

El cliente no reintenta automáticamente las escrituras tras perder la conexión. Para `POST`, el formulario conserva el cuerpo con el ID generado. Si el usuario reintenta y el primer envío ya creó el producto, core devuelve `409 PRODUCT_ID_CONFLICT`; mobile muestra el conflicto y ofrece revisar el catálogo antes de intentar otra creación. No trata ese `409` como éxito ni genera otro ID automáticamente. Para `PATCH`, el resultado puede quedar incierto y se consulta el detalle antes de reenviar. Las lecturas pueden reintentarse. La API inicial no añade control de concurrencia entre dos ediciones; conserva la semántica de actualización de core.

### Creación con ID aportado por mobile

`POST /api/products` exige `id` UUIDv4 en el JSON. Mobile lo genera con `Crypto.randomUUID()` de `expo-crypto`, dependencia ya instalada, al construir una petición válida. Conserva ese ID en el formulario mientras el intento esté abierto; un formulario nuevo genera otro ID. [Expo Crypto](https://docs.expo.dev/versions/latest/sdk/crypto/#cryptorandomuuid) documenta `randomUUID()` para iOS y Android.

Core valida `id` como UUIDv4 y lo usa como ID de `Product`, no como autorización. El middleware sigue exigiendo sesión y empresa activa; RLS protege la fila y otro usuario no obtiene acceso por conocer el UUID. La clave primaria existente de `Product.id` permite crear una sola vez con ese ID. Cualquier segundo `POST` con el mismo ID devuelve `409 PRODUCT_ID_CONFLICT`, sin comparar el cuerpo ni devolver el producto existente como si la creación hubiese tenido éxito.

`createProduct` usa el ID validado y el repositorio mantiene su transacción actual para producto, variantes y stock. El repositorio reconoce la violación de la clave primaria de `Product` y la traduce a `PRODUCT_ID_CONFLICT`, separada de la restricción de SKU. La base resuelve también dos peticiones simultáneas con el mismo ID: una crea y la otra recibe `409`, incluso si el cuerpo es idéntico. La respuesta de conflicto es genérica y no identifica a otra empresa si el ID pertenece a ella. No se necesita una lectura previa ni una tabla adicional.

`createProduct` acepta el ID validado cuando la API lo proporciona y conserva su generación actual de ID para el formulario web. No hay migración de base de datos. Sin persistencia local del formulario, si la app termina después de un envío incierto, se inicia otro intento al abrir el formulario de nuevo; ese límite queda explícito en el flujo de mobile.

### Compatibilidad entre versiones mobile y API

Una versión mobile instalada puede permanecer activa cuando core se despliega de nuevo. Por eso, los campos existentes de respuesta conservan nombre, tipo y significado; los nuevos campos se añaden como opcionales. Mobile valida los campos que conoce e ignora propiedades adicionales de respuesta. Las peticiones siguen rechazando propiedades desconocidas para impedir escrituras accidentales. Los códigos de error publicados también mantienen su significado; un código nuevo que un cliente antiguo no conoce se muestra como error genérico seguro. Un cambio incompatible requeriría una ruta versionada nueva y mantener la anterior durante la transición; no se añade versionado mientras el contrato inicial pueda evolucionar de forma compatible.

## Operaciones y estado en mobile

La composición expone una sola instancia del cliente HTTP autenticado existente. Hoy `createAuthOperations` crea `createApiClient` y no expone su función `request`; la integración debe compartir esa función con productos, sin crear otro ciclo independiente de tokens. `createProductApi(request)` construye las cuatro llamadas tipadas y la carga de imagen; el adaptador añade JSON o `FormData`, valida respuestas y traduce errores. El transporte ya renueva el token una vez ante `401` y cancela respuestas de una sesión anterior; productos usa ese mismo mecanismo.

| Operación mobile | Responsabilidad |
| --- | --- |
| `loadProducts(criteria)` | Pedir una página al adaptador. El catálogo concatena páginas solo para la búsqueda vigente y muestra **Cargar más** mientras `items.length < total`. |
| `loadProduct(id)` | Obtener el detalle completo para abrir la pantalla de gestión. |
| `createProduct(form, company.country, productId)` | Convertir valores del formulario, obtener la moneda desde `countryCurrencies`, enviar una variante con `attributes: {}` y el ID en el JSON; devolver el ID confirmado por core. La pantalla abre ese producto. |
| `updateProduct(product, form, photoSelection)` | Construir un parche explícito: `null` para limpiar opcionales, `variants` solo si hay exactamente una variante; enviar y devolver el resultado. La pantalla permanece abierta tras éxito. |

Las lecturas cuyo único trabajo adicional es el mapeo de `product-api.ts` no necesitan wrappers vacíos: composición puede exponer esas funciones como operaciones. `product-operations.ts` contiene la conversión de formularios de creación/edición, que sí tiene decisiones propias. No reproduce la validación de negocio de core; solo genera el ID UUIDv4 del producto para `POST`, nunca IDs de variante ni QR. El modelo mobile preliminar se adapta a los datos reales de core; el antiguo `generateProduct` deja de participar en el flujo en línea y se retira si no queda otro consumidor.

La pantalla conserva borrador, progreso y errores de campo. Compara el formulario y la selección de foto con sus valores iniciales para detectar cambios efectivos. Si los hay, Atrás, Cancelar y cambiar de pestaña pasan por una sola confirmación de descarte; continuar conserva el borrador y descartar sale sin llamar a la API de producto. Una navegación posterior a un guardado exitoso no pide confirmación. El guardado y la confirmación de salida se mantienen en presentación, sin convertirlos en reglas de dominio.

El catálogo guarda en memoria la búsqueda, las páginas cargadas, `total` y la posición de desplazamiento mientras la empresa está activa; al abrir y cerrar la gestión no reinicia esa vista. Al cambiar la búsqueda, reinicia filas y página; una respuesta tardía de la búsqueda anterior no se mezcla con la nueva. Tras crear o editar, vuelve a consultar las páginas cargadas para actualizar los datos sin borrar la búsqueda ni la posición. El estado privado se descarta al cerrar sesión o cambiar de empresa. Sin conexión se muestra fallo y reintento; no hay escritura optimista, caché persistente ni sincronización en segundo plano.

## Cámara, galería e imagen

`expo-image-picker` es el adaptador de plataforma propuesto para elegir de la galería o tomar una foto. No está instalado todavía; al implementar se añade una versión compatible con Expo y se configura su permiso de cámara en `app.config.js`. El selector devuelve un recurso local; cancelar o denegar permiso no cambia el formulario. Antes de subir, mobile prepara un JPG dentro de los límites de la API (10 MB, 24 MP y 8 000 píxeles por lado); `expo-image-manipulator` permite convertir formatos como HEIC y reducir dimensiones cuando sea necesario. Si la preparación falla, se conserva el formulario y se muestra un error recuperable. El archivo se envía como única parte `file` a `/api/images` con `FormData`, dejando que el transporte establezca el límite multipart. Solo un `201 { id, url }` válido actualiza la vista previa y el `imageId` pendiente. El servidor sigue validando formato, tamaño y dimensiones.

El formulario bloquea Guardar mientras la carga de imagen está en curso. Un fallo de carga mantiene campos y foto anterior para reintentar; reemplazar o quitar foto usa las reglas de asociación existentes. La fuente de la imagen no cambia el contrato de productos. Referencias de plataforma: [Expo ImagePicker](https://github.com/expo/expo/blob/main/docs/pages/tutorial/image-picker.mdx), [configuración del plugin](https://github.com/expo/expo/blob/main/packages/expo-image-picker/README.md) y [Expo ImageManipulator](https://github.com/expo/expo/blob/main/packages/expo-image-manipulator/src/ImageManipulator.ts).

## Pruebas previstas

Esta sección contiene **solo descripciones de pruebas**, no archivos ejecutables. Los [casos de producto de core](products-implementation.md#test-cases) siguen cubriendo las reglas de negocio, las restricciones de base de datos y sus transacciones. Los casos siguientes verifican las fronteras y el comportamiento nuevos de API y mobile. Se ubican junto a la capa responsable según las [convenciones del repositorio](testing-conventions.md); no se repite cada regla en todas las capas.

### Unitarias

| ID | Capa | Escenario | Resultado esperado |
| --- | --- | --- | --- |
| MU01 | Contratos compartidos | Parsear peticiones válidas de creación y edición; probar opcionales omitidos, `null` para limpiar y campos extra o inmutables. | Los tipos inferidos conservan ausencia y `null`; se rechazan claves desconocidas, IDs inválidos y valores con forma incorrecta antes de invocar core. |
| MU02 | Contratos compartidos | Parsear respuestas de catálogo, detalle, `{ id }` y errores; incluir campos adicionales de una API futura, fechas inválidas, dinero incompleto e `issues` ausentes en errores que los requieren. | El cliente acepta campos adicionales sin usarlos, pero rechaza campos conocidos incompletos o mal formados; cada código conserva la forma de error que le corresponde. |
| MU03 | Criterios de catálogo | Construir la consulta con búsqueda vacía o con espacios, página 1 y páginas siguientes; parsear tipos inválidos y claves desconocidas. | Mobile omite búsqueda vacía y envía tamaño 20; el contrato API rechaza formatos incorrectos como `INVALID_INPUT` con la ubicación del parámetro. Los rangos pertenecen al caso de uso de core. |
| MU04 | Modelo mobile | Mapear una fila de catálogo y un detalle con una o varias variantes, foto opcional, SKU ausente y precios distintos. | `ProductListItem` y `Product` contienen los valores necesarios; stock, precio «Desde» y foto se proyectan correctamente, sin incorporar QR, estado o fechas al modelo mobile. |
| MU05 | Creación mobile | Preparar el comando con datos mínimos y completos, para cada país admitido. | Se envía el ID UUIDv4 del producto en el JSON, la moneda correspondiente y una variante con `attributes: {}`; se omiten opcionales vacíos y no se generan IDs de variantes, QR ni `companyId`. |
| MU06 | Edición mobile | Preparar parches con campos omitidos, valores concretos y `null`; intentar modificar una variante de un producto multivariante. | Omitir preserva, `null` limpia; stock, moneda, QR y atributos no entran en el JSON. Un parche de variante no editable falla localmente en vez de ignorarse. |
| MU07 | Adaptador HTTP mobile | Recibir éxito, errores estructurados, campos adicionales de respuesta, un cuerpo de éxito inválido y un código de error nuevo. | El adaptador valida y mapea a `Result`/modelo mobile; conserva `issues` para el formulario, ignora campos adicionales, trata códigos nuevos como fallo genérico seguro y devuelve `INVALID_RESPONSE` ante datos conocidos fuera de contrato. |
| MU08 | Transporte autenticado | Recibir `401`, renovar el token y repetir una vez; cerrar sesión antes de que llegue una respuesta de producto; recibir errores HTTP con `issues` y código nuevo. | La petición usa el nuevo token una sola vez y una respuesta tardía no expone ni repuebla datos privados. `TransportError.http` conserva estado y cuerpo `unknown` para el adaptador; un código nuevo se convierte en `API_ERROR` sin perder el sobre. |
| MU09 | Catálogo mobile | Buscar, pulsar **Cargar más**, recibir una respuesta tardía de otra búsqueda y volver desde la gestión; refrescar después de guardar. | La lista agrega solo páginas de la búsqueda vigente, detiene la carga al llegar a `total` y conserva búsqueda, elementos y posición al volver; el refresco no reinicia la vista. |
| MU10 | Formulario y navegación | Intentar guardar dos veces, recibir errores de campos o red, y salir con/sin cambios mediante Atrás, Cancelar o pestaña. | Hay un solo envío; se conservan los valores tras fallos. Solo cambios sin guardar muestran confirmación; seguir editando conserva el borrador y descartar sale sin guardar. |
| MU11 | Gestión mobile | Abrir un producto con una variante y otro con varias. | El primero permite editar SKU y precios; el segundo muestra todas las variantes y solo permite datos generales y foto. El stock siempre es de lectura. |
| MU12 | Foto mobile | Simular selección de galería, captura de cámara, cancelación, permiso denegado, formato HEIC, imagen grande y fallo de subida. | Se prepara un JPG admitido y se envía una sola parte `file`; cancelar o denegar no altera el borrador. Un fallo conserva los datos y una carga válida aporta `imageId` y vista previa. |
| MU13 | Tipos | Comprobar por compilación IDs nominales, comandos de creación/edición, DTO inferidos y uniones de errores por operación. | No se intercambian IDs; no se admiten campos inmutables en el parche ni `null` en campos requeridos; listar no admite errores de producto y crear no admite `PRODUCT_NOT_FOUND`. |
| MU14 | Presenter API de core | Proyectar un catálogo y un detalle con varias variantes, foto opcional y fechas; agregar un campo interno extra a la entidad de entrada. | El DTO conserva agregados calculados por `listProducts`, serializa fechas ISO y anidados, y solo expone los campos enumerados en el contrato; no incorpora el campo interno ni textos de interfaz. |
| MU15 | Creación mobile + conflicto | Generar el UUIDv4 para una petición válida; simular pérdida de respuesta y reintento con el mismo ID. | Mobile conserva el ID mientras el formulario sigue abierto. Ante `409 PRODUCT_ID_CONFLICT` muestra el conflicto y ofrece revisar el catálogo; no lo convierte en éxito ni genera otro ID automáticamente. |
| MU16 | Validación y errores de creación | Enviar `id` ausente, mal formado o reutilizado; simular errores de clave primaria de producto y de SKU. | Un ID ausente o inválido produce `400 INVALID_INPUT`; la violación de `Product.id` produce `409 PRODUCT_ID_CONFLICT` y la de SKU conserva `409 DUPLICATE_SKU`. |
| MU17 | Caso de uso de creación en core | Invocar `createProduct` con un ID validado y sin ID desde el flujo web. | Con ID recibido se conserva ese valor; sin ID se usa `newId`. En ambos casos core genera IDs de variantes y QR distintos del ID del producto. |

### Integración

| ID | Frontera | Escenario | Resultado esperado |
| --- | --- | --- | --- |
| MI01 | API core + base aislada | Con una sesión de empresa, crear un producto por `POST` con ID UUIDv4, listarlo, leer su detalle, editarlo por `PATCH` y repetir un parche sin cambios. | El ID enviado es el ID persistido y los DTO cumplen el contrato; moneda, variante, stock y cambios persisten correctamente. El parche sin cambios conserva `updatedAt`. |
| MI02 | API core + autenticación | Llamar sin sesión, sin empresa, con Bearer válido y con otro usuario/empresa; intentar forzar `companyId`. | Respuestas `401`/`409` cuando corresponde; un producto ajeno aparece como `404`, no altera datos y no se filtra por filas, `total` ni errores. La identidad procede del middleware. |
| MI03 | API core + validación | Enviar JSON mal formado, otro `Content-Type`, un cuerpo mayor que 100 kB, `POST` sin `id` o con ID inválido, `page=abc`, `page=0`, `pageSize=101`, paginación insegura, parámetros repetidos o desconocidos, UUID inválido y campos desconocidos o inmutables en `POST`/`PATCH`. | Forma y formato inválidos devuelven `400 INVALID_INPUT`; tipo y tamaño de cuerpo devuelven `415 UNSUPPORTED_MEDIA_TYPE` y `413 PAYLOAD_TOO_LARGE`; rangos de listado devuelven `422 VALIDATION_ERROR` con `issues` de criterios. No hay escritura y JSON mal formado en `/api/products` no se etiqueta `INVALID_COMPANY`. |
| MI04 | API core + reglas existentes | Duplicar SKU, asociar una imagen de otra empresa, enviar una variante ajena o precios/stock inválidos y fallar una escritura dentro de la transacción. | La API traduce cada error a su estado/código acordado; las operaciones fallidas no dejan producto, variantes, stock ni edición parcial. Esta prueba reutiliza la cobertura de repositorio de core en vez de duplicarla entera. |
| MI05 | API core + variantes | Crear por API un producto de varias variantes; buscar y paginar por el SKU de una sola y editar campos generales sin enviar variantes. | El producto sale una vez, con precio mínimo y stock de todas las variantes; detalle incluye todas; el parche general no altera ninguna variante. |
| MI06 | API core + imágenes | Subir una foto mediante `/api/images`, crear el producto con `imageId`, reemplazarla y luego quitar la asociación. | El detalle devuelve la URL correspondiente en cada paso; quitar la foto no borra el archivo. La asociación se rechaza si la imagen no pertenece a la empresa. |
| MI07 | API core + fallos técnicos | Provocar una lectura de base o resolución de imagen indisponible y una respuesta interna que no cumpla el esquema. | La API devuelve indisponibilidad o error interno seguro y registra el problema; nunca responde catálogo vacío, producto ausente ni éxito falso. Las respuestas privadas llevan `Cache-Control: no-store`. |
| MI08 | Mobile + HTTP real de core | Ejecutar el adaptador mobile contra una instancia aislada de core con un token real para listar, crear y editar. | Serialización, Bearer, parseo de DTO y mapeo al modelo mobile son compatibles extremo a extremo; una respuesta de error conserva código e `issues`. |
| MI09 | Navegación mobile + operaciones controladas | Entrar por la pestaña Productos, buscar, cargar más, abrir gestión, volver y probar la confirmación de descarte. | Se preservan búsqueda, filas y posición; salir con cambios pide confirmación y no llama al guardado. Se prueba el flujo de pantallas sin atribuirle garantías de servidor. |
| MI10 | Plataforma mobile + imágenes | En una compilación de iOS y Android en dispositivo compatible, elegir de galería, tomar foto y denegar/conceder cámara. | El recurso real se prepara en un JPG que acepta `/api/images`; permisos y cancelación mantienen el formulario utilizable. Una simulación del picker no sustituye esta comprobación. |
| MI11 | API core + base aislada | Enviar dos `POST` con el mismo ID y cuerpo, incluido un par simultáneo; reutilizar el ID con otro cuerpo, probar la colisión con otra empresa y provocar una escritura fallida. | El primer envío confirmado crea un solo producto y todos los posteriores reciben `409 PRODUCT_ID_CONFLICT`; el error no distingue si el ID pertenece a otra empresa. Una escritura fallida no deja producto, variantes ni stock. |
| MI12 | Mobile + HTTP real de core | Perder la primera respuesta de creación después de que core confirme y pulsar **Reintentar** desde el mismo formulario. | El segundo `POST` conserva el ID, recibe `409 PRODUCT_ID_CONFLICT` y muestra la opción de revisar el catálogo sin crear otro producto ni presentar un éxito falso. |

La implementación se entrega en este orden: contratos y API de core; adaptador y composición mobile; pantallas y foto.
