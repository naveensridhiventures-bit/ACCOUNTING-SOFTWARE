import { useState } from 'react';
import { ApiError, post } from '../api';
import { useAuth } from '../auth';
import { useTitle } from '../hooks';
import { Button, Card, Field, PageHeader, useFeedback } from '../components/ui';

export default function Profile() {
  useTitle('My account');
  const { user, company, logout } = useAuth();
  const fb = useFeedback();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErrors({});
    if (f.newPassword !== f.confirm) return setErrors({ confirm: 'Passwords do not match' });
    setBusy(true);
    try { await post('/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword }); fb.toast('Password changed'); setF({ currentPassword: '', newPassword: '', confirm: '' }); }
    catch (e) { const err = e as ApiError; Object.keys(err.fieldErrors).length ? setErrors(err.fieldErrors) : setErrors({ currentPassword: err.message }); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="My account" />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Card title="Profile">
          <dl className="kv"><dt>Name</dt><dd>{user?.name}</dd><dt>Email</dt><dd>{user?.email}</dd><dt>Role</dt><dd>{user?.roleName}</dd><dt>Company</dt><dd>{company?.name}</dd></dl>
          <div style={{ marginTop: 16 }}><Button onClick={logout}>Sign out</Button></div>
        </Card>
        <Card title="Change password">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <Field label="Current password" error={errors.currentPassword}><input type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
            <Field label="New password" error={errors.newPassword} hint="At least 10 characters"><input type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
            <Field label="Confirm new password" error={errors.confirm}><input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
            <div><Button type="submit" variant="primary" loading={busy} disabled={!f.currentPassword || !f.newPassword}>Change password</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
