import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { PageHeader } from "@/components/ui/page-header";
import { privateUserContext } from "@/private-user-context";

export function loader({ context }: LoaderFunctionArgs) {
  return { name: context.get(privateUserContext).user.name };
}

export default function Dashboard() {
  const { name } = useLoaderData<typeof loader>();

  return (
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>Hola, {name}</PageHeader.Title>
        <PageHeader.Description>Tu espacio de trabajo está listo.</PageHeader.Description>
      </PageHeader.Heading>
    </PageHeader>
  );
}
