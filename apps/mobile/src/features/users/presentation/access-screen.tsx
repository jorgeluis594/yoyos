import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { countries, isCountry, type Country } from '@shared/country';
import type { CompanyDraft } from '@mobile/features/companies';
import { Field, FieldError, FieldGroup, FieldLabel } from '@mobile/components/ui/field';
import { Input } from '@mobile/components/ui/input';
import { ThemedText } from '@mobile/components/themed-text';
import { useTheme } from '@mobile/hooks/use-theme';
import { useAccess } from './access-provider';
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

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.action, { backgroundColor: theme.ring }, disabled && styles.disabled]}><ThemedText style={{ color: theme.backgroundElement, fontWeight: '600' }}>{label}</ThemedText></Pressable>;
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
  if (state.status === 'unavailable') return <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]}><ThemedText type="subtitle">{t('accessUnavailable')}</ThemedText><ThemedText>{message(state.error.code)}</ThemedText><Action label={state.error.code === 'SECURE_STORAGE_ERROR' ? t('retryCleanup') : t('retry')} onPress={() => void (state.error.code === 'SECURE_STORAGE_ERROR' ? access.signOut() : access.restore())} /></SafeAreaView>;
  if (state.status === 'ready') return null;
  return <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <ThemedText type="title">{checkEmail ? t('checkEmail') : onboarding ? t('completeCompany') : mode === 'login' ? t('welcome') : t('createAccount')}</ThemedText>
    <ThemedText themeColor="textSecondary">{checkEmail ? t('checkEmailDescription') : onboarding ? t('companyDescription') : t('welcomeDescription')}</ThemedText>
    <FieldGroup style={styles.fields}>
      {state.status === 'signed_out' && mode === 'register' ? <TextField label={t('name')} value={name} onChangeText={setName} disabled={busy} /> : null}
      {state.status === 'signed_out' || checkEmail ? <TextField label={t('email')} value={email} onChangeText={setEmail} disabled={busy} email /> : null}
      {state.status === 'signed_out' ? <TextField label={t('password')} value={password} onChangeText={setPassword} disabled={busy} secure /> : null}
      {onboarding ? <CompanyFields name={companyName} country={country} setName={setCompanyName} setCountry={setCountry} disabled={busy} /> : null}
      {notice ? <ThemedText accessibilityRole="text">{notice}</ThemedText> : null}
      {error ? <FieldError>{error}</FieldError> : null}
      {checkEmail ? <Action label={busy ? t('sending') : t('resendVerification')} disabled={busy} onPress={() => void requestVerification()} /> : <Action label={busy ? t('sending') : onboarding ? t('createCompany') : mode === 'login' ? t('signIn') : t('createAccountAction')} disabled={busy} onPress={() => void run()} />}
    </FieldGroup>
    {state.status === 'signed_out' && mode === 'login' ? <><Action label={t('resendVerification')} disabled={busy} onPress={() => void requestVerification()} /><Action label={t('recoverPassword')} disabled={busy} onPress={() => void requestPasswordReset()} /></> : null}
    {state.status === 'signed_out' ? <Action label={mode === 'login' ? t('createAnAccount') : t('alreadyHaveAccount')} onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setNotice(''); setPassword(''); }} /> : checkEmail ? <Action label={t('backToSignIn')} onPress={() => { void access.signOut(); setMode('login'); }} /> : <Action label={t('signOut')} onPress={() => void access.signOut()} />}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, center: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 }, content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }, fields: { marginVertical: 16 }, action: { minHeight: 48, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderRadius: 8 }, disabled: { opacity: 0.5 }, countries: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, country: { minWidth: 56, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderRadius: 8, justifyContent: 'center', alignItems: 'center' } });
