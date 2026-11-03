import { useState } from "react";
import { Linking } from "react-native";
import * as Clipboard from "expo-clipboard";

/** Copy and open actions of the catalog link: a copy the system refuses, or a missing browser, fails silently and answers false. */
export function useCopyLink(url: string | null) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<boolean> => {
    try {
      if (url !== null && await Clipboard.setStringAsync(url)) { setCopied(true); return true; }
    } catch { /* The seller can select the text instead. */ }
    return false;
  };
  const open = async (): Promise<boolean> => {
    if (url === null) return false;
    try { await Linking.openURL(url); return true; } catch { return false; }
  };
  return { copied, copy, open };
}
