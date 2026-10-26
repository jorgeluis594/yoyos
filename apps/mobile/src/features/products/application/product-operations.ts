import { countryCurrencies, type Country } from "@shared/country";
import type { CreateProductRequest, UpdateProductRequest } from "@shared/contracts/products";
import type { Product, ProductId, PhotoSelection } from "../domain/product";
import type { createProductApi } from "../infrastructure/product-api";

type ProductApi = ReturnType<typeof createProductApi>;
export type CreateProductCommand = Readonly<{
  id: ProductId;
  country: Country;
  name: string;
  description?: string;
  photo: PhotoSelection;
  sku?: string;
  salePrice: number;
  purchasePrice?: number;
  initialStock?: number;
}>;
export type UpdateProductCommand = Readonly<{
  current: Product;
  name?: string;
  description?: string | null;
  photo: PhotoSelection;
  variant?: Readonly<{ id: Product["variants"][number]["id"]; sku?: string | null; salePrice?: number; purchasePrice?: number | null }>;
}>;

function createRequest(command: CreateProductCommand): CreateProductRequest {
  return {
    id: command.id,
    name: command.name,
    description: command.description ?? null,
    imageId: command.photo.kind === "set" ? command.photo.imageId : null,
    currency: countryCurrencies[command.country],
    options: [],
    variants: [{
      values: [],
      sku: command.sku ?? null,
      salePrice: command.salePrice,
      purchasePrice: command.purchasePrice ?? null,
      initialStock: command.initialStock ?? 0,
    }],
  };
}

function updateRequest(command: UpdateProductCommand): UpdateProductRequest | null {
  if (command.variant && (command.current.variants.length !== 1 || command.current.variants[0].id !== command.variant.id)) return null;
  return {
    ...(command.name === undefined ? {} : { name: command.name }),
    ...(command.description === undefined ? {} : { description: command.description }),
    ...(command.photo.kind === "keep" ? {} : { imageId: command.photo.kind === "remove" ? null : command.photo.imageId }),
    ...(!command.variant ? {} : { variants: [{ ...command.variant }] }),
  };
}

export function createProductOperations(api: ProductApi) {
  return {
    loadProducts: api.list,
    loadProduct: api.get,
    uploadImage: api.uploadImage,
    createProduct: (command: CreateProductCommand) => api.create(createRequest(command)),
    updateProduct: (command: UpdateProductCommand) => {
      const input = updateRequest(command);
      return input ? api.update(command.current.id, input) : Promise.resolve({
        success: false as const,
        error: { code: "INVALID_INPUT", message: "This variant cannot be edited from mobile" },
      });
    },
  };
}
