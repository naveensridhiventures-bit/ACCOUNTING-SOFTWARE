import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useTitle } from '../hooks';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Stat, useFeedback } from '../components/ui';
import { money, num, rupee, today } from '../format';
import { AccountModal } from './ChartOfAccounts';

function TransferModal({ accounts, onClose, onSaved }: { accounts: any[]; onClose: () => void; onSaved: () => void }) {
  const fb = useFeedback();
  const [f, setF] = useState({ date: today(), fromId: accounts[0]?.id ?? '', toId: accounts[1]?.id ?? '', amount: '', reference: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setError('');
    if (f.fromId === f.toId) return setError('Choose two different accounts.');
    if (num(f.amount) <= 0) return setError('Enter an amount greater than zero.');
    setBusy(true);
    try { await post('/transfers', { date: f.date, fromId: f.fromId, toId: f.toId, amount: num(f.amount).toFixed(2), reference: f.reference || undefined, notes: f.notes || undefined }); fb.toast('Transfer recorded'); onSaved(); }
    catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Transfer between accounts" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Record transfer</Button></>}>
      <div className="form-grid">
        <Field label="From"><select value={f.fromId} onChange={(e) => set('fromId', e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({rupee(a.balance)})</option>)}</select></Field>
        <Field label="To"><select value={f.toId} onChange={(e) => set('toId', e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Amount"><input className="num" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" autoFocus /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Reference"><input value={f.reference} onChange={(e) => set('reference', e.target.value)} placeholder="UTR / cheque no." /></Field>
        <Field label="Notes"><input value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      {error && <div className="alert" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

export default function Banking() {
  useTitle('Cash & bank');
  const { can } = useAuth();
  const nav = useNavigate();
  const { data, loading, error, reload } = useApi<any>('/banking/accounts');
  const groups = useApi<any>('/account-groups');
  const [transfer, setTransfer] = useState(false);
  const [adding, setAdding] = useState(false);
  const items: any[] = data?.items ?? [];
  const active = items.filter((a) => a.isActive);
  const total = items.reduce((s, a) => s + num(a.balance), 0);
  const bankGroups = (groups.data?.items ?? []).filter((g: any) => g.name === 'Bank Accounts' || g.name === 'Cash-in-Hand');
  return (
    <>
      <PageHeader title="Cash & bank" subtitle="Balances as of today"
        actions={<>
          {can('voucher.create') && active.length > 1 && <Button onClick={() => setTransfer(true)}>Transfer money</Button>}
          {can('ledger.write') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add account</Button>}
        </>} />
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : (
        <>
          <div className="grid g3" style={{ marginBottom: 16 }}>
            <Stat label="Total cash and bank" value={rupee(total)} tone={total < 0 ? 'neg' : undefined} />
            <Stat label="Accounts" value={items.length} />
            <Stat label="Not yet matched to bank statement" value={items.reduce((s, a) => s + Math.abs(num(a.unreconciled)), 0) ? rupee(items.reduce((s, a) => s + Math.abs(num(a.unreconciled)), 0)) : 'All matched'} foot="Net of unreconciled entries" />
          </div>
          {!items.length ? <Card><Empty title="No cash or bank accounts" action={can('ledger.write') ? <Button variant="primary" onClick={() => setAdding(true)}>Add an account</Button> : undefined}>Add your bank accounts to record receipts and payments against them.</Empty></Card> : (
            <div className="grid g3">
              {items.map((a) => (
                <Card key={a.id} className={a.isActive ? '' : 'muted-row'}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>{a.name}</strong><Badge tone={a.type === 'CASH' ? 'amber' : 'blue'}>{a.type === 'CASH' ? 'Cash' : 'Bank'}</Badge>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 600, margin: '10px 0 2px' }} className={`num ${num(a.balance) < 0 ? 'neg' : ''}`}>{rupee(a.balance)}</div>
                  <div className="muted small">Book balance{a.type === 'BANK' && <> · Cleared {money(a.clearedBalance)}</>}</div>
                  <div className="row" style={{ marginTop: 14 }}>
                    <Button size="sm" onClick={() => nav(`/ledgers/${a.id}`)}>Statement</Button>
                    {a.type === 'BANK' && <Button size="sm" onClick={() => nav(`/banking/reconcile?ledger=${a.id}`)}>Reconcile</Button>}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
      {transfer && <TransferModal accounts={active} onClose={() => setTransfer(false)} onSaved={() => { setTransfer(false); reload(); }} />}
      {adding && <AccountModal groups={bankGroups} defaultGroup={bankGroups.find((g: any) => g.name === 'Bank Accounts')?.id} lockGroups onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}
