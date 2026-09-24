import type { Result } from "@shared/result";
import type { ImageStorage } from "@core/src/shared/images/application/images";

type Config = { accountId: string; apiToken: string; deliveryHash: string };
const failed = <T>(message: string): Result<T> => ({ success: false, error: { message } });

export function createCloudflareImageStorage(config: Config): ImageStorage {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/images/v1`;
  const headers = { Authorization: `Bearer ${config.apiToken}` };
  const ready = () => Boolean(config.accountId && config.apiToken && config.deliveryHash);

  return {
    async upload({ bytes, filename, contentType }) {
      if (!ready()) return failed("Image storage is not configured");
      const form = new FormData();
      form.set("file", new File([new Uint8Array(bytes)], filename, { type: contentType }));
      try {
        const response = await fetch(endpoint, { method: "POST", headers, body: form });
        const body: unknown = await response.json();
        if (response.ok && isUploadSuccess(body)) return { success: true, data: { key: body.result.id } };
        console.error("Cloudflare image upload failed", { status: response.status, body });
        return failed("Image upload failed");
      } catch (error) {
        console.error("Cloudflare image upload failed", error);
        return failed("Image upload failed");
      }
    },
    async getUrl(key) {
      if (!ready()) return failed("Image storage is not configured");
      return { success: true, data: `https://imagedelivery.net/${encodeURIComponent(config.deliveryHash)}/${encodeURIComponent(key)}/public` };
    },
    async delete(key) {
      if (!ready()) return failed("Image storage is not configured");
      try {
        const response = await fetch(`${endpoint}/${encodeURIComponent(key)}`, { method: "DELETE", headers });
        if (response.status === 404) return { success: true, data: undefined };
        const body: unknown = await response.json();
        if (response.ok && isSuccess(body)) return { success: true, data: undefined };
        console.error("Cloudflare image deletion failed", { status: response.status, body });
        return failed("Image deletion failed");
      } catch (error) {
        console.error("Cloudflare image deletion failed", error);
        return failed("Image deletion failed");
      }
    },
  };
}

function isSuccess(body: unknown): body is { success: true } {
  return typeof body === "object" && body !== null && "success" in body && body.success === true;
}

function isUploadSuccess(body: unknown): body is { success: true; result: { id: string } } {
  return isSuccess(body) && "result" in body && typeof body.result === "object" && body.result !== null
    && "id" in body.result && typeof body.result.id === "string" && body.result.id.length > 0;
}
