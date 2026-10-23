import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi, useTitle } from '../hooks';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, PeriodPicker, Stat, defaultPeriod } from '../components/ui';
import { VOUCHER_LABEL, date, downloadCsv, money, num } from '../format';

export default function LedgerStatement() {
  const { id } = useParams();
  const nav = useNavigate();
  const [period, setPeriod] = useState(defaultPeriod());
  const { data, loading, error, reload } = useApi<any>(`/ledgers/${id}/statement`, { from: period.from, to: period.to }, [id, period.from, period.to]);
  useTitle(data?.ledger.name ?? 'Account statement');
  const side = (s: string) => (s === 'DR' ? 'Dr' : 'Cr');
  return (
    <>
      <PageHeader crumb={<Link to="/accounts">Chart of accounts</Link>} title={data?.ledger.name ?? 'Account statement'} subtitle={data?.ledger.group}
        actions={<Button icon="download" onClick={() => data && downloadCsv(`${data.ledger.name}-statement.csv`, [['Date', 'Voucher', 'Type', 'Narration', 'Debit', 'Credit', 'Balance'], ...data.entries.map((e: any) => [e.date, e.voucherNumber, e.type, e.narration, e.debit, e.credit, `${e.balance} ${side(e.balanceSide)}`])])}>Export CSV</Button>} />
      <Card pad={false}>
        <div className="toolbar"><PeriodPicker value={period} onChange={setPeriod} /></div>
        {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && (
          <>
            <div className="grid g3 card-pad">
              <Stat label="Opening balance" value={`${money(data.opening.amount)} ${side(data.opening.side)}`} />
              <Stat label="Debits less credits in period" value={money(data.entries.reduce((s: number, e: any) => s + num(e.debit) - num(e.credit), 0))} />
              <Stat label="Closing balance" value={`${money(data.closing.amount)} ${side(data.closing.side)}`} />
            </div>
            {!data.entries.length ? <Empty title="No transactions in this period" /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Date</th><th>Voucher</th><th>Type</th><th>Narration</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  <tr className="muted-row"><td colSpan={6}>Opening balance</td><td className="num">{money(data.opening.amount)} {side(data.opening.side)}</td></tr>
                  {data.entries.map((e: any, i: number) => (
                    <tr key={i} className="clickable" onClick={() => nav(`/vouchers/${e.voucherId}`)}>
                      <td className="nowrap">{date(e.date)}</td><td className="mono-id">{e.voucherNumber}</td><td>{VOUCHER_LABEL[e.type] ?? e.type}</td><td>{e.narration ?? '-'}</td>
                      <td className="num">{num(e.debit) ? money(e.debit) : ''}</td><td className="num">{num(e.credit) ? money(e.credit) : ''}</td><td className="num">{money(e.balance)} {side(e.balanceSide)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
