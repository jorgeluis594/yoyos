import { useTranslation } from "react-i18next";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { PageHeader } from "@/components/ui/page-header";
import { privateUserContext } from "@/private-user-context";

export function loader({ context }: LoaderFunctionArgs) {
  return { name: context.get(privateUserContext).user.name };
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { name } = useLoaderData<typeof loader>();

  return (
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>{t("nav.greeting", { name })}</PageHeader.Title>
        <PageHeader.Description>{t("nav.ready")}</PageHeader.Description>
      </PageHeader.Heading>
    </PageHeader>
  );
}
