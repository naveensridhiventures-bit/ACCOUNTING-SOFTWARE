/**
 * Optional demo data so the UI is not empty: customers, suppliers, products and ~5 months of
 * invoices, bills, payments, expenses and stock movements - all posted through the real engine.
 * Run with: npm run seed:demo   (does nothing if the company already has parties or documents)
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { createDocument } from '../src/modules/sales/documents.service';
import { createExpense, createPayment, createTransfer } from '../src/modules/payments/payments.service';
import { postVoucher } from '../src/modules/accounting/posting.service';
import type { DocType } from '@prisma/client';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

async function main() {
  const company = await prisma.company.findFirstOrThrow();
  const admin = await prisma.user.findFirstOrThrow({ where: { companyId: company.id, role: { permissions: { has: '*' } } } });
  const actor = { companyId: company.id, userId: admin.id };
  if ((await prisma.party.count({ where: { companyId: company.id } })) || (await prisma.document.count({ where: { companyId: company.id } }))) {
    console.log('Company already has parties / documents - demo data skipped.');
    return;
  }

  await prisma.company.update({
    where: { id: company.id },
    data: {
      legalName: company.name, gstin: '29AABCA1234F1Z5', pan: 'AABCA1234F', address: '42, Industrial Layout, Peenya', city: 'Bengaluru', state: 'Karnataka', stateCode: '29', pincode: '560058',
      phone: '+91 80 4000 1234', email: 'accounts@acmetraders.example', website: 'www.acmetraders.example',
      bankDetails: 'Bank: Example Bank, Peenya Branch\nA/c No: 000123456789\nIFSC: EXMP0000123',
      invoiceTerms: '1. Payment due within the credit period stated on the invoice.\n2. Goods once sold will not be taken back without prior approval.\n3. Subject to Bengaluru jurisdiction.',
    },
  });

  const ledgerByName = async (name: string) => (await prisma.ledger.findUniqueOrThrow({ where: { companyId_name: { companyId: company.id, name } } })).id;
  const bank = await ledgerByName('Main Bank Account');
  const cash = await ledgerByName('Cash');
  // Opening position: 15 lakh in the bank funded by owner's capital.
  await prisma.ledger.update({ where: { id: bank }, data: { openingBalance: '1500000', openingSide: 'DR' } });
  await prisma.ledger.update({ where: { id: await ledgerByName("Owner's Capital") }, data: { openingBalance: '1500000', openingSide: 'CR' } });
  await prisma.ledger.update({ where: { id: cash }, data: { openingBalance: '25000', openingSide: 'DR' } });
  await prisma.ledger.update({ where: { id: await ledgerByName('Opening Balance Equity') }, data: { openingBalance: '25000', openingSide: 'CR' } });

  const groups = new Map((await prisma.accountGroup.findMany({ where: { companyId: company.id } })).map((g) => [g.name, g.id]));
  const mkParty = async (type: 'CUSTOMER' | 'SUPPLIER', name: string, o: { gstin?: string; city: string; state: string; stateCode: string; creditDays: number; phone: string; email?: string; address?: string }) => {
    const ledger = await prisma.ledger.create({ data: { companyId: company.id, name, groupId: groups.get(type === 'CUSTOMER' ? 'Sundry Debtors' : 'Sundry Creditors')! } });
    return prisma.party.create({ data: { companyId: company.id, ledgerId: ledger.id, type, name, gstin: o.gstin ?? null, city: o.city, state: o.state, stateCode: o.stateCode, creditDays: o.creditDays, phone: o.phone, email: o.email ?? null, billingAddress: o.address ?? null, contactPerson: 'Accounts Dept' } });
  };
  const cust = {
    nova: await mkParty('CUSTOMER', 'Nova Systems Pvt Ltd', { gstin: '29AAGCN5678K1Z2', city: 'Bengaluru', state: 'Karnataka', stateCode: '29', creditDays: 30, phone: '9845012345', email: 'ap@novasystems.example', address: '8th Floor, Prestige Tech Park, Marathahalli' }),
    bright: await mkParty('CUSTOMER', 'Brightway Education Trust', { gstin: '33AAATB9012L1Z8', city: 'Chennai', state: 'Tamil Nadu', stateCode: '33', creditDays: 45, phone: '9444098765', email: 'office@brightway.example', address: '12, Anna Salai' }),
    kiran: await mkParty('CUSTOMER', 'Kiran Enterprises', { gstin: '29AAFFK3456M1Z1', city: 'Mysuru', state: 'Karnataka', stateCode: '29', creditDays: 15, phone: '9886011223' }),
    metro: await mkParty('CUSTOMER', 'Metro Retail Solutions LLP', { gstin: '27AAHFM7890P1Z3', city: 'Mumbai', state: 'Maharashtra', stateCode: '27', creditDays: 30, phone: '9820045678', email: 'purchase@metroretail.example', address: 'Andheri East' }),
    walk: await mkParty('CUSTOMER', 'Walk-in Customer', { city: 'Bengaluru', state: 'Karnataka', stateCode: '29', creditDays: 0, phone: '' }),
  };
  const sup = {
    tech: await mkParty('SUPPLIER', 'TechSource Distributors', { gstin: '29AAECT2345Q1Z6', city: 'Bengaluru', state: 'Karnataka', stateCode: '29', creditDays: 30, phone: '8041234567' }),
    global: await mkParty('SUPPLIER', 'Global Peripherals Pvt Ltd', { gstin: '27AABCG6789R1Z4', city: 'Pune', state: 'Maharashtra', stateCode: '27', creditDays: 45, phone: '9890011223' }),
    paper: await mkParty('SUPPLIER', 'Southern Paper & Stationery', { gstin: '33AAAFS1122T1Z9', city: 'Coimbatore', state: 'Tamil Nadu', stateCode: '33', creditDays: 30, phone: '9442211334' }),
    furn: await mkParty('SUPPLIER', 'Urban Furnishings Co.', { gstin: '29AAHCU4455V1Z7', city: 'Bengaluru', state: 'Karnataka', stateCode: '29', creditDays: 20, phone: '9900011222' }),
  };

  type P = [string, string, string, 'GOODS' | 'SERVICE', string, string, number, number, number, number];
  const catalog: P[] = [
    ['LAP-14', 'Laptop Pro 14"', 'Computers', 'GOODS', '8471', 'Nos', 62000, 48000, 18, 5],
    ['MSE-01', 'Wireless Mouse', 'Accessories', 'GOODS', '8471', 'Nos', 899, 450, 18, 20],
    ['KBD-01', 'Mechanical Keyboard', 'Accessories', 'GOODS', '8471', 'Nos', 3499, 2100, 18, 10],
    ['MON-27', '27" 4K Monitor', 'Computers', 'GOODS', '8528', 'Nos', 18499, 14200, 18, 5],
    ['HUB-C', 'USB-C Hub 7-in-1', 'Accessories', 'GOODS', '8536', 'Nos', 2499, 1300, 18, 15],
    ['CHR-01', 'Ergonomic Office Chair', 'Furniture', 'GOODS', '9401', 'Nos', 8999, 5600, 18, 4],
    ['PAP-A4', 'A4 Copier Paper (500 sheets)', 'Stationery', 'GOODS', '4802', 'Ream', 349, 260, 12, 50],
    ['INK-01', 'Printer Ink Cartridge', 'Stationery', 'GOODS', '3215', 'Nos', 1299, 880, 18, 10],
    ['SVC-INS', 'Installation & Setup Service', 'Services', 'SERVICE', '998314', 'Job', 1500, 0, 18, 0],
    ['SVC-AMC', 'Annual Maintenance Contract', 'Services', 'SERVICE', '998719', 'Year', 12000, 0, 18, 0],
  ];
  const prod: Record<string, string> = {};
  for (const [sku, name, category, kind, hsn, unit, sale, buy, gst, reorder] of catalog) {
    const p = await prisma.product.create({ data: { companyId: company.id, sku, name, category, kind, hsn, unit, salePrice: sale, purchasePrice: buy, gstRate: gst, trackStock: kind === 'GOODS', reorderLevel: reorder } });
    prod[sku] = p.id;
  }

  const doc = (type: DocType, partyId: string, daysAgo: number, lines: { sku: string; qty: number; rate?: number; disc?: number }[], extra: { reference?: string; originalDocumentId?: string } = {}) =>
    createDocument(actor, { type, date: iso(daysAgo), partyId, ...extra, lines: lines.map((l) => ({ productId: prod[l.sku]!, qty: l.qty, ...(l.rate !== undefined && { rate: l.rate }), ...(l.disc !== undefined && { discountPct: l.disc }) })) });
  const pay = (direction: 'RECEIVED' | 'PAID', partyId: string, daysAgo: number, amount: number | string, docId: string | null, mode: 'BANK' | 'CASH' | 'UPI' | 'CHEQUE' = 'BANK', reference?: string, split?: number) =>
    createPayment(actor, { direction, partyId, accountId: mode === 'CASH' ? cash : bank, date: iso(daysAgo), amount, mode, reference, allocations: docId ? [{ documentId: docId, amount: split ?? amount }] : [] });

  // ---- purchases (stock in)
  const b1 = await doc('PURCHASE_BILL', sup.tech.id, 150, [{ sku: 'LAP-14', qty: 20 }, { sku: 'MON-27', qty: 16 }, { sku: 'HUB-C', qty: 40 }], { reference: 'TS/26-27/0412' });
  const b2 = await doc('PURCHASE_BILL', sup.global.id, 145, [{ sku: 'MSE-01', qty: 80 }, { sku: 'KBD-01', qty: 40 }], { reference: 'GP-8891' });
  const b3 = await doc('PURCHASE_BILL', sup.paper.id, 140, [{ sku: 'PAP-A4', qty: 200 }, { sku: 'INK-01', qty: 30 }], { reference: 'SPS/2209' });
  const b4 = await doc('PURCHASE_BILL', sup.furn.id, 120, [{ sku: 'CHR-01', qty: 12 }], { reference: 'UF-3310' });
  const b5 = await doc('PURCHASE_BILL', sup.tech.id, 60, [{ sku: 'LAP-14', qty: 10, rate: 49000 }, { sku: 'HUB-C', qty: 20, rate: 1350 }], { reference: 'TS/26-27/0877' });
  await pay('PAID', sup.tech.id, 118, b1.total.toString(), b1.id, 'BANK', 'NEFT-884412');
  await pay('PAID', sup.global.id, 100, b2.total.toString(), b2.id, 'BANK', 'NEFT-889102');
  await pay('PAID', sup.paper.id, 95, b3.total.toString(), b3.id, 'UPI', 'UPI-5521');
  await pay('PAID', sup.furn.id, 90, (Number(b4.total) / 2).toFixed(2), b4.id, 'CHEQUE', 'CHQ-000231');
  void b5;

  // ---- sales
  const s1 = await doc('SALES_INVOICE', cust.nova.id, 130, [{ sku: 'LAP-14', qty: 6 }, { sku: 'MON-27', qty: 6 }, { sku: 'SVC-INS', qty: 6 }]);
  const s2 = await doc('SALES_INVOICE', cust.bright.id, 118, [{ sku: 'MON-27', qty: 4, disc: 5 }, { sku: 'KBD-01', qty: 10 }, { sku: 'MSE-01', qty: 10 }]);
  const s3 = await doc('SALES_INVOICE', cust.kiran.id, 105, [{ sku: 'CHR-01', qty: 4 }, { sku: 'PAP-A4', qty: 40 }]);
  const s4 = await doc('SALES_INVOICE', cust.metro.id, 92, [{ sku: 'LAP-14', qty: 5, disc: 3 }, { sku: 'HUB-C', qty: 15 }, { sku: 'SVC-AMC', qty: 1 }]);
  const s5 = await doc('SALES_INVOICE', cust.walk.id, 80, [{ sku: 'MSE-01', qty: 3 }, { sku: 'INK-01', qty: 2 }]);
  const s6 = await doc('SALES_INVOICE', cust.nova.id, 62, [{ sku: 'KBD-01', qty: 15 }, { sku: 'MSE-01', qty: 25 }, { sku: 'HUB-C', qty: 20 }]);
  const s7 = await doc('SALES_INVOICE', cust.bright.id, 45, [{ sku: 'LAP-14', qty: 4 }, { sku: 'SVC-INS', qty: 4 }, { sku: 'SVC-AMC', qty: 1 }]);
  const s8 = await doc('SALES_INVOICE', cust.kiran.id, 30, [{ sku: 'PAP-A4', qty: 60 }, { sku: 'INK-01', qty: 8 }, { sku: 'MSE-01', qty: 6 }]);
  const s9 = await doc('SALES_INVOICE', cust.metro.id, 18, [{ sku: 'MON-27', qty: 3 }, { sku: 'CHR-01', qty: 3 }]);
  const s10 = await doc('SALES_INVOICE', cust.nova.id, 9, [{ sku: 'LAP-14', qty: 3 }, { sku: 'SVC-INS', qty: 3 }]);
  const s11 = await doc('SALES_INVOICE', cust.bright.id, 4, [{ sku: 'KBD-01', qty: 5 }, { sku: 'HUB-C', qty: 5 }]);
  await doc('SALES_INVOICE', cust.walk.id, 1, [{ sku: 'MSE-01', qty: 2 }, { sku: 'PAP-A4', qty: 5 }]);

  // credit note (customer returned 2 mice from s6) applied against that invoice, debit note on a supplier bill
  const cn = await doc('CREDIT_NOTE', cust.nova.id, 55, [{ sku: 'MSE-01', qty: 2 }], { originalDocumentId: s6.id });
  await createDocument(actor, { type: 'CREDIT_NOTE', date: iso(54), partyId: cust.nova.id, originalDocumentId: s6.id, lines: [{ productId: prod['SVC-INS']!, qty: 1, rate: 500 }], applyTo: [{ documentId: s6.id, amount: 590 }] });
  void cn;
  await doc('DEBIT_NOTE', sup.global.id, 85, [{ sku: 'KBD-01', qty: 2 }], { originalDocumentId: b2.id });

  // ---- receipts (some paid, some partial, some left overdue)
  await pay('RECEIVED', cust.nova.id, 110, s1.total.toString(), s1.id, 'BANK', 'RTGS-20931');
  await pay('RECEIVED', cust.bright.id, 80, s2.total.toString(), s2.id, 'BANK', 'NEFT-77120');
  await pay('RECEIVED', cust.kiran.id, 95, s3.total.toString(), s3.id, 'CHEQUE', 'CHQ-558812');
  await pay('RECEIVED', cust.metro.id, 50, (Number(s4.total) * 0.6).toFixed(2), s4.id, 'BANK', 'RTGS-44120');
  await pay('RECEIVED', cust.walk.id, 80, s5.total.toString(), s5.id, 'CASH');
  await pay('RECEIVED', cust.nova.id, 25, (Number(s6.total) - 590 - 1000).toFixed(2), s6.id, 'UPI', 'UPI-9981');
  await pay('RECEIVED', cust.kiran.id, 12, 5000, null, 'UPI', 'UPI-advance'); // on-account advance
  await pay('RECEIVED', cust.bright.id, 20, (Number(s7.total) * 0.5).toFixed(2), s7.id, 'BANK', 'NEFT-80123');
  void s8; void s9; void s10; void s11;

  // ---- expenses
  const ex = async (name: string, daysAgo: number, amount: number, gst = 0, from = bank, payee?: string) =>
    createExpense(actor, { date: iso(daysAgo), expenseLedgerId: await ledgerByName(name), paidFromId: from, amount, gstRate: gst, payee });
  for (const d of [140, 110, 80, 50, 20]) {
    await ex('Rent', d, 20000, 18, bank, 'Peenya Estates');
    await ex('Salaries & Wages', d - 3, 38000);
  }
  await ex('Electricity & Utilities', 100, 9800, 0, bank, 'BESCOM');
  await ex('Electricity & Utilities', 40, 11250, 0, bank, 'BESCOM');
  await ex('Telephone & Internet', 75, 3499, 18, bank, 'Airtel Business');
  await ex('Marketing & Advertising', 65, 22000, 18, bank, 'Google Ads');
  await ex('Travel & Conveyance', 33, 6400, 5, cash, 'Client visits');
  await ex('Office Expenses', 14, 2350, 18, cash, 'Tea, snacks & supplies');
  await ex('Professional Fees', 28, 15000, 18, bank, 'CA firm - audit fees');
  await ex('Bank Charges', 10, 590);

  await createTransfer(actor, { date: iso(70), fromId: bank, toId: cash, amount: 40000, notes: 'Cash withdrawal for petty cash' });
  await postVoucher(actor, { type: 'JOURNAL', date: iso(140), narration: 'Office computers and equipment introduced by the owner', lines: [{ ledgerId: await ledgerByName('Computers & Equipment'), side: 'DR', amount: '180000' }, { ledgerId: await ledgerByName("Owner's Capital"), side: 'CR', amount: '180000' }] });
  await postVoucher(actor, { type: 'JOURNAL', date: iso(5), narration: 'Depreciation for the half-year', lines: [{ ledgerId: await ledgerByName('Depreciation'), side: 'DR', amount: '18000' }, { ledgerId: await ledgerByName('Computers & Equipment'), side: 'CR', amount: '18000' }] });

  console.log(`Demo data created for ${company.name}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
