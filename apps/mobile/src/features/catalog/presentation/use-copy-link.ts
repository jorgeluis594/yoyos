import { useState } from "react";
import { Linking } from "react-native";
import * as Clipboard from "expo-clipboard";

/** Copy and open actions of the catalog link: a copy the system refuses, or a missing browser, fails silently. */
export function useCopyLink(url: string | null) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { if (url !== null && await Clipboard.setStringAsync(url)) setCopied(true); }
    catch { /* The seller can select the text instead. */ }
  };
  const open = () => { if (url !== null) void Linking.openURL(url).catch(() => undefined); };
  return { copied, copy, open };
}
