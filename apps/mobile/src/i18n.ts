import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

const i18n = createInstance();

const resources = {
  es: { translation: {
    home: 'Inicio', products: 'Productos', orders: 'Ventas',
    greeting: 'Hola, {{name}}', catalogTitle: 'Tu catálogo, a mano',
    catalogDescription: 'Consulta tus productos, revisa precios y stock o agrega uno nuevo.',
    viewProducts: 'Ver productos', addProduct: 'Agregar producto', signOut: 'Cerrar sesión',
    discardChanges: '¿Descartar cambios?', discardDescription: 'Se perderán los cambios que no guardaste.',
    discard: 'Descartar', keepEditing: 'Seguir editando',
  } },
  'pt-BR': { translation: {
    home: 'Início', products: 'Produtos', orders: 'Vendas',
    greeting: 'Olá, {{name}}', catalogTitle: 'Seu catálogo à mão',
    catalogDescription: 'Consulte seus produtos, confira preços e estoque ou adicione um novo.',
    viewProducts: 'Ver produtos', addProduct: 'Adicionar produto', signOut: 'Sair',
    discardChanges: 'Descartar alterações?', discardDescription: 'As alterações que você não salvou serão perdidas.',
    discard: 'Descartar', keepEditing: 'Continuar editando',
  } },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('pt') ? 'pt-BR' : 'es',
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
