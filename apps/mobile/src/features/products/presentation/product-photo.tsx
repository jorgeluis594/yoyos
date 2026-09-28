import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Button } from "@/components/ui/button";
import { ThemedText } from "@/components/themed-text";
import type { ImageId, PhotoSelection, Product } from "../domain/product";
import { useProductDraft } from "./draft-guard";

const MAX_BYTES = 10_000_000;
const MAX_PIXELS = 24_000_000;
const MAX_SIDE = 8_000;
type UploadImage = (uri: string) => Promise<{ success: true; data: Readonly<{ id: ImageId; url: string }> } | { success: false; error: { code: string; message: string } }>;

async function preparePhoto(asset: ImagePicker.ImagePickerAsset) {
  const width = asset.width;
  const height = asset.height;
  if (!width || !height) throw new Error("La foto no tiene dimensiones válidas.");
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  // ponytail: four JPEG size attempts cap device work; the upload API remains the final size check.
  for (let attempt = 0; attempt < 4; attempt++) {
    const factor = scale * 0.75 ** attempt;
    const result = await ImageManipulator.manipulateAsync(
      asset.uri,
      factor < 1 ? [{ resize: { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) } }] : [],
      { compress: [0.82, 0.72, 0.62, 0.52][attempt], format: ImageManipulator.SaveFormat.JPEG },
    );
    const file = await fetch(result.uri).then((response) => response.blob());
    if (file.size <= MAX_BYTES && result.width * result.height <= MAX_PIXELS && Math.max(result.width, result.height) <= MAX_SIDE) return result.uri;
  }
  throw new Error("La foto supera el tamaño permitido. Elige una imagen más pequeña.");
}

export function ProductPhoto({ value, original, upload, disabled = false, onChange, onBusy }: {
  value: PhotoSelection;
  original?: NonNullable<Product["photo"]>;
  upload: UploadImage;
  disabled?: boolean;
  onChange: (selection: PhotoSelection) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const { discardVersion } = useProductDraft();
  const discardVersionRef = useRef(discardVersion);
  const previousDiscardVersionRef = useRef(discardVersion);
  const mountedRef = useRef(true);
  const busy = busyVersion === discardVersion;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => {
    discardVersionRef.current = discardVersion;
    if (previousDiscardVersionRef.current !== discardVersion) {
      previousDiscardVersionRef.current = discardVersion;
      setBusyVersion(null);
      onBusy(false);
    }
  }, [discardVersion, onBusy]);
  const preview = value.kind === "remove" ? undefined : value.kind === "set" ? value.previewUrl : original?.url;

  const choose = async (source: "gallery" | "camera") => {
    if (busy || disabled) return;
    const currentDiscardVersion = discardVersionRef.current;
    setBusyVersion(currentDiscardVersion);
    onBusy(true);
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("Permiso de cámara", "Puedes continuar y elegir una foto de la galería.");
          return;
        }
      }
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
      if (result.canceled || !mountedRef.current || currentDiscardVersion !== discardVersionRef.current) return;
      const asset = result.assets[0];
      if (!asset) throw new Error("No se encontró la foto elegida.");
      const uri = await preparePhoto(asset);
      if (!mountedRef.current || currentDiscardVersion !== discardVersionRef.current) return;
      const uploaded = await upload(uri);
      if (!mountedRef.current || currentDiscardVersion !== discardVersionRef.current) return;
      if (!uploaded.success) {
        if (uploaded.error.code !== "OPERATION_CANCELLED") Alert.alert("No se pudo subir la foto", "Tus datos siguen intactos. Revisa la conexión e inténtalo otra vez.");
        return;
      }
      onChange({ kind: "set", imageId: uploaded.data.id, previewUrl: uploaded.data.url });
    } catch (error) {
      if (mountedRef.current) Alert.alert("No se pudo preparar la foto", error instanceof Error ? error.message : "Inténtalo otra vez.");
    } finally {
      if (mountedRef.current) { setBusyVersion(null); onBusy(false); }
    }
  };

  return <View style={styles.root}>
    <ThemedText type="subtitle">Foto</ThemedText>
    {preview ? <Image source={{ uri: preview }} contentFit="cover" style={styles.preview} accessibilityLabel="Vista previa de la foto del producto" /> : <View style={styles.placeholder}><ThemedText themeColor="textSecondary">Sin foto</ThemedText></View>}
    <View style={styles.actions}>
      <Button variant="secondary" disabled={busy || disabled} loading={busy} onPress={() => void choose("gallery")}>Elegir de galería</Button>
      <Button variant="secondary" disabled={busy || disabled} onPress={() => void choose("camera")}>Tomar foto</Button>
      {value.kind !== "keep" || original ? <Button variant="ghost" disabled={busy || disabled} onPress={() => onChange(original ? { kind: "remove" } : { kind: "keep" })}>Quitar foto</Button> : null}
      {value.kind === "remove" && original ? <Button variant="ghost" disabled={disabled} onPress={() => onChange({ kind: "keep" })}>Conservar foto actual</Button> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12 }, preview: { width: "100%", height: 200, borderRadius: 12 },
  placeholder: { height: 120, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#eee" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
