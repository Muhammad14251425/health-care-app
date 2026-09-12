/**
 * One of the patient's own invoices.
 *
 * Read-only. There is no "pay now", no "mark as paid", and no way to change a
 * figure -- the backend exposes none of those to a patient, and pretending
 * otherwise in the UI would only produce a permission error. Sharing the PDF is
 * the one action available, because a patient having a copy of their own bill is
 * unambiguously theirs to do.
 */

import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share2 } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { BackHeader, SectionHeader } from '@/components/ui/ScreenHeader';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as patientApi from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { messageForError } from '@/api/errors';
import { formatCurrency } from '@/utils/currency';
import { formatDate, formatDateLong } from '@/utils/date';
import { colors, spacing, typography } from '@/theme';

export default function PatientInvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();

  const query = useQuery({
    queryKey: queryKeys.patientInvoice(id ?? ''),
    queryFn: () => patientApi.invoice(id!),
    enabled: Boolean(id),
  });

  const invoice = query.data;
  const currency = invoice?.currency ?? 'PKR';

  const share = useMutation({
    mutationFn: async () => {
      const pdf = await patientApi.invoicePdf(id!);

      // Sharing needs a real file on disk. The cache directory is correct here:
      // the OS may reclaim it, and the invoice can always be re-fetched.
      const file = new File(Paths.cache, pdf.filename);
      if (file.exists) file.delete();
      file.create();
      file.write(pdf.content, { encoding: 'base64' });

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device.');
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: pdf.mime_type,
        dialogTitle: `Invoice ${pdf.invoice}`,
        UTI: 'com.adobe.pdf',
      });
    },
    onError: (error) => toast.error(messageForError(error)),
  });

  return (
    <Screen onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <BackHeader title="Invoice" />

      {query.isError ? (
        <View style={{ marginTop: spacing.lg }}>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </View>
      ) : query.isLoading || !invoice ? (
        <SkeletonList count={4} />
      ) : (
        <>
          <Card style={{ marginTop: spacing.lg, alignItems: 'center' }}>
            <Text variant="caption" muted>
              {invoice.name}
            </Text>
            <Text style={[typography.display, { marginTop: spacing.xs }]}>
              {formatCurrency(invoice.grand_total, currency)}
            </Text>
            <Text variant="caption" muted style={{ marginTop: 2 }}>
              {formatDateLong(invoice.posting_date)}
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <StatusPill status={invoice.payment_status} kind="invoice" />
            </View>
          </Card>

          <SectionHeader title="Items" style={{ marginTop: spacing.xl }} />
          <Card flush>
            {invoice.items.map((item, index) => (
              <View
                key={`${item.item_name}-${index}`}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.lg,
                  borderBottomWidth: index === invoice.items.length - 1 ? 0 : 1,
                  borderBottomColor: colors.line,
                }}
              >
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text variant="caption">{item.item_name ?? 'Service'}</Text>
                  {item.qty > 1 ? (
                    <Text variant="micro" muted style={{ marginTop: 2 }}>
                      {item.qty} × {formatCurrency(item.rate, currency)}
                    </Text>
                  ) : null}
                </View>
                <Text variant="caption">{formatCurrency(item.amount, currency)}</Text>
              </View>
            ))}
          </Card>

          <SectionHeader title="Summary" style={{ marginTop: spacing.xl }} />
          <Card>
            <SummaryRow
              label="Total"
              value={formatCurrency(invoice.grand_total, currency)}
            />
            <SummaryRow
              label="Paid"
              value={formatCurrency(invoice.paid_amount, currency)}
            />
            <SummaryRow
              label="Outstanding"
              value={formatCurrency(invoice.outstanding_amount, currency)}
              strong
              last
            />
          </Card>

          {invoice.payments?.length ? (
            <>
              <SectionHeader title="Payments received" style={{ marginTop: spacing.xl }} />
              <Card flush>
                {invoice.payments.map((payment, index) => (
                  <View
                    key={index}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      paddingVertical: spacing.md,
                      paddingHorizontal: spacing.lg,
                      borderBottomWidth: index === invoice.payments.length - 1 ? 0 : 1,
                      borderBottomColor: colors.line,
                    }}
                  >
                    <Text variant="caption" muted>
                      {payment.date ? formatDate(payment.date) : '—'}
                      {payment.mode ? ` · ${payment.mode}` : ''}
                    </Text>
                    <Text variant="caption">
                      {formatCurrency(payment.amount, currency)}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          <Button
            label="Share invoice"
            variant="secondary"
            icon={<Share2 size={17} color={colors.green} strokeWidth={1.9} />}
            onPress={() => share.mutate()}
            loading={share.isPending}
            fullWidth
            style={{ marginTop: spacing.xl }}
          />

          {invoice.outstanding_amount > 0 ? (
            <Text variant="micro" muted style={{ marginTop: spacing.md }} align="center">
              Please settle any outstanding amount at the clinic reception.
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function SummaryRow({
  label,
  value,
  strong,
  last,
}: {
  label: string;
  value: string;
  strong?: boolean;
  last?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: spacing.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      }}
    >
      <Text variant="caption" muted={!strong}>
        {label}
      </Text>
      <Text variant={strong ? 'body' : 'caption'}>{value}</Text>
    </View>
  );
}
