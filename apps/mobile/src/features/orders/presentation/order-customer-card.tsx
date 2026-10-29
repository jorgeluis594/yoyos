import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { internationalPhonePattern } from "@shared/phone";
import type { DraftCustomer } from "@mobile/features/orders/domain/order-draft";
import { ThemedText } from "@mobile/components/themed-text";
import { Button } from "@mobile/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@mobile/components/ui/field";
import { Input } from "@mobile/components/ui/input";
import { PhoneField } from "@mobile/features/orders/presentation/phone-field";
import { DeliveryRow } from "@mobile/features/orders/presentation/order-delivery-parts";
import { useTheme } from "@mobile/hooks/use-theme";
import tokens from "../../../../../../docs/design-tokens.json";

type Props = Readonly<{ customer: DraftCustomer | undefined; busy: boolean; onChange: (customer: DraftCustomer | undefined) => void }>;

/** Optional customer of a sale being built: typed by hand, saved as the order buyer; without it the sale stays "Público general". */
export function OrderCustomerCard({ customer, busy, onChange }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
    <DeliveryRow symbol={{ ios: "person", android: "person" }} label={t('customerOptional')} disabled={busy} onPress={() => setOpen(true)}
      value={customer ? `${customer.name} · ${customer.phone}` : t('addCustomer')} muted={!customer} />
    {open ? <CustomerSheet customer={customer} onClose={() => setOpen(false)}
      onSave={next => { onChange(next); setOpen(false); }} /> : null}
  </View>;
}

function CustomerSheet({ customer, onClose, onSave }: Readonly<{ customer: DraftCustomer | undefined; onClose: () => void; onSave: (customer: DraftCustomer | undefined) => void }>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [submitted, setSubmitted] = useState(false);
  const nameError = submitted && !name.trim();
  const phoneError = submitted && !internationalPhonePattern.test(phone);
  const save = () => {
    setSubmitted(true);
    if (!name.trim() || !internationalPhonePattern.test(phone)) return;
    onSave({ name: name.trim(), phone });
  };
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Pressable style={styles.scrim} accessible={false} importantForAccessibility="no" accessibilityElementsHidden onPress={onClose} />
      <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View style={[styles.grab, { backgroundColor: theme.input }]} />
        <View style={styles.header}>
          <ThemedText type="subtitle" accessibilityRole="header" style={styles.flex}>{t('customerSheetTitle')}</ThemedText>
          <Button variant="ghost" onPress={onClose}>{t('detailClose')}</Button>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          <FieldGroup>
            <Field required invalid={nameError}><FieldLabel>{t('customerName')}</FieldLabel>
              <Input value={name} onChangeText={setName} invalid={nameError} autoCapitalize="words" maxLength={120} accessibilityLabel={t('customerName')} />
              {nameError ? <FieldError>{t('customerNameRequired')}</FieldError> : null}</Field>
            <PhoneField testID="customer-phone" label={t('customerPhone')} value={phone} required invalid={phoneError} onChange={setPhone} />
          </FieldGroup>
          <Button onPress={save}>{t('saveCustomer')}</Button>
          {customer ? <Button variant="ghost" onPress={() => onSave(undefined)}>{t('removeCustomer')}</Button> : null}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  card: { borderWidth: tokens.sizing.borderWidth, borderRadius: tokens.radius.card, paddingHorizontal: 16, paddingVertical: 4 },
  flex: { flex: 1 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { borderTopLeftRadius: tokens.radius.overlay, borderTopRightRadius: tokens.radius.overlay, borderTopWidth: tokens.sizing.borderWidth },
  grab: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  body: { padding: 16, gap: 12 },
});
