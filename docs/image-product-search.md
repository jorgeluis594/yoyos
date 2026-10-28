# Product identification

Identification decides which product of the company a customer's photo or text refers to, and how certain that is. It returns only identity and certainty; [message-to-order](message-to-order.md) decides what to do with the chat's open order. Photos use a cascade that stops at the first step that answers: the printed QR label first, then visual search. Texts are matched against the catalog by name. One variant resolution serves both.

Code: `apps/core/src/features/products/application/identify-products-in-image.ts` (cascade), `identify-product-in-text.ts` (texts), `resolve-variant.ts` (variants), `catalog-search-readiness.ts`, `index-product-photos.ts` (indexing), `domain/image-identification.ts` (rules), `infrastructure/product-matching/` (embedders, choosers, the dim photo brightening and the post photo crop), `infrastructure/image-embeddings.ts` (vector queries), `infrastructure/text-candidates.ts` (text query). Schema: `ImageEmbedding` in `apps/core/prisma/schema.prisma`.

## Photo cascade

1. **QR.** Read the QR codes of the image.
   - Product QR codes found (a variant UUID, what labels print): their sellable (active) variants are the result, each with its product; a deactivated or deleted variant matches nothing (one item per distinct variant). Codes that match no sellable variant are reported as product not found.
   - Only non-product QR codes (Yape/Plin payments, URLs): the photo is not a product. Reason: such a QR says the image is not a product photo.
   - Unreadable image: stop.
   - No QR code at all: continue to visual search.
2. **Visual.** Only when visual search is configured and the company has at least one indexed product, that is, any current photo of an active product with an active variant has an embedding of the model (checked before any embedding, so a company without an indexed catalog costs nothing).
   1. If the image is dim (its luminance deviation is under 28: dark, blurry or washed out), stretch its contrast. If it is a screenshot of a social post or chat (a photo band with flat app screen above and below it), cut that photo out. Embed the photo cut out, or the brightened copy, or the whole image otherwise.
   2. Take the K nearest active, sellable products of the company by cosine distance (`PRODUCT_MATCH_CANDIDATES`, default 5). Every current photo of a product is compared; a product counts once, at the distance of its closest photo, even if several of its photos match.
   3. A vision model receives the customer image as it came, the photo cut out of it or its brightened copy if any, and, per candidate, that closest photo, labelled `A`, `B`, …, and answers one label or `none` with a confidence, plus the probability that the image's main subject is an item a shop could sell (`shows_product`): alone, worn, held, on a screen, in a social post screenshot, or dark, blurry or cropped; not a selfie or portrait, a building or place, a payment or transfer, a chat, a map, a receipt, a document or a meme.
   4. `shows_product` below 0.5 means the photo is not a product, whatever the choice and its confidence. Reason: a selfie in a knitted sweater can resemble a catalog sweater, and a photo that is not a product is no purchase intent.
   5. Otherwise accept the choice only if it is one of the candidates and its confidence is at least `PRODUCT_MATCH_MIN_CONFIDENCE` (default 0.8). The result is the product, not a variant. With no accepted choice, it is a product that was not found.
   Products without active variants are not candidates, and a company with none answers `no_indexed_products`.

Results: `found` (QR items or the visual product, with method and confidence), `not_product`, or `not_found` with its reason (`unreadable_image`, `unrecognized_qr_code`, `product_not_found`, `visual_search_disabled`, `no_indexed_products`, `no_visual_match`, `low_confidence`). A visual match returns at most one product per image (a live screenshot shows the product being offered) and is added like a QR match, without a confirmation step.

## Text identification

1. One SQL query, under the company's RLS, computes `word_similarity` between the buyer's words for a product and the names of the company's active products with a sellable variant, and returns the best `TEXT_MATCH_CANDIDATES` (default 8) at or above `TEXT_MATCH_MIN_SIMILARITY` (default 0.3), each with its min–max price. All lines of one message share one query.
2. No candidate → `not_found`, with no model call.
3. Otherwise one Decision API choice over the candidates plus `none`, with the unit price the buyer stated (amount only, compared with each candidate's price range in that product's own currency) as a hint. A choice at or above `PRODUCT_MATCH_MIN_CONFIDENCE` → `found`. Two or more likely candidates → `not_clear`, naming them. A candidate is likely with a probability of at least `TEXT_MATCH_UNCLEAR_MIN_PROBABILITY` (0.25), or when its name holds every word of the mention in any plural or diminutive form, articles and prepositions aside («gorritas» names «Gorra trucker» and «Gorra snapback» alike): the chooser often puts one of two equally named products first below the threshold, and that is no reason to call the mention unknown. Anything else → `not_found`.

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

