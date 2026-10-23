import { useState } from 'react';
import { useApi, useDebounced, useTitle } from '../hooks';
import { Card, Empty, ErrorBox, Loading, PageHeader, Pagination, SearchBox } from '../components/ui';
import { dateTime, titleCase } from '../format';

const brief = (d: any) => (d && typeof d === 'object' ? Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${titleCase(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '');

export default function AuditLog() {
  useTitle('Audit log');
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useApi<any>('/audit-logs', { action: dq || undefined, entity: entity || undefined, page, pageSize: 30 });
  return (
    <>
      <PageHeader title="Audit log" subtitle="A permanent record of who did what. Entries cannot be edited or deleted." />
      <Card pad={false}>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Filter by action, e.g. VOUCHER" />
          <select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} aria-label="Record type"><option value="">All records</option>{['Voucher', 'Document', 'Payment', 'Party', 'Product', 'Ledger', 'User', 'Role', 'Company', 'FinancialYear'].map((e) => <option key={e} value={e}>{e}</option>)}</select>
        </div>
        {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && !data.items.length ? <Empty title="No activity found" /> : data && (
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
            <tbody>{data.items.map((a: any) => (
              <tr key={a.id}><td className="nowrap">{dateTime(a.createdAt)}</td><td>{a.userName ?? 'System'}</td><td>{titleCase(a.action)}</td><td>{a.entity}</td><td className="muted small" style={{ maxWidth: 420 }}><span className="clamp">{brief(a.data)}</span></td></tr>
            ))}</tbody>
          </table></div>
        )}
        {data && <Pagination page={page} pageSize={30} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
