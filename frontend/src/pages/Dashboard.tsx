import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useApi, useTitle } from '../hooks';
import { Amt, Button, Card, Empty, ErrorBox, Loading, PageHeader, Stat } from '../components/ui';
import { BarChart, Legend, ShareBars } from '../components/charts';
import { date, monthLabel, money, moneyShort, num, rupee, titleCase, VOUCHER_LABEL } from '../format';

export default function Dashboard() {
  useTitle('Dashboard');
  const { user, can } = useAuth();
  const nav = useNavigate();
  const { data: d, loading, error, reload } = useApi<any>(can('report.read') ? '/reports/dashboard' : null);
  if (!can('report.read')) {
    return (
      <>
        <PageHeader title={`Welcome, ${user?.name.split(' ')[0]}`} subtitle="Pick a task from the menu to get started." />
        <div className="grid g3">
          {can('sales.write') && <Card title="Sales"><Button variant="primary" onClick={() => nav('/sales/invoices/new')}>New invoice</Button></Card>}
          {can('party.read') && <Card title="Customers"><Button onClick={() => nav('/customers')}>Open customers</Button></Card>}
        </div>
      </>
    );
  }
  if (loading && !d) return <><PageHeader title="Dashboard" /><Loading rows={6} /></>;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!d) return null;
  const k = d.kpis;
  const income = d.monthly.map((m: any) => num(m.income));
  const expense = d.monthly.map((m: any) => num(m.expense));
  const cashIn = d.monthly.map((m: any) => num(m.cashIn));
  const cashOut = d.monthly.map((m: any) => num(m.cashOut));
  const labels = d.monthly.map((m: any) => monthLabel(m.month));
  const noData = d.counts.invoices === 0 && d.counts.customers === 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={d.financialYear ? `Financial year ${d.financialYear.name}${d.financialYear.isClosed ? ' (closed)' : ''}, as of today` : 'No financial year covers today'}
        actions={<>
          {can('sales.write') && <Button variant="primary" icon="plus" onClick={() => nav('/sales/invoices/new')}>New invoice</Button>}
          {can('purchase.write') && <Button icon="plus" onClick={() => nav('/purchases/bills/new')}>New bill</Button>}
          {can('voucher.create') && <Button onClick={() => nav('/expenses?new=1')}>Record expense</Button>}
        </>}
      />
      {noData && (
        <div className="alert info" style={{ marginBottom: 16 }}>
          Your books are empty. Start by adding <Link to="/customers">customers</Link> and <Link to="/products">products</Link>, then create your first invoice. Run <code>npm run seed:demo</code> in the backend folder to load sample data.
        </div>
      )}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Cash & bank" value={rupee(k.cashAndBank)} foot={`${d.accounts.length} accounts`} onClick={() => nav('/banking')} />
        <Stat label="Customers owe you" value={rupee(k.receivables)} foot={num(k.receivablesOverdue) > 0 ? <span className="neg">{rupee(k.receivablesOverdue)} overdue</span> : 'Nothing overdue'} onClick={() => nav('/reports/receivables')} />
        <Stat label="You owe suppliers" value={rupee(k.payables)} foot={num(k.payablesOverdue) > 0 ? <span className="neg">{rupee(k.payablesOverdue)} overdue</span> : 'Nothing overdue'} onClick={() => nav('/reports/payables')} />
        <Stat label="Profit this year" tone={num(k.netProfit) < 0 ? 'neg' : 'pos'} value={rupee(k.netProfit)} foot={`Revenue ${rupee(k.revenue)}`} onClick={() => nav('/reports/profit-loss')} />
      </div>

      <div className="grid g-main" style={{ marginBottom: 16 }}>
        <Card title="Income and expenses, last 12 months" actions={<Legend series={[{ name: 'Income', color: 'var(--primary)' }, { name: 'Expenses', color: '#c9822b' }]} />}>
          <BarChart labels={labels} series={[{ name: 'Income', color: 'var(--primary)', values: income }, { name: 'Expenses', color: '#c9822b', values: expense }]} />
        </Card>
        <Card title="Cash and bank accounts" pad={false}>
          <table><tbody>
            {d.accounts.map((a: any) => (
              <tr key={a.id} className="clickable" onClick={() => nav(`/ledgers/${a.id}`)}>
                <td>{a.name}<div className="muted small">{a.group}</div></td>
                <td className="num"><Amt v={a.balance} className={num(a.balance) < 0 ? 'neg' : ''} /></td>
              </tr>
            ))}
            {!d.accounts.length && <tr><td><Empty title="No cash or bank account" /></td></tr>}
          </tbody></table>
        </Card>
      </div>

      <div className="grid g-main" style={{ marginBottom: 16 }}>
        <Card title="Money in and out (excludes transfers)" actions={<Legend series={[{ name: 'Received', color: 'var(--primary)' }, { name: 'Paid', color: '#8a5a9e' }]} />}>
          <BarChart height={190} labels={labels} series={[{ name: 'Received', color: 'var(--primary)', values: cashIn }, { name: 'Paid', color: '#8a5a9e', values: cashOut }]} />
        </Card>
        <Card title="Best customers this year">
          {d.topCustomers.length ? <ShareBars rows={d.topCustomers.map((c: any) => ({ label: c.name, value: num(c.sales), display: moneyShort(c.sales), onClick: () => nav(`/parties/${c.id}`) }))} /> : <div className="muted">No sales yet this year.</div>}
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Needs follow-up" pad={false}>
          {d.topOverdue.length ? (
            <table><tbody>{d.topOverdue.map((o: any) => (
              <tr key={o.partyId} className="clickable" onClick={() => nav(`/parties/${o.partyId}`)}><td>{o.party}</td><td className="num neg">{money(o.overdue)}</td></tr>
            ))}</tbody></table>
          ) : <div className="card-pad muted">No overdue invoices.</div>}
        </Card>
        <Card title="Low stock" pad={false}>
          {d.lowStock.length ? (
            <table><tbody>{d.lowStock.map((p: any) => (
              <tr key={p.id} className="clickable" onClick={() => nav(`/products/${p.id}`)}><td>{p.name}<div className="muted small">Reorder at {num(p.reorderLevel)}</div></td><td className="num">{num(p.qty)} {p.unit}</td></tr>
            ))}</tbody></table>
          ) : <div className="card-pad muted">All items are above their reorder level.</div>}
        </Card>
        <Card title="Latest entries" pad={false}>
          <table><tbody>{d.recentVouchers.map((v: any) => (
            <tr key={v.id} className="clickable" onClick={() => nav(`/vouchers/${v.id}`)}>
              <td><span className="mono-id">{v.number}</span><div className="muted small">{VOUCHER_LABEL[v.type] ?? titleCase(v.type)} · {date(v.date)}</div></td>
              <td className="num">{money(v.amount)}</td>
            </tr>
          ))}</tbody></table>
        </Card>
      </div>
    </>
  );
}
