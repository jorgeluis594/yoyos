# Decisión: API compartida de imágenes en core

Fecha: 2026-09-23.

Estado: subida y consulta implementadas en `apps/core`. Las URLs de entrega son públicas.

## Contexto y decisión

Las distintas entidades necesitan asociar imágenes sin implementar su propia integración con el proveedor. Se creará una API de imágenes en `apps/core`, reutilizable por el frontend y los módulos de negocio.

Cloudflare R2 almacena las imágenes y un dominio propio conectado al bucket las sirve públicamente. El contrato y los casos de uso son agnósticos mediante inversión de dependencias; únicamente el adaptador conoce la API S3 de R2.

El frontend subirá el archivo a core y recibirá `{ id, url }`. Después enviará el identificador al crear o actualizar la entidad correspondiente. Se recomienda persistir un identificador interno en las entidades, en lugar de una URL del proveedor, para poder cambiar la entrega de imágenes sin actualizar cada entidad.

## Flujo y API

```text
Frontend → POST /api/images → caso de uso → ImageStorage → R2
                                     └→ registro local de imagen

Respuesta: { id, url }

Frontend → creación o actualización de una entidad con imageId
```

Contrato HTTP propuesto:

| Operación | Entrada | Salida |
| --- | --- | --- |
| `POST /api/images` | Archivo multipart en el campo `file` | `201 { id, url }` |
| `GET /api/images/:id` | Identificador interno | `200 { id, url }` |

Ejemplo ilustrativo de consumo por una futura API de productos:

```text
POST /api/products      { name, imageId }
GET /api/products/:id   → { id, name, image: { id, url } | null }
```

La URL permite mostrar la imagen inmediatamente. La referencia persistente es `imageId`; no se debe depender de que la URL sea permanente.

## Datos

```ts
type Image = {
  id: string;          // Identificador interno de la aplicación.
  storageKey: string;  // Referencia opaca del proveedor.
  companyId: string;   // Empresa autorizada, determinada por el servidor.
  createdAt: Date;
};

// Ejemplo de asociación, no una definición completa del producto.
type Product = {
  id: string;
  name: string;
  imageId: string | null;
};
```

La implementación usa `companyId` como propietario y aplica RLS de PostgreSQL.

La base de datos conservará la relación entre el identificador interno y `storageKey`. Las entidades podrán referenciar el registro de imagen con una clave foránea. No se almacenarán credenciales ni URLs temporales en las entidades.

## Contrato agnóstico

```ts
import type { Result } from "@shared/result";

export interface ImageStorage {
  upload(input: {
    bytes: Uint8Array;
    filename: string;
    contentType: string;
  }): Promise<Result<{ key: string }>>;

  getUrl(key: string): Promise<Result<string>>;

  delete(key: string): Promise<Result<void>>;
}
```

`key` es una referencia opaca: los consumidores no interpretan su formato. El contrato no incluye identificadores de cuenta, variantes, respuestas HTTP ni tipos de Cloudflare.

`delete` se considera cumplido cuando el archivo ya no existe. Los fallos esperados se traducen al contrato `Result` existente; los fallos inesperados deben permanecer observables y nunca convertirse silenciosamente en éxito.

La persistencia del registro local también se suministrará al caso de uso mediante una dependencia explícita. Los casos de uso no importarán Prisma ni construirán adaptadores concretos.

## Ubicación y dependencias

```text
apps/core/src/shared/images/
├── application/      # Subida, consulta y contrato ImageStorage.
│   └── images.ts
├── infrastructure/   # Adaptador R2 y persistencia del registro.
└── presentation/     # Rutas, validación de entrada y respuestas HTTP.
```

Este código pertenece al `shared` de core. El `shared/` de la raíz sigue reservado para código compartido entre aplicaciones, como `Result`.

El adaptador se construye mediante `createR2ImageStorage(config): ImageStorage`. `app.ts` lo suministra a los casos de uso mediante parámetros, sin contenedor de inyección ni clases base. Cada objeto usa un UUID opaco como clave; la subida conserva el tipo de contenido y la URL se forma con `R2_PUBLIC_BASE_URL`.

