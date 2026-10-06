import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { interStyle } from '@mobile/constants/typography';
import tokens from '../../../../../docs/design-tokens.json';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';

export type ScreenStateProps = {
  status: 'loading' | 'empty' | 'no-results' | 'error';
  title: string;
  description?: string;
  media?: ReactNode;
  action?: ReactNode;
  onRetry?: () => void;
};

export function ScreenState({ status, title, description, media, action, onRetry }: ScreenStateProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const loading = status === 'loading';

  return (
    <View style={styles.root}>
      <View style={styles.content} accessible={loading} accessibilityRole={loading ? 'progressbar' : undefined} accessibilityLabel={loading ? title : undefined} accessibilityState={loading ? { busy: true } : undefined}>
        {loading ? <ActivityIndicator color={theme.primary} accessibilityElementsHidden importantForAccessibility="no" /> : media}
        <View style={styles.copy}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          {description ? <Text style={[styles.description, { color: theme.textSecondary }]}>{description}</Text> : null}
        </View>
        {!loading ? action ?? (status === 'error' && onRetry ? <Button onPress={onRetry}>{t('retry')}</Button> : null) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 320, justifyContent: 'center', alignItems: 'center', padding: tokens.spacing['6'] },
  content: { width: '100%', maxWidth: 320, alignItems: 'center', gap: tokens.spacing['6'] },
  copy: { alignItems: 'center', gap: tokens.spacing['2'] },
  title: { ...interStyle('600'), fontSize: tokens.typography.roles['section-title'].size, lineHeight: tokens.typography.roles['section-title'].lineHeight, textAlign: 'center' },
  description: { fontFamily: tokens.typography.family, fontSize: tokens.typography.roles['body-compact'].size, lineHeight: tokens.typography.roles['body-compact'].lineHeight, textAlign: 'center' },
});
