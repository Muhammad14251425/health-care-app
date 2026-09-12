/**
 * Authentication state for BOTH audiences: staff (username + password) and
 * patients (phone + OTP).
 *
 * Flow:
 *   launch -> restore credential from SecureStore -> confirm it with the server
 *   -> route by persona; anything else -> the public welcome screen.
 *
 * Two rules that are load-bearing:
 *
 *   1. A stored credential proves nothing. It is always re-confirmed against the
 *      server before the user is treated as signed in.
 *   2. Signing out CLEARS THE QUERY CACHE. React Query would otherwise hand the
 *      next user the previous user's cached rows -- with two patients on one
 *      phone that is a medical-records leak, not a cosmetic bug. This is
 *      exercised by the cache-isolation test in PATIENT_SECURITY_TESTS.md.
 *
 * A 401 from any request calls `handleUnauthenticated` exactly once, which
 * clears state and lets the router redirect. There is no retry: re-issuing a
 * request that just failed authentication is how crash loops start.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as authApi from '@/api/auth';
import * as patientAuthApi from '@/api/patientAuth';
import { setUnauthenticatedHandler } from '@/api/client';
import {
  clearSession,
  loadSession,
  saveSession,
  setCachedSid,
  type SessionKind,
} from '@/api/session';
import { derivePermissions, type Permissions } from '@/utils/permissions';
import type { CurrentUser } from '@/types/domain';
import type { PatientSession } from '@/types/patient';

type AuthState = {
  /** True until the stored session has been checked -- gates the first render. */
  initialising: boolean;
  user: CurrentUser | null;
  permissions: Permissions;
  /** Which app this session belongs to. Drives the top-level route split. */
  kind: SessionKind | null;
  /** True when a patient verified their phone but has no Patient record yet. */
  needsRegistration: boolean;

  signIn: (usr: string, pwd: string) => Promise<CurrentUser>;
  /** Completes a patient OTP sign-in with the session the server just issued. */
  signInWithPatientSession: (session: PatientSession) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/** Shape a patient session into the CurrentUser the rest of the app expects. */
function patientToCurrentUser(session: PatientSession): CurrentUser {
  return {
    user: session.user,
    full_name: session.patient_name ?? session.full_name ?? '',
    roles: session.roles ?? [],
    persona: 'patient',
    patient: session.patient,
    practitioner: null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialising, setInitialising] = useState(true);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [kind, setKind] = useState<SessionKind | null>(null);
  const [needsRegistration, setNeedsRegistration] = useState(false);
  const queryClient = useQueryClient();

  // Guards against several in-flight 401s each clearing state.
  const clearing = useRef(false);

  const clearLocalSession = useCallback(async () => {
    setCachedSid(null);
    setUser(null);
    setKind(null);
    setNeedsRegistration(false);
    await clearSession();
    // MUST stay last and MUST NOT be made conditional: this is what stops the
    // next account seeing the previous account's data.
    queryClient.clear();
  }, [queryClient]);

  const handleUnauthenticated = useCallback(() => {
    if (clearing.current) return;
    clearing.current = true;
    void clearLocalSession().finally(() => {
      clearing.current = false;
    });
  }, [clearLocalSession]);

  // Register before the first request can fire.
  useEffect(() => {
    setUnauthenticatedHandler(handleUnauthenticated);
    return () => setUnauthenticatedHandler(null);
  }, [handleUnauthenticated]);

  // Restore on launch.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stored = await loadSession();
        if (!stored) return;

        setCachedSid(stored.sid);

        if (stored.kind === 'patient') {
          // Confirm with the server, and pick up the patient link in case the
          // account was registered or re-linked since the last launch.
          const probe = await patientAuthApi.sessionValid();
          if (cancelled) return;
          if (!probe?.valid) {
            await clearLocalSession();
            return;
          }
          const profile = await authApi.me();
          if (cancelled) return;
          setUser({ ...profile, persona: 'patient' });
          setKind('patient');
          setNeedsRegistration(!probe.patient);
        } else {
          const current = await authApi.me();
          if (cancelled) return;
          setUser(current);
          setKind('staff');
        }
      } catch {
        // Expired or rejected -- start signed out, without surfacing an error.
        await clearLocalSession();
      } finally {
        if (!cancelled) setInitialising(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearLocalSession]);

  const signIn = useCallback(
    async (usr: string, pwd: string) => {
      // A previous patient's cached data must never survive into a staff
      // session (or vice versa), so clear before adopting the new identity.
      queryClient.clear();

      const result = await authApi.login(usr, pwd);
      setCachedSid(result.sid);
      await saveSession({ sid: result.sid, user: result.user, kind: 'staff' });

      const { sid: _sid, ...profile } = result;
      setUser(profile);
      setKind('staff');
      setNeedsRegistration(false);
      return profile;
    },
    [queryClient],
  );

  const signInWithPatientSession = useCallback(
    async (session: PatientSession) => {
      queryClient.clear();

      setCachedSid(session.sid);
      await saveSession({ sid: session.sid, user: session.user, kind: 'patient' });

      setUser(patientToCurrentUser(session));
      setKind('patient');
      setNeedsRegistration(Boolean(session.needs_registration));
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      // Ask the right endpoint to kill the session server-side. Either way the
      // local credential goes -- a failed network call must not strand a user
      // in a signed-in-looking state.
      if (kind === 'patient') await patientAuthApi.logout();
      else await authApi.logout();
    } catch {
      // Intentionally ignored; local teardown below is what matters.
    }
    await clearLocalSession();
  }, [clearLocalSession, kind]);

  const refresh = useCallback(async () => {
    const current = await authApi.me();
    setUser(kind === 'patient' ? { ...current, persona: 'patient' } : current);
    if (kind === 'patient') setNeedsRegistration(!current.patient);
  }, [kind]);

  const value = useMemo<AuthState>(
    () => ({
      initialising,
      user,
      permissions: derivePermissions(user),
      kind,
      needsRegistration,
      signIn,
      signInWithPatientSession,
      signOut,
      refresh,
    }),
    [
      initialising,
      user,
      kind,
      needsRegistration,
      signIn,
      signInWithPatientSession,
      signOut,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Convenience for the many screens that only need the permission flags. */
export function usePermissions(): Permissions {
  return useAuth().permissions;
}
