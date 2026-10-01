import type { Resource } from "i18next";

const es = {
  common: { email: "Correo electrónico", password: "Contraseña", name: "Nombre", login: "Iniciar sesión", forgotPassword: "Recuperar contraseña", sending: "Enviando…" },
  auth: {
    createAccount: "Crear cuenta", createCompany: "Crear empresa", companyTitle: "Crea tu empresa",
    companyDescription: "Tu correo está verificado. Completa tu espacio de trabajo.", registerDescription: "Te enviaremos un enlace para verificar tu correo.", loginDescription: "Accede a tu espacio de trabajo.",
    companyName: "Nombre de empresa", country: "País", selectCountry: "Selecciona un país", wait: "Espera…", enter: "Entrar", register: "Regístrate", hasAccount: "¿Ya tienes cuenta? ", noAccount: "¿Aún no tienes cuenta? ", forgotLink: "¿Olvidaste tu contraseña?",
    invalidCompany: "Revisa el nombre y el país de la empresa.", createCompanyError: "No se pudo crear la empresa. Inténtalo de nuevo.", invalidAccount: "Revisa los datos de la cuenta.", registerError: "No se pudo enviar la solicitud. Inténtalo de nuevo.", invalidCredentials: "Revisa el correo y la contraseña.", invalidResponse: "Respuesta de autenticación inválida.", loginError: "No se pudo iniciar sesión.", connectionError: "No se pudo conectar. Inténtalo de nuevo.", requestError: "No se pudo procesar la solicitud. Inténtalo de nuevo.",
    emailSent: "Si existe una cuenta con ese correo, recibirás un enlace.", forgotTitle: "Recuperar contraseña", sendLink: "Enviar enlace", backToLogin: "Volver a iniciar sesión",
    resetTitle: "Restablecer contraseña", invalidPassword: "La contraseña debe tener entre 8 y 128 caracteres.", invalidResetLink: "El enlace no es válido o ya venció.", invalidResetRequest: "El enlace no es válido o ya venció. Solicita otro.", requestAnotherLink: "Solicitar otro enlace", passwordChanged: "La contraseña se cambió. Inicia sesión para continuar.", newPassword: "Nueva contraseña", saving: "Guardando…", changePassword: "Cambiar contraseña",
    checkEmailTitle: "Revisa tu correo", checkEmailDescription: "Revisa tu correo si tienes una verificación pendiente. Si ya tienes cuenta, inicia sesión o recupera tu contraseña.", verificationSent: "Si tienes una verificación pendiente, recibirás un enlace.", resendVerification: "Reenviar verificación",
    verifiedTitle: "Verificación completada", verificationFailedTitle: "No se pudo verificar el correo", verifiedDescription: "Inicia sesión para continuar. La verificación no inicia una sesión automáticamente.", verificationFailedDescription: "El enlace puede haber vencido o ya no ser válido. Solicita otro desde la página de revisión del correo.", backToCheckEmail: "Volver a revisar el correo",
  },
} as const;

const pt: { [K in keyof typeof es]: Record<keyof typeof es[K], string> } = {
  common: { email: "E-mail", password: "Senha", name: "Nome", login: "Entrar", forgotPassword: "Recuperar senha", sending: "Enviando…" },
  auth: {
    createAccount: "Criar conta", createCompany: "Criar empresa", companyTitle: "Crie sua empresa",
    companyDescription: "Seu e-mail foi verificado. Configure seu espaço de trabalho.", registerDescription: "Enviaremos um link para verificar seu e-mail.", loginDescription: "Acesse seu espaço de trabalho.",
    companyName: "Nome da empresa", country: "País", selectCountry: "Selecione um país", wait: "Aguarde…", enter: "Entrar", register: "Cadastre-se", hasAccount: "Já tem uma conta? ", noAccount: "Ainda não tem uma conta? ", forgotLink: "Esqueceu sua senha?",
    invalidCompany: "Confira o nome e o país da empresa.", createCompanyError: "Não foi possível criar a empresa. Tente novamente.", invalidAccount: "Confira os dados da conta.", registerError: "Não foi possível enviar a solicitação. Tente novamente.", invalidCredentials: "Confira o e-mail e a senha.", invalidResponse: "Resposta de autenticação inválida.", loginError: "Não foi possível entrar.", connectionError: "Não foi possível conectar. Tente novamente.", requestError: "Não foi possível processar a solicitação. Tente novamente.",
    emailSent: "Se houver uma conta com esse e-mail, você receberá um link.", forgotTitle: "Recuperar senha", sendLink: "Enviar link", backToLogin: "Voltar para entrar",
    resetTitle: "Redefinir senha", invalidPassword: "A senha deve ter entre 8 e 128 caracteres.", invalidResetLink: "O link é inválido ou expirou.", invalidResetRequest: "O link é inválido ou expirou. Solicite outro.", requestAnotherLink: "Solicitar outro link", passwordChanged: "A senha foi alterada. Entre para continuar.", newPassword: "Nova senha", saving: "Salvando…", changePassword: "Alterar senha",
    checkEmailTitle: "Confira seu e-mail", checkEmailDescription: "Confira seu e-mail se houver uma verificação pendente. Se já tem uma conta, entre ou recupere sua senha.", verificationSent: "Se houver uma verificação pendente, você receberá um link.", resendVerification: "Reenviar verificação",
    verifiedTitle: "Verificação concluída", verificationFailedTitle: "Não foi possível verificar o e-mail", verifiedDescription: "Entre para continuar. A verificação não inicia uma sessão automaticamente.", verificationFailedDescription: "O link pode ter expirado ou deixado de ser válido. Solicite outro na página de verificação do e-mail.", backToCheckEmail: "Voltar para verificar o e-mail",
  },
};

const resources = { es: { translation: es }, pt: { translation: pt } } satisfies Resource;

export default resources;

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: typeof es;
  }
}
