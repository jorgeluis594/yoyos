import { companyLocale, languageFromPath } from "@core/app/locale";
import { useLocalization } from "@core/app/localization";
import { log } from "@core/src/shared/infrastructure/logger";
import { redirect, useActionData, useLoaderData, useNavigation, useSubmit, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { countryCurrencies, type Country } from "@shared/country";
import { PageContainer } from "@core/app/components/ui/page-container";
import { PageHeader } from "@core/app/components/ui/page-header";
import { privateUserContext } from "@core/app/private-user-context";
import { products } from "@core/src/features/products/composition";
import { parseCreateJson } from "@core/src/features/products/presentation/input";
import { createErrors, type FormErrors } from "@core/src/features/products/presentation/messages";
import { ProductForm, type ProductFormValues, type ProductImageSelection } from "@core/src/features/products/presentation/product-form";

export function loader({ context, request }: LoaderFunctionArgs) {
  const company = context.get(privateUserContext).company;
  return { currency: countryCurrencies[company.country as Country], catalog: `/${companyLocale(new URL(request.url).pathname, company.country)}/products` };
}

export async function action({ request, context }: ActionFunctionArgs): Promise<Response | { errors: FormErrors }> {
  const parsed = parseCreateJson(await request.text());
  if (!parsed.success) return { errors: createErrors(parsed.error, languageFromPath(new URL(request.url).pathname)) };
  const company = context.get(privateUserContext).company;
  try {
    const result = await products.create(parsed.data);
    if (!result.success) return { errors: createErrors(result.error, languageFromPath(new URL(request.url).pathname)) };
    return redirect(`/${companyLocale(new URL(request.url).pathname, company.country)}/products/${result.data}`);
  } catch (cause) {
    log.error({ event: "unable_to_create_product", err: cause }, "unable_to_create_product");
    return { errors: { form: "No se pudo guardar el producto. Inténtalo de nuevo." } };
  }
}

export default function ProductNew() {
  const { t } = useLocalization();
  const { currency, catalog } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const errors = actionData && "errors" in actionData ? actionData.errors : {};
  const pending = navigation.state === "submitting";

  function save(values: ProductFormValues, image: ProductImageSelection) {
    submit({
      name: values.name,
      ...(values.description === "" ? {} : { description: values.description }),
      ...(image.kind === "set" ? { imageId: image.id } : {}),
      currency,
      variants: [{ attributes: {}, ...(values.sku === "" ? {} : { sku: values.sku }), salePrice: Number(values.salePrice),
        ...(values.purchasePrice === "" ? {} : { purchasePrice: Number(values.purchasePrice) }),
        ...(values.initialStock === "" ? {} : { initialStock: Number(values.initialStock) }) }],
    }, { method: "post", encType: "application/json" });
  }

  return <PageContainer>
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>{t("Nuevo producto")}</PageHeader.Title>
        <PageHeader.Description>{t("Completa los datos para agregarlo a tu empresa.")}</PageHeader.Description>
      </PageHeader.Heading>
    </PageHeader>
    <ProductForm currency={currency} cancelTo={catalog} errors={errors} pending={pending} onSave={save} />
  </PageContainer>;
}
