import type { Preview } from '@storybook/react-native-web-vite';
import { View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import '../src/global.css';
import './preview.css';

function Surface({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <View style={{ backgroundColor: theme.background, minHeight: '100vh', padding: 24 }}>{children}</View>;
}

const preview: Preview = {
  decorators: [(Story) => <Surface><Story /></Surface>],
};

export default preview;
