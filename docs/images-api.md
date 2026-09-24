# Decision: Shared image API in core

Date: 2026-09-23.

Status: upload and retrieval implemented in `apps/core`. Delivery URLs are public.

## Context and decision

Different entities need to associate images without implementing their own provider integration. An image API will be created in `apps/core` for use by the frontend and business modules.

Cloudflare R2 stores the images, and a custom domain connected to the bucket serves them publicly. The contract and use cases are provider agnostic through dependency inversion; only the adapter knows the R2 S3 API.

The frontend will upload the file to core and receive `{ id, url }`. It will then send the identifier when creating or updating the corresponding entity. Entities should persist an internal identifier instead of a provider URL so image delivery can change without updating every entity.

## Flow and API

```text
Frontend → POST /api/images → use case → ImageStorage → R2
                                    └→ local image record

Response: { id, url }

Frontend → create or update an entity with imageId
```

HTTP contract:

| Operation | Input | Output |
| --- | --- | --- |
| `POST /api/images` | Multipart file in the `file` field | `201 { id, url }` |
| `GET /api/images/:id` | Internal identifier | `200 { id, url }` |

Successful responses are validated with `shared/contracts/images.ts`: `id` is a UUID and `url` is an HTTP or HTTPS URL. An invalid internal response is logged and returns `500 INTERNAL_ERROR`. Errors use the shared `{ code, error }` JSON contract:

| Condition | HTTP | `code` |
| --- | --- | --- |
| Invalid multipart body, file, or format | 400 | `INVALID_IMAGE` |
| File or request exceeds the upload limit | 413 | `IMAGE_TOO_LARGE` |
| Request is not multipart | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Image missing or owned by another company | 404 | `NOT_FOUND` |
| Storage provider failure | 502 | `IMAGE_STORAGE_UNAVAILABLE` |
| Persistence failure | 503 | `SERVICE_UNAVAILABLE` |
| Storage configuration or internal response failure | 500 | `INTERNAL_ERROR` |

Authentication and company errors use the existing shared codes. The mobile transport preserves image-specific codes; a future image adapter must validate successful responses before use.

Illustrative example of a future product API using this contract:

```text
POST /api/products      { name, imageId }
GET /api/products/:id   → { id, name, image: { id, url } | null }
```

The URL lets the frontend display the image immediately. The persistent reference is `imageId`; clients should not assume the URL is permanent.

## Data

```ts
type Image = {
  id: string;          // Internal application identifier.
  storageKey: string;  // Opaque provider reference.
  companyId: string;   // Authorized company, determined by the server.
  createdAt: Date;
};

// Example association, not a complete product definition.
type Product = {
  id: string;
  name: string;
  imageId: string | null;
};
```

The implementation uses `companyId` as the owner and applies PostgreSQL RLS.

The database will retain the mapping between the internal identifier and `storageKey`. Entities can reference the image record with a foreign key. Credentials and temporary URLs will not be stored in entities.

## Provider agnostic contract

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

`key` is an opaque reference: consumers do not interpret its format. The contract does not include account identifiers, variants, HTTP responses, or Cloudflare types.

`delete` is considered successful when the file no longer exists. Expected failures are translated into the existing `Result` contract; unexpected failures must remain observable and must never silently become successes.

The local record store will also be supplied to the use case through an explicit dependency. Use cases will not import Prisma or construct concrete adapters.

## Location and dependencies

```text
apps/core/src/shared/images/
├── application/      # Upload, retrieval, and the ImageStorage contract.
│   └── images.ts
├── infrastructure/   # R2 adapter and record persistence.
└── presentation/     # Routes, input validation, and HTTP responses.
```

This code belongs in core's `shared` directory. The root `shared/` directory remains reserved for code shared between applications, such as `Result`.

The adapter is constructed with `createR2ImageStorage(config): ImageStorage`. `app.ts` supplies it to the use cases through parameters, without an injection container or base classes. Each object uses an opaque UUID as its key; uploads preserve the content type, and the URL is formed with `R2_PUBLIC_BASE_URL`.

```text
Presentation → Application → ImageStorage contract
                                     ↑
                                R2 adapter
```

Feature-specific rules remain in each feature: permission to modify a product, the number of images allowed, and primary image selection. The storage port will not receive `entityType` or `entityId`.

## Validation, authorization, and consistency

- Uploads require authentication. The server determines the owner; it does not trust an owner sent by the client.
- A single JPEG, PNG, or WebP file in the `file` field is accepted, up to 10 MB. The request body is limited before parsing, and the file signature is checked in addition to the declared type.
- Future use cases that associate an `imageId` must verify that it exists and belongs to the authorized company. Knowing an ID does not grant authorization.
- R2 credentials remain on the server. The adapter translates upload and deletion errors.
- An upload stores the file first, then the local record. If saving the record fails, it attempts to delete the uploaded file; if compensation fails, it logs the failure for later cleanup.
- The database and provider do not share a transaction. A failure between the two operations can leave orphaned files.
- When replacing an image, the new association is saved first. The previous image may be deleted only when it has no remaining references and the operation is authorized.

## Initial scope and outstanding work

The first implementation includes upload through core and retrieval. No public deletion endpoint is exposed; `delete` is available internally for compensation.

Bucket domain URLs are public; the endpoints require a session and company. An ID belonging to another company returns `404`. If private images are needed, read authorization, visibility, and URL expiration must be defined before implementing that flow.

The integration requires `R2_ENDPOINT` (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_PUBLIC_BASE_URL` (for example, `https://images.example.com`) on the server. In Compose, these are supplied through a local `.env` file or environment variables. Create the bucket in R2, generate S3 credentials with object read and write access limited to that bucket, and connect the custom domain under **R2 → bucket → Settings → Custom Domains**. The domain must belong to a zone in the same Cloudflare account. Wait until it is shown as active before testing the URL. Credentials must not be exposed to the frontend. `r2.dev` is for development only; production uses the custom domain.

Future entities will store `imageId` and verify that the image belongs to the company when associating it. Public deletion and scheduled cleanup of valid unused images are not included. A failure between the remote upload and local record creation can still leave an orphaned file; its cleanup must be defined before it is automated.

Direct uploads to the provider, configurable variants, and transformations are deferred until there is a concrete requirement. Direct uploads would require a different flow for temporary authorization and upload confirmation.

## Consequences and checks

The API is reusable, and entities only know internal identifiers. The initial cost is an image table and routing file uploads through core. This change needs no file or database migration because no real images have been uploaded yet.

Tests cover successful uploads, rejection of invalid files, isolation between companies, translation of provider errors, and compensation when saving the local record fails. Authorization when associating images belongs to the future entity use cases.

## References

- [Project architecture](architecture.md).
- [Shared Result contract](../shared/result.ts).
- [R2 public buckets and custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/).
- [R2 S3 credentials](https://developers.cloudflare.com/r2/api/tokens/).
