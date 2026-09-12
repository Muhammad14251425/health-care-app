/**
 * Bulk invoice download.
 *
 * Pick a date range, optionally a patient and a payment status, see what matches,
 * then take the lot as one PDF.
 *
 * PREVIEW BEFORE DOWNLOAD, deliberately: rendering eighty invoices takes real
 * time on the server, and being told "11 invoices, PKR 15,500" first means
 * nobody waits on a render they did not intend to ask for.
 *
 * Billing roles only -- the server refuses a physician, matching invoices.*.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { BackHeader, SectionHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/form/TextField';
import { FilterPillRow } from '@/components/ui/FilterPill';
import { StatCard, StatCardRow } from '@/components/ui/StatCard';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as runner from '@/api/reportRunner';
import { queryKeys } from '@/api/queryClient';
import { messageForError } from '@/api/errors';
import { shareDownload } from '@/utils/download';
import { formatCurrencyCompact } from '@/utils/currency';
import { formatDate, todayBackendDate } from '@/utils/date';
import { colors, spacing } from '@/theme';

type Status = 'all' | 'unpaid' | 'paid';

const STATUSES: ReadonlyArray<{ value: Status; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'paid', label: 'Paid' },
];

export default function BulkInvoicesScreen() {
  const toast = useToast();
  const today = todayBackendDate();

  const [fromDate, setFromDate] = useState(`${today.slice(0, 4)}-01-01`);
  const [toDate, setToDate] = useState(today);
  const [patient, setPatient] = useState('');
  const [status, setStatus] = useState<Status>('all');

  const filters = useMemo(
    () => ({
      from_date: fromDate,
      to_date: toDate,
      patient: patient.trim() || undefined,
      status,
    }),
    [fromDate, toDate, patient, status],
  );

  const preview = useQuery({
    queryKey: queryKeys.report('bulk-invoices', JSON.stringify(filters)),
    queryFn: () => runner.bulkInvoicePreview(filters),
    retry: false,
  });

  const download = useMutation({
    mutationFn: async () => {
      const payload = await runner.bulkInvoices({ ...filters, limit: 100 });
      await shareDownload(payload, `${payload.count} invoices`);
      return payload.count ?? 0;
    },
    onSuccess: (count) => toast.success(`${count} invoices ready to share`),
    onError: (error) => toast.error(messageForError(error)),
  });

  const data = preview.data;
  const nothing = (data?.count ?? 0) === 0;

  return (
    <Screen>
      <BackHeader title="Download invoices" subtitle="Several invoices as one PDF" />

      <SectionHeader title="Period" />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <TextField
            label="From"
            value={fromDate}
            onChangeText={setFromDate}
            placeholder="YYYY-MM-DD"
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            label="To"
            value={toDate}
            onChangeText={setToDate}
            placeholder="YYYY-MM-DD"
          />
        </View>
      </View>

      <SectionHeader title="Payment status" style={{ marginTop: spacing.sm }} />
      <FilterPillRow options={STATUSES} value={status} onChange={setStatus} />

      <View style={{ marginTop: spacing.lg }}>
        <TextField
          label="Patient (optional)"
          value={patient}
          onChangeText={setPatient}
          placeholder="Leave blank for every patient"
        />
      </View>

      <SectionHeader title="Matching invoices" style={{ marginTop: spacing.md }} />

      {preview.isPending ? (
        <SkeletonList count={2} />
      ) : preview.isError ? (
        <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
      ) : nothing ? (
        <EmptyState
          title="Nothing matches"
          message="No submitted invoices fall in that range. Drafts are never included."
        />
      ) : (
        <>
          <StatCardRow>
            <StatCard label="Invoices" value={data!.count} backgroundColor={colors.mint} />
            <StatCard
              label="Total"
              value={formatCurrencyCompact(data!.total, data!.currency ?? undefined)}
              backgroundColor={colors.paleYellow}
            />
            <StatCard
              label="Outstanding"
              value={formatCurrencyCompact(data!.outstanding, data!.currency ?? undefined)}
              backgroundColor={colors.peach}
            />
          </StatCardRow>

          {data!.capped ? (
            <Text variant="micro" muted style={{ marginTop: spacing.sm }}>
              More than 100 invoices match. The download takes the first 100 —
              narrow the dates to get the rest.
            </Text>
          ) : null}

          <Card style={{ marginTop: spacing.md }}>
            {data!.items.slice(0, 8).map((inv, i, arr) => (
              <View
                key={inv.name}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: spacing.sm,
                  borderBottomWidth: i === arr.length - 1 ? 0 : 1,
                  borderBottomColor: colors.line,
                  gap: spacing.md,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="bodySmall" numberOfLines={1}>
                    {inv.patient_name}
                  </Text>
                  <Text variant="micro" muted>
                    {formatDate(inv.posting_date)} · {inv.name}
                  </Text>
                </View>
                <Text variant="cardTitle">
                  {formatCurrencyCompact(inv.grand_total, inv.currency)}
                </Text>
              </View>
            ))}
            {data!.count > 8 ? (
              <Text variant="micro" muted style={{ marginTop: spacing.sm }} align="center">
                and {data!.count - 8} more
              </Text>
            ) : null}
          </Card>

          <Button
            label={`Download ${data!.count} invoice${data!.count === 1 ? '' : 's'}`}
            icon={<Download size={17} color={colors.white} strokeWidth={1.9} />}
            onPress={() => download.mutate()}
            loading={download.isPending}
            disabled={download.isPending}
            fullWidth
            style={{ marginTop: spacing.lg }}
          />
          <Text variant="micro" muted align="center" style={{ marginTop: spacing.sm }}>
            One PDF, each invoice on its own page.
          </Text>
        </>
      )}

      <View style={{ height: spacing.xxxl }} />
    </Screen>
  );
}
