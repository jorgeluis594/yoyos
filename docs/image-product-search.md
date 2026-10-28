# Image product search

When a customer sends an image in a chat, core identifies which product of the company it shows, and [message-to-order](message-to-order.md) adds that variant to the chat's open order (or creates one). Identification is a cascade that stops at the first step that answers: the printed QR label first, then visual search.

Code: `apps/core/src/features/products/application/identify-products-in-image.ts` (cascade), `index-product-photos.ts` (indexing), `domain/image-identification.ts` (rules), `infrastructure/product-matching/` (embedders and chooser), `infrastructure/image-embeddings.ts` (vector queries). Schema: `ImageEmbedding` in `apps/core/prisma/schema.prisma`.

## Cascade

1. **QR.** Read the QR codes of the image.
   - Product QR codes found: their sellable (active) variants are the result; a deactivated or deleted variant matches nothing (one item per distinct variant). Codes that match no sellable variant are reported as product not found.
   - Only non-product QR codes (Yape/Plin payments, URLs): stop. Reason: such a QR says the image is not a product photo.
   - Unreadable image: stop.
   - No QR code at all: continue to visual search.
2. **Visual.** Only when visual search is configured and the company has at least one indexed product, that is, any current photo of an active product with an active variant has an embedding of the model (checked before any embedding, so a company without an indexed catalog costs nothing).
   1. Embed the customer image.
   2. Take the K nearest active, sellable products of the company by cosine distance (`PRODUCT_MATCH_CANDIDATES`, default 5). Every current photo of a product is compared; a product counts once, at the distance of its closest photo, even if several of its photos match.
   3. A vision model receives the customer image and, per candidate, that closest photo, labelled `A`, `B`, …, and answers one label or `none` with a confidence.
   4. Accept the choice only if it is one of the candidates and its confidence is at least `PRODUCT_MATCH_MIN_CONFIDENCE` (default 0.8).
   5. Add it only if the product has exactly one sellable (active) variant; otherwise the result is `ambiguous_variant`. Reason: product images are per product, so the image cannot tell which variant.
   Deactivating variants can therefore make a product recognizable by photo once a single active variant is left. Products without active variants are not candidates, and a company with none answers `no_indexed_products`.

A visual match returns at most one product per image (a live screenshot shows the product being offered) and is added to the order like a QR match, without a confirmation step; the seller removes a wrong item as with any item.

Miss reasons (logged as skip reasons of message-to-order): `unreadable_image`, `unrecognized_qr_code`, `product_not_found`, `visual_search_disabled`, `no_indexed_products`, `no_visual_match`, `low_confidence`, `ambiguous_variant`.

## Indexing

- Every photo of a product is indexed, one embedding per photo, when the product is saved with it. A photo uploaded but never saved to a product, or discarded with the form, identifies nothing.
- A create or save whose photo list holds an image the product did not have publishes `product_photos_added { companyId, productId }` after commit. Removing or reordering photos publishes nothing: a removed photo stops identifying the product as soon as the save without it commits, because search joins the product's current photos and never scans embeddings by themselves (embeddings of removed photos stay).
- The `index-product-photos` handler tries every photo of the product without an embedding of the model, one at a time in position order, and never stops at a failed photo. The job is retried (up to 8 times) only when some photo failed with a retryable code; a retry skips photos indexed meanwhile. Permanent failures (`INVALID_EMBEDDING`, `IMAGE_NOT_FOUND`) are logged per photo and the job succeeds. Reason: one bad photo must never keep the product's other photos unindexed (rejected: stopping the job at the first failure). Meanwhile the product is recognizable by its indexed photos.
- The event carries ids, not images, so a late event never indexes a removed photo for search; a photo removed while its job runs gets an embedding that no product uses, which is harmless. Indexing is idempotent per image and model.
- A product becomes recognizable by new photos after a delay (the job runs after the save, photo by photo), not at once.
- A failed publication does not fail the product save; it is logged and recovered with `pnpm --dir apps/core products:index-images`, which publishes the event for every active product with any photo lacking an embedding of the configured model. A photo that always fails permanently is tried once more on every run, without blocking the others.
- Indexing runs one job at a time. Reason: the local model saturates the worker CPU; one indexing job keeps a catalog upload from slowing customer image searches and bounds memory. The queue is shared by every company, so a product with 8 photos holds it for up to 8 embeddings; run `products:index-images` off-peak.
- Logs: `product_photos_indexed` (info, with `indexedCount`, `failedCount`, `durationMs` and `queueLatencyMs`, the wait from the event to the handler, so «recognizable within minutes» is read end to end), `product_photos_index_skipped` (debug), `product_photos_added_publish_failed` (error) and `product_photo_index_failed` once per failed photo and attempt. A retryable failure is a warning until the last attempt, then an error. A permanent failure is an error on the job's first attempt and debug on later retries of the same job, so one bad photo yields one error line per job. Known limit: a permanent failure first seen on a retry (the photo failed retryably before) is logged at debug only.

