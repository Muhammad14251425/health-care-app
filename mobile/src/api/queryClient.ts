/**
 * TanStack Query configuration.
 *
 * Two deliberate choices for a clinical app:
 *   * Auth and permission failures are NEVER retried. Retrying a 401 is how you
 *     build a crash loop; retrying a 403 just repeats a refusal.
 *   * Mutations are not retried at all. Re-sending "record payment" or "book
 *     appointment" after an ambiguous failure risks a duplicate record.
 */

import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';
import { ErrorCode } from '@/types/api';

const NO_RETRY: ReadonlySet<string> = new Set([
  ErrorCode.UNAUTHENTICATED,
  ErrorCode.FORBIDDEN,
  ErrorCode.NOT_FOUND,
  ErrorCode.VALIDATION,
  ErrorCode.CONFLICT,
  ErrorCode.RATE_LIMITED,
]);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (error instanceof ApiError && NO_RETRY.has(error.code)) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        // Clinic data changes while you look at it; keep it fresh but not chatty.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Central key factory so invalidation never guesses at a key shape. */
export const queryKeys = {
  me: ['me'] as const,

  patients: (search?: string) => ['patients', { search: search ?? '' }] as const,
  patient: (id: string) => ['patient', id] as const,
  visitHistory: (id: string) => ['patient', id, 'history'] as const,

  appointments: (filters?: Record<string, unknown>) =>
    ['appointments', filters ?? {}] as const,
  appointment: (id: string) => ['appointment', id] as const,
  slots: (practitioner: string, date: string) => ['slots', practitioner, date] as const,

  practitioners: (department?: string) =>
    ['practitioners', department ?? 'all'] as const,
  practitioner: (id: string) => ['practitioner', id] as const,
  departments: ['departments'] as const,
  availability: (practitioner: string) => ['availability', practitioner] as const,

  encounters: (filters?: Record<string, unknown>) => ['encounters', filters ?? {}] as const,
  encounter: (id: string) => ['encounter', id] as const,

  invoices: (filters?: Record<string, unknown>) => ['invoices', filters ?? {}] as const,
  invoice: (id: string) => ['invoice', id] as const,

  // Reports are keyed by period so switching the filter refetches rather than
  // showing last period's figures under the new label.
  report: (name: string, period: string) => ['report', name, period] as const,
  outstanding: (patient?: string) => ['outstanding', patient ?? 'all'] as const,
  payments: (patient: string) => ['payments', patient] as const,

  // Patient account. Namespaced under 'patient' so the whole surface can be
  // dropped in one call if a targeted eviction is ever needed -- though sign-out
  // uses queryClient.clear(), which is the only safe option when a DIFFERENT
  // patient may sign in next.
  patientMe: ['patient', 'me'] as const,
  patientHome: ['patient', 'home'] as const,
  patientAppointments: (scope: string) => ['patient', 'appointments', scope] as const,
  patientAppointment: (id: string) => ['patient', 'appointment', id] as const,
  patientVisits: ['patient', 'visits'] as const,
  patientVisit: (id: string) => ['patient', 'visit', id] as const,
  patientPrescriptions: ['patient', 'prescriptions'] as const,
  patientDiagnostics: ['patient', 'diagnostics'] as const,
  patientDiagnostic: (id: string) => ['patient', 'diagnostic', id] as const,
  patientRecordsSummary: ['patient', 'records', 'summary'] as const,
  patientInvoices: (status: string) => ['patient', 'invoices', status] as const,
  patientInvoice: (id: string) => ['patient', 'invoice', id] as const,
  patientBillingSummary: ['patient', 'billing', 'summary'] as const,

  publicDepartments: ['public', 'departments'] as const,
  publicPractitioners: (department?: string) =>
    ['public', 'practitioners', department ?? 'all'] as const,
  publicDays: (practitioner: string) => ['public', 'days', practitioner] as const,
  publicSlots: (practitioner: string, date: string) =>
    ['public', 'slots', practitioner, date] as const,
} as const;
