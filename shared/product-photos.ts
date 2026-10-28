/** What a product save sends for photos: nothing when the list is the loaded one, otherwise the whole ordered list of image ids. */
export type PhotosToSave = Readonly<{ kind: "untouched" }> | Readonly<{ kind: "set"; photoIds: readonly string[] }>;
