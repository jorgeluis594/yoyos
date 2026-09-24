import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { countries, isCountry, type Country } from '@shared/country';
import type { CompanyDraft } from '@/features/companies';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAccess } from './access-provider';

const countryNames: Record<Country, string> = { PE: 'Perú', US: 'Estados Unidos', CO: 'Colombia', AR: 'Argentina', CL: 'Chile', BR: 'Brasil' };

type FormError = { code: string; step?: string; cause?: { code: string } };
function errorMessage(error: FormError): string {
  if (error.code === 'SECURE_STORAGE_ERROR') return 'No se pudo borrar la sesión del dispositivo. Reintenta la limpieza.';
  if (error.code === 'EMAIL_IN_USE' || error.cause?.code === 'EMAIL_IN_USE') return 'Este correo ya está registrado. Inicia sesión.';
  if (error.code === 'INVALID_CREDENTIALS' || error.cause?.code === 'INVALID_CREDENTIALS') return 'Correo o contraseña incorrectos.';
  if (error.code === 'INVALID_INPUT' || error.cause?.code === 'INVALID_INPUT') return 'Revisa los datos ingresados.';
  if (error.code === 'RATE_LIMITED' || error.cause?.code === 'RATE_LIMITED') return 'Demasiados intentos. Espera un momento y vuelve a intentar.';
  if (error.code === 'SERVER_ERROR' || error.cause?.code === 'SERVER_ERROR') return 'El servicio no está disponible. Vuelve a intentar más tarde.';
  if (error.code === 'UNAUTHENTICATED' || error.cause?.code === 'UNAUTHENTICATED') return 'La sesión terminó. Inicia sesión otra vez.';
  if (error.code === 'OPERATION_CANCELLED' || error.cause?.code === 'OPERATION_CANCELLED') return '';
  if (error.code === 'INVALID_RESPONSE' || error.cause?.code === 'INVALID_RESPONSE') return 'No se pudo comprobar la respuesta. Vuelve a intentar.';
  if (error.code === 'INVALID_COMPANY' || error.cause?.code === 'INVALID_COMPANY') return 'Ingresa un nombre de empresa de 1 a 120 caracteres y elige un país.';
  if (error.code === 'NETWORK_ERROR' || error.cause?.code === 'NETWORK_ERROR') return 'Sin conexión. Comprueba tu red y vuelve a intentar.';
  if (error.step === 'account') return 'No se pudo confirmar el registro. Comprueba tu sesión o inicia sesión; no repitas el registro automáticamente.';
  if (error.step === 'company' || error.step === 'reload' || error.step === 'create') return 'No se pudo completar la empresa. Comprueba el acceso y vuelve a intentar este paso.';
  return 'No se pudo completar la operación. Vuelve a intentar.';
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
  return <><TextField label="Nombre de empresa" value={name} onChangeText={setName} disabled={disabled} /><Field required disabled={disabled}><FieldLabel>País</FieldLabel><View accessibilityRole="radiogroup" style={styles.countries}>{countries.map((item) => <Pressable key={item} accessibilityRole="radio" accessibilityLabel={countryNames[item]} accessibilityState={{ checked: country === item, disabled }} disabled={disabled} onPress={() => setCountry(item)} style={[styles.country, { borderColor: country === item ? theme.ring : theme.input, backgroundColor: country === item ? theme.backgroundSelected : theme.backgroundElement }]}><ThemedText>{countryNames[item]}</ThemedText></Pressable>)}</View></Field></>;
}

export function AccessScreen() {
  const access = useAccess();
  const theme = useTheme();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState(access.companyDraft?.name ?? '');
  const [country, setCountry] = useState<string>(access.companyDraft?.country ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const state = access.state;
  const draft = (): CompanyDraft | null => isCountry(country) && companyName.trim().length >= 1 && companyName.trim().length <= 120 ? { name: companyName, country } : null;
  const run = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      if (state.status === 'signed_out' && mode === 'login') {
        if (!email.includes('@') || !password) { setError('Ingresa un correo y una contraseña.'); return; }
        const result = await access.signIn({ email, password });
        if (!result.success) setError(errorMessage(result.error));
      } else if (state.status === 'signed_out') {
        const company = draft();
        if (!name.trim() || !email.includes('@') || password.length < 8 || password.length > 128 || !company) { setError('Completa todos los campos. La contraseña debe tener entre 8 y 128 caracteres y la empresa un nombre de 1 a 120.'); return; }
        const result = await access.register({ account: { name, email, password }, company });
        if (!result.success) setError(errorMessage(result.error));
        setPassword('');
      } else if (state.status === 'company_required') {
        const company = draft();
        if (!company) { setError('Ingresa un nombre de empresa de 1 a 120 caracteres y elige un país.'); return; }
        const result = await access.completeCompany(company);
        if (!result.success) setError(errorMessage(result.error));
      }
    } finally { submitting.current = false; setBusy(false); }
  };
  if (state.status === 'checking') return <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]}><ThemedText accessibilityRole="progressbar">Comprobando sesión…</ThemedText></SafeAreaView>;
  if (state.status === 'unavailable') return <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]}><ThemedText type="subtitle">No se pudo comprobar el acceso</ThemedText><ThemedText>{errorMessage(state.error)}</ThemedText><Action label={state.error.code === 'SECURE_STORAGE_ERROR' ? 'Reintentar limpieza' : 'Reintentar'} onPress={() => void (state.error.code === 'SECURE_STORAGE_ERROR' ? access.signOut() : access.restore())} /></SafeAreaView>;
  if (state.status === 'ready') return null;
  return <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><ThemedText type="title">{state.status === 'company_required' ? 'Completa tu empresa' : mode === 'login' ? 'Bienvenido a Yoyos' : 'Crea tu cuenta'}</ThemedText><ThemedText themeColor="textSecondary">{state.status === 'company_required' ? 'Tu cuenta ya está creada. Solo falta vincular la empresa.' : 'Gestiona tu negocio desde un solo lugar.'}</ThemedText><FieldGroup style={styles.fields}>{state.status === 'signed_out' ? <>{mode === 'register' ? <TextField label="Nombre" value={name} onChangeText={setName} disabled={busy} /> : null}<TextField label="Correo" value={email} onChangeText={setEmail} disabled={busy} email /><TextField label="Contraseña" value={password} onChangeText={setPassword} disabled={busy} secure /></> : null}{state.status === 'company_required' || mode === 'register' ? <CompanyFields name={companyName} country={country} setName={setCompanyName} setCountry={setCountry} disabled={busy} /> : null}{error ? <FieldError>{error}</FieldError> : null}<Action label={busy ? 'Enviando…' : state.status === 'company_required' ? 'Crear empresa' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'} disabled={busy} onPress={() => void run()} /></FieldGroup>{state.status === 'signed_out' ? <Action label={mode === 'login' ? 'Crear una cuenta' : 'Ya tengo una cuenta'} onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setPassword(''); }} /> : <Action label="Cerrar sesión" onPress={() => void access.signOut()} />}</ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, center: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 }, content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }, fields: { marginVertical: 16 }, action: { minHeight: 48, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderRadius: 8 }, disabled: { opacity: 0.5 }, countries: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, country: { minWidth: 56, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderRadius: 8, justifyContent: 'center', alignItems: 'center' } });
