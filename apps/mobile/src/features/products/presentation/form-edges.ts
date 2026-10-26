import type { Edge } from "react-native-safe-area-context";

// The bottom inset is scrolled content, so the form uses the full height when the tab bar is hidden.
export const formEdges: readonly Edge[] = ["top", "left", "right"];
