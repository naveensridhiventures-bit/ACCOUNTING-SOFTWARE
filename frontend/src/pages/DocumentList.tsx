import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { useApi, useDebounced, useTitle } from '../hooks';
import { Amt, Button, Card, Empty, ErrorBox, Loading, PageHeader, Pagination, PeriodPicker, SearchBox, statusBadge, defaultPeriod, Period } from '../components/ui';
import { date, DOC_LABEL, downloadCsv, money } from '../format';

type DocType = 'SALES_INVOICE' | 'PURCHASE_BILL' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
const META: Record<DocType, { title: string; path: string; singular: string; party: string; write: string }> = {
  SALES_INVOICE: { title: 'Sales invoices', path: '/sales/invoices', singular: 'invoice', party: 'Customer', write: 'sales.write' },
  PURCHASE_BILL: { title: 'Purchase bills', path: '/purchases/bills', singular: 'bill', party: 'Supplier', write: 'purchase.write' },
  CREDIT_NOTE: { title: 'Credit notes', path: '/sales/credit-notes', singular: 'credit note', party: 'Customer', write: 'sales.write' },
  DEBIT_NOTE: { title: 'Debit notes', path: '/purchases/debit-notes', singular: 'debit note', party: 'Supplier', write: 'purchase.write' },
};

export default function DocumentList({ type }: { type: DocType }) {
  const m = META[type];
  useTitle(m.title);
  const { can } = useAuth();
  const nav = useNavigate();
  const settleable = type === 'SALES_INVOICE' || type === 'PURCHASE_BILL';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState<Period | null>(null);
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const query = { type, q: dq, page, pageSize: 25, from: period?.from, to: period?.to, ...(status === 'CANCELLED' ? { status } : status ? { paymentStatus: status } : {}) };
  const { data, loading, error, reload } = useApi<any>('/documents', query);

  return (
    <>
      <PageHeader title={m.title} subtitle={data ? `${data.total} ${data.total === 1 ? 'document' : 'documents'}${data.totals?.total ? ` · total ${money(data.totals.total)}` : ''}` : undefined}
        actions={<>
          <Button icon="download" onClick={async () => {
                        const r = await get('/documents', { ...query, page: 1, pageSize: 200 });
            downloadCsv(`${m.title.toLowerCase().replace(/ /g, '-')}.csv`, [['Number', 'Date', 'Due date', m.party, 'Reference', 'Taxable', 'Tax', 'Total', 'Balance', 'Status'], ...r.items.map((d: any) => [d.number, d.date, d.dueDate, d.party.name, d.reference, d.taxable, d.tax, d.total, d.balance, d.status === 'CANCELLED' ? 'Cancelled' : d.paymentStatus])]);
          }}>Export CSV</Button>
          {can(m.write) && <Button variant="primary" icon="plus" onClick={() => nav(`${m.path}/new`)}>New {m.singular}</Button>}
        </>} />
      <Card pad={false}>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={`Search number, ${m.party.toLowerCase()} or reference`} />
          {settleable && (
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
              <option value="">All statuses</option>
              <option value="OPEN">Not fully paid</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIAL">Partly paid</option>
              <option value="PAID">Paid</option>
              <option value="OVERDUE">Overdue</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          )}
          <label className="check small"><input type="checkbox" checked={!!period} onChange={(e) => { setPeriod(e.target.checked ? defaultPeriod() : null); setPage(1); }} />Date range</label>
          {period && <PeriodPicker value={period} onChange={(p) => { setPeriod(p); setPage(1); }} />}
        </div>
        {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && data.items.length === 0 ? (
          <Empty title={q || status || period ? 'Nothing matches these filters' : `No ${m.title.toLowerCase()} yet`} action={!q && !status && can(m.write) ? <Button variant="primary" onClick={() => nav(`${m.path}/new`)}>Create your first {m.singular}</Button> : undefined}>
            {q || status || period ? 'Try clearing the search or filters.' : 'They will appear here once you create them.'}
          </Empty>
        ) : data && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Number</th><th>Date</th>{settleable && <th>Due</th>}<th>{m.party}</th><th className="num">Taxable</th><th className="num">Tax</th><th className="num">Total</th><th className="num">{settleable ? 'Balance' : 'Unused credit'}</th><th>Status</th></tr></thead>
              <tbody>
                {data.items.map((d: any) => (
                  <tr key={d.id} className={`clickable ${d.status === 'CANCELLED' ? 'muted-row' : ''}`} onClick={() => nav(`/documents/${d.id}`)}>
                    <td><Link to={`/documents/${d.id}`} className="mono-id strike" onClick={(e) => e.stopPropagation()}>{d.number}</Link>{d.reference && <div className="muted small">{d.reference}</div>}</td>
                    <td className="nowrap">{date(d.date)}</td>
                    {settleable && <td className="nowrap">{date(d.dueDate)}</td>}
                    <td>{d.party.name}</td>
                    <td className="num">{money(d.taxable)}</td>
                    <td className="num">{money(d.tax)}</td>
                    <td className="num" style={{ fontWeight: 500 }}>{money(d.total)}</td>
                    <td className="num">{d.status === 'CANCELLED' ? '-' : <Amt v={d.balance} />}</td>
                    <td>{settleable ? statusBadge(d.paymentStatus, d.overdue) : d.status === 'CANCELLED' ? statusBadge('CANCELLED') : Number(d.balance) > 0 ? <span className="badge amber">{DOC_LABEL[type]} open</span> : <span className="badge green">Fully applied</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
