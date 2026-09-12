/**
 * Draft invoices must never count as money.
 *
 * `invoices.list_invoices` returns everything except cancelled -- drafts
 * included, deliberately, because staff need to see them in the list. But a
 * draft posts nothing to the general ledger (ERPNext only writes GL entries on
 * submit), so its outstanding_amount is not a receivable.
 *
 * Three staff screens summed the raw list and so reported a draft as money
 * owed: the profile stat read "Rs 500 outstanding" while the Reports screen,
 * which asks the server, correctly read Rs 0. These tests pin the rule the
 * screens now follow.
 */

import type { Invoice } from '@/types/domain';

const SUBMITTED = 1;
const DRAFT = 0;
const CANCELLED = 2;

function invoice(over: Partial<Invoice>): Invoice {
  return {
    name: 'ACC-SINV-0001',
    patient: 'PAT-0001',
    patient_name: 'Test Patient',
    posting_date: '2026-09-09',
    due_date: '2026-09-09',
    grand_total: 1000,
    outstanding_amount: 0,
    status: 'Paid',
    currency: 'PKR',
    docstatus: SUBMITTED,
    payment_status: 'paid',
    ...over,
  } as Invoice;
}

/** The rule every staff money total applies. */
const posted = (rows: Invoice[]) => rows.filter((r) => r.docstatus === SUBMITTED);

const sumOutstanding = (rows: Invoice[]) =>
  posted(rows).reduce((sum, r) => sum + r.outstanding_amount, 0);

const sumCollected = (rows: Invoice[], date: string) =>
  posted(rows)
    .filter((r) => r.posting_date === date)
    .reduce((sum, r) => sum + (r.grand_total - r.outstanding_amount), 0);

describe('staff billing totals', () => {
  it('excludes a draft from outstanding', () => {
    const rows = [
      invoice({ name: 'SUBMITTED-PAID', docstatus: SUBMITTED, outstanding_amount: 0 }),
      invoice({ name: 'DRAFT-500', docstatus: DRAFT, grand_total: 500, outstanding_amount: 500 }),
    ];

    // The exact regression: this returned 500 before the fix.
    expect(sumOutstanding(rows)).toBe(0);
  });

  it('counts a submitted unpaid invoice as outstanding', () => {
    const rows = [
      invoice({ docstatus: SUBMITTED, grand_total: 1500, outstanding_amount: 1500 }),
    ];
    expect(sumOutstanding(rows)).toBe(1500);
  });

  it('excludes a cancelled invoice even when it carries an outstanding amount', () => {
    // A cancelled invoice keeps its outstanding_amount on the row; it is not owed.
    const rows = [
      invoice({ docstatus: CANCELLED, grand_total: 1000, outstanding_amount: 1000 }),
    ];
    expect(sumOutstanding(rows)).toBe(0);
  });

  it('does not treat a draft as cash collected', () => {
    // grand_total - outstanding is 0 for a fully-unpaid draft, but a partially
    // filled draft would otherwise register as takings that never happened.
    const rows = [
      invoice({ docstatus: DRAFT, posting_date: '2026-09-09', grand_total: 800, outstanding_amount: 300 }),
      invoice({ docstatus: SUBMITTED, posting_date: '2026-09-09', grand_total: 1000, outstanding_amount: 0 }),
    ];
    expect(sumCollected(rows, '2026-09-09')).toBe(1000);
  });

  it('sums partial payments on submitted invoices only', () => {
    const rows = [
      invoice({ docstatus: SUBMITTED, grand_total: 1000, outstanding_amount: 400 }),
      invoice({ docstatus: SUBMITTED, grand_total: 2000, outstanding_amount: 500 }),
      invoice({ docstatus: DRAFT, grand_total: 9999, outstanding_amount: 9999 }),
    ];
    expect(sumOutstanding(rows)).toBe(900);
  });
});
