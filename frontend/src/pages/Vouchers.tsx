import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useApi, useDebounced, useTitle } from '../hooks';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Pagination, PeriodPicker, SearchBox, defaultPeriod, statusBadge } from '../components/ui';
import { VOUCHER_LABEL, date, downloadCsv, money, titleCase } from '../format';

export default function Vouchers() {
  useTitle('Vouchers');
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState(defaultPeriod());
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useApi<any>('/vouchers', { q: dq, type: type || undefined, source: source || undefined, status: status || undefined, from: period.from, to: period.to, page, pageSize: 25 });
  const reset = () => setPage(1);
  return (
    <>
      <PageHeader title="Vouchers" subtitle="Day book: every entry in your books, newest first"
        actions={<>
          <Button icon="download" onClick={() => data && downloadCsv('vouchers.csv', [['Date', 'Number', 'Type', 'Source', 'Narration', 'Amount', 'Status'], ...data.items.map((v: any) => [v.date.slice(0, 10), v.number, VOUCHER_LABEL[v.type] ?? v.type, v.source, v.narration, v.totalAmount, v.status])])}>Export CSV</Button>
          {can('voucher.create') && <Button variant="primary" icon="plus" onClick={() => nav('/vouchers/new')}>New journal entry</Button>}
        </>} />
      <Card pad={false}>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); reset(); }} placeholder="Search number, narration or reference" />
          <select value={type} onChange={(e) => { setType(e.target.value); reset(); }} aria-label="Type"><option value="">All types</option>{Object.entries(VOUCHER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select value={source} onChange={(e) => { setSource(e.target.value); reset(); }} aria-label="Created from"><option value="">Any origin</option>{['MANUAL', 'INVOICE', 'PAYMENT', 'EXPENSE', 'ADJUSTMENT', 'OPENING', 'CLOSING'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} aria-label="Status"><option value="">Any status</option><option value="POSTED">Posted</option><option value="REVERSED">Reversed</option></select>
          <PeriodPicker value={period} onChange={(p) => { setPeriod(p); reset(); }} />
        </div>
        {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && !data.items.length ? <Empty title="No vouchers in this period">Change the dates or filters, or post a journal entry.</Empty> : data && (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Number</th><th>Type</th><th>Narration</th><th>Origin</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>{data.items.map((v: any) => (
              <tr key={v.id} className="clickable" onClick={() => nav(`/vouchers/${v.id}`)}>
                <td className="nowrap">{date(v.date)}</td><td className="mono-id">{v.number}</td><td>{VOUCHER_LABEL[v.type] ?? v.type}</td>
                <td style={{ maxWidth: 380 }}><span className="clamp">{v.narration ?? '-'}</span></td><td className="muted">{titleCase(v.source)}</td>
                <td className="num">{money(v.totalAmount)}</td><td>{statusBadge(v.status)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
