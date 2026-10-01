import { Link, useSearchParams } from "react-router";

export default function AccountVerified() {
  const [params] = useSearchParams();
  const failed = params.has("error");
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4"><h1 className="text-2xl font-semibold">{failed ? "No se pudo verificar el correo" : "Verificación completada"}</h1><p className="mt-3 text-muted-foreground">{failed ? "El enlace puede haber vencido o ya no ser válido. Solicita otro desde la página de revisión del correo." : "Inicia sesión para continuar. La verificación no inicia una sesión automáticamente."}</p><Link className="mt-6 underline" to={failed ? "/check-email" : "/login"}>{failed ? "Volver a revisar el correo" : "Iniciar sesión"}</Link></main>;
}
