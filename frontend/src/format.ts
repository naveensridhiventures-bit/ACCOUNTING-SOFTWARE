export const nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const qtyF = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
};
/** 1234567.5 -> "12,34,567.50" */
export const money = (v: unknown) => nf.format(num(v));
export const moneyShort = (v: unknown) => {
  const n = num(v), a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e7) return `${s}${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
};
export const qty = (v: unknown) => qtyF.format(num(v));
export const rupee = (v: unknown, cur = 'INR') => (cur === 'INR' ? '₹' : cur + ' ') + money(v);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-23" -> "23 Oct 2026" (no timezone maths: the API sends plain dates) */
export const date = (iso?: string | null) => {
  if (!iso) return '-';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number) => (n < 20 ? ones[n]! : tens[Math.floor(n / 10)]! + (n % 10 ? ' ' + ones[n % 10] : ''));
const three = (n: number) => (n >= 100 ? ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
/** Indian numbering words for invoices: 123456.5 -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only" */
export function amountInWords(v: unknown): string {
  const total = Math.round(Math.abs(num(v)) * 100);
  const rupees = Math.floor(total / 100), paise = total % 100;
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(rupees / 1e7), lakh = Math.floor((rupees % 1e7) / 1e5), thou = Math.floor((rupees % 1e5) / 1e3), rest = rupees % 1e3;
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thou) parts.push(two(thou) + ' Thousand');
  if (rest) parts.push(three(rest));
  let s = 'Rupees ' + (parts.join(' ') || 'Zero');
  if (paise) s += ' and ' + two(paise) + ' Paise';
  return s + ' Only';
}

export const titleCase = (s?: string | null) => (s ?? '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const DOC_LABEL: Record<string, string> = { SALES_INVOICE: 'Sales invoice', PURCHASE_BILL: 'Purchase bill', CREDIT_NOTE: 'Credit note', DEBIT_NOTE: 'Debit note' };
export const VOUCHER_LABEL: Record<string, string> = { SALES: 'Sales', PURCHASE: 'Purchase', PAYMENT: 'Payment', RECEIPT: 'Receipt', CONTRA: 'Contra', JOURNAL: 'Journal', CREDIT_NOTE: 'Credit note', DEBIT_NOTE: 'Debit note' };

/** Current Indian-style financial year bounds for a date (April start unless overridden). */
export function fyBounds(iso = today(), startMonth = 4) {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const sy = m >= startMonth ? y : y - 1;
  const start = `${sy}-${String(startMonth).padStart(2, '0')}-01`;
  const end = addDays(`${sy + 1}-${String(startMonth).padStart(2, '0')}-01`, -1);
  return { start, end };
}
