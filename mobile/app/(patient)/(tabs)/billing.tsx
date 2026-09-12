/**
 * The patient's own invoices and balance.
 *
 * Read-only, deliberately. There is no "mark as paid", no payment entry, no way
 * to alter a total -- the backend exposes none of those to a patient, and the UI
 * does not pretend otherwise. Settling a bill happens at the clinic.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { HeroCard } from '@/components/ui/HeroCard';
import { StatusPill } from '@/components/ui/StatusPill';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { FilterPillRow } from '@/components/ui/FilterPill';
import { EmptyState, ErrorState, SkeletonHero, SkeletonList } from '@/components/ui/States';
import * as patientApi from '@/api/patient';
import type { InvoiceFilter } from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { formatCurrency } from '@/utils/currency';
import { formatDate } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';

const FILTERS: Array<{ value: InvoiceFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'paid', label: 'Paid' },
  { value: 'partial', label: 'Partial' },
];

export default function PatientBillingScreen() {
  const [filter, setFilter] = useState<InvoiceFilter>('all');

  const summary = useQuery({
    queryKey: queryKeys.patientBillingSummary,
    queryFn: patientApi.billingSummary,
  });

  const invoices = useQuery({
    queryKey: queryKeys.patientInvoices(filter),
    queryFn: () => patientApi.invoices(filter),
  });

  const items = invoices.data?.items ?? [];
  const currency = summary.data?.currency ?? 'PKR';

  return (
    <Screen
      withTabBar
      onRefresh={() => {
        void summary.refetch();
        void invoices.refetch();
      }}
      refreshing={invoices.isRefetching}
    >
      <ScreenHeader title="Billing" subtitle="Your invoices and balance" />

      <View style={{ marginTop: spacing.lg }}>
        {summary.isLoading ? (
          <SkeletonHero />
        ) : summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        ) : (
          <HeroCard
            label="Outstanding"
            value={formatCurrency(summary.data?.total_outstanding ?? 0, currency)}
            caption={
              (summary.data?.unpaid_count ?? 0) > 0
                ? `${summary.data?.unpaid_count} unpaid invoice${
                    summary.data?.unpaid_count === 1 ? '' : 's'
                  }`
                : 'Nothing due. You are all settled.'
            }
          />
        )}
      </View>

      {/* Paid / billed context under the hero. */}
      {summary.data ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <Card style={{ flex: 1 }}>
            <Text variant="micro" muted>
              Total billed
            </Text>
            <Text variant="body" style={{ marginTop: 2 }}>
              {formatCurrency(summary.data.total_billed, currency)}
            </Text>
          </Card>
          <Card style={{ flex: 1 }}>
            <Text variant="micro" muted>
              Total paid
            </Text>
            <Text variant="body" style={{ marginTop: 2 }}>
              {formatCurrency(summary.data.total_paid, currency)}
            </Text>
          </Card>
        </View>
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        <FilterPillRow options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      <View style={{ marginTop: spacing.lg }}>
        {invoices.isError ? (
          <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
        ) : invoices.isLoading ? (
          <SkeletonList count={3} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Receipt size={26} color={colors.green} strokeWidth={1.6} />}
            title={filter === 'all' ? 'No invoices' : 'Nothing here'}
            message={
              filter === 'all'
                ? 'Invoices from your visits will appear here.'
                : 'Try a different filter.'
            }
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {items.map((invoice) => (
              <Pressable
                key={invoice.name}
                onPress={() => router.push(`/(patient)/invoice/${invoice.name}`)}
                accessibilityRole="button"
                accessibilityLabel={`Invoice ${invoice.name}, ${formatCurrency(
                  invoice.grand_total,
                  invoice.currency,
                )}`}
              >
                <Card>
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: radius.md,
                        backgroundColor: colors.paleYellow,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Receipt size={18} color={colors.warning} strokeWidth={1.8} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="body" numberOfLines={1}>
                        {invoice.name}
                      </Text>
                      <Text variant="caption" muted>
                        {formatDate(invoice.posting_date)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text variant="body">
                        {formatCurrency(invoice.grand_total, invoice.currency)}
                      </Text>
                      <StatusPill status={invoice.payment_status} kind="invoice" />
                    </View>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}
