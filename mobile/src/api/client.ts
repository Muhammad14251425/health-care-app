/**
 * The single HTTP entry point for the whole app.
 *
 * Responsibilities:
 *   * build the dotted clinic_core path (a slash after `v1` yields a bare
 *     AttributeError from Frappe, which looks exactly like a broken backend)
 *   * unwrap Frappe's {"message": {...}} envelope
 *   * turn every failure into an ApiError with a safe, user-readable message
 *   * attach the stored session credential
 *   * notify the auth layer once when a session goes stale -- no retry loop
 *
 * Screens never call fetch directly; they call src/api/<module>.ts.
 */

import { env } from '@/config/env';
import { ApiError, messageFor, toApiError } from '@/api/errors';
import { authHeaders } from '@/api/session';
import { ErrorCode, type ApiEnvelope, type ErrorCodeValue } from '@/types/api';

/** Set by the auth provider so a 401 can clear state exactly once. */
let onUnauthenticated: (() => void) | null = null;

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

const HTTP_TO_CODE: Record<number, ErrorCodeValue> = {
  400: ErrorCode.VALIDATION,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  417: ErrorCode.INTERNAL,
  429: ErrorCode.RATE_LIMITED,
  500: ErrorCode.INTERNAL,
};

export type RequestOptions = {
  /** Skip attaching the session -- used by the public booking endpoints. */
  anonymous?: boolean;
  signal?: AbortSignal;
};

/**
 * Call a clinic_core endpoint.
 *
 * @param method dotted path after the prefix, e.g. "patients.list_patients"
 *               or "public.booking.create"
 */
export async function callApi<T>(
  method: string,
  params: Record<string, unknown> = {},
  options: RequestOptions = {},
): Promise<T> {
  const url = `${env.apiBaseUrl}${env.apiPrefix}.${method}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.requestTimeoutMs);

  // If the caller passed its own signal (React Query cancellation), honour both.
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.anonymous ? {} : authHeaders()),
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
  } catch (cause) {
    throw toApiError(cause);
  } finally {
    clearTimeout(timeout);
  }

  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // A non-JSON body means we hit something other than the API (a proxy error
    // page, an HTML login redirect). Never show that content to the user.
    throw new ApiError(
      HTTP_TO_CODE[response.status] ?? ErrorCode.INTERNAL,
      messageFor(HTTP_TO_CODE[response.status] ?? ErrorCode.INTERNAL),
      response.status,
    );
  }

  const envelope = body?.message;

  // The documented error shape.
  if (envelope && envelope.success === false) {
    const code = (envelope.error?.code ?? ErrorCode.INTERNAL) as ErrorCodeValue;
    const error = new ApiError(
      code,
      messageFor(code, envelope.error?.message),
      response.status,
      envelope.error?.message ?? null,
    );
    if (error.isAuthFailure) onUnauthenticated?.();
    throw error;
  }

  // An exception escaped the endpoint (or the path was wrong): Frappe returns
  // exc_type / _server_messages instead of our envelope.
  if (!envelope || typeof envelope.success !== 'boolean') {
    const code = HTTP_TO_CODE[response.status] ?? ErrorCode.INTERNAL;
    const error = new ApiError(code, messageFor(code), response.status);
    if (error.isAuthFailure) onUnauthenticated?.();
    throw error;
  }

  if (!response.ok) {
    const code = HTTP_TO_CODE[response.status] ?? ErrorCode.INTERNAL;
    throw new ApiError(code, messageFor(code), response.status);
  }

  return (envelope.data ?? null) as T;
}

/** Public (guest) endpoints -- never attach a session. */
export function callPublicApi<T>(
  method: string,
  params: Record<string, unknown> = {},
  options: Omit<RequestOptions, 'anonymous'> = {},
): Promise<T> {
  return callApi<T>(method, params, { ...options, anonymous: true });
}
