import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Result } from "@shared/result";
import type { ImageStorage } from "@core/src/shared/images/application/images";

type Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
};
const failed = <T>(code: "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_STORAGE_CONFIG_ERROR", message: string): Result<T> => ({ success: false, error: { code, message } });

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
      if (!client) return failed("IMAGE_STORAGE_CONFIG_ERROR", "Image storage is not configured");
      const key = randomUUID();
      try {
        await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes, ContentType: contentType }));
        return { success: true, data: { key } };
      } catch (error) {
        console.error("R2 image upload failed", error);
        return failed("IMAGE_STORAGE_UNAVAILABLE", "Image upload failed");
      }
    },
    async getUrl(key) {
      if (!publicUrl) return failed("IMAGE_STORAGE_CONFIG_ERROR", "Image storage is not configured");
      return { success: true, data: `${publicUrl.href.replace(/\/+$/, "")}/${encodeURIComponent(key)}` };
    },
    async delete(key) {
      if (!client) return failed("IMAGE_STORAGE_CONFIG_ERROR", "Image storage is not configured");
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
        return { success: true, data: undefined };
      } catch (error) {
        console.error("R2 image deletion failed", error);
        return failed("IMAGE_STORAGE_UNAVAILABLE", "Image deletion failed");
      }
    },
  };
}
