import { redirect, useActionData, useLoaderData, useNavigation, useSubmit, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { countryCurrencies, type Country } from "@shared/country";
import { privateUserContext } from "@/private-user-context";
import { products } from "@core/src/features/products/composition";
import { parseCreateJson } from "@core/src/features/products/presentation/input";
import { createErrors, type FormErrors } from "@core/src/features/products/presentation/messages";
import { ProductForm, type ProductFormValues } from "@core/src/features/products/presentation/product-form";
import type { CompanyId } from "@core/src/features/products/domain/product";

export function loader({ context }: LoaderFunctionArgs) {
  const company = context.get(privateUserContext).company;
  return { currency: countryCurrencies[company.country as Country], home: `/es-${company.country}/dashboard` };
}

export async function action({ request, context }: ActionFunctionArgs): Promise<Response | { errors: FormErrors }> {
  const parsed = parseCreateJson(await request.text());
  if (!parsed.success) return { errors: createErrors(parsed.error) };
  const company = context.get(privateUserContext).company;
  try {
    const result = await products.create(company.id as CompanyId, parsed.data);
    if (!result.success) return { errors: createErrors(result.error) };
    return redirect(`/es-${company.country}/products/${result.data}`);
  } catch (cause) {
    console.error("Unable to create product", cause);
    return { errors: { form: "No se pudo guardar el producto. Inténtalo de nuevo." } };
  }
}

export default function ProductNew() {
  const { currency, home } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const errors = actionData && "errors" in actionData ? actionData.errors : {};
  const pending = navigation.state === "submitting";

  function save(values: ProductFormValues) {
    submit({
      name: values.name,
      ...(values.description === "" ? {} : { description: values.description }),
      currency,
      variants: [{ attributes: {}, ...(values.sku === "" ? {} : { sku: values.sku }), salePrice: Number(values.salePrice),
        ...(values.purchasePrice === "" ? {} : { purchasePrice: Number(values.purchasePrice) }),
        ...(values.initialStock === "" ? {} : { initialStock: Number(values.initialStock) }) }],
    }, { method: "post", encType: "application/json" });
  }

  return <section className="mx-auto max-w-2xl">
    <h1 className="text-2xl font-semibold tracking-tight">Nuevo producto</h1>
    <p className="mt-2 text-sm text-muted-foreground">Completa los datos para agregarlo a tu empresa.</p>
    <ProductForm currency={currency} cancelTo={home} errors={errors} pending={pending} onSave={save} />
  </section>;
}
