import { createElement, Fragment, type ReactNode } from 'react';
import { Platform } from 'react-native';
import RootStack from '@mobile/components/root-stack';
import { AccessScreen } from '@/features/users/presentation/access-screen';
import { WhatsAppProvider } from '@mobile/features/whatsapp/presentation/whatsapp-provider';
import { getWhatsAppRuntime } from '@mobile/composition/whatsapp-runtime';
import { NoticesProvider } from '@mobile/features/notifications/presentation/notices-provider';
import { PendingUnregisterFlush } from '@mobile/features/notifications/presentation/pending-unregister-flush';
import { loadCatalogReadiness, notices } from '@mobile/composition/notifications';
import { useAccess } from '@/features/users/presentation/access-provider';

export function AccessGate() {
  const { state } = useAccess();
  const gate = accessContent(state);
  // The pending unregister is sent while signed out too, so it sits above the access state.
  return Platform.OS === 'web' ? gate : createElement(Fragment, null, createElement(PendingUnregisterFlush, { controller: notices }), gate);
}

function accessContent(state: ReturnType<typeof useAccess>['state']) {
  return state.status === 'ready' ? createElement(WhatsAppProvider, { getRuntime: getWhatsAppRuntime, key: state.company.id }, createElement(NoticesGate, { companyId: state.company.id }, createElement(RootStack))) : createElement(AccessScreen, { key: state.status });
}

function NoticesGate({ companyId, children }: { companyId: string; children?: ReactNode }) {
  // Push notices exist on phones only; web has no push registration.
  if (Platform.OS === 'web') return children;
  return createElement(NoticesProvider, { controller: notices, companyId, loadCatalogReadiness }, children);
}
