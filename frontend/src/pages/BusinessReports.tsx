import { ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi, useTitle } from '../hooks';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, PeriodPicker, Stat, defaultPeriod } from '../components/ui';
import { ShareBars } from '../components/charts';
import { downloadCsv, money, num, rupee, today } from '../format';

function Shell({ title, subtitle, controls, children, onCsv }: { title: string; subtitle?: string; controls: ReactNode; children: ReactNode; onCsv?: () => void }) {
  useTitle(title);
  return (
    <>
      <PageHeader crumb={<Link to="/reports">Reports</Link>} title={title} subtitle={subtitle} actions={<>{onCsv && <Button icon="download" onClick={onCsv}>Export CSV</Button>}<Button icon="print" onClick={() => window.print()}>Print</Button></>} />
      <Card pad={false}><div className="toolbar no-print">{controls}</div>{children}</Card>
    </>
  );
}

export function Ageing({ kind }: { kind: 'receivables' | 'payables' }) {
  const nav = useNavigate();
  const [asOf, setAsOf] = useState(today());
  const { data, loading, error, reload } = useApi<any>(`/reports/${kind}`, { asOf }, [kind, asOf]);
  const rec = kind === 'receivables';
  const t = data?.totals;
  return (
    <Shell title={rec ? 'Customer outstanding' : 'Supplier outstanding'} subtitle="Aged by due date" controls={<label className="row small muted">As of <input type="date" value={asOf} max={today()} onChange={(e) => e.target.value && setAsOf(e.target.value)} /></label>}
      onCsv={data ? () => downloadCsv(`${kind}.csv`, [['Party', 'Not due', '1-30', '31-60', '61-90', '90+', 'Outstanding', 'Unapplied advance'], ...data.rows.map((r: any) => [r.party, r.current, r.d1_30, r.d31_60, r.d61_90, r.d90plus, r.outstanding, r.unapplied])]) : undefined}>
      {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="grid g3 card-pad">
            <Stat label={rec ? 'Total to collect' : 'Total to pay'} value={rupee(t.outstanding)} />
            <Stat label="Overdue" value={rupee(num(t.d1_30) + num(t.d31_60) + num(t.d61_90) + num(t.d90plus))} tone={num(t.d1_30) + num(t.d31_60) + num(t.d61_90) + num(t.d90plus) ? 'neg' : undefined} />
            <Stat label="Advances not yet applied" value={rupee(t.unapplied)} />
          </div>
          {!data.rows.length ? <Empty title="Nothing outstanding">{rec ? 'Every invoice is settled.' : 'Every bill is paid.'}</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{rec ? 'Customer' : 'Supplier'}</th><th className="num">Not due</th><th className="num">1–30 days</th><th className="num">31–60 days</th><th className="num">61–90 days</th><th className="num">Over 90</th><th className="num">Outstanding</th></tr></thead>
              <tbody>{data.rows.map((r: any) => (
                <tr key={r.partyId} className="clickable" onClick={() => nav(`/parties/${r.partyId}`)}>
                  <td style={{ fontWeight: 500 }}>{r.party}{r.phone && <div className="muted small">{r.phone}</div>}</td>
                  {[r.current, r.d1_30, r.d31_60, r.d61_90, r.d90plus].map((v, i) => <td key={i} className={`num ${i > 1 && num(v) ? 'neg' : ''}`}>{num(v) ? money(v) : ''}</td>)}
                  <td className="num" style={{ fontWeight: 600 }}>{money(r.outstanding)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td>Total</td>{[t.current, t.d1_30, t.d31_60, t.d61_90, t.d90plus, t.outstanding].map((v, i) => <td key={i} className="num">{money(v)}</td>)}</tr></tfoot>
            </table></div>
          )}
        </>
      )}
    </Shell>
  );
}

export function PartySummary({ kind }: { kind: 'SALES' | 'PURCHASE' }) {
  const nav = useNavigate();
  const [period, setPeriod] = useState(defaultPeriod());
  const { data, loading, error, reload } = useApi<any>('/reports/party-summary', { kind, from: period.from, to: period.to }, [kind, period.from, period.to]);
  const sales = kind === 'SALES';
  const total = data ? data.rows.reduce((s: number, r: any) => s + num(r.taxable), 0) : 0;
  return (
    <Shell title={sales ? 'Sales by customer' : 'Purchases by supplier'} subtitle={data && `${data.from} to ${data.to} · net of credit/debit notes`} controls={<PeriodPicker value={period} onChange={setPeriod} />}
      onCsv={data ? () => downloadCsv('party-summary.csv', [['Party', 'GSTIN', 'Documents', 'Taxable value', 'Tax', 'Total'], ...data.rows.map((r: any) => [r.party, r.gstin, r.documents, r.taxable, r.tax, r.total])]) : undefined}>
      {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
      {loading && !data ? <Loading /> : data && !data.rows.length ? <Empty title="No activity in this period" /> : data && (
        <>
          <div className="card-pad"><ShareBars rows={data.rows.slice(0, 8).map((r: any) => ({ label: r.party, value: num(r.taxable), display: rupee(r.taxable), onClick: () => nav(`/parties/${r.partyId}`) }))} /></div>
          <div className="table-wrap"><table>
            <thead><tr><th>{sales ? 'Customer' : 'Supplier'}</th><th>GSTIN</th><th className="num">Documents</th><th className="num">Taxable value</th><th className="num">Tax</th><th className="num">Total</th><th className="num">Share</th></tr></thead>
            <tbody>{data.rows.map((r: any) => (
              <tr key={r.partyId} className="clickable" onClick={() => nav(`/parties/${r.partyId}`)}><td style={{ fontWeight: 500 }}>{r.party}</td><td className="muted">{r.gstin ?? '-'}</td><td className="num">{r.documents}</td><td className="num">{money(r.taxable)}</td><td className="num">{money(r.tax)}</td><td className="num">{money(r.total)}</td><td className="num">{total ? `${((num(r.taxable) / total) * 100).toFixed(1)}%` : ''}</td></tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td className="num">{money(total)}</td><td className="num">{money(data.rows.reduce((s: number, r: any) => s + num(r.tax), 0))}</td><td className="num">{money(data.rows.reduce((s: number, r: any) => s + num(r.total), 0))}</td><td /></tr></tfoot>
          </table></div>
        </>
      )}
    </Shell>
  );
}

export function ProductSummary({ kind }: { kind: 'SALES' | 'PURCHASE' }) {
  const nav = useNavigate();
  const [period, setPeriod] = useState(defaultPeriod());
  const { data, loading, error, reload } = useApi<any>('/reports/product-summary', { kind, from: period.from, to: period.to }, [kind, period.from, period.to]);
  const sales = kind === 'SALES';
  const sum = (k: string) => (data ? data.rows.reduce((s: number, r: any) => s + num(r[k]), 0) : 0);
  return (
    <Shell title={sales ? 'Sales by product' : 'Purchases by product'} subtitle={data && `${data.from} to ${data.to}`} controls={<PeriodPicker value={period} onChange={setPeriod} />}
      onCsv={data ? () => downloadCsv('product-summary.csv', [['Item', 'Unit', 'Quantity', 'Taxable value', ...(sales ? ['Cost', 'Margin', 'Margin %'] : [])], ...data.rows.map((r: any) => [r.name, r.unit, r.qty, r.taxable, ...(sales ? [r.cost, r.margin, r.marginPct] : [])])]) : undefined}>
      {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
      {loading && !data ? <Loading /> : data && !data.rows.length ? <Empty title="No activity in this period" /> : data && (
        <div className="table-wrap"><table>
          <thead><tr><th>Item</th><th className="num">Quantity</th><th className="num">{sales ? 'Sales' : 'Purchases'} (taxable)</th>{sales && <><th className="num">Cost of goods</th><th className="num">Margin</th><th className="num">Margin %</th></>}</tr></thead>
          <tbody>{data.rows.map((r: any, i: number) => (
            <tr key={i} className={r.productId ? 'clickable' : ''} onClick={() => r.productId && nav(`/products/${r.productId}`)}>
              <td style={{ fontWeight: 500 }}>{r.name}</td><td className="num">{num(r.qty)} {r.unit}</td><td className="num">{money(r.taxable)}</td>
              {sales && <><td className="num">{money(r.cost)}</td><td className={`num ${num(r.margin) < 0 ? 'neg' : ''}`}>{money(r.margin)}</td><td className="num">{r.marginPct != null ? `${r.marginPct}%` : ''}</td></>}
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={2}>Total</td><td className="num">{money(sum('taxable'))}</td>{sales && <><td className="num">{money(sum('cost'))}</td><td className="num">{money(sum('margin'))}</td><td /></>}</tr></tfoot>
        </table></div>
      )}
    </Shell>
  );
}
