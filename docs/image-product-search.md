# Product identification

Identification decides which product of the company a customer's photo or text refers to, and how certain that is. It returns only identity and certainty; [message-to-order](message-to-order.md) decides what to do with the chat's open order. Photos use a cascade that stops at the first step that answers: the printed QR label first, then visual search. Texts are matched against the catalog by name. One variant resolution serves both.

Code: `apps/core/src/features/products/application/identify-products-in-image.ts` (cascade), `identify-product-in-text.ts` (texts), `resolve-variant.ts` (variants), `catalog-search-readiness.ts`, `index-product-image.ts` (indexing), `domain/image-identification.ts` (rules), `infrastructure/product-matching/` (embedders and choosers), `infrastructure/image-embeddings.ts` (vector queries), `infrastructure/text-candidates.ts` (text query). Schema: `ImageEmbedding` in `apps/core/prisma/schema.prisma`.

## Photo cascade

1. **QR.** Read the QR codes of the image.
   - Product QR codes found (a variant UUID, what labels print): their sellable variants are the result, each with its product (one item per distinct variant). Codes that match no sellable variant are reported as product not found.
   - Only non-product QR codes (Yape/Plin payments, URLs): the photo is not a product. Reason: such a QR says the image is not a product photo.
   - Unreadable image: stop.
   - No QR code at all: continue to visual search.
2. **Visual.** Only when visual search is configured and the company has at least one indexed product (checked before any embedding, so a company without an indexed catalog costs nothing).
   1. Embed the customer image.
   2. Take the K nearest active, sellable products of the company by cosine distance over the embedding of each product's current image (`PRODUCT_MATCH_CANDIDATES`, default 5).
   3. A vision model receives the customer image and the candidate images, labelled `A`, `B`, …, and answers one label or `none` with a confidence, plus the probability that the image's main subject is an item a shop could sell (`shows_product`): alone, worn, held, on a screen, in a social post screenshot, or dark, blurry or cropped; not a selfie or portrait, a building or place, a payment or transfer, a chat, a map, a receipt, a document or a meme.
   4. `shows_product` below 0.5 means the photo is not a product, whatever the choice and its confidence. Reason: a selfie in a knitted sweater can resemble a catalog sweater, and a photo that is not a product is no purchase intent.
   5. Otherwise accept the choice only if it is one of the candidates and its confidence is at least `PRODUCT_MATCH_MIN_CONFIDENCE` (default 0.8). The result is the product, not a variant. With no accepted choice, it is a product that was not found.

Results: `found` (QR items or the visual product, with method and confidence), `not_product`, or `not_found` with its reason (`unreadable_image`, `unrecognized_qr_code`, `product_not_found`, `visual_search_disabled`, `no_indexed_products`, `no_visual_match`, `low_confidence`). A visual match returns at most one product per image (a live screenshot shows the product being offered) and is added like a QR match, without a confirmation step.

## Text identification

1. One SQL query, under the company's RLS, computes `word_similarity` between the buyer's words for a product and the names of the company's active products with a sellable variant, and returns the best `TEXT_MATCH_CANDIDATES` (default 8) at or above `TEXT_MATCH_MIN_SIMILARITY` (default 0.3), each with its min–max price. All lines of one message share one query.
2. No candidate → `not_found`, with no model call.
3. Otherwise one Decision API choice over the candidates plus `none`, with the unit price the buyer stated (amount only, compared with each candidate's price range in that product's own currency) as a hint. A choice at or above `PRODUCT_MATCH_MIN_CONFIDENCE` → `found`. Two or more candidates with a probability of at least `TEXT_MATCH_UNCLEAR_MIN_PROBABILITY` (0.25) → `not_clear`, naming them. Anything else → `not_found`.

The price hint does not depend on the chat having an open order, so «el polo de 35» tells «Polo básico» (S/ 35) from «Polo premium» (S/ 55) either way.

## Variant resolution

`resolveVariant` is the only variant authority, for photos and texts. The interpretation model returns variant words, never a variant ID.

- A QR-selected variant with no words → that variant. With words, the matching variant of the same product.
- One sellable variant and no words → that variant.
- Several sellable variants and no words → `missing`, with the attribute names of the product's variants in their stored attribute order (the notice says «qué talla o color»).
- Words that exactly match one sellable variant, ignoring case and accents → that variant, with no model call.
- Otherwise a Decision choice over the sellable variant labels plus `none`: at or above 0.8 → that variant; anything else → `not_available`.

A visual product with no sellable variant is reported as not identified. Reason for one authority: product images and names identify a product, so the variant always comes from the buyer's words.

## Catalog search readiness

