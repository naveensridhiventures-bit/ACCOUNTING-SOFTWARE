import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useTitle } from '../hooks';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, PeriodPicker, Stat, defaultPeriod } from '../components/ui';
import { downloadCsv, money, num, rupee } from '../format';

function RateTable({ title, data }: { title: string; data: any }) {
  return (
    <Card title={title} pad={false}>
      {!data.byRate.length ? <Empty title="No documents in this period" /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>GST rate</th><th className="num">Taxable value</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th><th className="num">Total tax</th></tr></thead>
          <tbody>{data.byRate.map((r: any) => <tr key={r.rate}><td>{num(r.rate)}%</td><td className="num">{money(r.taxable)}</td><td className="num">{money(r.cgst)}</td><td className="num">{money(r.sgst)}</td><td className="num">{money(r.igst)}</td><td className="num">{money(r.tax)}</td></tr>)}</tbody>
          <tfoot><tr><td>Total</td><td className="num">{money(data.total.taxable)}</td><td className="num">{money(data.total.cgst)}</td><td className="num">{money(data.total.sgst)}</td><td className="num">{money(data.total.igst)}</td><td className="num">{money(data.total.tax)}</td></tr></tfoot>
        </table></div>
      )}
      {data.byRate.length > 0 && <div className="card-pad muted small">Registered customers/suppliers (B2B): taxable {money(data.b2b.taxable)}, tax {money(data.b2b.tax)}. Unregistered (B2C): taxable {money(data.b2c.taxable)}, tax {money(data.b2c.tax)}.</div>}
    </Card>
  );
}

export default function Gst() {
  useTitle('GST summary');
  const [period, setPeriod] = useState(defaultPeriod());
  const { data, loading, error, reload } = useApi<any>('/reports/gst', { from: period.from, to: period.to }, [period.from, period.to]);
  return (
    <>
      <PageHeader crumb={<Link to="/reports">Reports</Link>} title="GST summary" subtitle={data && `${data.from} to ${data.to} · credit/debit notes are netted off`}
        actions={<><Button icon="download" onClick={() => data && downloadCsv('gst-hsn-summary.csv', [['HSN/SAC', 'Unit', 'Quantity', 'Taxable value', 'CGST', 'SGST', 'IGST'], ...data.hsn.map((h: any) => [h.hsn, h.unit, h.qty, h.taxable, h.cgst, h.sgst, h.igst])])}>Export HSN CSV</Button><Button icon="print" onClick={() => window.print()}>Print</Button></>} />
      <Card className="no-print"><PeriodPicker value={period} onChange={setPeriod} /></Card>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data && (
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="grid g3">
            <Stat label="Output tax (on sales)" value={rupee(data.liability.heads.reduce((s: number, h: any) => s + num(h.output), 0))} />
            <Stat label="Input tax credit (on purchases)" value={rupee(data.liability.heads.reduce((s: number, h: any) => s + num(h.input), 0))} />
            <Stat label={num(data.liability.netPayable) >= 0 ? 'Net GST payable' : 'Net credit carried forward'} value={rupee(Math.abs(num(data.liability.netPayable)))} tone={num(data.liability.netPayable) > 0 ? 'neg' : 'pos'} foot="From the GST ledgers" />
          </div>
          <Card title="Liability by tax head" pad={false}>
            <div className="table-wrap"><table>
              <thead><tr><th>Tax</th><th className="num">Output</th><th className="num">Input credit</th><th className="num">Payable</th></tr></thead>
              <tbody>{data.liability.heads.map((h: any) => <tr key={h.head}><td>{h.head}</td><td className="num">{money(h.output)}</td><td className="num">{money(h.input)}</td><td className="num">{money(h.payable)}</td></tr>)}</tbody>
              <tfoot><tr><td>Net payable</td><td colSpan={2} /><td className="num">{money(data.liability.netPayable)}</td></tr></tfoot>
            </table></div>
          </Card>
          <RateTable title="Outward supplies (sales)" data={data.outward} />
          <RateTable title="Inward supplies (purchases)" data={data.inward} />
          <Card title="HSN / SAC summary of outward supplies" pad={false}>
            {!data.hsn.length ? <Empty title="No outward supplies in this period" /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>HSN / SAC</th><th>Unit</th><th className="num">Quantity</th><th className="num">Taxable value</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th></tr></thead>
                <tbody>{data.hsn.map((h: any, i: number) => <tr key={i}><td>{h.hsn}</td><td>{h.unit}</td><td className="num">{num(h.qty)}</td><td className="num">{money(h.taxable)}</td><td className="num">{money(h.cgst)}</td><td className="num">{money(h.sgst)}</td><td className="num">{money(h.igst)}</td></tr>)}</tbody>
              </table></div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
