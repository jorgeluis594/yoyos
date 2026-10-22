import { useEffect } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/** `accessibilityLiveRegion` only works on Android: on iOS the message is spoken to VoiceOver explicitly. */
export function useIosAnnouncement(message: string | null) {
  useEffect(() => {
    if (message && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
