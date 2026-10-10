import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import type { WhatsAppRuntime } from "@mobile/features/whatsapp/composition";
import type { CompanyId, NativeMessageId } from "@mobile/features/whatsapp/domain/ids";

type State =
  | { kind: "idle" } | { kind: "loading" }
  | { kind: "loaded"; uri: string }
  | { kind: "failed"; code: "IMAGE_UNAVAILABLE" | "IMAGE_DOWNLOAD_FAILED" | "STORAGE_LIMIT_REACHED" | "OTHER" };

type Props = Readonly<{ runtime: WhatsAppRuntime; companyId: string; messageId: NativeMessageId }>;

/** Downloads on demand and releases the private file when the message leaves the screen. */
export function MessageImage({ runtime, companyId, messageId }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: "idle" });
  const loaded = useRef(false);

  const show = async () => {
    setState({ kind: "loading" });
    const result = await runtime.viewImage(companyId as CompanyId, messageId);
    if (result.success) {
      loaded.current = true;
      setState({ kind: "loaded", uri: result.data.uri });
      return;
    }
    const code = result.error.code;
    setState({ kind: "failed", code: code === "IMAGE_UNAVAILABLE" || code === "IMAGE_DOWNLOAD_FAILED" || code === "STORAGE_LIMIT_REACHED" ? code : "OTHER" });
  };

  useEffect(() => () => { if (loaded.current) void runtime.releaseImage(messageId); }, [runtime, messageId]);

  if (state.kind === "loaded") return <Image source={{ uri: state.uri }} accessibilityLabel={t("whatsappImage")} style={styles.image} contentFit="cover" />;
  return (
    <View style={styles.box}>
      {state.kind === "failed" ? (
        <ThemedText type="small" accessibilityRole="alert">
          {state.code === "IMAGE_UNAVAILABLE" ? t("whatsappImageUnavailable") : state.code === "STORAGE_LIMIT_REACHED" ? t("whatsappImageStorageLimit") : t("whatsappImageDownloadFailed")}
        </ThemedText>
      ) : null}
      {state.kind !== "failed" || state.code !== "IMAGE_UNAVAILABLE" ? (
        <Button variant="secondary" loading={state.kind === "loading"} onPress={() => void show()}>
          {state.kind === "failed" ? t("whatsappRetry") : t("whatsappShowImage")}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ box: { gap: 8 }, image: { width: 240, height: 240, borderRadius: 8 } });
