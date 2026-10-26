import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { EditorDraft } from "@shared/product-variants";

/** Rejections of one save, by the editor's own ids: rows by `ref`, options and values by id. */
export type EditorErrors = Readonly<{
  rows: Readonly<Record<string, string>>;
  options: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
}>;
export const noEditorErrors: EditorErrors = { rows: {}, options: {}, values: {} };

type EditorContext = Readonly<{
  draft: EditorDraft | null;
  /** The draft as the session started or was last saved: what renames are compared with. */
  baseline: EditorDraft | null;
  dirty: boolean;
  selection: readonly string[];
  errors: EditorErrors;
  /** Starts a new editing session with this draft as the saved starting point. */
  reset: (draft: EditorDraft) => void;
  setDraft: (draft: EditorDraft) => void;
  setSelection: (selection: readonly string[]) => void;
  setErrors: (errors: EditorErrors) => void;
}>;

const Context = createContext<EditorContext | null>(null);

/**
 * The product editor's draft, shared by the product screen and the Opciones, Variantes and unsaved-variant screens
 * above it. It lives in the products stack, so leaving the stack ends the session.
 */
export function ProductEditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ draft: EditorDraft | null; baseline: EditorDraft | null }>({ draft: null, baseline: null });
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [errors, setErrors] = useState<EditorErrors>(noEditorErrors);
  const reset = useCallback((draft: EditorDraft) => {
    setState({ draft, baseline: draft });
    setSelection([]);
    setErrors(noEditorErrors);
  }, []);
  const setDraft = useCallback((draft: EditorDraft) => setState((current) => ({ ...current, draft })), []);
  const value = useMemo(() => ({
    draft: state.draft, baseline: state.baseline,
    dirty: state.draft !== null && state.baseline !== null && state.draft !== state.baseline && JSON.stringify(state.draft) !== JSON.stringify(state.baseline),
    selection, errors, reset, setDraft, setSelection, setErrors,
  }), [state, selection, errors, reset, setDraft]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProductEditor(): EditorContext {
  const value = useContext(Context);
  if (!value) throw new Error("ProductEditorProvider is required");
  return value;
}
