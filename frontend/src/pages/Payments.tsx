import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useDebounced, useTitle } from '../hooks';
import { Amt, Badge, Button, Card, Combo, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pagination, PeriodPicker, SearchBox, defaultPeriod, Period, useFeedback } from '../components/ui';
import { date, downloadCsv, money, num, titleCase, today } from '../format';

interface OpenDoc { id: string; type: string; number: string; date: string; dueDate: string | null; total: string; outstanding: string }

/** Record a receipt (from a customer) or payment (to a supplier) and settle invoices / bills in one step. */
export function PaymentModal({ direction, partyId: fixedParty, documentId, onClose, onSaved }: { direction: 'RECEIVED' | 'PAID'; partyId?: string; documentId?: string; onClose: () => void; onSaved: () => void }) {
  const fb = useFeedback();
  const received = direction === 'RECEIVED';
  const parties = useApi<any>('/parties', { type: received ? 'CUSTOMER' : 'SUPPLIER', active: true, pageSize: 200 });
  const accounts = useApi<any>('/banking/accounts');
  const [partyId, setPartyId] = useState(fixedParty ?? '');
  const open = useApi<any>(partyId ? `/parties/${partyId}/open-items` : null);
  const [accountId, setAccountId] = useState('');
  const [d, setD] = useState(today());
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('BANK');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const docs: OpenDoc[] = open.data?.documents ?? [];
  useEffect(() => { if (!accountId && accounts.data?.items.length) setAccountId((accounts.data.items.find((a: any) => a.type === (mode === 'CASH' ? 'CASH' : 'BANK')) ?? accounts.data.items[0]).id); }, [accounts.data, accountId, mode]);
  // when opened from a document, pre-fill its outstanding amount
  useEffect(() => {
    if (!documentId || !docs.length) return;
    const target = docs.find((x) => x.id === documentId);
    if (target) { setAmount(target.outstanding); setAlloc({ [target.id]: target.outstanding }); }
  }, [documentId, open.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const distribute = (total: number, firstId?: string) => {
    let left = total;
    const ordered = [...docs].sort((a, b) => (a.id === firstId ? -1 : b.id === firstId ? 1 : 0));
    const next: Record<string, string> = {};
    for (const x of ordered) { const take = Math.min(left, num(x.outstanding)); if (take > 0) { next[x.id] = take.toFixed(2); left = Math.round((left - take) * 100) / 100; } }
    setAlloc(next);
  };
  const allocated = useMemo(() => Object.values(alloc).reduce((a, v) => a + num(v), 0), [alloc]);
  const onAccount = Math.round((num(amount) - allocated) * 100) / 100;

  const save = async () => {
    setError('');
    if (!partyId) return setError(`Choose a ${received ? 'customer' : 'supplier'}.`);
    if (!accountId) return setError('Choose the cash or bank account.');
    if (num(amount) <= 0) return setError('Enter an amount greater than zero.');
    if (onAccount < 0) return setError('The allocated amount is more than the payment amount.');
    setBusy(true);
    try {
      const allocations = Object.entries(alloc).filter(([, v]) => num(v) > 0).map(([documentId, v]) => ({ documentId, amount: num(v).toFixed(2) }));
      const p = await post('/payments', { direction, partyId, accountId, date: d, amount: num(amount).toFixed(2), mode, reference: reference || undefined, notes: notes || undefined, allocations });
      fb.toast(`${received ? 'Receipt' : 'Payment'} ${p.voucherNumber} recorded`);
      onSaved();
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };

  return (
    <Modal wide title={received ? 'Record receipt' : 'Record payment'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{received ? 'Save receipt' : 'Save payment'}</Button></>}>
      <div className="form-grid">
        <Field label={received ? 'Received from' : 'Paid to'} full>
          <Combo disabled={!!fixedParty} value={partyId} onChange={(v) => { setPartyId(v); setAlloc({}); }} items={(parties.data?.items ?? []).map((p: any) => ({ value: p.id, label: p.name, sub: p.city ?? '' }))} placeholder="Search" />
        </Field>
        <Field label="Date"><input type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        <Field label="Amount"><input className="num" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); distribute(num(e.target.value), documentId); }} placeholder="0.00" /></Field>
        <Field label="Mode">
          <select value={mode} onChange={(e) => { setMode(e.target.value); setAccountId(''); }}>
            {['BANK', 'UPI', 'CHEQUE', 'CARD', 'CASH', 'OTHER'].map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
          </select>
        </Field>
        <Field label={received ? 'Deposit to' : 'Paid from'}>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {(accounts.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Reference" hint="Cheque no., UTR or UPI id"><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} /></Field>
      </div>
      {partyId && (
        <div style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <strong>{received ? 'Settle invoices' : 'Settle bills'}</strong>
            <Button size="sm" onClick={() => distribute(num(amount), documentId)} disabled={!docs.length}>Auto-allocate oldest first</Button>
          </div>
          {open.loading && !open.data ? <Loading rows={2} /> : docs.length ? (
            <div className="table-wrap card"><table>
              <thead><tr><th>Document</th><th>Due</th><th className="num">Outstanding</th><th className="num" style={{ width: 150 }}>Settle now</th></tr></thead>
              <tbody>{docs.map((x) => (
                <tr key={x.id}><td className="mono-id">{x.number}<div className="muted small">{date(x.date)}</div></td><td className="nowrap">{date(x.dueDate)}</td><td className="num">{money(x.outstanding)}</td>
                  <td><input className="num" inputMode="decimal" value={alloc[x.id] ?? ''} placeholder="0.00" aria-label={`Amount for ${x.number}`} onChange={(e) => setAlloc({ ...alloc, [x.id]: e.target.value })} /></td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="muted">No open {received ? 'invoices' : 'bills'} for this {received ? 'customer' : 'supplier'}. The amount will be kept on account.</div>}
          <div className="row small" style={{ justifyContent: 'flex-end', marginTop: 8, gap: 18 }}>
            <span>Allocated <strong className="num">{money(allocated)}</strong></span>
            <span className={onAccount < 0 ? 'neg' : 'muted'}>{onAccount < 0 ? 'Over-allocated by' : 'Kept on account'} <strong className="num">{money(Math.abs(onAccount))}</strong></span>
          </div>
        </div>
      )}
      <Field label="Notes" className="" ><input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
      {error && <div className="alert" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

export default function Payments({ direction }: { direction: 'RECEIVED' | 'PAID' }) {
  const received = direction === 'RECEIVED';
  const title = received ? 'Receipts' : 'Payments';
  useTitle(title);
  const { can } = useAuth();
  const fb = useFeedback();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<Period | null>(null);
  const [adding, setAdding] = useState(false);
  const [allocFor, setAllocFor] = useState<any>(null);
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useApi<any>('/payments', { direction, q: dq, page, pageSize: 25, from: period?.from, to: period?.to });

  const cancel = async (p: any) => {
    const reason = await fb.confirm({ title: `Cancel ${p.number}?`, message: 'The entry is reversed in the books and any invoices it settled become outstanding again.', confirmLabel: 'Cancel payment', danger: true, reason: true });
    if (reason === null) return;
    try { await post(`/payments/${p.id}/cancel`, { reason: reason || undefined }); fb.toast(`${p.number} cancelled`); reload(); } catch (e) { fb.error(e); }
  };

  return (
    <>
      <PageHeader title={title} subtitle={received ? 'Money received from customers' : 'Money paid to suppliers'}
        actions={<>
          <Button icon="download" onClick={() => data && downloadCsv(`${title.toLowerCase()}.csv`, [['Number', 'Date', received ? 'Customer' : 'Supplier', 'Mode', 'Account', 'Reference', 'Amount', 'Allocated', 'Unallocated', 'Status'], ...data.items.map((p: any) => [p.number, p.date, p.party.name, p.mode, p.account, p.reference, p.amount, p.allocated, p.unallocated, p.status])])}>Export CSV</Button>
          {can('payment.write') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>{received ? 'Record receipt' : 'Record payment'}</Button>}
        </>} />
      <Card pad={false}>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search number, party or reference" />
          <label className="check small"><input type="checkbox" checked={!!period} onChange={(e) => { setPeriod(e.target.checked ? defaultPeriod() : null); setPage(1); }} />Date range</label>
          {period && <PeriodPicker value={period} onChange={(p) => { setPeriod(p); setPage(1); }} />}
        </div>
        {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && !data.items.length ? <Empty title={`No ${title.toLowerCase()} yet`} action={can('payment.write') ? <Button variant="primary" onClick={() => setAdding(true)}>{received ? 'Record a receipt' : 'Record a payment'}</Button> : undefined}>Entries appear here as soon as you record them.</Empty> : data && (
          <div className="table-wrap"><table>
            <thead><tr><th>Number</th><th>Date</th><th>{received ? 'Customer' : 'Supplier'}</th><th>Mode</th><th>Account</th><th className="num">Amount</th><th className="num">On account</th><th /></tr></thead>
            <tbody>{data.items.map((p: any) => (
              <tr key={p.id} className={p.status === 'CANCELLED' ? 'muted-row' : ''}>
                <td><span className="mono-id strike">{p.number}</span>{p.reference && <div className="muted small">{p.reference}</div>}</td>
                <td className="nowrap">{date(p.date)}</td>
                <td><Link to={`/parties/${p.party.id}`}>{p.party.name}</Link></td>
                <td>{titleCase(p.mode)}</td><td>{p.account}</td>
                <td className="num" style={{ fontWeight: 500 }}>{money(p.amount)}</td>
                <td className="num">{p.status === 'CANCELLED' ? <Badge tone="red">Cancelled</Badge> : num(p.unallocated) > 0 ? <span className="row" style={{ justifyContent: 'flex-end' }}><Amt v={p.unallocated} />{can('payment.write') && <Button size="sm" onClick={() => setAllocFor(p)}>Apply</Button>}</span> : <span className="muted">Fully applied</span>}</td>
                <td className="right">{p.status === 'ACTIVE' && can('payment.write') && <Button size="sm" variant="danger" onClick={() => cancel(p)}>Cancel</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      {adding && <PaymentModal direction={direction} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      {allocFor && <ApplyPaymentModal payment={allocFor} onClose={() => setAllocFor(null)} onSaved={() => { setAllocFor(null); reload(); }} />}
    </>
  );
}

/** Apply the unallocated part of an existing payment to open invoices / bills. */
function ApplyPaymentModal({ payment, onClose, onSaved }: { payment: any; onClose: () => void; onSaved: () => void }) {
  const fb = useFeedback();
  const open = useApi<any>(`/parties/${payment.party.id}/open-items`);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const docs: OpenDoc[] = open.data?.documents ?? [];
  const sum = Object.values(alloc).reduce((a, v) => a + num(v), 0);
  const left = num(payment.unallocated) - sum;
  const save = async () => {
    setBusy(true);
    try {
      const items = Object.entries(alloc).filter(([, v]) => num(v) > 0).map(([documentId, v]) => ({ documentId, amount: num(v).toFixed(2) }));
      await post(`/payments/${payment.id}/allocate`, { items });
      fb.toast('Payment applied'); onSaved();
    } catch (e) { fb.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={`Apply ${payment.number}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={sum <= 0 || left < 0} onClick={save}>Apply</Button></>}>
      <p className="muted" style={{ marginBottom: 10 }}>{money(payment.unallocated)} from {payment.party.name} is not yet applied to any document.</p>
      {open.loading ? <Loading rows={2} /> : docs.length ? (
        <div className="table-wrap card"><table>
          <thead><tr><th>Document</th><th className="num">Outstanding</th><th className="num" style={{ width: 150 }}>Apply</th></tr></thead>
          <tbody>{docs.map((x) => <tr key={x.id}><td className="mono-id">{x.number}</td><td className="num">{money(x.outstanding)}</td><td><input className="num" value={alloc[x.id] ?? ''} aria-label={`Apply to ${x.number}`} onChange={(e) => setAlloc({ ...alloc, [x.id]: e.target.value })} /></td></tr>)}</tbody>
        </table></div>
      ) : <div className="muted">There is nothing outstanding to apply it to.</div>}
      <div className={`small ${left < 0 ? 'neg' : 'muted'}`} style={{ marginTop: 8, textAlign: 'right' }}>{left < 0 ? 'More than available by' : 'Remaining'} {money(Math.abs(left))}</div>
    </Modal>
  );
}
