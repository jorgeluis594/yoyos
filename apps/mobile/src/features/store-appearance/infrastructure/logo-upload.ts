import * as ImagePicker from "expo-image-picker";
import { imageUploadLimits } from "@shared/contracts/images";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";
import { uploadImage } from "@mobile/shared/infrastructure/image-api";
import { fitJpeg, type JpegBounds } from "@mobile/shared/infrastructure/jpeg-fitting";
import type { LogoFiles } from "@mobile/features/store-appearance/application/store-appearance";
import type { LogoAsset } from "@mobile/features/store-appearance/domain/logo-file";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;
export type LogoPickError = Readonly<{ code: "CAMERA_PERMISSION_DENIED" | "PICK_FAILED"; message: string }>;

/** A converted logo has no transparency to keep and shows at header size, so it is far smaller than the server limits. */
export const logoJpegBounds: JpegBounds = { maxSide: 1024, maxBytes: imageUploadLimits.maxBytes };

async function sizeOf(asset: ImagePicker.ImagePickerAsset) {
  if (asset.fileSize !== undefined) return asset.fileSize;
  return fetch(asset.uri).then(response => response.blob()).then(blob => blob.size);
}

export function createLogoFiles(request: Request) {
  return {
    /** Editing is off and the original representation is kept, so iOS hands over the original PNG, WEBP or HEIC instead of a re-encoded file. `ok(null)` is a cancelled pick. */
    async pick(source: LogoAsset["source"]): Promise<Result<LogoAsset | null, LogoPickError>> {
      try {
        if (source === "camera") {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) return err({ code: "CAMERA_PERMISSION_DENIED", message: "Camera permission denied" });
        }
        const result = source === "camera"
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, exif: false })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, allowsMultipleSelection: false, quality: 1, exif: false,
            preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current });
        const asset = result.canceled ? undefined : result.assets[0];
        if (!asset) return ok(null);
        return ok({ uri: asset.uri, width: asset.width, height: asset.height, mimeType: asset.mimeType ?? null, fileName: asset.fileName ?? null, fileSize: await sizeOf(asset), source });
      } catch {
        return err({ code: "PICK_FAILED", message: "Could not read the picked image" });
      }
    },
    async convertToJpeg(asset: LogoAsset) {
      const fitted = await fitJpeg(asset.uri, asset.width, asset.height, logoJpegBounds);
      return fitted.success ? fitted : err({ message: fitted.error.message });
    },
    upload: (uri: string, mimeType: string) => uploadImage(request, uri, mimeType),
  } satisfies LogoFiles & { pick: unknown };
}
