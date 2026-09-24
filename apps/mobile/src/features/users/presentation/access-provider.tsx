import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CompanyDraft } from '@/features/companies';
import type { AccessError, CompleteCompanyError, RegisterInput, RegistrationError, SignInError, SignInInput, StorageError, UserAccess } from '@/features/users';
import type { Result } from '@shared/result';

type AccessState = { status: 'checking' | 'signed_out' } | UserAccess | { status: 'unavailable'; error: AccessError | StorageError };
type Operations = Readonly<{
  restoreSession: () => Promise<Result<UserAccess | null, AccessError>>;
  signIn: (input: SignInInput) => Promise<Result<UserAccess, SignInError>>;
  register: (input: RegisterInput) => Promise<Result<Extract<UserAccess, { status: 'ready' }>, RegistrationError>>;
  completeCompany: (input: CompanyDraft) => Promise<Result<Extract<UserAccess, { status: 'ready' }>, CompleteCompanyError>>;
  signOut: (clearPrivateState: () => void) => Promise<Result<unknown, StorageError>>;
}>;

type AccessContextValue = Readonly<{
  state: AccessState;
  companyDraft: CompanyDraft | null;
  restore: () => Promise<void>;
  signIn: (input: SignInInput) => ReturnType<Operations['signIn']>;
  register: (input: RegisterInput) => ReturnType<Operations['register']>;
  completeCompany: (input: CompanyDraft) => ReturnType<Operations['completeCompany']>;
  signOut: () => ReturnType<Operations['signOut']>;
}>;

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({ operations, children }: { operations: Operations; children: ReactNode }) {
  const [state, setState] = useState<AccessState>({ status: 'checking' });
  const [companyDraft, setCompanyDraft] = useState<CompanyDraft | null>(null);
  const generation = useRef(0);
  const restore = async () => {
    const ticket = ++generation.current;
    setState({ status: 'checking' });
    const result = await operations.restoreSession();
    if (ticket !== generation.current) return;
    setState(result.success ? result.data ?? { status: 'signed_out' } : { status: 'unavailable', error: result.error });
  };
  useEffect(() => {
    const currentGeneration = generation;
    const ticket = ++currentGeneration.current;
    void operations.restoreSession().then((result) => {
      if (ticket === currentGeneration.current) setState(result.success ? result.data ?? { status: 'signed_out' } : { status: 'unavailable', error: result.error });
    });
    return () => { if (currentGeneration.current === ticket) currentGeneration.current++; };
  }, [operations]);

  const signIn: AccessContextValue['signIn'] = async (input) => {
    const ticket = ++generation.current;
    const result = await operations.signIn(input);
    if (ticket === generation.current) {
      if (result.success) { setCompanyDraft(null); setState(result.data); }
      else if (result.error.step === 'access') void restore();
    }
    return result;
  };
  const register: AccessContextValue['register'] = async (input) => {
    const ticket = ++generation.current;
    const result = await operations.register(input);
    if (ticket === generation.current) {
      if (result.success) { setCompanyDraft(null); setState(result.data); }
      else if (result.error.step !== 'account' || result.error.cause.code !== 'INVALID_INPUT' && result.error.cause.code !== 'EMAIL_IN_USE') {
        setCompanyDraft(input.company);
        void restore();
      }
    }
    return result;
  };
  const completeCompany: AccessContextValue['completeCompany'] = async (input) => {
    const ticket = ++generation.current;
    const result = await operations.completeCompany(input);
    if (ticket === generation.current && result.success) { setCompanyDraft(null); setState(result.data); }
    return result;
  };
  const signOut: AccessContextValue['signOut'] = async () => {
    generation.current++;
    setCompanyDraft(null);
    setState({ status: 'checking' });
    const result = await operations.signOut(() => { setCompanyDraft(null); setState({ status: 'checking' }); });
    setState(result.success ? { status: 'signed_out' } : { status: 'unavailable', error: result.error });
    return result;
  };
  return <AccessContext.Provider value={{ state, companyDraft, restore, signIn, register, completeCompany, signOut }}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const value = useContext(AccessContext);
  if (!value) throw new Error('AccessProvider is required');
  return value;
}
