/**
 * Patient phone + OTP authentication.
 *
 * The backend decides everything that matters here: which patient a verified
 * number belongs to, whether the account needs registering, and whether a code
 * is valid. This module only moves values.
 *
 * Note what is NOT here: no patient id is ever sent, and none of these calls
 * accept one. The session is the identity.
 */

import { callApi, callPublicApi } from '@/api/client';
import type { PatientProfile, PatientSession } from '@/types/patient';

export type OtpRequestResult = {
  /**
   * The request was accepted. NOT a promise that a message reached the handset --
   * the server deliberately reports the same thing either way, so this value
   * cannot be used to probe which numbers exist.
   */
  sent: boolean;
  /** Masked/prettified echo of the number the SERVER parsed, e.g. "+92 300 1234567". */
  phone: string;
  expires_in: number;
  /** Seconds until a resend is accepted -- drives the countdown. */
  resend_in: number;
  /**
   * Present ONLY when the backend runs with developer_mode on. It says which
   * transport actually ran, so the UI can avoid claiming an SMS was sent when
   * the console provider merely printed the code to the server log.
   */
  dev?: {
    channel: 'console' | 'null' | 'sms' | 'whatsapp' | null;
    delivered_to_device: boolean;
  };
};

/**
 * Ask for a login code.
 *
 * Always resolves for a well-formed number, whether or not it belongs to a
 * patient -- the backend deliberately does not say, so the UI must not either.
 */
export function requestOtp(phoneNumber: string): Promise<OtpRequestResult> {
  return callPublicApi<OtpRequestResult>('patient_auth.request_otp', {
    phone_number: phoneNumber,
  });
}

/** Verify a code and receive a session. */
export function verifyOtp(phoneNumber: string, otp: string): Promise<PatientSession> {
  return callPublicApi<PatientSession>('patient_auth.verify_otp', {
    phone_number: phoneNumber,
    otp,
  });
}

/** Complete first-time setup when a verified number has no patient record. */
export function register(input: {
  full_name: string;
  gender?: string;
  dob?: string | null;
  email?: string | null;
}): Promise<PatientProfile> {
  return callApi<PatientProfile>('patient_auth.register', { payload: input });
}

export function logout(): Promise<{ logged_out: boolean }> {
  return callApi<{ logged_out: boolean }>('patient_auth.logout');
}

export function sessionValid(): Promise<{ valid: boolean; user: string; patient: string | null }> {
  return callApi('patient_auth.session_valid');
}

/** Step 1 of changing the login number: send a code to the NEW number. */
export function requestPhoneChange(newPhone: string): Promise<OtpRequestResult> {
  return callApi<OtpRequestResult>('patient_auth.request_phone_change', {
    new_phone: newPhone,
  });
}

/** Step 2: prove control of the new number, then the mapping moves. */
export function confirmPhoneChange(
  newPhone: string,
  otp: string,
): Promise<{ phone: string; updated: boolean }> {
  return callApi('patient_auth.confirm_phone_change', { new_phone: newPhone, otp });
}
