import { createElement } from 'react';
import RootStack from '@mobile/components/root-stack';
import { AccessScreen } from '@/features/users/presentation/access-screen';
import { WhatsAppProvider } from '@mobile/features/whatsapp/presentation/whatsapp-provider';
import { getWhatsAppRuntime } from '@mobile/composition/whatsapp-runtime';
import { useAccess } from '@/features/users/presentation/access-provider';

export function AccessGate() {
  const { state } = useAccess();
  return state.status === 'ready' ? createElement(WhatsAppProvider, { getRuntime: getWhatsAppRuntime, key: state.company.id }, createElement(RootStack)) : createElement(AccessScreen, { key: state.status });
}
