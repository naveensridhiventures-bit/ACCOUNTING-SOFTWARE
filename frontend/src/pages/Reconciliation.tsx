import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, del, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useTitle } from '../hooks';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Stat, Tabs, useFeedback } from '../components/ui';
import { date, money, num, rupee, today } from '../format';

export default function Reconciliation() {
  useTitle('Bank reconciliation');
  const { can } = useAuth();
  const fb = useFeedback();
  const [sp, setSp] = useSearchParams();
  const accounts = useApi<any>('/banking/accounts');
  const banks: any[] = (accounts.data?.items ?? []).filter((a: any) => a.type === 'BANK' && a.isActive);
  const ledgerId = sp.get('ledger') ?? banks[0]?.id ?? '';
  const [to, setTo] = useState(today());
  const [show, setShow] = useState<'unreconciled' | 'all'>('unreconciled');
  const rec = useApi<any>(ledgerId ? '/banking/reconciliation' : null, { ledgerId, to, show }, [ledgerId, to, show]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [statementBalance, setStatementBalance] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setPicked({}), [ledgerId, to, show]);
  const write = can('bank.reconcile');
  const items: any[] = rec.data?.items ?? [];
  const pickedNet = useMemo(() => items.filter((i) => picked[i.lineId]).reduce((s, i) => s + num(i.debit) - num(i.credit), 0), [items, picked]);
  const afterBalance = rec.data ? num(rec.data.clearedBalance) + pickedNet : 0;
  const diff = statementBalance === '' ? null : num(statementBalance) - afterBalance;
  const toggle = (i: any) => setPicked((p) => { const n = { ...p }; if (n[i.lineId]) delete n[i.lineId]; else n[i.lineId] = i.date <= today() ? i.date : today(); return n; });
  const save = async () => {
    setBusy(true);
    try {
      await post('/banking/reconciliation', { ledgerId, items: Object.entries(picked).map(([lineId, bankDate]) => ({ lineId, bankDate })) });
      fb.toast(`${Object.keys(picked).length} entries marked as cleared`); setPicked({}); rec.reload(); accounts.reload();
    } catch (e) { fb.error(e as ApiError); } finally { setBusy(false); }
  };
  const unmatch = async (i: any) => { try { await del(`/banking/reconciliation/${i.lineId}`); fb.toast('Entry marked as not cleared'); rec.reload(); accounts.reload(); } catch (e) { fb.error(e); } };
  return (
    <>
      <PageHeader title="Bank reconciliation" subtitle="Tick the entries that appear on your bank statement" />
      {accounts.error && <ErrorBox error={accounts.error} onRetry={accounts.reload} />}
      {accounts.data && !banks.length ? <Card><Empty title="No bank accounts">Add a bank account under Cash & bank first.</Empty></Card> : (
        <>
          <Card pad={false} className="" >
            <div className="toolbar">
              <select value={ledgerId} onChange={(e) => setSp({ ledger: e.target.value })} aria-label="Bank account" style={{ minWidth: 220 }}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              <label className="row small muted">Statement date <input type="date" value={to} max={today()} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
              <Tabs tabs={[{ id: 'unreconciled', label: 'Not cleared' }, { id: 'all', label: 'All entries' }]} value={show} onChange={setShow} />
            </div>
          </Card>
          {rec.data && (
            <div className="grid g4" style={{ margin: '16px 0' }}>
              <Stat label="Book balance" value={rupee(rec.data.bookBalance)} />
              <Stat label="Cleared balance" value={rupee(rec.data.clearedBalance)} foot="What your statement should show" />
              <Stat label="Selected now" value={rupee(pickedNet)} foot={`${Object.keys(picked).length} entries`} />
              <Card>
                <label className="small muted" htmlFor="sb">Closing balance on your statement</label>
                <input id="sb" className="num" inputMode="decimal" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} placeholder="0.00" style={{ marginTop: 6 }} />
                {diff !== null && <div className={`small ${Math.abs(diff) < 0.005 ? 'pos' : 'neg'}`} style={{ marginTop: 6 }}>{Math.abs(diff) < 0.005 ? 'Matches after clearing selected entries' : `Difference ${money(diff)}`}</div>}
              </Card>
            </div>
          )}
          <Card pad={false} title="Entries" actions={write && Object.keys(picked).length ? <Button variant="primary" loading={busy} onClick={save}>Mark {Object.keys(picked).length} as cleared</Button> : undefined}>
            {rec.error && <div className="card-pad"><ErrorBox error={rec.error} onRetry={rec.reload} /></div>}
            {rec.loading && !rec.data ? <Loading /> : rec.data && !items.length ? <Empty title={show === 'all' ? 'No entries' : 'Everything is cleared'}>{show === 'all' ? 'No transactions on this account yet.' : 'All entries up to this date are matched with your statement.'}</Empty> : rec.data && (
              <div className="table-wrap"><table>
                <thead><tr><th style={{ width: 36 }} /><th>Date</th><th>Voucher</th><th>Details</th><th className="num">Money in</th><th className="num">Money out</th><th>Bank date</th></tr></thead>
                <tbody>{items.map((i) => (
                  <tr key={i.lineId}>
                    <td>{!i.reconciled && write && <input type="checkbox" checked={!!picked[i.lineId]} onChange={() => toggle(i)} aria-label={`Select ${i.voucherNumber}`} />}</td>
                    <td className="nowrap">{date(i.date)}</td><td className="mono-id">{i.voucherNumber}</td><td>{i.narration ?? '-'}{i.reference && <div className="muted small">Ref {i.reference}</div>}</td>
                    <td className="num">{num(i.debit) ? money(i.debit) : ''}</td><td className="num">{num(i.credit) ? money(i.credit) : ''}</td>
                    <td>{i.reconciled ? <span className="row"><Badge tone="green">{date(i.bankDate)}</Badge>{write && <Button size="sm" variant="ghost" onClick={() => unmatch(i)}>Undo</Button>}</span> : picked[i.lineId] ? <input type="date" value={picked[i.lineId]} onChange={(e) => setPicked((p) => ({ ...p, [i.lineId]: e.target.value }))} style={{ width: 'auto' }} aria-label="Bank date" /> : <span className="faint">-</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
