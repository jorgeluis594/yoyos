# Images

Core has one shared image API so that any feature (products, chat messages) can attach images without integrating a storage provider itself. Clients upload the file to core, receive `{ id, url }`, and then send only the `imageId` when creating or editing the entity.

Code: `apps/core/src/shared/images/` (application, R2 adapter, record repository, routes). Response contract: `shared/contracts/images.ts`. Schema: `Image` in `apps/core/prisma/schema.prisma`.

## Decisions

| Decision | Reason |
| --- | --- |
| Entities store the internal `imageId`, never a provider URL | Image delivery can change without updating every entity. Clients must not treat the URL as permanent. |
| Cloudflare R2 behind a provider-agnostic `ImageStorage` port | Only the adapter knows the R2 S3 API; use cases receive storage and the record repository as explicit dependencies. |
| The module lives in `apps/core/src/shared/`, not the root `shared/` | It is core code used by several core features; the root `shared/` is for code shared between applications. |
| Delivery URLs are public (bucket custom domain) | Clients, including the anonymous public catalog, display the URL directly. Whoever has a URL can download the object, so this module must not store private documents without a new access contract. |
| Uploads go through core, not directly to the provider | No temporary authorization or upload confirmation flow is needed. |
| Original bytes are stored; no conversion, thumbnails or variants | No requirement for them. |
| Feature rules (who may change a product photo, how many images) stay in each feature | The storage port receives no entity type or id. |
| The QR reader (`infrastructure/qr-code-reader.ts`) lives in this module; what a decoded QR means stays in each feature | It is generic, products (code identification) and payment settings (wallet QR) both use it, and placing it in products would create a dependency cycle between features. |

## API

| Operation | Input | Output |
| --- | --- | --- |
| `POST /api/images` | Multipart body with one file in the `file` field | `201 { id, url }` |
| `GET /api/images/:id` | Image id | `200 { id, url }` |

Both require a session and an active company. Errors use the shared `{ code, error }` envelope:

| Condition | HTTP | `code` |
| --- | --- | --- |
| Invalid multipart body, file or format | 400 | `INVALID_IMAGE` |
| File, request or resolution over the limits | 413 | `IMAGE_TOO_LARGE` |
| Request is not multipart | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Image missing or owned by another company | 404 | `NOT_FOUND` |
| Storage provider failure | 502 | `IMAGE_STORAGE_UNAVAILABLE` |
| Persistence failure | 503 | `SERVICE_UNAVAILABLE` |
| Storage configuration or invalid internal response | 500 | `INTERNAL_ERROR` |

## Rules

- The server decides the owner company from the session; an image of another company is reported as missing.
- Accepted files: one complete, static JPEG, PNG or WebP of at most 10 MB, positive dimensions, at most 8,000 px per side and 24 MP. The detected format must match the declared type; empty, truncated, corrupt, animated WebP and APNG files are rejected. The whole image is decoded before anything is stored, because a valid header does not prove a complete image.
- A use case that associates an `imageId` with an entity verifies that the image exists and belongs to the company. Knowing an id grants nothing.
- An upload stores the file first and then the record. If the record fails, the file is deleted as compensation; a failed compensation is logged. The provider and the database share no transaction, so an interrupted upload can leave an orphaned file.
- Replacing an image saves the new association first. Removing an association does not delete the file. There is no public delete endpoint and no automatic cleanup of unassociated images; a future cleanup must not expire bucket objects indiscriminately, because associated images live in the same bucket.

## Configuration

Server environment: `R2_ENDPOINT` (`https://<account id>.r2.cloudflarestorage.com`), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_PUBLIC_BASE_URL` (the bucket's custom domain, optionally with a path prefix). Only `R2_PUBLIC_BASE_URL` is needed to resolve URLs of existing images; uploads need all of them. Both URLs must be HTTPS in production and carry no credentials, query or fragment. Invalid configuration fails the affected operation with a configuration error, distinct from provider unavailability. Credentials never reach a client.

Setting up R2:

1. Create the bucket and S3 credentials with object read and write access limited to that bucket.
2. Connect a custom domain under **R2 → bucket → Settings → Custom Domains**; the domain must belong to a zone in the same Cloudflare account. Wait until it is active before testing a URL.
3. `r2.dev` URLs are for development only; production uses the custom domain.

References: [R2 public buckets and custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/), [R2 S3 credentials](https://developers.cloudflare.com/r2/api/tokens/).
