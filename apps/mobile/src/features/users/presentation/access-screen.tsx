import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { countries, isCountry, type Country } from '@shared/country';
import type { CompanyDraft } from '@mobile/features/companies';
import { Field, FieldError, FieldGroup, FieldLabel } from '@mobile/components/ui/field';
import { Input } from '@mobile/components/ui/input';
import { ThemedText } from '@mobile/components/themed-text';
import { useTheme } from '@mobile/hooks/use-theme';
import { useAccess } from '@mobile/features/users/presentation/access-provider';
import { Button } from '@mobile/components/ui/button';
import i18n from '@mobile/i18n';

const countryKeys: Record<Country, string> = { PE: 'countryPE', US: 'countryUS', CO: 'countryCO', AR: 'countryAR', CL: 'countryCL', BR: 'countryBR' };

function message(code: string): string {
  if (code === 'INVALID_INPUT') return i18n.t('invalidInput');
  if (code === 'INVALID_CREDENTIALS') return i18n.t('invalidCredentials');
  if (code === 'EMAIL_NOT_VERIFIED') return i18n.t('emailNotVerified');
  if (code === 'RATE_LIMITED') return i18n.t('rateLimited');
  if (code === 'NETWORK_ERROR') return i18n.t('networkError');
  if (code === 'SECURE_STORAGE_ERROR') return i18n.t('secureStorageError');
  return i18n.t('operationError');
}

