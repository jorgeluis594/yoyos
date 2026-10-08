/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Button } from "@/components/ui/button";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import type { ImageId, PhotoSelection, Product } from "../domain/product";
import { useProductDraft } from "./draft-guard";
import i18n from '@mobile/i18n';

const MAX_BYTES = 10_000_000;
const MAX_PIXELS = 24_000_000;
const MAX_SIDE = 8_000;
type UploadImage = (uri: string) => Promise<{ success: true; data: Readonly<{ id: ImageId; url: string }> } | { success: false; error: { code: string; message: string } }>;

async function preparePhoto(asset: ImagePicker.ImagePickerAsset) {
  const width = asset.width;
  const height = asset.height;
  if (!width || !height) throw new Error(i18n.t('photoInvalidDimensions'));
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
  throw new Error(i18n.t('photoTooLarge'));
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
  const { t } = useTranslation();
  const theme = useTheme();
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
          Alert.alert(t('cameraPermission'), t('cameraPermissionHint'));
          return;
        }
      }
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
      if (result.canceled || !mountedRef.current || currentDiscardVersion !== discardVersionRef.current) return;
      const asset = result.assets[0];
      if (!asset) throw new Error(t('photoNotFound'));
      const uri = await preparePhoto(asset);
      if (!mountedRef.current || currentDiscardVersion !== discardVersionRef.current) return;
      const uploaded = await upload(uri);
      if (!mountedRef.current || currentDiscardVersion !== discardVersionRef.current) return;
      if (!uploaded.success) {
        if (uploaded.error.code !== "OPERATION_CANCELLED") Alert.alert(t('uploadPhotoError'), t('uploadPhotoHint'));
        return;
      }
      onChange({ kind: "set", imageId: uploaded.data.id, previewUrl: uploaded.data.url });
    } catch (error) {
      if (mountedRef.current) Alert.alert(t('preparePhotoError'), error instanceof Error ? error.message : t('tryAgain'));
    } finally {
      if (mountedRef.current) { setBusyVersion(null); onBusy(false); }
    }
  };

  const chooseSource = () => Alert.alert(t('photo'), undefined, [
    { text: t('chooseGallery'), onPress: () => void choose('gallery') },
    { text: t('takePhoto'), onPress: () => void choose('camera') },
    { text: t('cancel'), style: 'cancel' },
  ]);

  return <View style={styles.root}>
    <Pressable accessibilityRole="button" accessibilityLabel={preview ? t('changeProductPhoto') : t('addProductPhoto')}
      accessibilityState={{ disabled: busy || disabled, busy }} disabled={busy || disabled} onPress={chooseSource}
      style={({ pressed }) => [styles.strip, { borderColor: theme.border, backgroundColor: pressed ? theme.secondary : theme.backgroundElement, opacity: disabled ? 0.5 : 1 }]}>
      {preview ? <Image source={{ uri: preview }} contentFit="cover" style={styles.preview} accessibilityLabel={t('photoPreview')} />
        : <SymbolView name={{ ios: 'camera', android: 'photo_camera' }} size={28} tintColor={theme.textSecondary} />}
      <View style={styles.copy}>
        <ThemedText type="smallBold">{preview ? t('changeProductPhoto') : t('addProductPhoto')}</ThemedText>
        <ThemedText themeColor="textSecondary" type="small">{t('photoSourceHint')}</ThemedText>
      </View>
      {busy ? <ActivityIndicator color={theme.textSecondary} /> : null}
    </Pressable>
    {value.kind !== "remove" && (value.kind !== "keep" || original) ? <View style={styles.remove}><Button variant="ghost" disabled={busy || disabled} onPress={() => onChange(original ? { kind: "remove" } : { kind: "keep" })}>{t('removePhoto')}</Button></View> : null}
    {value.kind === "remove" && original ? <View style={styles.remove}><Button variant="ghost" disabled={disabled} onPress={() => onChange({ kind: "keep" })}>{t('keepPhoto')}</Button></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 2 },
  strip: { minHeight: 84, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, padding: 10 },
  preview: { width: 64, height: 64, borderRadius: 8 },
  copy: { alignItems: 'center', gap: 2 },
  remove: { alignSelf: 'flex-start' },
});
