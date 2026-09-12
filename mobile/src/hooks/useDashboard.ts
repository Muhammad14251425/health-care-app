/**
 * Dashboard data.
 *
 * Every number on the home screen comes from a real backend query -- there are
 * no placeholder counts. Where a role cannot read a source (a doctor cannot read
 * invoices), the query is disabled rather than fired and failed.
 */

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import * as appointmentsApi from '@/api/appointments';
import * as invoicesApi from '@/api/invoices';
import { queryKeys } from '@/api/queryClient';
import { todayBackendDate } from '@/utils/date';
import type { Appointment } from '@/types/domain';
import { usePermissions } from '@/stores/auth';

export type DashboardCounts = {
  total: number;
  waiting: number;
  completed: number;
  upcoming: number;
};

export function summarise(appointments: Appointment[]): DashboardCounts {
  let waiting = 0;
  let completed = 0;
  let upcoming = 0;

  for (const appointment of appointments) {
    switch (appointment.status) {
      case 'Checked In':
      case 'Open':
        waiting += 1;
        break;
      case 'Closed':
        completed += 1;
        break;
      case 'Scheduled':
        upcoming += 1;
        break;
      default:
        // Cancelled / No Show are counted in the total but in no bucket.
        break;
    }
  }

  return { total: appointments.length, waiting, completed, upcoming };
}

export function useDashboard() {
  const today = todayBackendDate();
  const { canViewBilling } = usePermissions();

  const [todayQuery, billingQuery] = useQueries({
    queries: [
      {
        queryKey: queryKeys.appointments({ date: today }),
        queryFn: () =>
          appointmentsApi.listAppointments({
            from_date: today,
            to_date: today,
            limit: 200,
          }),
      },
      {
        queryKey: queryKeys.outstanding(),
        queryFn: () => invoicesApi.listInvoices({ limit: 200 }),
        enabled: canViewBilling,
      },
    ],
  });

  const appointments = todayQuery.data?.items ?? [];
  const counts = useMemo(() => summarise(appointments), [appointments]);

  const billing = useMemo(() => {
    const invoices = billingQuery.data?.items ?? [];
    const todayInvoices = invoices.filter((invoice) => invoice.posting_date === today);

    // "Collected today" is what today's invoices have actually been paid, i.e.
    // total minus what is still outstanding on them.
    const collectedToday = todayInvoices.reduce(
      (sum, invoice) => sum + (invoice.grand_total - invoice.outstanding_amount),
      0,
    );
    const outstanding = invoices.reduce(
      (sum, invoice) => sum + invoice.outstanding_amount,
      0,
    );
    const unpaidCount = invoices.filter(
      (invoice) => invoice.payment_status === 'unpaid' || invoice.payment_status === 'partially_paid',
    ).length;

    return { collectedToday, outstanding, unpaidCount, currency: invoices[0]?.currency };
  }, [billingQuery.data, today]);

  return {
    today,
    appointments,
    counts,
    billing,
    isPending: todayQuery.isPending,
    isError: todayQuery.isError,
    error: todayQuery.error,
    billingAvailable: canViewBilling && !billingQuery.isError,
    refetch: async () => {
      await Promise.all([todayQuery.refetch(), canViewBilling ? billingQuery.refetch() : null]);
    },
    isRefetching: todayQuery.isRefetching,
  };
}
