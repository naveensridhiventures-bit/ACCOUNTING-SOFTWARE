import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, post } from '../api';
import { useApi, useTitle } from '../hooks';
import { Button, Card, Combo, Field, PageHeader, useFeedback } from '../components/ui';
import { Icon } from '../components/Icon';
import { money, num, today } from '../format';

interface Line { ledgerId: string; side: 'DR' | 'CR'; amount: string; narration: string }
const blank = (side: 'DR' | 'CR'): Line => ({ ledgerId: '', side, amount: '', narration: '' });

export default function VoucherForm() {
  useTitle('New journal entry');
  const nav = useNavigate();
  const fb = useFeedback();
  const ledgers = useApi<any>('/ledgers', { active: true });
  const [type, setType] = useState('JOURNAL');
  const [dt, setDt] = useState(today());
  const [narration, setNarration] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([blank('DR'), blank('CR')]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => (ledgers.data?.items ?? []).map((l: any) => ({ value: l.id, label: l.name, sub: l.group.name })), [ledgers.data]);
  const dr = lines.filter((l) => l.side === 'DR').reduce((s, l) => s + num(l.amount), 0);
  const cr = lines.filter((l) => l.side === 'CR').reduce((s, l) => s + num(l.amount), 0);
  const diff = Math.round((dr - cr) * 100) / 100;
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const balanceLine = (i: number) => { const others = lines.filter((_, j) => j !== i); const o = others.reduce((s, l) => s + (l.side === 'DR' ? num(l.amount) : -num(l.amount)), 0); set(i, { amount: Math.abs(o).toFixed(2), side: o > 0 ? 'CR' : 'DR' }); };
  const save = async () => {
    setError('');
    const used = lines.filter((l) => l.ledgerId || num(l.amount));
    if (used.some((l) => !l.ledgerId || num(l.amount) <= 0)) return setError('Every line needs an account and an amount greater than zero.');
    if (used.length < 2) return setError('Add at least two lines.');
    if (diff !== 0) return setError(`Debits and credits must be equal. The difference is ${money(Math.abs(diff))}.`);
    setBusy(true);
    try {
      const v = await post('/vouchers', { type, date: dt, narration: narration || undefined, reference: reference || undefined, lines: used.map((l) => ({ ledgerId: l.ledgerId, side: l.side, amount: num(l.amount).toFixed(2), narration: l.narration || undefined })) });
      fb.toast(`${v.number} posted`); nav(`/vouchers/${v.id}`);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="New journal entry" subtitle="Post a manual double-entry voucher. Invoices, bills and receipts have their own screens."
        actions={<><Button onClick={() => nav('/vouchers')}>Cancel</Button><Button variant="primary" loading={busy} disabled={diff !== 0 || dr === 0} onClick={save}>Post voucher</Button></>} />
      <Card>
        <div className="form-grid cols3">
          <Field label="Voucher type"><select value={type} onChange={(e) => setType(e.target.value)}><option value="JOURNAL">Journal</option><option value="CONTRA">Contra (cash/bank moves)</option><option value="PAYMENT">Payment</option><option value="RECEIPT">Receipt</option></select></Field>
          <Field label="Date"><input type="date" value={dt} onChange={(e) => setDt(e.target.value)} /></Field>
          <Field label="Reference"><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} /></Field>
          <Field label="Narration" full><input value={narration} onChange={(e) => setNarration(e.target.value)} maxLength={500} placeholder="What is this entry for?" /></Field>
        </div>
      </Card>
      <Card title="Lines" pad={false} className="mt">
        <div className="table-wrap"><table className="lines">
          <thead><tr><th style={{ width: 90 }}>Dr / Cr</th><th>Account</th><th>Line note</th><th className="num" style={{ width: 170 }}>Amount</th><th style={{ width: 90 }} /></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={i}>
              <td><select value={l.side} onChange={(e) => set(i, { side: e.target.value as 'DR' | 'CR' })} aria-label="Debit or credit"><option value="DR">Dr</option><option value="CR">Cr</option></select></td>
              <td style={{ minWidth: 240 }}><Combo items={items} value={l.ledgerId} onChange={(v) => set(i, { ledgerId: v })} placeholder="Choose account" /></td>
              <td><input value={l.narration} onChange={(e) => set(i, { narration: e.target.value })} aria-label="Line note" /></td>
              <td><input className="num" inputMode="decimal" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} placeholder="0.00" aria-label="Amount" /></td>
              <td className="nowrap">
                {diff !== 0 && <Button size="sm" variant="ghost" title="Fill the amount that balances the voucher" onClick={() => balanceLine(i)}>Balance</Button>}
                {lines.length > 2 && <Button size="sm" variant="ghost" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Icon name="x" /></Button>}
              </td>
            </tr>
          ))}</tbody>
          <tfoot>
            <tr><td colSpan={3} className="right">Total debit</td><td className="num">{money(dr)}</td><td /></tr>
            <tr><td colSpan={3} className="right">Total credit</td><td className="num">{money(cr)}</td><td /></tr>
          </tfoot>
        </table></div>
        <div className="card-pad row" style={{ justifyContent: 'space-between' }}>
          <Button variant="ghost" icon="plus" onClick={() => setLines((ls) => [...ls, blank(diff > 0 ? 'CR' : 'DR')])}>Add line</Button>
          <span className={diff === 0 && dr > 0 ? 'pos' : 'neg'} role="status">{dr === 0 ? 'Enter amounts to begin' : diff === 0 ? 'Balanced' : `Out of balance by ${money(Math.abs(diff))} (${diff > 0 ? 'credit' : 'debit'} needed)`}</span>
        </div>
      </Card>
      {error && <div className="alert" role="alert" style={{ marginTop: 14 }}>{error}</div>}
    </>
  );
}
