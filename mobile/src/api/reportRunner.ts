/**
 * Generic report runner: any of the clinic's ~82 desk reports, plus downloads.
 *
 * This is the counterpart to `reports.ts`. That one returns a few figures shaped
 * for a phone; this one runs ERPNext's own reports, which are spreadsheets --
 * Sales Register is 24 columns. The viewer renders them in a scrollable grid,
 * and the CSV/PDF export exists because a 24-column grid is for checking, not
 * for analysis.
 *
 * Downloads arrive base64 and are written to the cache directory before being
 * handed to the share sheet -- the same path the invoice PDF already uses.
 */

import { callApi } from '@/api/client';

export type ReportSummary = {
  name: string;
  module: string;
  report_type: string;
  ref_doctype: string | null;
};

export type ReportListing = {
  items: ReportSummary[];
  total: number;
  /** Modules this user may see. Doctors get Healthcare only; billing adds Accounts/Selling. */
  modules: string[];
};

export type ReportFilterDef = {
  fieldname: string;
  label: string;
  /** Frappe fieldtype: Data, Date, Select, Link, Check, Int, Float, Currency… */
  fieldtype: string;
  /** For Select: newline-separated choices. For Link: the target doctype. */
  options: string | null;
  default: string | null;
  mandatory: number;
};

export type ReportFilterInfo = {
  report: string;
  filters: ReportFilterDef[];
  suggests_company: boolean;
  default_company: string | null;
  today: string;
};

export type ReportColumn = {
  label: string;
  fieldname: string;
  fieldtype: string;
  width: number;
  options?: string | null;
};

export type ReportRow = Record<string, unknown>;

export type ReportResult = {
  report: string;
  module: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  total: number;
  /** True when the server capped the rows -- export to CSV for the rest. */
  truncated: boolean;
  filters: Record<string, unknown>;
};

/** A base64 file, ready to be written to disk and shared. */
export type DownloadPayload = {
  filename: string;
  mime_type: string;
  encoding: 'base64';
  content: string;
  rows?: number;
  count?: number;
  invoices?: string[];
  report?: string;
};

export type BulkInvoiceFilters = {
  from_date?: string;
  to_date?: string;
  patient?: string;
  status?: 'all' | 'paid' | 'unpaid';
  limit?: number;
};

export type BulkInvoicePreview = {
  count: number;
  /** True when more invoices match than the preview lists. */
  capped: boolean;
  total: number;
  outstanding: number;
  currency: string | null;
  items: Array<{
    name: string;
    patient_name: string;
    posting_date: string;
    grand_total: number;
    outstanding_amount: number;
    currency: string;
  }>;
};

export function listReports(search?: string): Promise<ReportListing> {
  return callApi<ReportListing>('report_runner.list_reports', { payload: { search } });
}

export function getReportFilters(report: string): Promise<ReportFilterInfo> {
  return callApi<ReportFilterInfo>('report_runner.get_filters', { payload: { report } });
}

export function runReport(
  report: string,
  filters: Record<string, unknown> = {},
  limit = 200,
): Promise<ReportResult> {
  return callApi<ReportResult>('report_runner.run_report', {
    payload: { report, filters, limit },
  });
}

export function downloadCsv(
  report: string,
  filters: Record<string, unknown> = {},
): Promise<DownloadPayload> {
  return callApi<DownloadPayload>('report_runner.download_csv', {
    payload: { report, filters },
  });
}

export function downloadPdf(
  report: string,
  filters: Record<string, unknown> = {},
): Promise<DownloadPayload> {
  return callApi<DownloadPayload>('report_runner.download_pdf', {
    payload: { report, filters },
  });
}

export function bulkInvoicePreview(filters: BulkInvoiceFilters): Promise<BulkInvoicePreview> {
  return callApi<BulkInvoicePreview>('report_runner.bulk_invoices_preview', {
    payload: filters,
  });
}

export function bulkInvoices(filters: BulkInvoiceFilters): Promise<DownloadPayload> {
  return callApi<DownloadPayload>('report_runner.bulk_invoices', { payload: filters });
}
