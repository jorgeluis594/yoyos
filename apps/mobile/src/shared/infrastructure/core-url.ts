import { z } from "zod";

const configuredUrl = process.env.EXPO_PUBLIC_CORE_URL ?? (__DEV__ ? "http://localhost:3000" : "");
const parsedUrl = z.url().safeParse(configuredUrl);
if (!parsedUrl.success || !/^https?:\/\//.test(configuredUrl)) {
  throw new Error("EXPO_PUBLIC_CORE_URL must be an absolute HTTP(S) URL");
}
if (!__DEV__ && !configuredUrl.startsWith("https://")) {
  throw new Error("EXPO_PUBLIC_CORE_URL must use HTTPS outside development");
}

export const coreUrl = configuredUrl.replace(/\/$/, "");
