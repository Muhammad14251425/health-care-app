/**
 * Invoice row. Shows the amount due rather than the total when something is
 * outstanding -- that is the number the desk actually acts on.
 */

import { Pressable, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { StatusPill } from '@/components/ui/StatusPill';
import { currencySymbol, formatCurrency } from '@/utils/currency';
import { formatDate } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';
import type { Invoice } from '@/types/domain';

export type InvoiceCardProps = {
  invoice: Invoice;
  onPress?: () => void;
  /**
   * Hide the patient name. Set when every row on screen belongs to the same
   * patient -- their own invoice list -- where repeating the name on each card
   * says nothing and pushes the useful identifier (the invoice number) into
   * small grey subtitle text.
   */
  hidePatient?: boolean;
};

export function InvoiceCard({ invoice, onPress, hidePatient }: InvoiceCardProps) {
  const due = invoice.outstanding_amount > 0;

  const body = (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: radius.md,
            backgroundColor: due ? colors.peach : colors.mint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Resolve through the shared table, not by slicing the code: a
              hand-rolled mapping renders "IN" for INR and "US" for USD, and it
              is a second source of truth that drifts from formatCurrency(). */}
          <Text variant="micro" color={due ? colors.brown : colors.green} style={{ fontSize: 13 }}>
            {currencySymbol(invoice.currency ?? undefined)}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          {hidePatient ? (
            // The invoice number becomes the identifier, since the patient is
            // already established by the screen this list sits on.
            <>
              <Text variant="cardTitle" numberOfLines={1}>
                {invoice.name}
              </Text>
              <Text variant="caption" muted numberOfLines={1} style={{ marginTop: 2 }}>
                {formatDate(invoice.posting_date)}
              </Text>
            </>
          ) : (
            <>
              <Text variant="cardTitle" numberOfLines={1}>
                {invoice.patient_name || invoice.patient}
              </Text>
              <Text variant="caption" muted numberOfLines={1} style={{ marginTop: 2 }}>
                {invoice.name} · {formatDate(invoice.posting_date)}
              </Text>
            </>
          )}
        </View>

        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <Text variant="cardTitle">
            {formatCurrency(
              due ? invoice.outstanding_amount : invoice.grand_total,
              invoice.currency,
            )}
          </Text>
          <StatusPill status={invoice.payment_status} kind="invoice" />
        </View>
      </View>
    </Card>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        hidePatient
          ? `Invoice ${invoice.name}`
          : `Invoice ${invoice.name} for ${invoice.patient_name}`
      }
    >
      {body}
    </Pressable>
  );
}
