/**
 * Reporting endpoints.
 *
 * These are clinic_core's own, not ERPNext's ~200 desk reports: those return a
 * spreadsheet grid that is unreadable on a phone and each takes a different,
 * undocumented filter set. The desk reports remain at /app/report for anyone
 * who wants the grid.
 *
 * Revenue is billing data and follows the same rule as invoices.*: a pure
 * Physician gets 403 from `revenue`, and `overview` simply omits the revenue
 * block for them rather than returning an empty money card.
 */

import { callApi } from '@/api/client';

/** Named periods, not free dates: two date pickers on a phone is a chore. */
export type ReportPeriod = 'today' | 'week' | 'month' | 'quarter' | 'year';

export const PERIOD_LABELS: ReadonlyArray<{ value: ReportPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
  { value: 'quarter', label: '3 months' },
  { value: 'year', label: '12 months' },
];

export type RevenueTotals = {
  invoices: number;
  billed: number;
  collected: number;
  outstanding: number;
  currency: string;
};

export type Overview = {
  period: ReportPeriod;
  from_date: string;
  to_date: string;
  appointments: {
    total: number;
    attended: number;
    cancelled: number;
    no_show: number;
    scheduled: number;
    cancellation_rate: number;
    no_show_rate: number;
  };
  encounters: number;
  new_patients: number;
  /** Absent for roles without billing access -- check before rendering. */
  revenue?: RevenueTotals;
};

export type TrendPoint = { date: string; count: number };

export type AppointmentsTrend = {
  period: ReportPeriod;
  from_date: string;
  to_date: string;
  /** Gap-filled: quiet days are present with count 0, so the chart is honest. */
  series: TrendPoint[];
  total: number;
  peak: number;
};

export type PractitionerStats = {
  practitioner: string;
  practitioner_name: string;
  appointments: number;
  attended: number;
  cancelled: number;
  encounters: number;
};

export type ByPractitioner = {
  period: ReportPeriod;
  from_date: string;
  to_date: string;
  items: PractitionerStats[];
};

export type RevenuePoint = { date: string; billed: number; collected: number };

export type Debtor = {
  patient: string;
  patient_name: string;
  due: number;
  invoices: number;
};

export type RevenueReport = {
  period: ReportPeriod;
  from_date: string;
  to_date: string;
  totals: RevenueTotals;
  series: RevenuePoint[];
  outstanding_by_patient: Debtor[];
};

export type DiagnosisCount = { diagnosis: string; count: number };

export type TopDiagnoses = {
  period: ReportPeriod;
  from_date: string;
  to_date: string;
  items: DiagnosisCount[];
};

export function overview(period: ReportPeriod): Promise<Overview> {
  return callApi<Overview>('reports.overview', { payload: { period } });
}

export function appointmentsTrend(period: ReportPeriod): Promise<AppointmentsTrend> {
  return callApi<AppointmentsTrend>('reports.appointments_trend', { payload: { period } });
}

export function byPractitioner(period: ReportPeriod): Promise<ByPractitioner> {
  return callApi<ByPractitioner>('reports.by_practitioner', { payload: { period } });
}

export function revenue(period: ReportPeriod): Promise<RevenueReport> {
  return callApi<RevenueReport>('reports.revenue', { payload: { period } });
}

export function topDiagnoses(period: ReportPeriod): Promise<TopDiagnoses> {
  return callApi<TopDiagnoses>('reports.top_diagnoses', { payload: { period } });
}