```text
Presentación → Aplicación → Contrato ImageStorage
                                  ↑
                         Adaptador R2
```

Las reglas específicas permanecen en cada feature: permisos para modificar un producto, cantidad de imágenes permitidas o selección de imagen principal. El puerto de almacenamiento no recibirá `entityType` ni `entityId`.

## Validación, autorización y consistencia

- La subida requiere autenticación. El servidor determina el propietario; no confía en un propietario enviado por el cliente.
- Se acepta un único archivo `file` de JPEG, PNG o WebP, de hasta 10 MB. Se limita el cuerpo antes de parsearlo y se comprueba la firma además del tipo declarado.
- Los futuros casos de uso que asocien un `imageId` deberán comprobar que exista y pertenezca a la empresa autorizada. Conocer un ID no concede autorización.
- Las credenciales de R2 permanecen en el servidor. El adaptador traduce los errores de subida y borrado.
- La subida guarda primero el archivo y después el registro local. Si falla el guardado, intenta eliminar el archivo subido; si la compensación falla, registra el fallo para su posterior limpieza.
- La base de datos y el proveedor no comparten una transacción. Una caída entre ambas operaciones puede dejar archivos huérfanos.
- Al reemplazar una imagen se guarda primero la nueva asociación. La anterior solo puede eliminarse cuando ya no tenga referencias y la operación esté autorizada.

## Alcance inicial y pendientes

La primera implementación incluye subida a través de core y consulta. No se expone un endpoint público de borrado; `delete` está disponible internamente para compensaciones.

Las URLs del dominio del bucket son públicas; los endpoints requieren sesión y empresa. Un ID de otra empresa responde `404`. Si se necesitan imágenes privadas, habrá que definir autorización de lectura, visibilidad y vencimiento de URLs antes de implementar ese flujo.

La integración requiere `R2_ENDPOINT` (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_PUBLIC_BASE_URL` (por ejemplo `https://images.example.com`) en el servidor. En Compose se suministran desde un archivo `.env` local o variables del entorno. Crear el bucket en R2, generar credenciales S3 con permiso de lectura y escritura de objetos limitado a ese bucket y conectar el dominio propio desde **R2 → bucket → Settings → Custom Domains**. El dominio debe pertenecer a una zona de la misma cuenta de Cloudflare. Esperar a que figure como activo antes de probar la URL. Las credenciales no deben exponerse al frontend. `r2.dev` es solo para desarrollo; en producción se usa el dominio propio.

Las entidades futuras guardarán `imageId` y comprobarán que la imagen pertenece a la empresa al asociarla. No se incluye borrado público ni limpieza programada de imágenes válidas sin uso. Una caída entre la subida remota y el registro local todavía puede dejar un archivo huérfano; habrá que definir su limpieza antes de automatizarla.

Se posponen las subidas directas al proveedor, variantes configurables y transformaciones hasta tener un requisito concreto. La subida directa requeriría un flujo distinto de autorización temporal y confirmación de carga.

## Consecuencias y comprobaciones

La API es reutilizable y las entidades solo conocen identificadores internos. El coste inicial es una tabla de imágenes y el tránsito de archivos por core. Este cambio no necesita migración de archivos ni de base de datos porque aún no hay imágenes reales subidas.

Las pruebas comprueban la subida correcta, el rechazo de archivos inválidos, el aislamiento entre empresas, la traducción de errores del proveedor y la compensación cuando falla el guardado local. La autorización al asociar imágenes corresponde a los futuros casos de uso de las entidades.

## Referencias

- [Arquitectura del proyecto](architecture.md).
- [Contrato Result compartido](../shared/result.ts).
- [Buckets públicos y dominios propios de R2](https://developers.cloudflare.com/r2/buckets/public-buckets/).
- [Credenciales S3 de R2](https://developers.cloudflare.com/r2/api/tokens/).
