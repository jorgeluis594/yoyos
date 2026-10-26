/** The product editor's routes: `/products/new/...` while creating and `/products/<id>/...` while editing. */
export type EditorRoute = "options" | "variants" | "draft-variant";

export function productPath(productId: string | undefined, route: EditorRoute) {
  return productId ? `/products/[productId]/${route}` as const : `/products/new/${route}` as const;
}
