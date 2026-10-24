# Eval photos

Realistic phone-style photos of the synthetic catalog (`../catalog.ts`) and of what buyers send. Every photo is generated: no real
people, no real brands and no real payment data (names, amounts, account numbers and ID numbers are invented). They are released
as CC0 like the rest of the generated fixtures.

`manifest.json` lists every photo and is the only thing the evals read (`../image-manifest.ts` validates it with Zod):

| Field | Meaning |
| --- | --- |
| `file`, `folder` | Path relative to this folder; the folder is one of the table below. |
| `productKey`, `color` | The catalog product and color shown, or null; required for `match` and `label`. |
| `scenario` | What the photo shows («worn», «repost-screenshot», «second-color-worn», «payment»…); reported as `kind:<scenario>`. |
| `expected` | `match` (the product is found), `no_match` (not identified), `not_product` (nothing changes), `label` (found by its QR). |
| `generator`, `prompt`, `derivedFrom` | The source of the photo: the generator and prompt used, or the photo it was derived from (crop, light, repost). |

| Folder | Content |
| --- | --- |
| `catalog/` | The seller's photo of each catalog product that has one; indexed with the real embedder before each run. |
| `customer/` | What a buyer sends for a catalog product: other angles, light and crops, worn, worn in its second color, a repost screenshot. |
| `negative/` | Hard negatives (near-identical polos of another model or color) and products the catalog does not sell. |
| `non-product/` | Yape and Plin screens, a transfer voucher, a selfie, a map, an ID card specimen and a payment QR. |
| `label/` | Printed labels whose QR code is a catalog variant id (`variantIdOf` in `../catalog.ts`). |

Each manifest entry becomes one image case; the end-to-end cases pick their photos by product, folder and scenario. To add a
photo, add the file and its entry and run `pnpm --dir apps/core test:unit`, which parses the manifest.

The eval cases also reuse two CC0 fixtures that already exist in the repository (sources in their own READMEs):

- `src/features/products/infrastructure/product-matching/embedding-fixtures/product-a-front.jpg` (The Met Open Access, CC0): a product the catalog does not sell.
- `src/features/products/infrastructure/qr-fixtures/non-uuid-qr.jpg` (generated): a payment QR whose content is a URL.
