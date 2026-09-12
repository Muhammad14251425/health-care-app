/** Authentication endpoints. */

import { callApi } from '@/api/client';
import type { CurrentUser, LoginResult } from '@/types/domain';

export function login(usr: string, pwd: string): Promise<LoginResult> {
  // `anonymous` because a stale cookie must not interfere with a fresh sign-in.
  return callApi<LoginResult>('auth.login', { usr, pwd }, { anonymous: true });
}

export function me(): Promise<CurrentUser> {
  return callApi<CurrentUser>('auth.me');
}

export function logout(): Promise<null> {
  return callApi<null>('auth.logout');
}

export function sessionValid(): Promise<{ valid: boolean; user: string }> {
  return callApi<{ valid: boolean; user: string }>('auth.session_valid');
}
