import type { AccountNature } from '@prisma/client';

// ---------------------------------------------------------------- permissions
export const PERMISSION_CATALOG: { key: string; label: string; group: string }[] = [
  { key: 'company.read', label: 'View company & financial years', group: 'Company' },
  { key: 'company.write', label: 'Edit company profile', group: 'Company' },
  { key: 'fy.manage', label: 'Create / close financial years', group: 'Company' },
  { key: 'user.read', label: 'View users & roles', group: 'Administration' },
  { key: 'user.write', label: 'Manage users & roles', group: 'Administration' },
  { key: 'audit.read', label: 'View audit log', group: 'Administration' },
  { key: 'ledger.read', label: 'View chart of accounts', group: 'Accounting' },
  { key: 'ledger.write', label: 'Create / edit ledgers & groups', group: 'Accounting' },
  { key: 'voucher.read', label: 'View vouchers', group: 'Accounting' },
  { key: 'voucher.create', label: 'Post vouchers & expenses', group: 'Accounting' },
  { key: 'voucher.reverse', label: 'Reverse vouchers', group: 'Accounting' },
  { key: 'party.read', label: 'View customers & suppliers', group: 'Parties' },
  { key: 'party.write', label: 'Create / edit customers & suppliers', group: 'Parties' },
  { key: 'product.read', label: 'View products & stock', group: 'Inventory' },
  { key: 'product.write', label: 'Create / edit products', group: 'Inventory' },
  { key: 'stock.adjust', label: 'Adjust stock', group: 'Inventory' },
  { key: 'sales.read', label: 'View sales documents', group: 'Sales' },
  { key: 'sales.write', label: 'Create sales invoices & credit notes', group: 'Sales' },
  { key: 'purchase.read', label: 'View purchase documents', group: 'Purchases' },
  { key: 'purchase.write', label: 'Create bills & debit notes', group: 'Purchases' },
  { key: 'document.cancel', label: 'Cancel invoices / bills / notes', group: 'Sales' },
  { key: 'payment.read', label: 'View receipts & payments', group: 'Banking' },
  { key: 'payment.write', label: 'Record receipts & payments', group: 'Banking' },
  { key: 'bank.reconcile', label: 'Reconcile bank accounts', group: 'Banking' },
  { key: 'report.read', label: 'View reports', group: 'Reports' },
];

const ALL_KEYS = PERMISSION_CATALOG.map((p) => p.key);
const READ_KEYS = ALL_KEYS.filter((k) => k.endsWith('.read') && k !== 'audit.read' && k !== 'user.read');

export const SYSTEM_ROLES: Record<string, string[]> = {
  Admin: ['*'],
  Accountant: ALL_KEYS.filter((k) => !['user.write', 'user.read', 'company.write'].includes(k)),
  'Sales Executive': ['company.read', 'ledger.read', 'party.read', 'party.write', 'product.read', 'sales.read', 'sales.write', 'payment.read', 'payment.write', 'report.read'],
  Viewer: READ_KEYS,
};

// ------------------------------------------------------------- account groups
// [name, parent, nature]
export const DEFAULT_GROUPS: [string, string | null, AccountNature][] = [
  ['Capital Account', null, 'LIABILITY'],
  ['Reserves & Surplus', 'Capital Account', 'LIABILITY'],
  ['Current Liabilities', null, 'LIABILITY'],
  ['Duties & Taxes', 'Current Liabilities', 'LIABILITY'],
  ['Provisions', 'Current Liabilities', 'LIABILITY'],
  ['Sundry Creditors', 'Current Liabilities', 'LIABILITY'],
  ['Loans (Liability)', null, 'LIABILITY'],
  ['Bank OD Accounts', 'Loans (Liability)', 'LIABILITY'],
  ['Secured Loans', 'Loans (Liability)', 'LIABILITY'],
  ['Unsecured Loans', 'Loans (Liability)', 'LIABILITY'],
  ['Fixed Assets', null, 'ASSET'],
  ['Investments', null, 'ASSET'],
  ['Current Assets', null, 'ASSET'],
  ['Bank Accounts', 'Current Assets', 'ASSET'],
  ['Cash-in-Hand', 'Current Assets', 'ASSET'],
  ['Deposits (Asset)', 'Current Assets', 'ASSET'],
  ['Loans & Advances (Asset)', 'Current Assets', 'ASSET'],
  ['Stock-in-Hand', 'Current Assets', 'ASSET'],
  ['Sundry Debtors', 'Current Assets', 'ASSET'],
  ['Sales Accounts', null, 'INCOME'],
  ['Direct Incomes', null, 'INCOME'],
  ['Indirect Incomes', null, 'INCOME'],
  ['Purchase Accounts', null, 'EXPENSE'],
  ['Direct Expenses', null, 'EXPENSE'],
  ['Indirect Expenses', null, 'EXPENSE'],
];

