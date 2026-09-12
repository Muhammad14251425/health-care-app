/**
 * One place where every API failure becomes a message a patient-facing clinic
 * user can read.
 *
 * Rules:
 *   * Never surface a Frappe/Python traceback, SQL, or raw HTML.
 *   * Never surface an internal field name.
 *   * Always leave the caller able to branch on `code` (e.g. refresh slots on
 *     CONFLICT, route to login on UNAUTHENTICATED).
 */

import { ErrorCode, type ErrorCodeValue } from '@/types/api';

export class ApiError extends Error {
  readonly code: ErrorCodeValue;
  readonly httpStatus: number | null;
  /** Server-supplied message, kept for context-specific overrides. */
  readonly serverMessage: string | null;

  constructor(
    code: ErrorCodeValue,
    message: string,
    httpStatus: number | null = null,
    serverMessage: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.serverMessage = serverMessage;
  }

  get isAuthFailure(): boolean {
    return this.code === ErrorCode.UNAUTHENTICATED;
  }

  get isPermissionFailure(): boolean {
    return this.code === ErrorCode.FORBIDDEN;
  }

  get isConflict(): boolean {
    return this.code === ErrorCode.CONFLICT;
  }

  get isOffline(): boolean {
    return this.code === ErrorCode.NETWORK || this.code === ErrorCode.TIMEOUT;
  }
}

/** Fallback copy per error code. Deliberately plain and non-technical. */
const DEFAULT_MESSAGE: Record<ErrorCodeValue, string> = {
  [ErrorCode.UNAUTHENTICATED]: 'Your session has expired. Please sign in again.',
  [ErrorCode.FORBIDDEN]: 'You do not have permission to view this information.',
  [ErrorCode.NOT_FOUND]: 'We could not find what you were looking for.',
  [ErrorCode.VALIDATION]: 'Please check the details you entered.',
  [ErrorCode.CONFLICT]: 'That action conflicts with a recent change. Please try again.',
  [ErrorCode.RATE_LIMITED]: 'Too many requests. Please wait a moment and try again.',
  [ErrorCode.INTERNAL]: 'Something went wrong at our end. Please try again.',
  [ErrorCode.NETWORK]: 'No internet connection. Check your network and try again.',
  [ErrorCode.TIMEOUT]: 'The request took too long. Please try again.',
};

/**
 * A server message is safe to show only when it reads like guidance rather than
 * a stack trace. Anything with markup, a traceback marker or SQL is replaced.
 */
function isSafeToDisplay(message: string): boolean {
  if (!message || message.length > 220) return false;
  const unsafe = [
    /<[a-z/][^>]*>/i, // HTML
    /traceback/i,
    /File "\//,
    /\b(SELECT|INSERT|UPDATE|DELETE)\b .*\bFROM\b/i,
    /frappe\.|pymysql|MySQLdb|sqlalchemy/i,
    /line \d+, in /,
  ];
  return !unsafe.some((pattern) => pattern.test(message));
}

export function messageFor(code: ErrorCodeValue, serverMessage?: string | null): string {
  if (serverMessage && isSafeToDisplay(serverMessage)) return serverMessage;
  return DEFAULT_MESSAGE[code] ?? DEFAULT_MESSAGE[ErrorCode.INTERNAL];
}

/**
 * The message to show for any thrown value.
 *
 * ApiError messages are already sanitised (see messageFor); anything else is a
 * bug or a platform failure, and gets a neutral line rather than whatever text
 * the runtime happened to produce.
 */
export function messageForError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

export function toApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  if (cause instanceof Error && cause.name === 'AbortError') {
    return new ApiError(ErrorCode.TIMEOUT, DEFAULT_MESSAGE[ErrorCode.TIMEOUT]);
  }
  // fetch() rejects with a TypeError when the host is unreachable.
  return new ApiError(ErrorCode.NETWORK, DEFAULT_MESSAGE[ErrorCode.NETWORK]);
}
