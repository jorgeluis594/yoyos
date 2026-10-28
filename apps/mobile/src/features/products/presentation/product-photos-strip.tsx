/** @jsxImportSource react */
// Preserve native Pressable style callbacks outside NativeWind interop.
import { useEffect, useRef } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, findNodeHandle, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import * as ImagePicker from "expo-image-picker";
import type { TFunction } from "i18next";
import type { FieldPhoto, PhotoFailure } from "@shared/product-photos";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@mobile/hooks/use-theme";
import { addTileTarget, lineTarget, type PhotoFieldController } from "./use-photo-field";
import tokens from "../../../../../../docs/design-tokens.json";

const thumbSize = 64;
// Wide enough for the longest state word at the app's small text, so the label wraps only between words.
const tileWidth = 72;
const gap = tokens.spacing["2"];
const focusDelayMs = 250;
const reasons: Readonly<Record<PhotoFailure, string>> = {
  weight: "photoWeight", dimensions: "photoDimensions", format: "photoFormat", prepare: "photoPrepare", connection: "photoConnection", file_gone: "photoFileGone",
};

type Action = Readonly<{ name: string; label: string; run: () => void }>;

function actionsOf(photo: FieldPhoto, primary: boolean, photos: PhotoFieldController, t: TFunction): readonly Action[] {
  const key = photo.key;
  if (photo.kind === "uploading") return [{ name: "cancelUpload", label: t("cancelUpload"), run: () => photos.drop(key) }];
  if (photo.kind === "failed") {
    return [
      ...(photo.retryable ? [{ name: "retry", label: t("retryPhoto"), run: () => photos.retry(key) }] : []),
      { name: "removeFailed", label: t("removeFailedPhoto"), run: () => photos.drop(key) },
    ];
  }
  if (photo.marked) return [{ name: "undo", label: t("undo"), run: () => photos.undo(key) }];
  return [
    ...(primary ? [] : [{ name: "makePrimary", label: t("makePrimary"), run: () => photos.makePrimary(key) }]),
    { name: "remove", label: t("removePhoto"), run: () => photos.mark(key) },
  ];
}

function reasonOf(photo: FieldPhoto, t: TFunction): string | undefined {
  if (photo.kind === "failed") return t(reasons[photo.failure]);
  if ((photo.kind === "saved" || photo.kind === "uploaded") && photo.rejected) return t("photoRejected");
  return undefined;
}

function nameOf(photo: FieldPhoto, primary: boolean, position: number, total: number, t: TFunction): string {
  const state = photo.kind === "uploading" ? t("photoStateUploading")
    : photo.kind === "failed" ? t("photoStateFailed", { reason: reasonOf(photo, t) })
    : photo.marked ? t(photo.kind === "saved" ? "photoStateDelete" : "photoStateRemove")
    : photo.rejected ? reasonOf(photo, t) : null;
  return [t("photoPosition", { position, total }), primary ? t("photoPrimaryWord") : null, state].filter(Boolean).join(", ");
}

/** The line under the strip: the over-limit notice, then failures, then unusable photos, then the counter. */
function lineOf(photos: PhotoFieldController, t: TFunction): Readonly<{ text: string; error: boolean }> {
  const { notice, field, summary, max } = photos;
  if (notice) return { text: t("photoOver", { count: notice.added, selected: notice.selected }), error: false };
  const failed = field.photos.filter((photo) => photo.kind === "failed").length;
  if (failed > 0) return { text: t("photosFailed", { count: failed }), error: true };
  if (field.photos.some((photo) => (photo.kind === "saved" || photo.kind === "uploaded") && photo.rejected)) return { text: t("photoRejected"), error: true };
  const total = summary.count;
  const mark = summary.markedSaved ? "Delete" : "Remove";
  if (total >= max) return { text: summary.marked > 0 ? t(`photoLimit${mark}`, { count: summary.marked, max }) : t("photoLimit", { max }), error: false };
  return { text: summary.marked > 0 ? t(`photoCounter${mark}`, { count: summary.marked, total, max }) : t("photoCounter", { total, max }), error: false };
}

