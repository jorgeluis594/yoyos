import { createElement, type ReactNode } from 'react';
import { Platform } from 'react-native';
import RootStack from '@mobile/components/root-stack';
import { AccessScreen } from '@/features/users/presentation/access-screen';
import { WhatsAppProvider } from '@mobile/features/whatsapp/presentation/whatsapp-provider';
import { getWhatsAppRuntime } from '@mobile/composition/whatsapp-runtime';
import { NoticesProvider } from '@mobile/features/notifications/presentation/notices-provider';
import { loadCatalogReadiness, notices } from '@mobile/composition/notifications';
import { useAccess } from '@/features/users/presentation/access-provider';

export function AccessGate() {
  const { state } = useAccess();
  return state.status === 'ready' ? createElement(WhatsAppProvider, { getRuntime: getWhatsAppRuntime, key: state.company.id }, createElement(NoticesGate, { companyId: state.company.id }, createElement(RootStack))) : createElement(AccessScreen, { key: state.status });
}

function NoticesGate({ companyId, children }: { companyId: string; children?: ReactNode }) {
  // Push notices exist on phones only; web has no push registration.
  if (Platform.OS === 'web') return children;
  return createElement(NoticesProvider, { controller: notices, companyId, loadCatalogReadiness }, children);
}