`GET /api/products/search-readiness` (session, `no-store`, contract `shared/contracts/catalog-search-readiness.ts`) answers `no_active_products`, `no_searchable_photos` (visual search disabled, or no active product's current image has an embedding of the configured model) or `ready`. Message-to-order consults it only on miss paths, to keep misses silent while visual search cannot answer; the mobile WhatsApp screen shows the matching hint.

## Indexing

- Creating a product with an image, or changing its image to a new one, publishes `product_image_changed { companyId, productId }`. The `index-product-image` handler reads the product's current image, embeds it and stores the embedding. Removing an image publishes nothing: search only uses the current image.
- The event carries ids, not the image, so a late event never indexes a replaced image. Indexing is idempotent per image and model.
- A failed publication does not fail the product save; it is logged and recovered with `pnpm --dir apps/core products:index-images`, which publishes the event for every active product whose current image lacks an embedding of the configured model.
- Indexing runs one job at a time. Reason: the local model saturates the worker CPU; one indexing job keeps a catalog upload from slowing customer image searches and bounds memory.

## Decisions

| Decision | Reason |
| --- | --- |
| Identification is owned by `products` and returns identity and certainty only; `orders` decides and applies the order change | The QR code, image or text identifies a product, not an order change. Dependency direction stays orders → products. |
| Embeddings belong to the image (`ImageEmbedding` keyed by company, image and model), not the product | Products sharing an image share its embedding, an image change only needs the new image embedded, and embeddings of customer images can be cached later. |
| pgvector in the same PostgreSQL, exact search, no ANN index | Catalogs have hundreds of products per company; an exact scan is cheaper than maintaining an index. Revisit beyond about 10,000 embeddings per company. |
| The text query uses the `Product (companyId)` btree, not the global trigram GIN | Catalogs have hundreds of products. Beyond about 10,000 products per company, add a `btree_gin (companyId, name gin_trgm_ops)` index `CONCURRENTLY` in its own migration. |
| Every embedding stores its model; search compares only embeddings of the configured model | Vectors of different models are not comparable. Changing the embedder or its model requires deploying and running `products:index-images`. |
| Default embedder: local SigLIP 2 base (`onnx-community/siglip2-base-patch16-224-ONNX`, fp32) in the worker | One local inference instead of paid calls, deterministic, and no image leaves the server. Among commercially licensed models it gave the best preselection recall within the worker's latency and memory limits; quantized exports lost recall on screenshots, and OpenAI CLIP was excluded for its license. Photo throughput is bound by the worker's vCPU, not by job concurrency. |
| Alternative embedder `IMAGE_EMBEDDER_PROVIDER=openai`: a vision model describes the image, a text embedding model embeds the description | OpenAI offers no image embedding endpoint. |
| No proximity threshold on candidates | Distances are measured first: visual outcomes log `topDistance` and `chosenDistance` to choose a cutoff later. |
| Captions are used for interpretation, never for identification; product names are not sent to the vision model | A caption never chooses another product than the photo's, and it stays out of the identification request; names bias towards text and are seller data the vision model does not need. Interpretation of a caption receives the caption with the identified product's name and variant labels as text, never the image. |
| A photo that does not show a product is no purchase intent | Payment and transfer screenshots ask for nothing; notifying them would bury real misses. |
| Method and certainty of each identification are kept in the message's `ChatMessageOutcome`, not only in logs | They make each message apply once and are the data for showing how an item was identified and for threshold tuning. |
| `INVALID_MATCHER_RESPONSE` and `INVALID_EMBEDDING` are permanent failures; provider unavailability is retried | Their causes repeat on every paid attempt, so retrying only multiplies cost. |
| Provider adapters sit behind the `EmbedImage`, `ChooseProduct` and text and variant chooser ports, chosen by environment, and pass shared contract tests | Providers can be swapped or compared without touching the cascade. Products does not depend on `shared/ai-tools`. |

## Configuration

Visual search and the text and variant choosers require `OPENAI_API_KEY` (the choosers use the OpenAI Decision API). Without it both indexing and the visual step are disabled and images without QR end as `visual_search_disabled`; development and tests run without it. Other variables and their defaults are declared in `apps/core/src/features/products/composition.ts`: `PRODUCT_MATCHER_PROVIDER`, `PRODUCT_MATCHER_MODEL`, `IMAGE_EMBEDDER_PROVIDER`, `IMAGE_EMBEDDER_MODEL`, `IMAGE_DESCRIBE_MODEL`, `PRODUCT_MATCH_CANDIDATES`, `PRODUCT_MATCH_MIN_CONFIDENCE`, `PRODUCT_MATCH_TIMEOUT_MS`, `TEXT_MATCH_CANDIDATES`, `TEXT_MATCH_MIN_SIMILARITY`, `TEXT_MATCH_UNCLEAR_MIN_PROBABILITY`. An unknown provider name fails at startup. Each chooser call is bounded by `PRODUCT_MATCH_TIMEOUT_MS`; the image cascade does not receive the message job's attempt deadline, so its bound is that timeout and the job's expiry.

The local model files are not committed; `pnpm --dir apps/core models:fetch` downloads them (see [apps/core/models/README.md](../apps/core/models/README.md)).

Log events: `product_visual_match_completed` (method, confidence, distances, `showsProduct`), `product_visual_search_disabled`, `product_text_match_completed` and `product_variant_match_completed` (candidates, confidence, tokens, duration). The text and variant choosers send product names and variant labels to the Decision API, because the buyer's words are compared with them. Never logged: image bytes, prompts, raw model responses, captions, buyer words, product names, vectors or keys. Customer images and product photos sent to providers must not be retained for training; zero-retention options are used where the provider offers them.