`GET /api/products/search-readiness` (session, `no-store`, contract `shared/contracts/catalog-search-readiness.ts`) answers `no_active_products`, `no_searchable_photos` (visual search disabled, or no current photo of an active product has an embedding of the configured model) or `ready`. Message-to-order consults it only on miss paths, to keep misses silent while visual search cannot answer; the mobile WhatsApp screen shows the matching hint.

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
| Identification is owned by `products` and returns identity and certainty only; `orders` decides and applies the order change | The QR code, image or text identifies a product, not an order change. Dependency direction stays orders → products. |
| Embeddings belong to the image (`ImageEmbedding` keyed by company, image and model), not the product | Products sharing an image share its embedding, an image change only needs the new image embedded, and embeddings of customer images can be cached later. |
| pgvector in the same PostgreSQL, exact search, no ANN index | Catalogs have hundreds of products per company; an exact scan is cheaper than maintaining an index. Revisit beyond about 10,000 embeddings per company, which with 8 photos per product is about 1,250 products; an ANN index is not a drop-in, because it orders photos, not products, so it needs an over-fetch (about K × 8 photos, then one per product) and a filter to current photos. |
| The text query uses the `Product (companyId)` btree, not the global trigram GIN | Catalogs have hundreds of products. Beyond about 10,000 products per company, add a `btree_gin (companyId, name gin_trgm_ops)` index `CONCURRENTLY` in its own migration. |
| The chooser sees one photo per candidate, the one closest to the customer image | A customer photo of the product worn is compared with the worn photo, not the front one, at the cost of one photo per candidate, as with a single photo. |
| Every embedding stores its model; search compares only embeddings of the configured model | Vectors of different models are not comparable. Changing the embedder or its model requires deploying and running `products:index-images`. |
| Default embedder: local SigLIP 2 base (`onnx-community/siglip2-base-patch16-224-ONNX`, fp32) in the worker | One local inference instead of paid calls, deterministic, and no image leaves the server. Among commercially licensed models it gave the best preselection recall within the worker's latency and memory limits; quantized exports lost recall on screenshots, and OpenAI CLIP was excluded for its license. Photo throughput is bound by the worker's vCPU, not by job concurrency. |
| Alternative embedder `IMAGE_EMBEDDER_PROVIDER=openai`: a vision model describes the image, a text embedding model embeds the description | OpenAI offers no image embedding endpoint. |
| A post or chat screenshot is searched by the photo inside it, found by fixed rules on pixel rows; the vision model still sees the whole screenshot | The app screen around a reposted catalog photo lowered the chooser's certainty under 0.8 for the very photo the seller uploaded. Rules cost milliseconds and no call; the whole screenshot keeps payment and chat screens recognisable as non-products. |
| A dim photo is searched by a contrast-stretched copy, and the vision model sees that copy beside the photo as it came | Dark, blurred photos of real products were answered `none` or under 0.8. Showing only the brightened copy rescued one and lost another, whose colours it shifted; with both views every damaged fixture photo is found. Clear photos are never touched (all fixtures are above a deviation of 30); a flat map screenshot is, and stays a non-product. Matching still needs 0.8, so a dim photo that is not a product gains nothing. |
| No proximity threshold on candidates | Distances are measured first: visual outcomes log `topDistance` and `chosenDistance` to choose a cutoff later, and `chosenPhotoPosition` shows whether a photo other than the primary identified the product. |
| Captions are used for interpretation, never for identification; product names are not sent to the vision model | A caption never chooses another product than the photo's, and it stays out of the identification request; names bias towards text and are seller data the vision model does not need. Interpretation of a caption receives the caption with the identified product's name and variant labels as text, never the image. |
| A photo that does not show a product is no purchase intent | Payment and transfer screenshots ask for nothing; notifying them would bury real misses. |
| Method and certainty of each identification are kept in the message's `ChatMessageOutcome`, not only in logs | They make each message apply once and are the data for showing how an item was identified and for threshold tuning. |
| `INVALID_MATCHER_RESPONSE` and `INVALID_EMBEDDING` are permanent failures; provider unavailability is retried | Their causes repeat on every paid attempt, so retrying only multiplies cost. |
| Provider adapters sit behind the `EmbedImage`, `ChooseProduct` and text and variant chooser ports, chosen by environment, and pass shared contract tests | Providers can be swapped or compared without touching the cascade. Products does not depend on `shared/ai-tools`. |

## Configuration

Visual search and the text and variant choosers require `OPENAI_API_KEY` (the choosers use the OpenAI Decision API). Without it both indexing and the visual step are disabled and images without QR end as `visual_search_disabled`; development and tests run without it. Other variables and their defaults are declared in `apps/core/src/features/products/composition.ts`: `PRODUCT_MATCHER_PROVIDER`, `PRODUCT_MATCHER_MODEL`, `IMAGE_EMBEDDER_PROVIDER`, `IMAGE_EMBEDDER_MODEL`, `IMAGE_DESCRIBE_MODEL`, `PRODUCT_MATCH_CANDIDATES`, `PRODUCT_MATCH_MIN_CONFIDENCE`, `PRODUCT_MATCH_TIMEOUT_MS`, `TEXT_MATCH_CANDIDATES`, `TEXT_MATCH_MIN_SIMILARITY`, `TEXT_MATCH_UNCLEAR_MIN_PROBABILITY`. An unknown provider name fails at startup. Each chooser call is bounded by `PRODUCT_MATCH_TIMEOUT_MS`; the image cascade does not receive the message job's attempt deadline, so its bound is that timeout and the job's expiry.

The local model files are not committed; `pnpm --dir apps/core models:fetch` downloads them (see [apps/core/models/README.md](../apps/core/models/README.md)).

Log events: `product_visual_match_completed` (method, confidence, distances, `showsProduct`, `detail`: `post_photo`, `brightened` or null), `product_visual_search_disabled`, `product_text_match_completed` and `product_variant_match_completed` (candidates, confidence, tokens, duration). The text and variant choosers send product names and variant labels to the Decision API, because the buyer's words are compared with them. Never logged: image bytes, prompts, raw model responses, captions, buyer words, product names, vectors or keys. Customer images and product photos sent to providers must not be retained for training; zero-retention options are used where the provider offers them.
