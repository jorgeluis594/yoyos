# Decisión: API compartida de imágenes en core

Fecha: 2026-09-23.

Estado: diseño acordado para documentar; implementación pendiente. La visibilidad y la política de limpieza requieren definición antes de producción.

## Contexto y decisión

Las distintas entidades necesitan asociar imágenes sin implementar su propia integración con el proveedor. Se creará una API de imágenes en `apps/core`, reutilizable por el frontend y los módulos de negocio.

Cloudflare será el primer proveedor. Se propone Cloudflare Images como servicio concreto. El contrato y los casos de uso serán agnósticos mediante inversión de dependencias; únicamente el adaptador conocerá la API de Cloudflare.

El frontend subirá el archivo a core y recibirá `{ id, url }`. Después enviará el identificador al crear o actualizar la entidad correspondiente. Se recomienda persistir un identificador interno en las entidades, en lugar de una URL del proveedor, para poder cambiar la entrega de imágenes sin actualizar cada entidad.

## Flujo y API

```text
Frontend → POST /api/images → caso de uso → ImageStorage → Cloudflare
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
  ownerId: string;     // Propietario autorizado, determinado por el servidor.
  createdAt: Date;
};

// Ejemplo de asociación, no una definición completa del producto.
type Product = {
  id: string;
  name: string;
  imageId: string | null;
};
```

Se debe definir si la propiedad corresponde al usuario o a la empresa y modelar esa relación explícitamente. `ownerId` expresa esa necesidad, no una relación polimórfica ya decidida.

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
├── domain/           # Registro de imagen compartido.
├── application/      # Subida, consulta y puertos necesarios.
│   └── ports/
│       └── image-storage.ts
├── infrastructure/   # Adaptador Cloudflare y persistencia del registro.
└── presentation/     # Rutas, validación de entrada y respuestas HTTP.
```

Este código pertenece al `shared` de core. El `shared/` de la raíz sigue reservado para código compartido entre aplicaciones, como `Result`.

El adaptador se construirá mediante una función como `createCloudflareImageStorage(config): ImageStorage`. `app.ts` lo suministrará a los casos de uso mediante parámetros, sin contenedor de inyección ni clases base.

```text
Presentación → Aplicación → Contrato ImageStorage
                                  ↑
                         Adaptador Cloudflare
```

Las reglas específicas permanecen en cada feature: permisos para modificar un producto, cantidad de imágenes permitidas o selección de imagen principal. El puerto de almacenamiento no recibirá `entityType` ni `entityId`.

## Validación, autorización y consistencia

- La subida requiere autenticación. El servidor determina el propietario; no confía en un propietario enviado por el cliente.
- Se limita el tamaño antes de cargar el archivo completo en memoria y se valida su contenido real, además del tipo declarado. Los formatos y límites concretos quedan por definir.
- Al asociar un `imageId`, el caso de uso comprueba que exista y que el actor tenga permiso para utilizarlo. Conocer un ID no concede autorización.
- Las credenciales de Cloudflare permanecen en el servidor. El adaptador valida las respuestas externas y traduce sus errores.
- La subida guarda primero el archivo y después el registro local. Si falla el guardado, intenta eliminar el archivo subido; si la compensación falla, registra el fallo para su posterior limpieza.
- La base de datos y el proveedor no comparten una transacción. Una caída entre ambas operaciones puede dejar archivos huérfanos.
- Al reemplazar una imagen se guarda primero la nueva asociación. La anterior solo puede eliminarse cuando ya no tenga referencias y la operación esté autorizada.

## Alcance inicial y pendientes

La primera implementación incluirá subida a través de core y consulta. No se expondrá todavía un endpoint público de borrado; `delete` estará disponible internamente para compensaciones.

Se asumen imágenes públicas para este contrato inicial. Si se necesitan imágenes privadas, habrá que definir autorización de lectura, visibilidad y vencimiento de URLs antes de implementar ese flujo.

Quedan pendientes:

1. Confirmar Cloudflare Images y la visibilidad de las imágenes.
2. Definir si el propietario es el usuario o la empresa.
3. Establecer formatos admitidos y tamaño máximo.
4. Definir la limpieza de subidas abandonadas, archivos huérfanos y registros sin referencias, sin eliminar imágenes todavía utilizadas.

Se posponen las subidas directas al proveedor, variantes configurables y transformaciones hasta tener un requisito concreto. La subida directa requeriría un flujo distinto de autorización temporal y confirmación de carga.

## Consecuencias y comprobaciones

La API es reutilizable y las entidades solo conocen identificadores internos. El coste inicial es una tabla de imágenes y el tránsito de archivos por core. Cambiar de proveedor requiere otro adaptador y migrar los archivos y sus referencias internas; la inversión de dependencias no migra datos automáticamente.

Al implementar se comprobarán la subida correcta, el rechazo de archivos inválidos, la autorización al asociar imágenes, la traducción de errores del proveedor y la compensación cuando falle el guardado local. Los casos de uso podrán comprobarse con dependencias simuladas, sin llamar a Cloudflare.

## Referencias

- [Arquitectura del proyecto](architecture.md).
- [Contrato Result compartido](../shared/result.ts).
- [Cloudflare Images: subidas directas y confirmación de carga](https://developers.cloudflare.com/images/storage/upload-images/direct-creator-upload/).
