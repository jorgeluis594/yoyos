import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { privateUserContext } from "@/private-user-context";

export function loader({ context }: LoaderFunctionArgs) {
  return { name: context.get(privateUserContext).name };
}

export default function Dashboard() {
  const { name } = useLoaderData<typeof loader>();

  return (
    <div>
      <h1 className="break-words text-2xl font-semibold tracking-tight text-balance">Hola, {name}</h1>
      <p className="mt-2 text-sm leading-5 text-muted-foreground">Tu espacio de trabajo está listo.</p>
    </div>
  );
}