// -------------------------------------------------------------- system ledgers
export type SystemKey =
  | 'CASH' | 'SALES' | 'SALES_RETURNS' | 'PURCHASES' | 'PURCHASE_RETURNS' | 'INVENTORY' | 'COGS' | 'STOCK_ADJUSTMENT'
  | 'ROUND_OFF' | 'OUTPUT_CGST' | 'OUTPUT_SGST' | 'OUTPUT_IGST' | 'INPUT_CGST' | 'INPUT_SGST' | 'INPUT_IGST'
  | 'OPENING_EQUITY' | 'RETAINED_EARNINGS';

export const SYSTEM_LEDGERS: Record<SystemKey, { name: string; group: string }> = {
  CASH: { name: 'Cash', group: 'Cash-in-Hand' },
  SALES: { name: 'Sales', group: 'Sales Accounts' },
  SALES_RETURNS: { name: 'Sales Returns', group: 'Sales Accounts' },
  PURCHASES: { name: 'Purchases', group: 'Purchase Accounts' },
  PURCHASE_RETURNS: { name: 'Purchase Returns', group: 'Purchase Accounts' },
  INVENTORY: { name: 'Inventory', group: 'Stock-in-Hand' },
  COGS: { name: 'Cost of Goods Sold', group: 'Direct Expenses' },
  STOCK_ADJUSTMENT: { name: 'Stock Adjustments', group: 'Direct Expenses' },
  ROUND_OFF: { name: 'Round Off', group: 'Indirect Expenses' },
  OUTPUT_CGST: { name: 'Output CGST', group: 'Duties & Taxes' },
  OUTPUT_SGST: { name: 'Output SGST', group: 'Duties & Taxes' },
  OUTPUT_IGST: { name: 'Output IGST', group: 'Duties & Taxes' },
  INPUT_CGST: { name: 'Input CGST', group: 'Duties & Taxes' },
  INPUT_SGST: { name: 'Input SGST', group: 'Duties & Taxes' },
  INPUT_IGST: { name: 'Input IGST', group: 'Duties & Taxes' },
  OPENING_EQUITY: { name: 'Opening Balance Equity', group: 'Capital Account' },
  RETAINED_EARNINGS: { name: 'Retained Earnings', group: 'Reserves & Surplus' },
};

/** Ledgers created for every new company in addition to the system ledgers. */
export const STARTER_LEDGERS: { name: string; group: string }[] = [
  { name: 'Main Bank Account', group: 'Bank Accounts' },
  { name: 'Salaries & Wages', group: 'Indirect Expenses' },
  { name: 'Rent', group: 'Indirect Expenses' },
  { name: 'Electricity & Utilities', group: 'Indirect Expenses' },
  { name: 'Telephone & Internet', group: 'Indirect Expenses' },
  { name: 'Office Expenses', group: 'Indirect Expenses' },
  { name: 'Travel & Conveyance', group: 'Indirect Expenses' },
  { name: 'Professional Fees', group: 'Indirect Expenses' },
  { name: 'Marketing & Advertising', group: 'Indirect Expenses' },
  { name: 'Repairs & Maintenance', group: 'Indirect Expenses' },
  { name: 'Bank Charges', group: 'Indirect Expenses' },
  { name: 'Interest Paid', group: 'Indirect Expenses' },
  { name: 'Depreciation', group: 'Indirect Expenses' },
  { name: 'Interest Received', group: 'Indirect Incomes' },
  { name: 'Discount Received', group: 'Indirect Incomes' },
  { name: 'Other Income', group: 'Indirect Incomes' },
  { name: 'Furniture & Fixtures', group: 'Fixed Assets' },
  { name: 'Computers & Equipment', group: 'Fixed Assets' },
  { name: 'Owner\'s Capital', group: 'Capital Account' },
  { name: 'Drawings', group: 'Capital Account' },
];

export const INDIAN_STATES: [string, string][] = [
  ['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
  ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'],
  ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra & Nagar Haveli and Daman & Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
  ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman & Nicobar Islands'],
  ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
];
