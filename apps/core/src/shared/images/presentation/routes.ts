import express, { type ErrorRequestHandler } from "express";
import { getCompanyId } from "@core/src/shared/infrastructure/persistance";
import { getImage, uploadImage, type ImageRepository, type ImageStorage } from "@core/src/shared/images/application/images";

const maxBytes = 10_000_000;
const rawBody = express.raw({ type: () => true, limit: maxBytes + 64 * 1024 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actualType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP") return "image/webp";
  return null;
}

export function imageRoutes(storage: ImageStorage, repository: ImageRepository) {
  const router = express.Router();
  router.post("/", rawBody, async (request, response) => {
    if (!request.is("multipart/form-data") || !Buffer.isBuffer(request.body)) return response.status(415).json({ error: "Multipart file required" });
    let form: FormData;
    try {
      form = await new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": request.headers["content-type"] ?? "" },
        body: new Uint8Array(request.body),
      }).formData();
    } catch {
      return response.status(400).json({ error: "Invalid multipart body" });
    }
    const entries = [...form.entries()];
    if (entries.length !== 1 || entries[0][0] !== "file" || !(entries[0][1] instanceof File)) {
      return response.status(400).json({ error: "One file is required" });
    }
    const file = entries[0][1];
    if (file.size > maxBytes) return response.status(413).json({ error: "File exceeds 10 MB" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (actualType(bytes) !== file.type || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return response.status(400).json({ error: "Unsupported image" });
    }
    const result = await uploadImage(getCompanyId(), { bytes, filename: file.name, contentType: file.type }, storage, repository);
    return result.success ? response.status(201).json(result.data) : response.status(502).json({ error: result.error.message });
  });
  router.get("/:id", async (request, response) => {
    const id = request.params.id;
    if (typeof id !== "string" || !uuid.test(id)) return response.status(404).json({ error: "Not found" });
    const result = await getImage(getCompanyId(), id, storage, repository);
    if (!result.success) return response.status(502).json({ error: result.error.message });
    return result.data ? response.json(result.data) : response.status(404).json({ error: "Not found" });
  });
  const sizeError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
      return response.status(413).json({ error: "Request exceeds upload limit" });
    }
    next(error);
  };
  router.use(sizeError);
  return router;
}
