import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useDebounced, useTitle } from '../hooks';
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pagination, PeriodPicker, SearchBox, Period, defaultPeriod, statusBadge, useFeedback } from '../components/ui';
import { date, downloadCsv, money, num, today } from '../format';
import { calcLine } from '../calc';

function ExpenseModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const fb = useFeedback();
  const { company } = useAuth();
  const ledgers = useApi<any>('/ledgers', { nature: 'EXPENSE', active: true });
  const accounts = useApi<any>('/banking/accounts');
  const [f, setF] = useState({ date: today(), expenseLedgerId: '', paidFromId: '', amount: '', gstRate: '0', interState: false, payee: '', reference: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { if (!f.paidFromId && accounts.data?.items.length) set('paidFromId', accounts.data.items[0].id); }, [accounts.data, f.paidFromId]);
  const c = calcLine({ qty: 1, rate: f.amount, discountPct: 0, gstRate: f.gstRate }, f.interState, company?.gstEnabled ?? true);
  const expense = (ledgers.data?.items ?? []).filter((l: any) => !['Purchase Accounts'].includes(l.group.name) && l.systemKey !== 'COGS');
  const save = async () => {
    setError('');
    if (!f.expenseLedgerId) return setError('Choose the expense category.');
    if (num(f.amount) <= 0) return setError('Enter an amount greater than zero.');
    setBusy(true);
    try { const v = await post('/expenses', { date: f.date, expenseLedgerId: f.expenseLedgerId, paidFromId: f.paidFromId, amount: num(f.amount).toFixed(2), gstRate: num(f.gstRate), interState: f.interState, payee: f.payee || undefined, reference: f.reference || undefined, notes: f.notes || undefined }); fb.toast(`Expense ${v.number} recorded`); onSaved(); }
    catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Record expense" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save expense</Button></>}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Category"><select value={f.expenseLedgerId} onChange={(e) => set('expenseLedgerId', e.target.value)}><option value="">Select category</option>{expense.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="Amount before GST"><input className="num" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" /></Field>
        <Field label="GST rate"><select value={f.gstRate} onChange={(e) => set('gstRate', e.target.value)}>{['0', '5', '12', '18', '28'].map((r) => <option key={r} value={r}>{r}%</option>)}</select></Field>
        {num(f.gstRate) > 0 && <label className="check full"><input type="checkbox" checked={f.interState} onChange={(e) => set('interState', e.target.checked)} />Inter-state purchase (IGST instead of CGST + SGST)</label>}
        <Field label="Paid from"><select value={f.paidFromId} onChange={(e) => set('paidFromId', e.target.value)}>{(accounts.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Paid to (optional)"><input value={f.payee} onChange={(e) => set('payee', e.target.value)} /></Field>
        <Field label="Reference"><input value={f.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Bill no. or UTR" /></Field>
        <Field label="Notes"><input value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      {num(f.amount) > 0 && <div className="alert info" style={{ marginTop: 12 }}>Total paid <strong>{money(c.total)}</strong>{c.taxable !== c.total && <> (includes GST {money(c.cgst + c.sgst + c.igst)}, claimable as input credit)</>}</div>}
      {error && <div className="alert" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

export default function Expenses() {
  useTitle('Expenses');
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<Period | null>(null);
  const [adding, setAdding] = useState(params.get('new') === '1');
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useApi<any>('/expenses', { q: dq, page, pageSize: 25, from: period?.from, to: period?.to });
  return (
    <>
      <PageHeader title="Expenses" subtitle={data ? `${data.total} entries · ${money(data.totals.amount)} in total` : 'Rent, salaries, utilities and other costs'}
        actions={<>
          <Button icon="download" onClick={() => data && downloadCsv('expenses.csv', [['Number', 'Date', 'Category', 'Paid from', 'Details', 'GST', 'Total'], ...data.items.map((x: any) => [x.number, x.date, x.category, x.paidFrom, x.narration, x.gst, x.total])])}>Export CSV</Button>
          {can('voucher.create') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Record expense</Button>}
        </>} />
      <Card pad={false}>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search details or reference" />
          <label className="check small"><input type="checkbox" checked={!!period} onChange={(e) => { setPeriod(e.target.checked ? defaultPeriod() : null); setPage(1); }} />Date range</label>
          {period && <PeriodPicker value={period} onChange={(p) => { setPeriod(p); setPage(1); }} />}
        </div>
        {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && !data.items.length ? <Empty title="No expenses recorded" action={can('voucher.create') ? <Button variant="primary" onClick={() => setAdding(true)}>Record your first expense</Button> : undefined}>Expenses paid from cash or bank show up here.</Empty> : data && (
          <div className="table-wrap"><table>
            <thead><tr><th>Number</th><th>Date</th><th>Category</th><th>Details</th><th>Paid from</th><th className="num">GST</th><th className="num">Total</th><th>Status</th></tr></thead>
            <tbody>{data.items.map((x: any) => (
              <tr key={x.id} className={`clickable ${x.status === 'REVERSED' ? 'muted-row' : ''}`} onClick={() => nav(`/vouchers/${x.id}`)}>
                <td className="mono-id">{x.number}</td><td className="nowrap">{date(x.date)}</td><td>{x.category}</td><td>{x.narration}{x.reference && <span className="muted small"> · {x.reference}</span>}</td><td>{x.paidFrom}</td><td className="num">{num(x.gst) ? money(x.gst) : '-'}</td><td className="num" style={{ fontWeight: 500 }}>{money(x.total)}</td><td>{statusBadge(x.status)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      {adding && <ExpenseModal onClose={() => { setAdding(false); if (params.get('new')) setParams({}); }} onSaved={() => { setAdding(false); setParams({}); reload(); }} />}
    </>
  );
}
