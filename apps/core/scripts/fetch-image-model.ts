import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// The default local image model (DEFAULT_LOCAL_IMAGE_MODEL) at a pinned Hugging Face revision, verified by sha256 (models/README.md).
// The Dockerfile and CI run it once; the app never downloads. Standalone so the Dockerfile runs it before copying the sources.
const model = "onnx-community/siglip2-base-patch16-224-ONNX";
const revision = "ba1f3b0843f24bc5417d38e19c37b287d719b2f4";
const files: Readonly<Record<string, string>> = {
  "config.json": "e43a9f7692d3819886a82cb2097048258d444f123c67d37ec825f9345b019cf2",
  "preprocessor_config.json": "9b36b57ebaf20f09bf4c22100ccc21877ea6bfe5aead0c00c59f8af8ccefacfc",
  "onnx/vision_model.onnx": "c0573e3f4140c3a7c4e9cc5912bd6b26a033b46a6a8e8af26cbea262b163bcad",
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function fetchFile(name: string, expected: string) {
  const path = join(resolve("models"), model, name);
  const present = await readFile(path).catch(() => null);
  if (present && sha256(present) === expected) return;
  const response = await fetch(`https://huggingface.co/${model}/resolve/${revision}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error(`${name}: sha256 mismatch`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.part`, bytes);
  await rename(`${path}.part`, path);
  console.log(`Fetched ${model}/${name}`);
}

try {
  for (const [name, expected] of Object.entries(files)) await fetchFile(name, expected);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
