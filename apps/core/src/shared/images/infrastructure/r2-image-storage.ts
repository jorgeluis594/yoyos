import { log } from "@core/src/shared/infrastructure/logger";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import type { Result } from "@shared/result";
import type { ImageStorage } from "@core/src/shared/images/application/images";

type Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
};
const failed = <T>(code: "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_STORAGE_CONFIG_ERROR" | "IMAGE_NOT_FOUND", message: string): Result<T> => ({ success: false, error: { code, message } });
// S3 error codes (AccessDenied, NoSuchBucket...) are fixed identifiers; safeError drops them.
const providerFailure = (error: unknown) => error instanceof S3ServiceException
  ? { providerErrorCode: error.name, providerStatusCode: error.$metadata.httpStatusCode }
  : {};
const configurationFailed = <T>(message: string): Result<T> => {
  log.error({ event: "image_storage_configuration_invalid", errorCode: "IMAGE_STORAGE_CONFIG_ERROR" }, "image_storage_configuration_invalid");
  return failed("IMAGE_STORAGE_CONFIG_ERROR", message);
};

function storageUrl(value: string, allowPath: boolean): URL | null {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol)
      || (process.env.NODE_ENV === "production" && url.protocol !== "https:")
      || url.username || url.password || value.includes("?") || value.includes("#")
      || (!allowPath && url.pathname !== "/")
    ) return null;
    return url;
  } catch {
    return null;
  }
}

export function createR2ImageStorage(config: Config): ImageStorage {
  const publicUrl = storageUrl(config.publicBaseUrl, true);
  const endpoint = storageUrl(config.endpoint, false);
  const writable = endpoint && [config.bucket, config.accessKeyId, config.secretAccessKey].every((value) => value.trim().length > 0);
  const client = writable ? new S3Client({
    region: "auto",
    endpoint: endpoint.href,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  }) : null;

  return {
    async upload({ bytes, contentType }) {
      if (!client) return configurationFailed("Image storage is not configured");
      const key = randomUUID();
      try {
        await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes, ContentType: contentType }));
        return { success: true, data: { key } };
      } catch (error) {
        log.error({ event: "r2_image_upload_failed", err: error, ...providerFailure(error) }, "r2_image_upload_failed");
        return failed("IMAGE_STORAGE_UNAVAILABLE", "Image upload failed");
      }
    },
    async read(key, options) {
      if (!client) return configurationFailed("Image storage is not configured");
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }), options ? { abortSignal: options.signal } : undefined);
        if (!object.Body) return failed("IMAGE_STORAGE_UNAVAILABLE", "Image is unavailable");
        return { success: true, data: { bytes: await object.Body.transformToByteArray(), contentType: object.ContentType ?? "application/octet-stream" } };
      } catch (error) {
        if (error instanceof NoSuchKey) return failed("IMAGE_NOT_FOUND", "Image object not found");
        // An aborted read is the caller's deadline; the caller logs it as a warning.
        if (options?.signal.aborted) return failed("IMAGE_STORAGE_UNAVAILABLE", "Image is unavailable");
        log.error({ event: "r2_image_read_failed", err: error, ...providerFailure(error) }, "r2_image_read_failed");
        return failed("IMAGE_STORAGE_UNAVAILABLE", "Image is unavailable");
      }
    },
    async getUrl(key) {
      if (!publicUrl) return configurationFailed("Image storage is not configured");
      return { success: true, data: `${publicUrl.href.replace(/\/+$/, "")}/${encodeURIComponent(key)}` };
    },
    async delete(key) {
      if (!client) return configurationFailed("Image storage is not configured");
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
        return { success: true, data: undefined };
      } catch (error) {
        log.error({ event: "r2_image_deletion_failed", err: error, ...providerFailure(error) }, "r2_image_deletion_failed");
        return failed("IMAGE_STORAGE_UNAVAILABLE", "Image deletion failed");
      }
    },
  };
}
