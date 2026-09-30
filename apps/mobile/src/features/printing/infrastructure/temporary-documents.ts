import { File, Paths } from "expo-file-system";
import { err, ok } from "@shared/functional";
import type { RenderedDocument } from "@mobile/features/printing/domain/printing";

const prefix = "yoyos-label-";
const belongsToPrinting = (file: File) => file.uri.startsWith(Paths.cache.uri) && file.name.startsWith(prefix) && file.name.endsWith(".png");

export const temporaryDocuments = {
  async remove(document: RenderedDocument) {
    const file = new File(document.uri);
    if (!belongsToPrinting(file)) return err({ code: "CLEANUP_FAILED" as const, message: "Invalid temporary print document" });
    try { if (file.exists) file.delete(); return ok(undefined); }
    catch { return err({ code: "CLEANUP_FAILED" as const, message: "Could not remove temporary print document" }); }
  },
  async removeOrphans() {
    try { for (const entry of Paths.cache.list()) if (entry instanceof File && belongsToPrinting(entry)) entry.delete(); return ok(undefined); }
    catch { return err({ code: "CLEANUP_FAILED" as const, message: "Could not remove old print documents" }); }
  },
};
