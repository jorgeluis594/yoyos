import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const Context = createContext<Readonly<{ dirty: boolean; setDirty: (dirty: boolean) => void;
  discard: () => void; discardVersion: number }> | null>(null);

export function OrderDraftProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const [discardVersion, setDiscardVersion] = useState(0);
  const discard = useCallback(() => { setDirty(false); setDiscardVersion((value) => value + 1); }, []);
  const value = useMemo(() => ({ dirty, setDirty, discard, discardVersion }), [dirty, discard, discardVersion]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOrderDraft() {
  const value = useContext(Context);
  if (!value) throw new Error("OrderDraftProvider is required");
  return value;
}
