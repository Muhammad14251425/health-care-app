/**
 * Invoice endpoints.
 *
 * Billing access is Admin/Reception, NOT doctors: a live probe showed a pure
 * Physician gets 403 (no `Sales Invoice` permission). Totals and statuses are
 * ERPNext's -- the app displays them and never recomputes them.
 */

import { callApi } from '@/api/client';
import type { Paged } from '@/types/api';
import type { Invoice, InvoiceDetail, Outstanding, PaymentStatus } from '@/types/domain';

export type ListInvoicesParams = {
  patient?: string;
  status?: PaymentStatus;
  limit?: number;
  start?: number;
};

export function listInvoices(params: ListInvoicesParams = {}): Promise<Paged<Invoice>> {
  return callApi<Paged<Invoice>>('invoices.list_invoices', {
    ...params,
    limit: params.limit ?? 50,
    start: params.start ?? 0,
  });
}

export function getInvoice(invoice: string): Promise<InvoiceDetail> {
  return callApi<InvoiceDetail>('invoices.get_invoice', { invoice });
}

export type CreateInvoicePayload = {
  patient: string;
  practitioner?: string;
  /** Omit to use the practitioner's configured consultation charge. */
  rate?: number;
  submit?: boolean;
};

export function createConsultationInvoice(
  payload: CreateInvoicePayload,
): Promise<InvoiceDetail> {
  return callApi<InvoiceDetail>('invoices.create_consultation_invoice', { payload });
}

export function submitInvoice(invoice: string): Promise<InvoiceDetail> {
  return callApi<InvoiceDetail>('invoices.submit_invoice', { invoice });
}

export type InvoicePdf = {
  invoice: string;
  filename: string;
  mime_type: string;
  encoding: 'base64';
  content: string;
  size: number;
};

/**
 * The invoice rendered as a PDF, base64-encoded.
 *
 * Base64 rather than a URL because the app authenticates with a session cookie,
 * not a browser session -- and the native share sheet needs the bytes on the
 * device regardless. Only submitted invoices can be shared; a draft is rejected
 * with VALIDATION.
 */
export function invoicePdf(invoice: string): Promise<InvoicePdf> {
  return callApi<InvoicePdf>('invoices.invoice_pdf', { invoice });
}

/**
 * Email the invoice PDF to the patient (billing staff only).
 *
 * Rejects with VALIDATION when the clinic has no outgoing Email Account or the
 * patient has no address on file -- callers should fall back to sharing.
 */
export function emailInvoice(
  invoice: string,
  recipient?: string,
): Promise<{ invoice: string; sent_to: string }> {
  return callApi('invoices.email_invoice', { invoice, recipient });
}

/**
 * Outstanding balance for one patient.
 *
 * `patient` is REQUIRED: the backend rejects a call without it with
 * 400 "Patient is required." There is no clinic-wide variant of this endpoint --
 * the dashboard totals its figures from listInvoices() instead.
 */
export function outstanding(patient: string): Promise<Outstanding> {
  return callApi<Outstanding>('invoices.outstanding', { patient });
}
