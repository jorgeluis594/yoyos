# Local image embedder models

The local image embedder (`src/features/products/infrastructure/product-matching/local-image-embedder.ts`) loads its model only from
this directory, with transformers.js remote downloads disabled (`env.allowRemoteModels = false`, `env.localModelPath`). The app, the
tests and the Docker image (which copies this directory) never download a model.

A model with id `<owner>/<name>` lives in `<owner>/<name>/` and needs exactly the files the embedder loads:

- `config.json`
- `preprocessor_config.json`
- `onnx/vision_model.onnx` (fp32, as pinned by the config's `transformers.js_config`)

Commit them as plain git files (no LFS, each under GitHub's 100 MB limit) with a section below naming the source, revision, license and
sha256 of each file. Changing the model requires `pnpm products:index-images`.

## Xenova/mobileclip_s0 (current default, not committed)

- Source: https://huggingface.co/Xenova/mobileclip_s0, revision `757d59c9c6870a76a4b0306f05f5061bca15c39f`, an ONNX conversion of
  https://github.com/apple/ml-mobileclip.
- License: the weights are under the Apple ML Research Model Terms of Use (research only, no commercial use), so they are not committed
  and must not ship (design §15). `.gitignore` excludes the directory; place the files here by hand only for local measurement.
- sha256:
  - `config.json` `8e33c1f2634a33de3e38715f9809ef86742aacbe31c310c66fc2636755458d56`
  - `preprocessor_config.json` `b031f09fbd69e22a605b6cc7433993249ee893b7fc1b79321f669cd015493dd4`
  - `onnx/vision_model.onnx` (45,543,630 bytes) `17d3c037b1d488c10c50e09f6009ea5a198caef4e0e8f4ea5617b7cb2d067ac0`
