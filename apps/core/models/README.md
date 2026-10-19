# Local image embedder models

The local image embedder (`src/features/products/infrastructure/product-matching/local-image-embedder.ts`) loads its model only from
this directory, with transformers.js remote downloads disabled (`env.allowRemoteModels = false`, `env.localModelPath`). The app and the
tests never download a model.

A model with id `<owner>/<name>` lives in `<owner>/<name>/` and needs exactly the files the embedder loads:

- `config.json`
- `preprocessor_config.json`
- `onnx/vision_model.onnx` (fp32)

The default model's vision tower is 372 MB, over GitHub's 100 MB file limit, and Git LFS is not used: Coolify would pull it on every deploy
and CI on every run, which exhausts the free 10 GiB monthly LFS bandwidth in about 27 pulls, after which GitHub disables LFS and checkouts
get pointer files. Instead `pnpm models:fetch` (`scripts/fetch-image-model.ts`) downloads the files from a pinned Hugging Face revision
and rejects any whose sha256 differs. The Dockerfile runs it in its own cached layer before installing dependencies, CI runs it (cached) before
the integration suite, and a developer runs it once. Only this README and the license are committed; `.gitignore` and `.dockerignore`
exclude the fetched files. Changing the model requires updating the script, this README and `pnpm products:index-images`.

## onnx-community/siglip2-base-patch16-224-ONNX (default)

- Source: https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX, revision `ba1f3b0843f24bc5417d38e19c37b287d719b2f4`, the
  transformers.js ONNX export of https://huggingface.co/google/siglip2-base-patch16-224 (revision `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`).
- License: Apache-2.0 (checked 2026-10-18 on the Google model card, which licenses the weights; the ONNX repo is a format conversion of
  those weights and states no other terms). Commercial use and redistribution are allowed with the license text, which is in
  `onnx-community/siglip2-base-patch16-224-ONNX/LICENSE`; the Google repo ships no NOTICE file.
- Output: 768-dimension pooled image embedding; fp32 (the quantized export loses much of its recall, design §2).
- sha256:
  - `config.json` (435 bytes) `e43a9f7692d3819886a82cb2097048258d444f123c67d37ec825f9345b019cf2`
  - `preprocessor_config.json` (394 bytes) `9b36b57ebaf20f09bf4c22100ccc21877ea6bfe5aead0c00c59f8af8ccefacfc`
  - `onnx/vision_model.onnx` (371,807,752 bytes) `c0573e3f4140c3a7c4e9cc5912bd6b26a033b46a6a8e8af26cbea262b163bcad`
