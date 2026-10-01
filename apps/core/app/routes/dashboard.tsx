import { useLocalization } from "@core/app/localization";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { PageHeader } from "@core/app/components/ui/page-header";
import { privateUserContext } from "@core/app/private-user-context";

export function loader({ context }: LoaderFunctionArgs) {
  return { name: context.get(privateUserContext).user.name };
}

export default function Dashboard() {
  const { t } = useLocalization();
  const { name } = useLoaderData<typeof loader>();

  return (
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>{t("Hola,")} {name}</PageHeader.Title>
        <PageHeader.Description>{t("Tu espacio de trabajo está listo.")}</PageHeader.Description>
      </PageHeader.Heading>
    </PageHeader>
  );
}
