import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Money } from "@shared/money";

type ResultNotice = Readonly<{ id: string; shownTotal: Money }>;
const Context = createContext<Readonly<{
  notice: ResultNotice | null;
  show: (notice: ResultNotice) => void;
  clear: () => void;
}> | null>(null);

export function OrderResultProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<ResultNotice | null>(null);
  const clear = useCallback(() => setNotice(null), []);
  const value = useMemo(() => ({ notice, show: setNotice, clear }), [notice, clear]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOrderResult() {
  const value = useContext(Context);
  if (!value) throw new Error("OrderResultProvider is required");
  return value;
}
