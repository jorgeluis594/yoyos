/**
 * A screenshot position on the page. An empty alt marks the capture as decorative (the card text carries the meaning).
 * A provisional slot renders a labelled placeholder until the real capture is supplied.
 */
export type ScreenshotSlot = Readonly<{ alt: string; aspectRatio: `${number}/${number}` } & (
  | { kind: "provisional" }
  | { kind: "image"; image: ImageMetadata }
)>;

export const provisionalLabel = "Imagen provisional";
