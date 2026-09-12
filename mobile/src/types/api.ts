/**
 * Wire types for the clinic_core API.
 *
 * Frappe wraps every whitelisted return value in a `message` key, so the raw
 * body is {"message": {success, data, error}}. Callers should never see that
 * shape -- the client unwraps it and returns `data` or throws ApiError.
 */

export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL_ERROR',
  /** Client-side only: request never reached the server. */
  NETWORK: 'NETWORK_ERROR',
  /** Client-side only: request exceeded the timeout. */
  TIMEOUT: 'TIMEOUT',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ApiEnvelope<T> = {
  message?: {
    success: boolean;
    data: T | null;
    message?: string | null;
    error?: { code: ErrorCodeValue; message: string };
  };
  /** Frappe's own error shape, used when an exception escapes the endpoint. */
  exc_type?: string;
  _server_messages?: string;
};

export type Paged<T> = {
  items: T[];
  total: number;
  limit?: number;
  start?: number;
};
