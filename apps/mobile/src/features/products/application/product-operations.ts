import { countryCurrencies, type Country } from "@shared/country";
import { buildCreateProductBody, buildSaveProductBody, type EditorDraft } from "@shared/product-variants";
import type { Product, ProductId, PhotoSelection } from "../domain/product";
import type { createProductApi } from "../infrastructure/product-api";

type ProductApi = ReturnType<typeof createProductApi>;
/** The draft carries the base values (SKU, prices, stock) of a product without options and every option, variant and mark. */
export type CreateProductCommand = Readonly<{
  id: ProductId;
  country: Country;
  name: string;
  description?: string;
  photo: PhotoSelection;
  draft: EditorDraft;
}>;
export type SaveProductCommand = Readonly<{
  current: Product;
  name: string;
  description: string | null;
  photo: PhotoSelection;
  draft: EditorDraft;
}>;

const imageIdOf = (photo: PhotoSelection, current?: Product["photo"]) =>
  photo.kind === "set" ? photo.imageId : photo.kind === "remove" ? null : current?.id ?? null;

export function createProductOperations(api: ProductApi) {
  return {
    loadProducts: api.list,
    loadProduct: api.get,
    uploadImage: api.uploadImage,
    createProduct: (command: CreateProductCommand) => api.create(buildCreateProductBody(command.draft, {
      id: command.id, name: command.name, description: command.description ?? null, imageId: imageIdOf(command.photo),
      currency: countryCurrencies[command.country],
    })),
    saveProduct: (command: SaveProductCommand) => api.save(command.current.id, buildSaveProductBody(command.draft, {
      structureVersion: command.current.structureVersion, name: command.name, description: command.description,
      imageId: imageIdOf(command.photo, command.current.photo),
    })),
  };
}