/** The photos of the product form: a fixed add tile and 64 px thumbnails scrolling to its right. */
export function ProductPhotosStrip({ photos, disabled = false }: { photos: PhotoFieldController; disabled?: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scroll = useRef<ScrollView>(null);
  const nodes = useRef(new Map<string, View>());
  const addTile = useRef<View>(null);
  const line = useRef<View>(null);
  const { focus, field } = photos;

  useEffect(() => {
    if (!focus) return;
    const index = field.photos.findIndex((photo) => photo.key === focus.target);
    if (index >= 0) scroll.current?.scrollTo({ x: index * (tileWidth + gap), animated: true });
    const timer = setTimeout(() => {
      const node = focus.target === addTileTarget ? addTile.current : focus.target === lineTarget ? line.current : nodes.current.get(focus.target);
      // findNodeHandle throws on react-native-web, where there is no native focus tag.
      const tag = node && Platform.OS !== "web" ? findNodeHandle(node) : null;
      if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
    }, focusDelayMs);
    return () => clearTimeout(timer);
  // The focus request is a one-off event keyed by its nonce.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const choose = async (source: "gallery" | "camera") => {
    photos.clearNotice();
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { Alert.alert(t("cameraPermission"), t("cameraPermissionHint")); return; }
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsMultipleSelection: true, selectionLimit: photos.free, orderedSelection: true });
    if (result.canceled) return;
    photos.add(result.assets.map((asset) => ({ uri: asset.uri, width: asset.width, height: asset.height })));
  };
  const chooseSource = () => Alert.alert(
    t("photosLabel"),
    photos.field.photos.length === 0 ? t("photoSourceEmpty", { max: photos.max }) : t("photoSourceMore", { count: photos.free }),
    [
      { text: t("chooseGallery"), onPress: () => void choose("gallery") },
      { text: t("takePhoto"), onPress: () => void choose("camera") },
      { text: t("cancel"), style: "cancel" },
    ],
  );
  const openSheet = (photo: FieldPhoto, position: number) => {
    const actions = actionsOf(photo, photos.primary === photo.key, photos, t).slice(0, 2);
    Alert.alert(t("photoPosition", { position, total: field.photos.length }), reasonOf(photo, t), [
      ...actions.map((action) => ({ text: action.label, onPress: action.run })),
      { text: photo.kind === "uploading" ? t("keepUploading") : t("cancel"), style: "cancel" as const },
    ]);
  };

  const text = lineOf(photos, t);
  const full = photos.free === 0;
  return <View style={styles.root}>
    <View style={styles.row}>
      {full ? null : <Pressable ref={addTile} accessibilityRole="button" accessibilityLabel={`${t("addPhotos")}, ${t("photoSourceHint")}`} disabled={disabled}
        accessibilityState={{ disabled }} onPress={chooseSource}
        style={({ pressed }) => [styles.tile, { borderColor: theme.border, backgroundColor: pressed ? theme.secondary : theme.backgroundElement, opacity: disabled ? 0.5 : 1 }]}>
        <SymbolView name={{ ios: "camera", android: "photo_camera" }} size={20} tintColor={theme.textSecondary} />
        <ThemedText type="smallBold" style={styles.tileText}>{t("addPhotos")}</ThemedText>
        <ThemedText themeColor="textSecondary" type="small" style={styles.tileText}>{t("photoSourceHint")}</ThemedText>
      </Pressable>}
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.thumbs}>
        {field.photos.map((photo, index) => {
          const primary = photos.primary === photo.key;
          const uri = photo.kind === "saved" || photo.kind === "uploaded" ? photo.url : photos.previewOf(photo.key) ?? photo.previewUrl;
          const marked = (photo.kind === "saved" || photo.kind === "uploaded") && photo.marked;
          const labels = [
            primary ? t("photoPrimary") : null,
            photo.kind === "failed" ? t("photoNotUploaded") : marked ? t(photo.kind === "saved" ? "rowWillBeDeleted" : "rowWillBeRemoved") : null,
          ].filter((text): text is string => text !== null);
          const actions = actionsOf(photo, primary, photos, t);
          const position = index + 1;
          return <Pressable key={photo.key} ref={(node) => { if (node) nodes.current.set(photo.key, node); else nodes.current.delete(photo.key); }}
            accessibilityRole="button" accessibilityLabel={nameOf(photo, primary, position, field.photos.length, t)} accessibilityHint={t("photoHint")}
            accessibilityActions={actions.map((action) => ({ name: action.name, label: action.label }))}
            onAccessibilityAction={(event) => { if (!disabled) actions.find((action) => action.name === event.nativeEvent.actionName)?.run(); }}
            disabled={disabled} onPress={() => openSheet(photo, position)}
            style={styles.cell}>
            <View testID="photo-square" style={[styles.thumb, { borderColor: photo.kind === "failed" || (photo.kind !== "uploading" && photo.rejected) ? theme.error : theme.border, backgroundColor: theme.backgroundElement }]}>
            {uri ? <Image source={{ uri }} contentFit="cover" style={[styles.image, (marked || photo.kind !== "saved" && photo.kind !== "uploaded") && styles.dim]} accessibilityElementsHidden importantForAccessibility="no" /> : null}
            {photo.kind === "uploading" ? <View style={styles.center}><ActivityIndicator color={theme.text} /></View> : null}
            {photo.kind === "failed" || (photo.kind !== "uploading" && photo.rejected)
              ? <View style={styles.center}><SymbolView name={{ ios: "exclamationmark.triangle.fill", android: "warning" }} size={24} tintColor={theme.error} /></View> : null}
            </View>
            {labels.map((text) => <ThemedText key={text} type="small" style={styles.label} testID="photo-label">{text}</ThemedText>)}
          </Pressable>;
        })}
      </ScrollView>
    </View>
    {field.photos.length > 0 ? <View ref={line} accessible accessibilityLiveRegion="polite">
      <ThemedText type="small" themeColor={text.error ? undefined : "textSecondary"} style={text.error ? { color: theme.error } : undefined}>{text.text}</ThemedText>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: tokens.spacing["2"] },
  row: { flexDirection: "row", alignItems: "flex-start", gap },
  tile: { width: 112, minHeight: thumbSize + 16, borderWidth: 1, borderStyle: "dashed", borderRadius: 10, padding: tokens.spacing["2"], alignItems: "center", justifyContent: "center", gap: 2 },
  tileText: { textAlign: "center" },
  scroll: { flex: 1 },
  thumbs: { gap, paddingVertical: 8 },
  thumb: { width: thumbSize, height: thumbSize, alignSelf: "center", borderRadius: 8, borderWidth: 1, overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  dim: { opacity: 0.45 },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  cell: { width: tileWidth, gap: 2 },
  // The label wraps between words rather than shrinking the app's small text.
  label: { textAlign: "center" },
});
