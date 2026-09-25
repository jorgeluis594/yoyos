import express, { type ErrorRequestHandler } from "express";
import { imageResponseSchema } from "@shared/contracts/images";
import { apiError } from "@core/src/shared/infrastructure/api-auth-middleware";
import { getCompanyId } from "@core/src/shared/infrastructure/persistance";
import { getImage, readPrivateImage, uploadImage, validateImage, type ImageRepository, type ImageStorage } from "@core/src/shared/images/application/images";

const maxBytes = 10_000_000;
const rawBody = express.raw({ type: () => true, limit: maxBytes + 64 * 1024 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function imageRoutes(storage: ImageStorage, repository: ImageRepository) {
  const router = express.Router();
  const sendResult = (response: express.Response, value: unknown, status = 200) => {
    const parsed = imageResponseSchema.safeParse(value);
    if (!parsed.success) {
      console.error("Invalid image response", parsed.error);
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    }
    return response.status(status).json(parsed.data);
  };
  const sendFailure = (response: express.Response, code?: string) => {
    switch (code) {
      case "IMAGE_STORAGE_UNAVAILABLE": return apiError(response, 502, "IMAGE_STORAGE_UNAVAILABLE", "Image storage unavailable");
      case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
      default: return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    }
  };
  router.post("/", rawBody, async (request, response) => {
    if (!request.is("multipart/form-data") || !Buffer.isBuffer(request.body)) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Multipart file required");
    let form: FormData;
    try {
      form = await new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": request.headers["content-type"] ?? "" },
        body: new Uint8Array(request.body),
      }).formData();
    } catch {
      return apiError(response, 400, "INVALID_IMAGE", "Invalid multipart body");
    }
    const entries = [...form.entries()];
    if (entries.length !== 1 || entries[0][0] !== "file" || !(entries[0][1] instanceof File)) {
      return apiError(response, 400, "INVALID_IMAGE", "One file is required");
    }
    const file = entries[0][1];
    if (file.size > maxBytes) return apiError(response, 413, "IMAGE_TOO_LARGE", "File exceeds 10 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid = await validateImage({ bytes, filename: file.name, declaredContentType: file.type });
    if (!valid.success) return valid.error.code === "IMAGE_TOO_LARGE"
      ? apiError(response, 413, "IMAGE_TOO_LARGE", "Image exceeds 24 MP or 8000 pixels per side")
      : apiError(response, 400, "INVALID_IMAGE", "Invalid image data");
    const result = await uploadImage(getCompanyId(), { bytes, filename: file.name, contentType: file.type }, storage, repository);
    return result.success ? sendResult(response, result.data, 201) : sendFailure(response, result.error.code);
  });
  router.get("/:id", async (request, response) => {
    const id = request.params.id;
    if (typeof id !== "string" || !uuid.test(id)) return apiError(response, 404, "NOT_FOUND", "Not found");
    const privateImage = await readPrivateImage(getCompanyId(), id, storage, repository);
    if (!privateImage.success) return sendFailure(response, privateImage.error.code);
    if (privateImage.data) return response.type(privateImage.data.contentType).set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(Buffer.from(privateImage.data.bytes));
    const result = await getImage(getCompanyId(), id, storage, repository);
    if (!result.success) return sendFailure(response, result.error.code);
    return result.data ? sendResult(response, result.data) : apiError(response, 404, "NOT_FOUND", "Not found");
  });
  const sizeError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
      return apiError(response, 413, "IMAGE_TOO_LARGE", "Request exceeds upload limit");
    }
    next(error);
  };
  router.use(sizeError);
  return router;
}