function TextField({ label, value, onChangeText, disabled, secure = false, email = false }: { label: string; value: string; onChangeText: (value: string) => void; disabled: boolean; secure?: boolean; email?: boolean }) {
  return <Field required disabled={disabled}><FieldLabel>{label}</FieldLabel><Input value={value} onChangeText={onChangeText} autoCapitalize={email ? 'none' : 'sentences'} autoCorrect={!email && !secure} keyboardType={email ? 'email-address' : 'default'} textContentType={secure ? 'password' : email ? 'emailAddress' : 'none'} secureTextEntry={secure} /></Field>;
}
function CompanyFields({ name, country, setName, setCountry, disabled }: { name: string; country: string; setName: (value: string) => void; setCountry: (value: string) => void; disabled: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return <><TextField label={t('companyName')} value={name} onChangeText={setName} disabled={disabled} /><Field required disabled={disabled}><FieldLabel>{t('country')}</FieldLabel><View accessibilityRole="radiogroup" style={styles.countries}>{countries.map((item) => <Pressable key={item} accessibilityRole="radio" accessibilityLabel={t(countryKeys[item])} accessibilityState={{ checked: country === item, disabled }} disabled={disabled} onPress={() => setCountry(item)} style={[styles.country, { borderColor: country === item ? theme.ring : theme.input, backgroundColor: country === item ? theme.backgroundSelected : theme.backgroundElement }]}><ThemedText>{t(countryKeys[item])}</ThemedText></Pressable>)}</View></Field></>;
}

export function AccessScreen() {
  const access = useAccess();
  const theme = useTheme();
  const { t } = useTranslation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState(access.companyDraft?.name ?? '');
  const [country, setCountry] = useState<string>(access.companyDraft?.country ?? '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const state = access.state;
  const checkEmail = state.status === 'check_email' || state.status === 'verification_required';
  const onboarding = state.status === 'company_required';
  const draft = (): CompanyDraft | null => isCountry(country) && companyName.trim().length >= 1 && companyName.trim().length <= 120 ? { name: companyName, country } : null;

  const run = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (state.status === 'signed_out' && mode === 'login') {
        if (!email.includes('@') || !password) { setError(t('loginInputError')); return; }
        const result = await access.signIn({ email, password });
        if (!result.success) setError(message(result.error.cause.code));
      } else if (state.status === 'signed_out') {
        if (!name.trim() || !email.includes('@') || password.length < 8 || password.length > 128) { setError(t('registerInputError')); return; }
        const result = await access.register({ name, email, password });
        if (!result.success) setError(message(result.error.cause.code));
        setPassword('');
      } else if (onboarding) {
        const company = draft();
        if (!company) { setError(t('companyInputError')); return; }
        const result = await access.completeCompany(company);
        if (!result.success) setError(message(result.error.cause.code));
      }
    } finally { submitting.current = false; setBusy(false); }
  };
  const requestVerification = async () => {
    setBusy(true); setError(''); setNotice('');
    const result = await access.requestVerification(email);
    setBusy(false);
    if (!result.success) setError(message(result.error.code));
    else setNotice(t('verificationSent'));
  };
  const requestPasswordReset = async () => {
    setBusy(true); setError(''); setNotice('');
    const result = await access.requestPasswordReset(email);
    setBusy(false);
    if (!result.success) setError(message(result.error.code));
    else setNotice(t('resetSent'));
  };

  if (state.status === 'checking') return <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]}><ThemedText accessibilityRole="progressbar">{t('checkingSession')}</ThemedText></SafeAreaView>;
  if (state.status === 'unavailable') return <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]}><ThemedText type="subtitle">{t('accessUnavailable')}</ThemedText><ThemedText>{message(state.error.code)}</ThemedText><Button onPress={() => void (state.error.code === 'SECURE_STORAGE_ERROR' ? access.signOut() : access.restore())} >{state.error.code === 'SECURE_STORAGE_ERROR' ? t('retryCleanup') : t('retry')}</Button></SafeAreaView>;
  if (state.status === 'ready') return null;
  return <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}><KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <ThemedText type="title" accessibilityRole="header">{checkEmail ? t('checkEmail') : onboarding ? t('completeCompany') : mode === 'login' ? t('welcome') : t('createAccount')}</ThemedText>
    <ThemedText themeColor="textSecondary">{checkEmail ? t('checkEmailDescription') : onboarding ? t('companyDescription') : t('welcomeDescription')}</ThemedText>
    <FieldGroup style={styles.fields}>
      {state.status === 'signed_out' && mode === 'register' ? <TextField label={t('name')} value={name} onChangeText={setName} disabled={busy} /> : null}
      {state.status === 'signed_out' || checkEmail ? <TextField label={t('email')} value={email} onChangeText={setEmail} disabled={busy} email /> : null}
      {state.status === 'signed_out' ? <TextField label={t('password')} value={password} onChangeText={setPassword} disabled={busy} secure /> : null}
      {state.status === 'signed_out' && mode === 'login' ? <View style={styles.recovery}><Button variant="ghost" disabled={busy} onPress={() => void requestPasswordReset()}>{t('recoverPassword')}</Button></View> : null}
      {onboarding ? <CompanyFields name={companyName} country={country} setName={setCompanyName} setCountry={setCountry} disabled={busy} /> : null}
      {notice ? <ThemedText accessibilityRole="text">{notice}</ThemedText> : null}
      {error ? <FieldError>{error}</FieldError> : null}
      {checkEmail ? <Button disabled={busy} onPress={() => void requestVerification()} >{busy ? t('sending') : t('resendVerification')}</Button> : <Button disabled={busy} onPress={() => void run()} >{busy ? t('sending') : onboarding ? t('createCompany') : mode === 'login' ? t('signIn') : t('createAccountAction')}</Button>}
    </FieldGroup>
    {state.status === 'signed_out' ? <Button variant="secondary" disabled={busy} onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setNotice(''); setPassword(''); }} >{mode === 'login' ? t('createAnAccount') : t('alreadyHaveAccount')}</Button> : checkEmail ? <Button variant="ghost" disabled={busy} onPress={() => { void access.signOut(); setMode('login'); }} >{t('backToSignIn')}</Button> : <Button variant="ghost" disabled={busy} onPress={() => void access.signOut()} >{t('signOut')}</Button>}
    {state.status === 'signed_out' && mode === 'login' ? <View style={[styles.verification, { borderTopColor: theme.border }]}><Button variant="ghost" disabled={busy} onPress={() => void requestVerification()}>{t('resendVerification')}</Button></View> : null}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  content: { flexGrow: 1, padding: 24, paddingTop: 48, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' },
  fields: { marginTop: 16 },
  recovery: { alignSelf: 'flex-end' },
  verification: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, marginTop: 8 },
  countries: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  country: { minWidth: 56, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
});
