import { Link } from 'react-router-dom';
import { useTitle } from '../hooks';
import { Card, PageHeader } from '../components/ui';

const SECTIONS = [
  { title: 'Financial statements', items: [
    { to: '/reports/profit-loss', name: 'Profit & loss', d: 'Income, cost of sales and expenses for any period.' },
    { to: '/reports/balance-sheet', name: 'Balance sheet', d: 'What you own and owe as of a date.' },
    { to: '/reports/trial-balance', name: 'Trial balance', d: 'Opening, movement and closing for every account.' },
    { to: '/reports/group-summary', name: 'Group summary', d: 'Totals by account group, like Tally’s group summary.' },
  ] },
  { title: 'Receivables and payables', items: [
    { to: '/reports/receivables', name: 'Customer outstanding', d: 'Who owes you, aged by due date.' },
    { to: '/reports/payables', name: 'Supplier outstanding', d: 'What you owe, aged by due date.' },
  ] },
  { title: 'Sales and purchases', items: [
    { to: '/reports/sales-by-customer', name: 'Sales by customer', d: 'Net sales and tax per customer.' },
    { to: '/reports/purchases-by-supplier', name: 'Purchases by supplier', d: 'Net purchases and tax per supplier.' },
    { to: '/reports/sales-by-product', name: 'Sales by product', d: 'Quantity, revenue, cost and margin per item.' },
    { to: '/reports/purchases-by-product', name: 'Purchases by product', d: 'Quantity and spend per item.' },
  ] },
  { title: 'Tax and stock', items: [
    { to: '/gst', name: 'GST summary', d: 'Output tax, input credit, net payable and HSN summary.' },
    { to: '/stock', name: 'Stock summary', d: 'Quantity and value of every item on hand.' },
  ] },
];

export default function ReportsHub() {
  useTitle('Reports');
  return (
    <>
      <PageHeader title="Reports" subtitle="Everything here comes straight from your books, so it always agrees with the ledger" />
      <div className="stack" style={{ gap: 22 }}>
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="section-title">{s.title}</h2>
            <div className="grid g2">
              {s.items.map((i) => <Link key={i.to} to={i.to} className="report-link"><Card><strong>{i.name}</strong><div className="muted">{i.d}</div></Card></Link>)}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
