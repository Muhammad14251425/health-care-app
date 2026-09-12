/**
 * Secure storage for the session credential.
 *
 * The backend's token-issuing endpoint (auth.generate_token) is NOT implemented
 * yet -- see docs/06_KNOWN_LIMITATIONS.md. Until it exists, auth.login returns a
 * Frappe session id (`sid`) which we send back as a cookie.
 *
 * Either way the credential is bearer material, so it lives in expo-secure-store
 * (Keychain / Android Keystore), never AsyncStorage. `authHeaders()` is the only
 * place that decides how it is attached, so switching to
 * `Authorization: token <key>:<secret>` later is a one-function change.
 */

import * as SecureStore from 'expo-secure-store';

const SID_KEY = 'clinic.session.sid';
const USER_KEY = 'clinic.session.user';
const KIND_KEY = 'clinic.session.kind';

/**
 * Which app the stored session belongs to.
 *
 * Persisted so a cold start can route to the right navigator BEFORE the network
 * answers. It is a routing hint only -- the server still decides what the
 * session may read, so a tampered value grants nothing.
 */
export type SessionKind = 'staff' | 'patient';

export type StoredSession = {
  sid: string;
  user: string;
  kind: SessionKind;
};

export async function saveSession(session: StoredSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SID_KEY, session.sid),
    SecureStore.setItemAsync(USER_KEY, session.user),
    SecureStore.setItemAsync(KIND_KEY, session.kind),
  ]);
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const [sid, user, kind] = await Promise.all([
      SecureStore.getItemAsync(SID_KEY),
      SecureStore.getItemAsync(USER_KEY),
      SecureStore.getItemAsync(KIND_KEY),
    ]);
    if (!sid || !user) return null;
    // Sessions stored before the patient app existed have no kind; they can only
    // have been staff logins.
    return { sid, user, kind: kind === 'patient' ? 'patient' : 'staff' };
  } catch {
    // A corrupt keychain entry must not brick the app -- treat as signed out.
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SID_KEY).catch(() => undefined),
    SecureStore.deleteItemAsync(USER_KEY).catch(() => undefined),
    SecureStore.deleteItemAsync(KIND_KEY).catch(() => undefined),
  ]);
}

/** In-memory mirror so request building stays synchronous. */
let cachedSid: string | null = null;

export function setCachedSid(sid: string | null): void {
  cachedSid = sid;
}

export function getCachedSid(): string | null {
  return cachedSid;
}

export function authHeaders(): Record<string, string> {
  if (!cachedSid) return {};
  return { Cookie: `sid=${cachedSid}` };
}
