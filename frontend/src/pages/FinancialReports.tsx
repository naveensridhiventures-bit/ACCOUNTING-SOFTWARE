import { Fragment, ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi, useTitle } from '../hooks';
import { Button, Card, ErrorBox, Loading, PageHeader, PeriodPicker, Stat, defaultPeriod } from '../components/ui';
import { downloadCsv, money, num, rupee, today } from '../format';

function Shell({ title, subtitle, controls, children, onCsv }: { title: string; subtitle?: string; controls: ReactNode; children: ReactNode; onCsv?: () => void }) {
  useTitle(title);
  return (
    <>
      <PageHeader crumb={<Link to="/reports">Reports</Link>} title={title} subtitle={subtitle} actions={<>{onCsv && <Button icon="download" onClick={onCsv}>Export CSV</Button>}<Button icon="print" onClick={() => window.print()}>Print</Button></>} />
      <Card pad={false}>
        <div className="toolbar no-print">{controls}</div>
        {children}
      </Card>
    </>
  );
}

// ------------------------------------------------------------- trial balance
export function TrialBalance() {
  const nav = useNavigate();
  const [period, setPeriod] = useState(defaultPeriod());
  const { data, loading, error, reload } = useApi<any>('/reports/trial-balance', { from: period.from, to: period.to }, [period.from, period.to]);
  const rows: any[] = (data?.ledgers ?? []).filter((l: any) => [l.openingDr, l.openingCr, l.debit, l.credit, l.closingDr, l.closingCr].some((v) => num(v)));
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <Shell title="Trial balance" subtitle={data && `${data.from} to ${data.to}`} controls={<PeriodPicker value={period} onChange={setPeriod} />}
      onCsv={data ? () => downloadCsv('trial-balance.csv', [['Group', 'Account', 'Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'], ...rows.map((r) => [r.group, r.ledger, r.openingDr, r.openingCr, r.debit, r.credit, r.closingDr, r.closingCr])]) : undefined}>
      {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
      {loading && !data ? <Loading /> : data && (
        <>
          <div className={`alert ${data.isBalanced ? 'ok' : 'warn'}`} style={{ margin: 14 }} role="status">{data.isBalanced ? 'Debits equal credits. The books balance.' : `Closing balances are out by ${money(Math.abs(num(data.difference)))}. Check the opening balances entered on your accounts.`}</div>
          <div className="table-wrap"><table>
            <thead><tr><th rowSpan={2}>Account</th><th colSpan={2} className="num">Opening</th><th colSpan={2} className="num">Period</th><th colSpan={2} className="num">Closing</th></tr><tr><th className="num">Debit</th><th className="num">Credit</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
            <tbody>{groups.map((g) => (
              <Fragment key={g}>
                <tr className="group-row"><td colSpan={7}><strong>{g}</strong></td></tr>
                {rows.filter((r) => r.group === g).map((r) => (
                  <tr key={r.ledgerId} className="clickable" onClick={() => nav(`/ledgers/${r.ledgerId}`)}>
                    <td style={{ paddingLeft: 28 }}>{r.ledger}</td>
                    {[r.openingDr, r.openingCr, r.debit, r.credit, r.closingDr, r.closingCr].map((v, i) => <td key={i} className="num">{num(v) ? money(v) : ''}</td>)}
                  </tr>
                ))}
              </Fragment>
            ))}</tbody>
            <tfoot><tr><td>Total</td>{[data.totals.openingDr, data.totals.openingCr, data.totals.debit, data.totals.credit, data.totals.closingDr, data.totals.closingCr].map((v, i) => <td key={i} className="num">{money(v)}</td>)}</tr></tfoot>
          </table></div>
        </>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- profit & loss
function Section({ title, sec, nav }: { title: string; sec: any; nav: (id: string) => void }) {
  return (
    <>
      <tr className="group-row"><td colSpan={2}><strong>{title}</strong></td></tr>
      {sec.ledgers.map((l: any) => <tr key={l.ledgerId} className="clickable" onClick={() => nav(l.ledgerId)}><td style={{ paddingLeft: 28 }}>{l.name}</td><td className="num">{money(l.amount)}</td></tr>)}
      {!sec.ledgers.length && <tr><td style={{ paddingLeft: 28 }} className="faint">Nothing in this period</td><td /></tr>}
      <tr className="subtotal"><td>Total {title.toLowerCase()}</td><td className="num">{money(sec.total)}</td></tr>
    </>
  );
}
export function ProfitLoss() {
  const nav = useNavigate();
  const [period, setPeriod] = useState(defaultPeriod());
  const { data, loading, error, reload } = useApi<any>('/reports/profit-loss', { from: period.from, to: period.to }, [period.from, period.to]);
  const go = (id: string) => nav(`/ledgers/${id}`);
  return (
    <Shell title="Profit & loss" subtitle={data && `${data.from} to ${data.to}`} controls={<PeriodPicker value={period} onChange={setPeriod} />}
      onCsv={data ? () => downloadCsv('profit-loss.csv', [['Section', 'Account', 'Amount'], ...(['revenue', 'costOfSales', 'otherIncome', 'expenses'] as const).flatMap((k) => data[k].ledgers.map((l: any) => [k, l.name, l.amount])), ['', 'Gross profit', data.grossProfit], ['', 'Net profit', data.netProfit]]) : undefined}>
      {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="grid g3 card-pad">
            <Stat label="Revenue" value={rupee(data.revenue.total)} />
            <Stat label="Gross profit" value={rupee(data.grossProfit)} foot={data.grossMarginPct && `${data.grossMarginPct}% of revenue`} tone={num(data.grossProfit) < 0 ? 'neg' : undefined} />
            <Stat label={num(data.netProfit) >= 0 ? 'Net profit' : 'Net loss'} value={rupee(data.netProfit)} foot={data.netMarginPct && `${data.netMarginPct}% of revenue`} tone={num(data.netProfit) < 0 ? 'neg' : 'pos'} />
          </div>
          <div className="table-wrap"><table>
            <tbody>
              <Section title="Revenue" sec={data.revenue} nav={go} />
              <Section title="Cost of sales" sec={data.costOfSales} nav={go} />
              <tr className="total-row"><td>Gross profit</td><td className="num">{money(data.grossProfit)}</td></tr>
              <Section title="Other income" sec={data.otherIncome} nav={go} />
              <Section title="Expenses" sec={data.expenses} nav={go} />
            </tbody>
            <tfoot><tr><td>{num(data.netProfit) >= 0 ? 'Net profit' : 'Net loss'}</td><td className="num">{money(data.netProfit)}</td></tr></tfoot>
          </table></div>
        </>
      )}
    </Shell>
  );
}

// ----------------------------------------------------------------- balance sheet
function GroupRows({ g, depth, nav }: { g: any; depth: number; nav: (id: string) => void }) {
  return (
    <>
      <tr className={depth === 0 ? 'group-row' : ''}><td style={{ paddingLeft: 12 + depth * 18, fontWeight: depth === 0 ? 600 : 500 }}>{g.name}</td><td className="num" style={{ fontWeight: depth === 0 ? 600 : 400 }}>{money(g.amount)}</td></tr>
      {g.ledgers.map((l: any) => <tr key={l.id} className="clickable" onClick={() => nav(l.id)}><td style={{ paddingLeft: 30 + depth * 18 }} className="muted">{l.name}</td><td className="num muted">{money(l.amount)}</td></tr>)}
      {g.children.map((c: any) => <GroupRows key={c.id} g={c} depth={depth + 1} nav={nav} />)}
    </>
  );
}
export function BalanceSheet() {
  const nav = useNavigate();
  const [asOf, setAsOf] = useState(today());
  const { data, loading, error, reload } = useApi<any>('/reports/balance-sheet', { asOf }, [asOf]);
  const go = (id: string) => nav(`/ledgers/${id}`);
  return (
    <Shell title="Balance sheet" subtitle={data && `As of ${data.asOf}`} controls={<label className="row small muted">As of <input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} /></label>}
      onCsv={data ? () => downloadCsv('balance-sheet.csv', [['Side', 'Group', 'Amount'], ...data.assets.groups.map((g: any) => ['Assets', g.name, g.amount]), ...data.liabilities.groups.map((g: any) => ['Liabilities', g.name, g.amount]), ['Liabilities', 'Profit & loss', data.profitAndLoss]]) : undefined}>
      {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
      {loading && !data ? <Loading /> : data && (
        <>
          {!data.isBalanced && <div className="alert warn" style={{ margin: 14 }}>Opening balances are one-sided by {money(Math.abs(num(data.differenceInOpeningBalances)))}. The difference is shown as a balancing line.</div>}
          <div className="grid g2 card-pad" style={{ alignItems: 'start' }}>
            <div className="table-wrap"><table>
              <thead><tr><th>Liabilities and equity</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {data.liabilities.groups.map((g: any) => <GroupRows key={g.id} g={g} depth={0} nav={go} />)}
                <tr className="group-row"><td><strong>Profit & loss (current year, not yet closed)</strong></td><td className="num"><strong>{money(data.profitAndLoss)}</strong></td></tr>
                {!data.isBalanced && <tr><td className="muted">Difference in opening balances</td><td className="num">{money(data.differenceInOpeningBalances)}</td></tr>}
              </tbody>
              <tfoot><tr><td>Total</td><td className="num">{money(data.totalLiabilitiesAndEquity)}</td></tr></tfoot>
            </table></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Assets</th><th className="num">Amount</th></tr></thead>
              <tbody>{data.assets.groups.map((g: any) => <GroupRows key={g.id} g={g} depth={0} nav={go} />)}</tbody>
              <tfoot><tr><td>Total</td><td className="num">{money(data.totalAssets)}</td></tr></tfoot>
            </table></div>
          </div>
        </>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- group summary
export function GroupSummary() {
  const [period, setPeriod] = useState(defaultPeriod());
  const { data, loading, error, reload } = useApi<any>('/reports/group-summary', { from: period.from, to: period.to }, [period.from, period.to]);
  const depthOf = (g: any, all: any[]): number => (g.parentId ? 1 + depthOf(all.find((x) => x.id === g.parentId) ?? { parentId: null }, all) : 0);
  const rows: any[] = data ? data.groups.filter((g: any) => num(g.debit) || num(g.credit) || num(g.closing)) : [];
  return (
    <Shell title="Group summary" subtitle={data && `${data.from} to ${data.to}`} controls={<PeriodPicker value={period} onChange={setPeriod} />}
      onCsv={data ? () => downloadCsv('group-summary.csv', [['Group', 'Debit', 'Credit', 'Closing', 'Side'], ...rows.map((g) => [g.name, g.debit, g.credit, g.closing, g.closingSide])]) : undefined}>
      {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
      {loading && !data ? <Loading /> : data && (
        <div className="table-wrap"><table>
          <thead><tr><th>Group</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Closing balance</th></tr></thead>
          <tbody>{rows.map((g) => <tr key={g.id}><td style={{ paddingLeft: 12 + depthOf(g, data.groups) * 18 }}>{g.name}</td><td className="num">{num(g.debit) ? money(g.debit) : ''}</td><td className="num">{num(g.credit) ? money(g.credit) : ''}</td><td className="num">{num(g.closing) ? `${money(g.closing)} ${g.closingSide === 'DR' ? 'Dr' : 'Cr'}` : ''}</td></tr>)}</tbody>
        </table></div>
      )}
    </Shell>
  );
}
