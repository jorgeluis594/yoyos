import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const DraftContext = createContext<Readonly<{ dirty: boolean; setDirty: (dirty: boolean) => void; discard: () => void; discardVersion: number }> | null>(null);

export function ProductDraftProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const [discardVersion, setDiscardVersion] = useState(0);
  const discard = useCallback(() => { setDirty(false); setDiscardVersion((value) => value + 1); }, []);
  const value = useMemo(() => ({ dirty, setDirty, discard, discardVersion }), [dirty, discard, discardVersion]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useProductDraft() {
  const value = useContext(DraftContext);
  if (!value) throw new Error("ProductDraftProvider is required");
  return value;
}
