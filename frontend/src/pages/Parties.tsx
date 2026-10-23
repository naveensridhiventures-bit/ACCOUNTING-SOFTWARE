import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, patch, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useDebounced, useTitle } from '../hooks';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pagination, SearchBox, useFeedback } from '../components/ui';
import { downloadCsv, money, num } from '../format';

export function PartyFormModal({ type, party, onClose, onSaved }: { type: 'CUSTOMER' | 'SUPPLIER'; party?: any; onClose: () => void; onSaved: (p: any) => void }) {
  const fb = useFeedback();
  const co = useApi<any>('/company');
  const editing = !!party;
  const [f, setF] = useState({
    name: party?.name ?? '', gstin: party?.gstin ?? '', pan: party?.pan ?? '', phone: party?.phone ?? '', email: party?.email ?? '', contactPerson: party?.contactPerson ?? '',
    billingAddress: party?.billingAddress ?? '', city: party?.city ?? '', stateCode: party?.stateCode ?? '', pincode: party?.pincode ?? '',
    creditDays: String(party?.creditDays ?? 30), creditLimit: party?.creditLimit ? String(party.creditLimit) : '', notes: party?.notes ?? '',
    openingBalance: '', openingSide: type === 'CUSTOMER' ? 'DR' : 'CR',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const noun = type === 'CUSTOMER' ? 'customer' : 'supplier';

  const save = async () => {
    setErrors({});
    if (!f.name.trim()) return setErrors({ name: 'Enter a name' });
    setBusy(true);
    try {
      const stateName = co.data?.states.find((s: any) => s.code === f.stateCode)?.name;
      const body: any = {
        name: f.name.trim(), gstin: f.gstin.trim() || undefined, pan: f.pan.trim() || undefined, phone: f.phone, email: f.email, contactPerson: f.contactPerson, billingAddress: f.billingAddress,
        city: f.city, state: stateName, stateCode: f.stateCode || undefined, pincode: f.pincode, creditDays: num(f.creditDays), creditLimit: f.creditLimit || undefined, notes: f.notes,
      };
      // a GSTIN's first two digits are the state: use them when no state was picked
      if (!body.stateCode && body.gstin && /^\d{2}/.test(body.gstin)) { body.stateCode = body.gstin.slice(0, 2); body.state = co.data?.states.find((s: any) => s.code === body.stateCode)?.name; }
      const saved = editing ? await patch(`/parties/${party.id}`, body) : await post('/parties', { ...body, type, ...(num(f.openingBalance) > 0 && { openingBalance: num(f.openingBalance).toFixed(2), openingSide: f.openingSide }) });
      fb.toast(`${saved.name} ${editing ? 'updated' : 'added'}`);
      onSaved(saved);
    } catch (e) {
      const err = e as ApiError;
      if (Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors); else setErrors({ _: err.message });
    } finally { setBusy(false); }
  };
  return (
    <Modal wide title={editing ? `Edit ${noun}` : `New ${noun}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{editing ? 'Save changes' : `Add ${noun}`}</Button></>}>
      <div className="form-grid">
        <Field label="Name" error={errors.name} full><input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={150} /></Field>
        <Field label="GSTIN" error={errors.gstin} hint="15 characters. Leave blank if unregistered."><input value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} /></Field>
        <Field label="PAN" error={errors.pan}><input value={f.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} maxLength={10} /></Field>
        <Field label="Contact person"><input value={f.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email" error={errors.email}><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Address" full><textarea value={f.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} rows={2} /></Field>
        <Field label="City"><input value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="State" hint="Decides CGST+SGST or IGST on invoices">
          <select value={f.stateCode} onChange={(e) => set('stateCode', e.target.value)}><option value="">Select state</option>{(co.data?.states ?? []).map((s: any) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}</select>
        </Field>
        <Field label="Credit period (days)" error={errors.creditDays}><input className="num" inputMode="numeric" value={f.creditDays} onChange={(e) => set('creditDays', e.target.value)} /></Field>
        <Field label="Credit limit" hint="Optional"><input className="num" inputMode="decimal" value={f.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} /></Field>
        {!editing && (
          <>
            <Field label="Opening balance" hint={type === 'CUSTOMER' ? 'Amount the customer already owes you' : 'Amount you already owe the supplier'}><input className="num" inputMode="decimal" value={f.openingBalance} onChange={(e) => set('openingBalance', e.target.value)} placeholder="0.00" /></Field>
            <Field label="Opening balance is"><select value={f.openingSide} onChange={(e) => set('openingSide', e.target.value)}><option value="DR">{type === 'CUSTOMER' ? 'Receivable (they owe us)' : 'Advance paid (they owe us)'}</option><option value="CR">{type === 'CUSTOMER' ? 'Advance received (we owe them)' : 'Payable (we owe them)'}</option></select></Field>
          </>
        )}
        <Field label="Notes" full><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2} /></Field>
      </div>
      {errors._ && <div className="alert" role="alert" style={{ marginTop: 12 }}>{errors._}</div>}
    </Modal>
  );
}

export default function Parties({ type }: { type: 'CUSTOMER' | 'SUPPLIER' }) {
  const customers = type === 'CUSTOMER';
  const title = customers ? 'Customers' : 'Suppliers';
  useTitle(title);
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('true');
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useApi<any>('/parties', { type, q: dq, page, pageSize: 25, active: active || undefined, withBalance: true });

  return (
    <>
      <PageHeader title={title} subtitle={customers ? 'People and companies you sell to' : 'People and companies you buy from'}
        actions={<>
          <Button icon="download" onClick={() => data && downloadCsv(`${title.toLowerCase()}.csv`, [['Name', 'GSTIN', 'City', 'State', 'Phone', 'Email', 'Credit days', customers ? 'Receivable' : 'Payable'], ...data.items.map((p: any) => [p.name, p.gstin, p.city, p.state, p.phone, p.email, p.creditDays, p.balance])])}>Export CSV</Button>
          {can('party.write') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>New {customers ? 'customer' : 'supplier'}</Button>}
        </>} />
      <Card pad={false}>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name, GSTIN, phone or email" />
          <select value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }} aria-label="Status"><option value="true">Active</option><option value="false">Inactive</option><option value="">All</option></select>
        </div>
        {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && !data.items.length ? (
          <Empty title={q ? 'No match' : `No ${title.toLowerCase()} yet`} action={!q && can('party.write') ? <Button variant="primary" onClick={() => setAdding(true)}>Add your first {customers ? 'customer' : 'supplier'}</Button> : undefined}>
            {q ? 'Try a different search.' : `Add ${title.toLowerCase()} so you can invoice and track balances.`}
          </Empty>
        ) : data && (
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>GSTIN</th><th>Location</th><th>Contact</th><th className="num">Credit days</th><th className="num">{customers ? 'Owes you' : 'You owe'}</th></tr></thead>
            <tbody>{data.items.map((p: any) => (
              <tr key={p.id} className={`clickable ${p.isActive ? '' : 'muted-row'}`} onClick={() => nav(`/parties/${p.id}`)}>
                <td style={{ fontWeight: 500 }}>{p.name} {!p.isActive && <Badge>Inactive</Badge>}</td>
                <td>{p.gstin ?? <span className="faint">Unregistered</span>}</td>
                <td>{[p.city, p.state].filter(Boolean).join(', ') || '-'}</td>
                <td>{p.phone || p.email || '-'}</td>
                <td className="num">{p.creditDays}</td>
                <td className={`num ${num(p.balance) < 0 ? 'pos' : ''}`}>{money(p.balance)}{num(p.balance) < 0 ? ' advance' : ''}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      {adding && <PartyFormModal type={type} onClose={() => setAdding(false)} onSaved={(p) => { setAdding(false); nav(`/parties/${p.id}`); }} />}
    </>
  );
}
