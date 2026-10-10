import { createElement } from 'react';
import RootStack from '@mobile/components/root-stack';
import { AccessScreen } from '@/features/users/presentation/access-screen';
import { useAccess } from '@/features/users/presentation/access-provider';

export function AccessGate() {
  const { state } = useAccess();
  return state.status === 'ready' ? createElement(RootStack, { key: state.company.id }) : createElement(AccessScreen, { key: state.status });
}
