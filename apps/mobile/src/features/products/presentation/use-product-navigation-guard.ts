import { useEffect, useRef } from "react";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { showConfirmation } from "@/components/ui/show-confirmation";
import { useProductDraft } from "./draft-guard";

export function useProductNavigationGuard(dirty: boolean) {
  const navigation = useNavigation();
  const draft = useProductDraft();
  const { setDirty, discard, discardVersion } = draft;
  const dirtyRef = useRef(dirty);
  const discardedRef = useRef(false);
  const discardVersionRef = useRef(discardVersion);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => {
    if (discardVersionRef.current !== discardVersion) {
      discardVersionRef.current = discardVersion;
      discardedRef.current = true;
    }
    if (!dirty) discardedRef.current = false;
    setDirty(dirty && !discardedRef.current);
  }, [discardVersion, dirty, setDirty]);
  usePreventRemove(dirty, ({ data }) => {
    if (!dirtyRef.current) { navigation.dispatch(data.action); return; }
    showConfirmation({
      title: "¿Descartar cambios?",
      description: "Se perderán los cambios que no guardaste.",
      confirmLabel: "Descartar",
      cancelLabel: "Seguir editando",
      destructive: true,
      onConfirm: () => { dirtyRef.current = false; discardedRef.current = true; discard(); navigation.dispatch(data.action); },
    });
  });
  useEffect(() => () => setDirty(false), [setDirty]);
  return (value: boolean) => {
    if (!value) {
      dirtyRef.current = false;
      discardedRef.current = true;
    }
    setDirty(value);
  };
}
