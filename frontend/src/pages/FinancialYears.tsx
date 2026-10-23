import { useState } from 'react';
import { ApiError, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useTitle } from '../hooks';
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, PageHeader, useFeedback } from '../components/ui';
import { addDays, date, money, num, rupee } from '../format';

function NewYearModal({ last, onClose, onSaved }: { last?: any; onClose: () => void; onSaved: () => void }) {
  const fb = useFeedback();
  const start = last ? addDays(String(last.endDate).slice(0, 10), 1) : `${new Date().getFullYear()}-04-01`;
  const endDefault = `${Number(start.slice(0, 4)) + 1}-03-31`;
  const [f, setF] = useState({ name: `FY ${start.slice(0, 4)}-${String(Number(start.slice(0, 4)) + 1).slice(2)}`, startDate: start, endDate: endDefault });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setError(''); try { await post('/financial-years', f); fb.toast('Financial year created'); onSaved(); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); } };
  return (
    <Modal title="New financial year" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Create year</Button></>}>
      <div className="form-grid">
        <Field label="Name" full><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={30} /></Field>
        <Field label="Starts"><input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="Ends"><input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
      </div>
      {error && <div className="alert" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

function CloseModal({ fy, onClose, onDone }: { fy: any; onClose: () => void; onDone: () => void }) {
  const fb = useFeedback();
  const { data, loading, error } = useApi<any>(`/financial-years/${fy.id}/closing-preview`);
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const run = async () => { setBusy(true); try { const r = await post(`/financial-years/${fy.id}/close`); fb.toast(r.voucherNumber ? `${fy.name} closed (${r.voucherNumber})` : `${fy.name} closed`); onDone(); } catch (e) { fb.error(e); } finally { setBusy(false); } };
  return (
    <Modal wide title={`Close ${fy.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={!ack || loading} onClick={run}>Close financial year</Button></>}>
      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : data && (
        <div className="stack">
          <p>Closing moves this year’s income and expenses into <strong>Retained Earnings</strong> with one journal entry dated {date(fy.endDate)}, then locks the year so nothing more can be posted to it.</p>
          <div className={`alert ${num(data.netProfit) >= 0 ? 'ok' : 'warn'}`}>{num(data.netProfit) >= 0 ? 'Net profit' : 'Net loss'} to transfer: <strong>{rupee(Math.abs(num(data.netProfit)))}</strong></div>
          {data.ledgers.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}><table>
              <thead><tr><th>Account to clear</th><th className="num">Balance</th></tr></thead>
              <tbody>{data.ledgers.map((l: any) => <tr key={l.ledgerId}><td>{l.name}</td><td className="num">{money(l.balance)} {l.side === 'DR' ? 'Dr' : 'Cr'}</td></tr>)}</tbody>
            </table></div>
          )}
          <div className="alert info">The closing entry is dated the last day of the year, so the balance sheet shows profit under Retained Earnings only from that date. You can re-open the year later if you need to correct something.</div>
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I have posted all entries for {fy.name} and want to close it.</label>
        </div>
      )}
    </Modal>
  );
}

export default function FinancialYears() {
  useTitle('Financial years');
  const { can } = useAuth();
  const fb = useFeedback();
  const { data, loading, error, reload } = useApi<any>('/financial-years');
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState<any>(null);
  const manage = can('fy.manage');
  const reopen = async (fy: any) => {
    const ok = await fb.confirm({ title: `Re-open ${fy.name}?`, message: 'The year-end closing entry is reversed and posting is allowed again. Close the year again when you are done.', confirmLabel: 'Re-open year' });
    if (ok === null) return;
    try { await post(`/financial-years/${fy.id}/reopen`); fb.toast(`${fy.name} re-opened`); reload(); } catch (e) { fb.error(e); }
  };
  const items: any[] = data?.items ?? [];
  return (
    <>
      <PageHeader title="Financial years" subtitle="Each year has its own document numbering. Closed years are locked." actions={manage ? <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>New year</Button> : undefined} />
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : (
        <Card pad={false}><div className="table-wrap"><table>
          <thead><tr><th>Year</th><th>From</th><th>To</th><th>Status</th><th /></tr></thead>
          <tbody>{items.map((fy) => (
            <tr key={fy.id}><td style={{ fontWeight: 500 }}>{fy.name}</td><td>{date(fy.startDate)}</td><td>{date(fy.endDate)}</td><td>{fy.isClosed ? <Badge>Closed</Badge> : <Badge tone="green">Open</Badge>}</td>
              <td className="right">{manage && (fy.isClosed ? <Button size="sm" onClick={() => reopen(fy)}>Re-open</Button> : <Button size="sm" onClick={() => setClosing(fy)}>Close year</Button>)}</td></tr>
          ))}</tbody>
        </table></div></Card>
      )}
      {adding && <NewYearModal last={items[0]} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      {closing && <CloseModal fy={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); reload(); }} />}
    </>
  );
}
