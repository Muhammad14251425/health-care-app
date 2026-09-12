/**
 * Billing.
 *
 * Reachable only for roles the backend actually grants invoice access to; a
 * doctor sees the Activity tab in this slot instead. If someone arrives here
 * anyway, the 403 renders as a clean permission message rather than a crash.
 */

import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { ScreenHeader, BackHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FilterPillRow } from '@/components/ui/FilterPill';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { InvoiceCard } from '@/components/clinic/InvoiceCard';
import * as invoicesApi from '@/api/invoices';
import { queryKeys } from '@/api/queryClient';
import { usePermissions } from '@/stores/auth';
import { formatCurrencyCompact } from '@/utils/currency';
import { todayBackendDate } from '@/utils/date';
import { colors, radius, screenPadding, shadows, spacing, tabBarClearance } from '@/theme';
import type { Invoice } from '@/types/domain';

type Filter = 'all' | 'unpaid' | 'partially_paid' | 'paid';

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partially_paid', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
];

type BillingScreenProps = {
  /**
   * Render this patient's invoices only. Passed by the patient drill-down route
   * (`patient/[id]/invoices`), which reuses this screen rather than duplicating
   * the list. Absent when this is the Billing tab.
   */
  patientOverride?: string;
};

export default function BillingScreen({ patientOverride }: BillingScreenProps = {}) {
  const router = useRouter();
  const permissions = usePermissions();
  const [filter, setFilter] = useState<Filter>('all');
  const today = todayBackendDate();

  // Scoping to one patient means "Invoices" on a profile shows that patient's
  // ledger instead of dropping the user into the whole clinic's and making them
  // find the patient again -- the profile already knew who it was. Filtering
  // happens SERVER-side so the cap of 200 cannot hide a patient's older invoices
  // behind other patients' newer ones.
  const params = useLocalSearchParams<{ patient?: string }>();
  const routePatient = params.patient ? decodeURIComponent(params.patient) : undefined;
  const patient = patientOverride ?? routePatient;
  const scoped = Boolean(patient);

  const query = useQuery({
    queryKey: queryKeys.invoices({ scope: patient ?? 'all' }),
    queryFn: () => invoicesApi.listInvoices({ patient, limit: 200 }),
  });

  const invoices = useMemo(() => query.data?.items ?? [], [query.data]);

  const summary = useMemo(() => {
    // Money totals count SUBMITTED invoices only. The list deliberately includes
    // drafts so staff can see them, but a draft posts nothing to the general
    // ledger: its outstanding_amount is not owed, and `grand_total -
    // outstanding` on a draft is zero-minus-nothing, not cash taken.
    const posted = invoices.filter((invoice) => invoice.docstatus === 1);
    const collectedToday = posted
      .filter((invoice) => invoice.posting_date === today)
      .reduce((sum, invoice) => sum + (invoice.grand_total - invoice.outstanding_amount), 0);
    const outstanding = posted.reduce((sum, i) => sum + i.outstanding_amount, 0);
    return { collectedToday, outstanding, currency: invoices[0]?.currency };
  }, [invoices, today]);

  const visible = useMemo(
    () =>
      filter === 'all'
        ? invoices
        : invoices.filter((invoice) => invoice.payment_status === filter),
    [invoices, filter],
  );

  const renderItem = ({ item }: { item: Invoice }) => (
    <InvoiceCard
      invoice={item}
      // Every row here is the same patient when scoped, so their name would be
      // repeated on each card instead of the invoice number.
      hidePatient={scoped}
      onPress={() => router.push(`/(app)/invoice/${encodeURIComponent(item.name)}`)}
    />
  );

  // Shared by both headers: a scoped view still needs a way to raise an invoice,
  // and here it can carry the patient straight into the form.
  const newInvoiceButton = permissions.canCreateInvoice ? (
    <Pressable
      onPress={() =>
        router.push(
          scoped
            ? `/(app)/invoice/new?patient=${encodeURIComponent(patient!)}`
            : '/(app)/invoice/new',
        )
      }
      accessibilityRole="button"
      accessibilityLabel="New invoice"
      style={{
        width: 44,
        height: 44,
        borderRadius: radius.pill,
        backgroundColor: colors.green,
        alignItems: 'center',
        justifyContent: 'center',
        ...shadows.raised,
      }}
    >
      <Plus size={21} color={colors.gold} strokeWidth={2.4} />
    </Pressable>
  ) : undefined;

  return (
    // A scoped view is pushed over the tabs, so it must not reserve tab-bar space.
    <Screen scroll={false} withTabBar={!scoped} padded={false}>
      <View style={{ paddingHorizontal: screenPadding }}>
        {scoped ? (
          // Scoped to one patient: this is a drill-down, not the tab, so it gets
          // a way back and names whose invoices these are.
          <BackHeader title="Invoices" subtitle={patient} right={newInvoiceButton} />
        ) : (
          <ScreenHeader
            title="Billing"
            subtitle={`${invoices.length} invoices`}
            right={newInvoiceButton}
          />
        )}

        {/* Clinic-wide takings are meaningless on a single patient's ledger. */}
        {!query.isError && !scoped ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1 }}>
                <Text variant="micro" muted>
                  Collected today
                </Text>
                <Text variant="heading3" style={{ marginTop: 4 }}>
                  {formatCurrencyCompact(summary.collectedToday, summary.currency)}
                </Text>
              </View>
              <View
                style={{ width: 1, backgroundColor: colors.line, marginHorizontal: spacing.lg }}
              />
              <View style={{ flex: 1 }}>
                <Text variant="micro" muted>
                  Outstanding
                </Text>
                <Text variant="heading3" style={{ marginTop: 4 }}>
                  {formatCurrencyCompact(summary.outstanding, summary.currency)}
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        <View style={{ marginBottom: spacing.lg }}>
          <FilterPillRow options={FILTERS} value={filter} onChange={setFilter} />
        </View>
      </View>

      {query.isPending ? (
        <View style={{ paddingHorizontal: screenPadding }}>
          <SkeletonList count={5} />
        </View>
      ) : query.isError ? (
        <View style={{ paddingHorizontal: screenPadding }}>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.name}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: screenPadding,
            paddingBottom: scoped ? spacing.xxxl : tabBarClearance,
          }}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          ListEmptyComponent={
            <EmptyState
              title={filter === 'unpaid' ? 'Nothing unpaid' : 'No invoices'}
              message={
                filter === 'unpaid'
                  ? 'Everything is paid.'
                  : scoped
                    ? `${patient} has no invoices yet.`
                    : 'Invoices you create will appear here.'
              }
            />
          }
        />
      )}
    </Screen>
  );
}
