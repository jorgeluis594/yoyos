import { Alert } from 'react-native';

export type ConfirmationOptions = {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

export function showConfirmation({ title, description, confirmLabel, cancelLabel, destructive = false, onConfirm }: ConfirmationOptions) {
  Alert.alert(title, description, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
