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

export function createR2ImageStorage(config: Config): ImageStorage {
  const ready = Object.values(config).every(Boolean) && URL.canParse(config.publicBaseUrl);
  const client = ready ? new S3Client({
    region: "auto",
    endpoint: config.endpoint,
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
      if (!client) return failed("IMAGE_STORAGE_CONFIG_ERROR", "Image storage is not configured");
      return { success: true, data: `${config.publicBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(key)}` };
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
