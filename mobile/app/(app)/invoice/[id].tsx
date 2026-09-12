/**
 * Invoice detail + record payment + share.
 *
 * Marking an invoice paid is never a local field change: `record_payment` runs
 * ERPNext's own payment entry so ledgers stay correct. Overpayment is refused
 * server-side, and the form refuses it too rather than submitting something
 * certain to fail.
 *
 * Sharing fetches the PDF ERPNext itself renders (base64 over the API, since we
 * authenticate with a session cookie rather than a browser), writes it to the
 * cache directory and hands it to the OS share sheet. Only submitted invoices
 * can be shared -- the backend rejects drafts.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share2 } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { SummaryRow } from '@/components/ui/SummaryRow';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { FormInput } from '@/components/form/FormInput';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as invoicesApi from '@/api/invoices';
import * as paymentsApi from '@/api/payments';
import { queryKeys } from '@/api/queryClient';
import { ApiError } from '@/api/errors';
import { usePermissions } from '@/stores/auth';
import { formatCurrency, parseAmount } from '@/utils/currency';
import { formatDate } from '@/utils/date';
import { paymentSchema, type PaymentForm } from '@/validation/schemas';
import { colors, spacing } from '@/theme';

export default function InvoiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const invoiceId = decodeURIComponent(String(id ?? ''));

  const [sheetOpen, setSheetOpen] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.invoice(invoiceId),
    queryFn: () => invoicesApi.getInvoice(invoiceId),
    enabled: Boolean(invoiceId),
  });

  const invoice = query.data;
  const outstanding = invoice?.outstanding_amount ?? 0;

  const { control, handleSubmit, reset } = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema(outstanding)),
    defaultValues: { amount: '', reference_no: '' },
  });

  const paid = useMemo(
    () => (invoice ? invoice.grand_total - invoice.outstanding_amount : 0),
    [invoice],
  );

  const record = useMutation({
    mutationFn: (values: PaymentForm) =>
      paymentsApi.recordPayment({
        invoice: invoiceId,
        amount: parseAmount(values.amount) ?? undefined,
        reference_no: values.reference_no?.trim() || undefined,
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoice(invoiceId) }),
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['outstanding'] }),
      ]);
      setSheetOpen(false);
      reset({ amount: '', reference_no: '' });
      toast.success(
        result.fully_paid
          ? 'Invoice fully paid'
          : `Payment of ${formatCurrency(result.paid_amount)} recorded`,
      );
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not record the payment.',
      );
    },
  });

  const onSubmit = handleSubmit((values) => record.mutate(values));

  const share = useMutation({
    mutationFn: async () => {
      const pdf = await invoicesApi.invoicePdf(invoiceId);

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
    onError: (error) => {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Could not prepare the invoice for sharing.',
      );
    },
  });

  return (
    <Screen onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <BackHeader
        title="Invoice"
        subtitle={invoice?.name}
        right={
          invoice ? (
            <StatusPill status={invoice.payment_status} kind="invoice" />
          ) : undefined
        }
      />

      {query.isPending ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : invoice ? (
        <>
          <Card flush>
            <View style={{ paddingHorizontal: spacing.lg }}>
              <SummaryRow
                label="Patient"
                value={invoice.patient_name || invoice.patient}
                strong
              />
              <SummaryRow label="Date" value={formatDate(invoice.posting_date)} />
              {invoice.due_date ? (
                <SummaryRow label="Due" value={formatDate(invoice.due_date)} />
              ) : null}
              <SummaryRow label="Status" value={invoice.status} last />
            </View>
          </Card>

          {invoice.items && invoice.items.length > 0 ? (
            <Card flush style={{ marginTop: spacing.lg }}>
              <View style={{ paddingHorizontal: spacing.lg }}>
                <Text variant="label" muted style={{ paddingTop: spacing.md }}>
                  ITEMS
                </Text>
                {invoice.items.map((item, index) => (
                  <SummaryRow
                    key={`${item.item_name}-${index}`}
                    label={`${item.item_name}${item.qty > 1 ? ` × ${item.qty}` : ''}`}
                    value={formatCurrency(item.amount, invoice.currency)}
                    last={index === (invoice.items?.length ?? 0) - 1}
                  />
                ))}
              </View>
            </Card>
          ) : null}

          <Card flush style={{ marginTop: spacing.lg }}>
            <View style={{ paddingHorizontal: spacing.lg }}>
              <SummaryRow
                label="Total"
                value={formatCurrency(invoice.grand_total, invoice.currency)}
                strong
              />
              <SummaryRow
                label="Paid"
                value={formatCurrency(paid, invoice.currency)}
                valueColor={colors.success}
              />
              <SummaryRow
                label="Outstanding"
                value={formatCurrency(invoice.outstanding_amount, invoice.currency)}
                strong
                valueColor={outstanding > 0 ? colors.danger : colors.success}
                last
              />
            </View>
          </Card>

          {permissions.canRecordPayment && outstanding > 0 && invoice.docstatus === 1 ? (
            <View style={{ marginTop: spacing.xxl }}>
              <Button label="Record payment" onPress={() => setSheetOpen(true)} />
            </View>
          ) : outstanding === 0 ? (
            <Text variant="caption" muted align="center" style={{ marginTop: spacing.xl }}>
              This invoice is fully paid.
            </Text>
          ) : null}

          {/* A draft has no shareable PDF -- the backend refuses one, so do not
              offer the action until the invoice is submitted. */}
          {invoice.docstatus === 1 ? (
            <View style={{ marginTop: spacing.lg }}>
              <Button
                label="Share invoice"
                variant="secondary"
                icon={<Share2 size={18} color="#31523F" strokeWidth={1.8} />}
                onPress={() => share.mutate()}
                loading={share.isPending}
                disabled={share.isPending}
              />
            </View>
          ) : null}

          <BottomSheet
            visible={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title="Record payment"
          >
            <Text variant="caption" muted style={{ marginBottom: spacing.lg }}>
              Outstanding: {formatCurrency(outstanding, invoice.currency)}
            </Text>

            <FormInput
              control={control}
              name="amount"
              label="Amount"
              placeholder={String(outstanding)}
              type="number"
              hint="Partial payments are supported."
            />
            <FormInput
              control={control}
              name="reference_no"
              label="Reference (optional)"
              placeholder="Receipt or transaction number"
            />

            <Button
              label="Record payment"
              onPress={onSubmit}
              loading={record.isPending}
              disabled={record.isPending}
            />
          </BottomSheet>
        </>
      ) : null}
    </Screen>
  );
}
