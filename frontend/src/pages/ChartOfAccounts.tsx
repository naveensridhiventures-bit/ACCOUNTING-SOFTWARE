import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, del, patch, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useDebounced, useTitle } from '../hooks';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, SearchBox, Tabs, useFeedback } from '../components/ui';
import { money, num, titleCase } from '../format';

export function AccountModal({ ledger, groups, defaultGroup, lockGroups, onClose, onSaved }: { ledger?: any; groups: any[]; defaultGroup?: string; lockGroups?: boolean; onClose: () => void; onSaved: () => void }) {
  const fb = useFeedback();
  const editing = !!ledger;
  const [f, setF] = useState({ name: ledger?.name ?? '', groupId: ledger?.groupId ?? defaultGroup ?? groups[0]?.id ?? '', code: ledger?.code ?? '', description: ledger?.description ?? '', openingBalance: String(num(ledger?.openingBalance ?? 0) || ''), openingSide: ledger?.openingSide ?? 'DR' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setErrors({});
    if (!f.name.trim()) return setErrors({ name: 'Enter a name' });
    setBusy(true);
    try {
      const body: any = { name: f.name.trim(), groupId: f.groupId, code: f.code.trim() || undefined, description: f.description.trim() || undefined, openingBalance: num(f.openingBalance).toFixed(2), openingSide: f.openingSide };
      if (editing) await patch(`/ledgers/${ledger.id}`, body); else await post('/ledgers', body);
      fb.toast(`${f.name.trim()} ${editing ? 'updated' : 'added'}`); onSaved();
    } catch (e) { const err = e as ApiError; Object.keys(err.fieldErrors).length ? setErrors(err.fieldErrors) : setErrors({ _: err.message }); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? 'Edit account' : 'New account'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{editing ? 'Save changes' : 'Add account'}</Button></>}>
      <div className="form-grid">
        <Field label="Account name" error={errors.name} full><input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus maxLength={150} /></Field>
        <Field label="Group" error={errors.groupId} full><select value={f.groupId} onChange={(e) => set('groupId', e.target.value)} disabled={lockGroups && groups.length < 2}>{groups.map((g) => <option key={g.id} value={g.id}>{g.label ?? g.name}</option>)}</select></Field>
        <Field label="Opening balance" error={errors.openingBalance} hint="Balance carried from your earlier books"><input className="num" inputMode="decimal" value={f.openingBalance} onChange={(e) => set('openingBalance', e.target.value)} placeholder="0.00" /></Field>
        <Field label="Debit or credit"><select value={f.openingSide} onChange={(e) => set('openingSide', e.target.value)}><option value="DR">Debit (Dr)</option><option value="CR">Credit (Cr)</option></select></Field>
        <Field label="Code"><input value={f.code} onChange={(e) => set('code', e.target.value)} maxLength={50} /></Field>
        <Field label="Description"><input value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={300} /></Field>
      </div>
      {errors._ && <div className="alert" role="alert" style={{ marginTop: 12 }}>{errors._}</div>}
    </Modal>
  );
}

function GroupModal({ groups, onClose, onSaved }: { groups: any[]; onClose: () => void; onSaved: () => void }) {
  const fb = useFeedback();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState(groups[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return setError('Enter a name');
    setBusy(true);
    try { await post('/account-groups', { name: name.trim(), parentId }); fb.toast('Group added'); onSaved(); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="New account group" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Add group</Button></>}>
      <div className="stack">
        <Field label="Group name" error={error}><input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} /></Field>
        <Field label="Inside group"><select value={parentId} onChange={(e) => setParentId(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

export default function ChartOfAccounts() {
  useTitle('Chart of accounts');
  const { can } = useAuth();
  const fb = useFeedback();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [nature, setNature] = useState('ALL');
  const [editing, setEditing] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [addGroup, setAddGroup] = useState(false);
  const dq = useDebounced(q);
  const ledgers = useApi<any>('/ledgers', { q: dq, withBalance: true, nature: nature === 'ALL' ? undefined : nature }, [dq, nature]);
  const groups = useApi<any>('/account-groups');
  const groupList: any[] = useMemo(() => {
    const items: any[] = groups.data?.items ?? [];
    const byId = new Map(items.map((g) => [g.id, g]));
    const depth = (g: any): number => (g.parentId && byId.get(g.parentId) ? 1 + depth(byId.get(g.parentId)) : 0);
    const out: any[] = [];
    const walk = (parent: string | null) => items.filter((g) => (g.parentId ?? null) === parent).sort((a, b) => a.name.localeCompare(b.name)).forEach((g) => { out.push({ ...g, label: `${'— '.repeat(depth(g))}${g.name}` }); walk(g.id); });
    walk(null);
    return out;
  }, [groups.data]);
  const write = can('ledger.write');
  const grouped = useMemo(() => {
    const m = new Map<string, any[]>();
    (ledgers.data?.items ?? []).forEach((l: any) => { const k = l.group.name; m.set(k, [...(m.get(k) ?? []), l]); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ledgers.data]);
  const remove = async (l: any) => {
    const ok = await fb.confirm({ title: `Delete ${l.name}?`, message: 'Only accounts with no transactions can be deleted.', confirmLabel: 'Delete', danger: true });
    if (ok === null) return;
    try { await del(`/ledgers/${l.id}`); fb.toast('Account deleted'); ledgers.reload(); } catch (e) { fb.error(e); }
  };
  const toggle = async (l: any) => { try { await patch(`/ledgers/${l.id}`, { isActive: !l.isActive }); fb.toast(l.isActive ? 'Account hidden from pickers' : 'Account active again'); ledgers.reload(); } catch (e) { fb.error(e); } };
  return (
    <>
      <PageHeader title="Chart of accounts" subtitle="Every account your books use, grouped the way Tally does"
        actions={write ? <><Button onClick={() => setAddGroup(true)}>New group</Button><Button variant="primary" icon="plus" onClick={() => setAdding(true)}>New account</Button></> : undefined} />
      <Card pad={false}>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Search accounts" />
          <Tabs tabs={[{ id: 'ALL', label: 'All' }, { id: 'ASSET', label: 'Assets' }, { id: 'LIABILITY', label: 'Liabilities' }, { id: 'INCOME', label: 'Income' }, { id: 'EXPENSE', label: 'Expenses' }]} value={nature} onChange={setNature} />
        </div>
        {ledgers.error && <div className="card-pad"><ErrorBox error={ledgers.error} onRetry={ledgers.reload} /></div>}
        {ledgers.loading && !ledgers.data ? <Loading /> : !grouped.length ? <Empty title="No accounts match" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Account</th><th>Type</th><th className="num">Balance</th><th /></tr></thead>
            <tbody>{grouped.map(([g, rows]) => (
              <Fragment key={g}>
                <tr className="group-row"><td colSpan={4}><strong>{g}</strong></td></tr>
                {rows.map((l: any) => (
                  <tr key={l.id} className={`clickable ${l.isActive ? '' : 'muted-row'}`} onClick={() => nav(`/ledgers/${l.id}`)}>
                    <td style={{ paddingLeft: 28 }}>{l.name} {!l.isActive && <Badge>Hidden</Badge>} {l.systemKey && <Badge tone="blue">System</Badge>}{l.description && <div className="muted small">{l.description}</div>}</td>
                    <td>{titleCase(l.group.nature)}</td>
                    <td className="num">{num(l.balance) ? `${money(l.balance)} ${l.balanceSide === 'DR' ? 'Dr' : 'Cr'}` : <span className="faint">0.00</span>}</td>
                    <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                      {write && !l.party && <><Button size="sm" variant="ghost" onClick={() => setEditing(l)}>Edit</Button>{!l.systemKey && <Button size="sm" variant="ghost" onClick={() => toggle(l)}>{l.isActive ? 'Hide' : 'Show'}</Button>}{!l.systemKey && <Button size="sm" variant="ghost" onClick={() => remove(l)}>Delete</Button>}</>}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {(adding || editing) && groups.data && <AccountModal ledger={editing ?? undefined} groups={groupList} onClose={() => { setAdding(false); setEditing(null); }} onSaved={() => { setAdding(false); setEditing(null); ledgers.reload(); }} />}
      {addGroup && groups.data && <GroupModal groups={groupList} onClose={() => setAddGroup(false)} onSaved={() => { setAddGroup(false); groups.reload(); }} />}
    </>
  );
}
