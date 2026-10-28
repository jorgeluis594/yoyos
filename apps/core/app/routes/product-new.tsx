import { useTranslation } from "react-i18next";
import { companyPath, languageForLocale } from "@core/app/locale";
import resources from "@core/app/locales";
import { log } from "@core/src/shared/infrastructure/logger";
import { useState } from "react";
import { data, redirect, useActionData, useLoaderData, useNavigation, useSubmit, type ActionFunctionArgs, type ClientActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { countryCurrencies, type Country } from "@shared/country";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { privateUserContext } from "@/private-user-context";
import { lostResponse, lostResponseStatus } from "@core/app/routes/lost-response";
import { createProductRequestSchema } from "@shared/contracts/products";
import { buildCreateProductBody } from "@shared/product-variants";
import { productEditing } from "@core/src/features/products/product-editing";
import { parseRequestJson, toCreateInput } from "@core/src/features/products/presentation/request-input";
import { createFeedback, type SaveFeedback } from "@core/src/features/products/presentation/messages";
import { ProductForm, type ProductFormSubmission } from "@core/src/features/products/presentation/product-form";

export function loader({ context, request }: LoaderFunctionArgs) {
  const company = context.get(privateUserContext).company;
  return { currency: countryCurrencies[company.country as Country], catalog: companyPath(new URL(request.url).pathname, company.country, "/products") };
}

export async function action({ request, context }: ActionFunctionArgs): Promise<Response | SaveFeedback> {
  const language = languageForLocale(new URL(request.url).pathname.split("/")[1]);
  const parsed = parseRequestJson(createProductRequestSchema, await request.text(), "Invalid product input");
  if (!parsed.success) return createFeedback(parsed.error, language);
  const company = context.get(privateUserContext).company;
  try {
    const result = await productEditing.create(toCreateInput(parsed.data));
    if (!result.success) return createFeedback(result.error, language);
    return redirect(companyPath(new URL(request.url).pathname, company.country, `/products/${result.data}`));
  } catch (cause) {
    log.error({ event: "unable_to_create_product", err: cause }, "unable_to_create_product");
    return { errors: { form: resources[language].translation.productEditor.inDoubtCreate }, issues: [] };
  }
}

// A request that never reached the server is a connection problem; a gateway failure after it left is an uncertain result. Redirects and client errors keep their usual handling.
export async function clientAction({ request, serverAction }: ClientActionFunctionArgs) {
  try { return await serverAction<typeof action>(); }
  catch (cause) {
    const lost = lostResponse(cause);
    if (!lost) throw cause;
    const { productEditor } = resources[languageForLocale(new URL(request.url).pathname.split("/")[1])].translation;
    return data<SaveFeedback>({ errors: { form: lost === "offline" ? productEditor.offline : productEditor.inDoubtCreate }, issues: [] }, { status: lostResponseStatus });
  }
}

// A rejected save leaves the form as it is.
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: { actionResult?: unknown; defaultShouldRevalidate: boolean }) {
  return actionResult && typeof actionResult === "object" && "errors" in actionResult ? false : defaultShouldRevalidate;
}

export default function ProductNew() {
  const { t } = useTranslation();
  const { currency, catalog } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof clientAction>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const feedback = actionData && "errors" in actionData ? actionData : undefined;
  const pending = navigation.state === "submitting";
  // One id per opened form, so a retry after an uncertain result is answered with a conflict instead of a second product.
  const [productId] = useState(() => crypto.randomUUID());

  function save({ values, photos, draft }: ProductFormSubmission) {
    submit(buildCreateProductBody(draft, {
      id: productId, name: values.name, description: values.description === "" ? null : values.description,
      photos, currency,
    }), { method: "post", encType: "application/json" });
  }

  return <PageContainer>
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>{t("products.new")}</PageHeader.Title>
        <PageHeader.Description>{t("products.newDescription")}</PageHeader.Description>
      </PageHeader.Heading>
    </PageHeader>
    <ProductForm currency={currency} cancelTo={catalog} feedback={feedback} pending={pending} onSave={save} />
  </PageContainer>;
}
