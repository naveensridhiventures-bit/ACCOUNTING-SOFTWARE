import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button, Field } from '../components/ui';
import { useTitle } from '../hooks';

export default function Login() {
  useTitle('Sign in');
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={loc.state?.from ?? '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(email.trim(), password); nav(loc.state?.from ?? '/', { replace: true }); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="login">
      <div className="login-art">
        <div className="ledger-lines" />
        <div className="brand" style={{ color: '#fff', padding: 0, paddingLeft: 40 }}>Ledgerly</div>
        <div style={{ paddingLeft: 40 }}>
          <h1>Every rupee, accounted for.</h1>
          <p>Invoices, stock, GST and the books behind them, in one place. Entries are never edited or deleted, only reversed, so your records always reconcile.</p>
        </div>
        <div className="small" style={{ opacity: 0.75, paddingLeft: 40 }}>Double-entry bookkeeping · GST ready · Audit trail on every change</div>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="muted" style={{ marginBottom: 20 }}>Use the account created when the database was seeded.</p>
          <div className="stack">
            <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
            <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            {error && <div className="alert" role="alert">{error}</div>}
            <Button variant="primary" loading={busy} type="submit">Sign in</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