## Decisions

| Decision | Reason |
| --- | --- |
| Identification is owned by `products`; `orders` only adds what it returns | The QR code and the image identify a product, not an order. Dependency direction stays orders → products. |
| Embeddings belong to the image (`ImageEmbedding` keyed by company, image and model), not the product | Products sharing an image share its embedding, an image change only needs the new image embedded, and embeddings of customer images can be cached later. |
| pgvector in the same PostgreSQL, exact search, no ANN index | Catalogs have hundreds of products per company; an exact scan is cheaper than maintaining an index. Revisit beyond about 10,000 embeddings per company, which with 8 photos per product is about 1,250 products; an ANN index is not a drop-in, because it orders photos, not products, so it needs an over-fetch (about K × 8 photos, then one per product) and a filter to current photos. |
| The chooser sees one photo per candidate, the one closest to the customer image | A customer photo of the product worn is compared with the worn photo, not the front one, at the cost of one photo per candidate, as with a single photo. |
| Every embedding stores its model; search compares only embeddings of the configured model | Vectors of different models are not comparable. Changing the embedder or its model requires deploying and running `products:index-images`. |
| Default embedder: local SigLIP 2 base (`onnx-community/siglip2-base-patch16-224-ONNX`, fp32) in the worker | One local inference instead of paid calls, deterministic, and no image leaves the server. Among commercially licensed models it gave the best preselection recall within the worker's latency and memory limits; quantized exports lost recall on screenshots, and OpenAI CLIP was excluded for its license. |
| Alternative embedder `IMAGE_EMBEDDER_PROVIDER=openai`: a vision model describes the image, a text embedding model embeds the description | OpenAI offers no image embedding endpoint. |
| No proximity threshold on candidates | Distances are measured first: visual outcomes log `topDistance` and `chosenDistance` to choose a cutoff later, and `chosenPhotoPosition` shows whether a photo other than the primary identified the product. |
| Captions and product names are not sent to the vision model | Captions are a prompt-injection surface without measured gain; names bias towards text and are seller data the model does not need. |
| Match method and confidence go to logs only | No new column; same visibility as other message-to-order skips. |
| `INVALID_MATCHER_RESPONSE` and `INVALID_EMBEDDING` are permanent failures; provider unavailability is retried | Their causes repeat on every paid attempt, so retrying only multiplies cost. |
| Provider adapters sit behind the `EmbedImage` and `ChooseProduct` ports, chosen by environment, and pass shared contract tests | Providers can be swapped or compared without touching the cascade. |

## Configuration

Visual search requires `OPENAI_API_KEY` (the chooser uses OpenAI). Without it both indexing and the visual step are disabled and images without QR end as `visual_search_disabled`; development and tests run without it. Other variables and their defaults are declared in `apps/core/src/features/products/composition.ts`: `PRODUCT_MATCHER_PROVIDER`, `PRODUCT_MATCHER_MODEL`, `IMAGE_EMBEDDER_PROVIDER`, `IMAGE_EMBEDDER_MODEL`, `IMAGE_DESCRIBE_MODEL`, `PRODUCT_MATCH_CANDIDATES`, `PRODUCT_MATCH_MIN_CONFIDENCE`, `PRODUCT_MATCH_TIMEOUT_MS`. An unknown provider name fails at startup.

The local model files are not committed; `pnpm --dir apps/core models:fetch` downloads them (see [apps/core/models/README.md](../apps/core/models/README.md)).

Never logged: image bytes, prompts, raw model responses, captions, product names, vectors or keys. Customer images and product photos sent to providers must not be retained for training; zero-retention options are used where the provider offers them.
