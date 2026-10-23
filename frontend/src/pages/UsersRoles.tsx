import { useMemo, useState } from 'react';
import { ApiError, del, patch, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useTitle } from '../hooks';
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, PageHeader, Tabs, useFeedback } from '../components/ui';
import { date } from '../format';

function UserModal({ user, roles, onClose, onSaved }: { user?: any; roles: any[]; onClose: () => void; onSaved: () => void }) {
  const fb = useFeedback();
  const editing = !!user;
  const [f, setF] = useState({ name: user?.name ?? '', email: user?.email ?? '', roleId: user?.roleId ?? roles.find((r) => r.name === 'Accountant')?.id ?? roles[0]?.id ?? '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErrors({}); setBusy(true);
    try {
      if (editing) await patch(`/users/${user.id}`, { name: f.name.trim(), roleId: f.roleId, ...(f.password && { password: f.password }) });
      else await post('/users', { name: f.name.trim(), email: f.email.trim(), roleId: f.roleId, password: f.password });
      fb.toast(editing ? 'User updated' : 'User added'); onSaved();
    } catch (e) { const err = e as ApiError; Object.keys(err.fieldErrors).length ? setErrors(err.fieldErrors) : setErrors({ _: err.message }); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? `Edit ${user.name}` : 'Add user'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{editing ? 'Save changes' : 'Add user'}</Button></>}>
      <div className="form-grid">
        <Field label="Name" error={errors.name}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Email" error={errors.email}><input type="email" value={f.email} disabled={editing} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role" error={errors.roleId}><select value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label={editing ? 'Reset password' : 'Password'} error={errors.password} hint="At least 10 characters"><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={editing ? 'Leave blank to keep' : ''} /></Field>
      </div>
      {errors._ && <div className="alert" role="alert" style={{ marginTop: 12 }}>{errors._}</div>}
    </Modal>
  );
}

function RoleModal({ role, perms, onClose, onSaved }: { role?: any; perms: any[]; onClose: () => void; onSaved: () => void }) {
  const fb = useFeedback();
  const [name, setName] = useState(role?.name ?? '');
  const [sel, setSel] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => { const m = new Map<string, any[]>(); perms.forEach((p) => m.set(p.group, [...(m.get(p.group) ?? []), p])); return [...m.entries()]; }, [perms]);
  const flip = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const save = async () => {
    if (!name.trim()) return setError('Enter a role name');
    setBusy(true);
    try { const body = { name: name.trim(), permissions: [...sel] }; if (role) await patch(`/roles/${role.id}`, body); else await post('/roles', body); fb.toast('Role saved'); onSaved(); }
    catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={role ? `Edit role: ${role.name}` : 'New role'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save role</Button></>}>
      <Field label="Role name" error={error}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus /></Field>
      <div className="perm-grid">
        {groups.map(([g, items]) => (
          <fieldset key={g}><legend>{g}</legend>
            {items.map((p: any) => <label key={p.key} className="check"><input type="checkbox" checked={sel.has(p.key)} onChange={() => flip(p.key)} />{p.label}</label>)}
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}

export default function UsersRoles() {
  useTitle('Users & roles');
  const { can, user: me } = useAuth();
  const fb = useFeedback();
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const users = useApi<any>('/users');
  const roles = useApi<any>('/roles');
  const perms = useApi<any>('/permissions');
  const [userModal, setUserModal] = useState<any>(null);
  const [roleModal, setRoleModal] = useState<any>(null);
  const write = can('user.write');
  const toggle = async (u: any) => { try { await patch(`/users/${u.id}`, { isActive: !u.isActive }); fb.toast(u.isActive ? `${u.name} can no longer sign in` : `${u.name} can sign in again`); users.reload(); } catch (e) { fb.error(e); } };
  const removeRole = async (r: any) => { const ok = await fb.confirm({ title: `Delete role ${r.name}?`, confirmLabel: 'Delete', danger: true }); if (ok === null) return; try { await del(`/roles/${r.id}`); fb.toast('Role deleted'); roles.reload(); } catch (e) { fb.error(e); } };
  const roleItems: any[] = roles.data?.items ?? [];
  return (
    <>
      <PageHeader title="Users & roles" subtitle="Decide who can see and change what"
        actions={write ? (tab === 'users' ? <Button variant="primary" icon="plus" onClick={() => setUserModal({})} disabled={!roleItems.length}>Add user</Button> : <Button variant="primary" icon="plus" onClick={() => setRoleModal({})}>New role</Button>) : undefined} />
      <Tabs tabs={[{ id: 'users', label: 'Users' }, { id: 'roles', label: 'Roles' }]} value={tab} onChange={setTab} />
      {tab === 'users' ? (
        <Card pad={false}>
          {users.error && <div className="card-pad"><ErrorBox error={users.error} onRetry={users.reload} /></div>}
          {users.loading && !users.data ? <Loading /> : users.data && (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
              <tbody>{users.data.items.map((u: any) => (
                <tr key={u.id} className={u.isActive ? '' : 'muted-row'}>
                  <td style={{ fontWeight: 500 }}>{u.name}{u.id === me?.id && <> <Badge tone="blue">You</Badge></>}</td><td>{u.email}</td><td>{u.role?.name ?? u.roleName ?? '-'}</td><td>{u.lastLoginAt ? date(u.lastLoginAt) : 'Never'}</td>
                  <td>{u.isActive ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}</td>
                  <td className="right nowrap">{write && <><Button size="sm" variant="ghost" onClick={() => setUserModal(u)}>Edit</Button>{u.id !== me?.id && <Button size="sm" variant="ghost" onClick={() => toggle(u)}>{u.isActive ? 'Disable' : 'Enable'}</Button>}</>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      ) : (
        <Card pad={false}>
          {roles.loading && !roles.data ? <Loading /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Role</th><th>Access</th><th className="num">Users</th><th /></tr></thead>
              <tbody>{roleItems.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.name} {r.isSystem && <Badge tone="blue">Built-in</Badge>}</td>
                  <td className="muted">{r.permissions.includes('*') ? 'Full access' : `${r.permissions.length} permissions`}</td><td className="num">{r.users}</td>
                  <td className="right nowrap">{write && !r.isSystem && <><Button size="sm" variant="ghost" onClick={() => setRoleModal(r)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => removeRole(r)}>Delete</Button></>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}
      {userModal && <UserModal user={userModal.id ? { ...userModal, roleId: userModal.roleId ?? roleItems.find((r) => r.name === userModal.roleName)?.id } : undefined} roles={roleItems} onClose={() => setUserModal(null)} onSaved={() => { setUserModal(null); users.reload(); }} />}
      {roleModal && perms.data && <RoleModal role={roleModal.id ? roleModal : undefined} perms={perms.data.items} onClose={() => setRoleModal(null)} onSaved={() => { setRoleModal(null); roles.reload(); }} />}
    </>
  );
}
