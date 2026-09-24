import { createElement } from 'react';
import AppTabs from '@/components/app-tabs';
import { AccessScreen } from '@/features/users/presentation/access-screen';
import { useAccess } from '@/features/users/presentation/access-provider';

export function AccessGate() {
  const { state } = useAccess();
  return state.status === 'ready' ? createElement(AppTabs) : createElement(AccessScreen, { key: state.status });
}
