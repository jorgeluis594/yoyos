import type { Resource } from "i18next";

const es = {
  common: { email: "Correo electrónico", password: "Contraseña", name: "Nombre", login: "Iniciar sesión", forgotPassword: "Recuperar contraseña", sending: "Enviando…", retry: "Inténtalo de nuevo." },
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
  nav: {
    workspace: "Espacio de trabajo", main: "Navegación principal", home: "Inicio", products: "Productos", orders: "Ventas", newProduct: "Nuevo producto", product: "Producto",
    toggleTheme: "Alternar tema", lightMode: "Modo claro", darkMode: "Modo oscuro", signingOut: "Cerrando sesión…", signOut: "Cerrar sesión", signOutError: "No se pudo cerrar la sesión. Inténtalo de nuevo.",
    skipContent: "Saltar al contenido", mainMenu: "Menú principal", closeMenu: "Cerrar menú", openMenu: "Abrir menú", breadcrumb: "Ruta de navegación",
    greeting: "Hola, {{name}}", ready: "Tu espacio de trabajo está listo.",
  },
  products: {
    title: "Productos", new: "Nuevo producto", newDescription: "Completa los datos para agregarlo a tu empresa.", name: "Nombre", multipleVariants: "Varias variantes", noSku: "Sin SKU", salePrice: "Precio de venta", purchasePrice: "Precio de compra", from: "Desde ", stock: "Stock", searchLabel: "Buscar por nombre o SKU", search: "Buscar", caption: "Productos del catálogo", emptySearch: "No se encontraron productos para esta búsqueda.", empty: "Aún no hay productos en el catálogo. ", createFirst: "Crea el primero", pages: "Páginas de productos", page: "Página {{page}}", invalidSearch: "Búsqueda no válida", loadError: "No se pudo cargar el catálogo", invalidSearchDescription: "Revisa los criterios e inténtalo de nuevo.", retry: "Reintentar", backCatalog: "Volver al catálogo", backProducts: "Volver a productos", saved: "Producto guardado correctamente.", saveChanges: "Guardar cambios", variants: "Variantes", variant: "Variante {{number}}", noPrice: "Sin precio", missing: "Producto no encontrado", loadProductError: "No se pudo cargar el producto", missingDescription: "No hay un producto disponible en esta dirección.", backHome: "Volver al inicio",
    readonlyVariants: "Puedes editar los datos generales y la foto. Las variantes son de solo lectura.", data: "Datos del producto", description: "Descripción", priceVariant: "Precio y variante", initialStock: "Stock inicial", photo: "Foto", removePhoto: "Quitar foto", uploading: "Subiendo imagen…", preview: "Vista previa de la foto del producto", saving: "Guardando…", save: "Guardar producto", cancel: "Cancelar", imageTooLarge: "La imagen supera el tamaño máximo de 10 MB.", invalidImage: "El archivo debe ser una imagen JPG, PNG o WebP.", uploadError: "No se pudo subir la imagen. Inténtalo de nuevo.",
  },
} as const;

const pt: { [K in keyof typeof es]: Record<keyof typeof es[K], string> } = {
  common: { email: "E-mail", password: "Senha", name: "Nome", login: "Entrar", forgotPassword: "Recuperar senha", sending: "Enviando…", retry: "Tente novamente." },
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
  nav: {
    workspace: "Espaço de trabalho", main: "Navegação principal", home: "Início", products: "Produtos", orders: "Vendas", newProduct: "Novo produto", product: "Produto",
    toggleTheme: "Alternar tema", lightMode: "Modo claro", darkMode: "Modo escuro", signingOut: "Saindo…", signOut: "Sair", signOutError: "Não foi possível sair. Tente novamente.",
    skipContent: "Ir para o conteúdo", mainMenu: "Menu principal", closeMenu: "Fechar menu", openMenu: "Abrir menu", breadcrumb: "Caminho de navegação",
    greeting: "Olá, {{name}}", ready: "Seu espaço de trabalho está pronto.",
  },
  products: {
    title: "Produtos", new: "Novo produto", newDescription: "Preencha os dados para adicioná-lo à sua empresa.", name: "Nome", multipleVariants: "Várias variantes", noSku: "Sem SKU", salePrice: "Preço de venda", purchasePrice: "Preço de compra", from: "A partir de ", stock: "Estoque", searchLabel: "Buscar por nome ou SKU", search: "Buscar", caption: "Produtos do catálogo", emptySearch: "Nenhum produto encontrado para esta busca.", empty: "Ainda não há produtos no catálogo. ", createFirst: "Crie o primeiro", pages: "Páginas de produtos", page: "Página {{page}}", invalidSearch: "Busca inválida", loadError: "Não foi possível carregar o catálogo", invalidSearchDescription: "Confira os critérios e tente novamente.", retry: "Tentar novamente", backCatalog: "Voltar ao catálogo", backProducts: "Voltar aos produtos", saved: "Produto salvo com sucesso.", saveChanges: "Salvar alterações", variants: "Variantes", variant: "Variante {{number}}", noPrice: "Sem preço", missing: "Produto não encontrado", loadProductError: "Não foi possível carregar o produto", missingDescription: "Não há um produto disponível neste endereço.", backHome: "Voltar ao início",
    readonlyVariants: "Você pode editar os dados gerais e a foto. As variantes são somente leitura.", data: "Dados do produto", description: "Descrição", priceVariant: "Preço e variante", initialStock: "Estoque inicial", photo: "Foto", removePhoto: "Remover foto", uploading: "Enviando imagem…", preview: "Prévia da foto do produto", saving: "Salvando…", save: "Salvar produto", cancel: "Cancelar", imageTooLarge: "A imagem excede o tamanho máximo de 10 MB.", invalidImage: "O arquivo deve ser uma imagem JPG, PNG ou WebP.", uploadError: "Não foi possível enviar a imagem. Tente novamente.",
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
