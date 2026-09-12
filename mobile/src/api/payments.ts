/**
 * Payment endpoints.
 *
 * Marking an invoice paid is never a frontend field change: record_payment goes
 * through ERPNext's own payment entry so GL entries and party balances stay
 * correct. Overpayment is refused server-side (VALIDATION_ERROR), and paying an
 * already-settled invoice returns CONFLICT.
 */

import { callApi } from '@/api/client';
import type { Paged } from '@/types/api';
import type { Payment, PaymentResult } from '@/types/domain';

export function paymentHistory(patient: string, limit = 50): Promise<Paged<Payment>> {
  return callApi<Paged<Payment>>('payments.payment_history', { patient, limit });
}

export type RecordPaymentPayload = {
  invoice: string;
  /** Omit to settle the full outstanding balance. */
  amount?: number;
  mode_of_payment?: string;
  reference_no?: string;
};

export function recordPayment(payload: RecordPaymentPayload): Promise<PaymentResult> {
  return callApi<PaymentResult>('payments.record_payment', { payload });
}
