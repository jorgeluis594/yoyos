import { Alert } from 'react-native';

export type ConfirmationOptions = {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** Runs when the seller picks the cancel button or dismisses the dialog. */
  onCancel?: () => void;
};

export function showConfirmation({ title, description, confirmLabel, cancelLabel, destructive = false, onConfirm, onCancel }: ConfirmationOptions) {
  Alert.alert(title, description, [
    { text: cancelLabel, style: 'cancel', onPress: onCancel },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ], { cancelable: true, onDismiss: onCancel });
}
