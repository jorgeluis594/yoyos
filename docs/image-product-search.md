# Image product search

When a customer sends an image in a chat, core identifies which product of the company it shows, and [message-to-order](message-to-order.md) adds that variant to the chat's open order (or creates one). Identification is a cascade that stops at the first step that answers: the printed QR label first, then visual search.

Code: `apps/core/src/features/products/application/identify-products-in-image.ts` (cascade), `index-product-image.ts` (indexing), `domain/image-identification.ts` (rules), `infrastructure/product-matching/` (embedders and chooser), `infrastructure/image-embeddings.ts` (vector queries). Schema: `ImageEmbedding` in `apps/core/prisma/schema.prisma`.

## Cascade

1. **QR.** Read the QR codes of the image.
   - Product QR codes found: their sellable (active) variants are the result; a deactivated or deleted variant matches nothing (one item per distinct variant). Codes that match no sellable variant are reported as product not found.
   - Only non-product QR codes (Yape/Plin payments, URLs): stop. Reason: such a QR says the image is not a product photo.
   - Unreadable image: stop.
   - No QR code at all: continue to visual search.
2. **Visual.** Only when visual search is configured and the company has at least one indexed product (checked before any embedding, so a company without an indexed catalog costs nothing).
   1. Embed the customer image.
   2. Take the K nearest active, sellable products of the company by cosine distance over the embedding of each product's current image (`PRODUCT_MATCH_CANDIDATES`, default 5).
   3. A vision model receives the customer image and the candidate images, labelled `A`, `B`, …, and answers one label or `none` with a confidence.
   4. Accept the choice only if it is one of the candidates and its confidence is at least `PRODUCT_MATCH_MIN_CONFIDENCE` (default 0.8).
   5. Add it only if the product has exactly one sellable (active) variant; otherwise the result is `ambiguous_variant`. Reason: product images are per product, so the image cannot tell which variant.

A visual match returns at most one product per image (a live screenshot shows the product being offered) and is added to the order like a QR match, without a confirmation step; the seller removes a wrong item as with any item.

Miss reasons (logged as skip reasons of message-to-order): `unreadable_image`, `unrecognized_qr_code`, `product_not_found`, `visual_search_disabled`, `no_indexed_products`, `no_visual_match`, `low_confidence`, `ambiguous_variant`.

## Indexing

- Creating a product with an image, or changing its image to a new one, publishes `product_image_changed { companyId, productId }`. The `index-product-image` handler reads the product's current image, embeds it and stores the embedding. Removing an image publishes nothing: search only uses the current image.
- The event carries ids, not the image, so a late event never indexes a replaced image. Indexing is idempotent per image and model.
- A failed publication does not fail the product save; it is logged and recovered with `pnpm --dir apps/core products:index-images`, which publishes the event for every active product whose current image lacks an embedding of the configured model.
- Indexing runs one job at a time. Reason: the local model saturates the worker CPU; one indexing job keeps a catalog upload from slowing customer image searches and bounds memory.

## Decisions

| Decision | Reason |
| --- | --- |
| Identification is owned by `products`; `orders` only adds what it returns | The QR code and the image identify a product, not an order. Dependency direction stays orders → products. |
| Embeddings belong to the image (`ImageEmbedding` keyed by company, image and model), not the product | Products sharing an image share its embedding, an image change only needs the new image embedded, and embeddings of customer images can be cached later. |
| pgvector in the same PostgreSQL, exact search, no ANN index | Catalogs have hundreds of products per company; an exact scan is cheaper than maintaining an index. Revisit beyond about 10,000 embeddings per company. |
| Every embedding stores its model; search compares only embeddings of the configured model | Vectors of different models are not comparable. Changing the embedder or its model requires deploying and running `products:index-images`. |
| Default embedder: local SigLIP 2 base (`onnx-community/siglip2-base-patch16-224-ONNX`, fp32) in the worker | One local inference instead of paid calls, deterministic, and no image leaves the server. Among commercially licensed models it gave the best preselection recall within the worker's latency and memory limits; quantized exports lost recall on screenshots, and OpenAI CLIP was excluded for its license. |
| Alternative embedder `IMAGE_EMBEDDER_PROVIDER=openai`: a vision model describes the image, a text embedding model embeds the description | OpenAI offers no image embedding endpoint. |
| No proximity threshold on candidates | Distances are measured first: visual outcomes log `topDistance` and `chosenDistance` to choose a cutoff later. |
| Captions and product names are not sent to the vision model | Captions are a prompt-injection surface without measured gain; names bias towards text and are seller data the model does not need. |
| Match method and confidence go to logs only | No new column; same visibility as other message-to-order skips. |
| `INVALID_MATCHER_RESPONSE` and `INVALID_EMBEDDING` are permanent failures; provider unavailability is retried | Their causes repeat on every paid attempt, so retrying only multiplies cost. |
| Provider adapters sit behind the `EmbedImage` and `ChooseProduct` ports, chosen by environment, and pass shared contract tests | Providers can be swapped or compared without touching the cascade. |

## Configuration

Visual search requires `OPENAI_API_KEY` (the chooser uses OpenAI). Without it both indexing and the visual step are disabled and images without QR end as `visual_search_disabled`; development and tests run without it. Other variables and their defaults are declared in `apps/core/src/features/products/composition.ts`: `PRODUCT_MATCHER_PROVIDER`, `PRODUCT_MATCHER_MODEL`, `IMAGE_EMBEDDER_PROVIDER`, `IMAGE_EMBEDDER_MODEL`, `IMAGE_DESCRIBE_MODEL`, `PRODUCT_MATCH_CANDIDATES`, `PRODUCT_MATCH_MIN_CONFIDENCE`, `PRODUCT_MATCH_TIMEOUT_MS`. An unknown provider name fails at startup.

The local model files are not committed; `pnpm --dir apps/core models:fetch` downloads them (see [apps/core/models/README.md](../apps/core/models/README.md)).

Never logged: image bytes, prompts, raw model responses, captions, product names, vectors or keys. Customer images and product photos sent to providers must not be retained for training; zero-retention options are used where the provider offers them.
