import { useEffect, useState } from 'react';
import { ApiError, put } from '../api';
import { useAuth } from '../auth';
import { useApi, useTitle } from '../hooks';
import { Button, Card, ErrorBox, Field, Loading, PageHeader, useFeedback } from '../components/ui';

const PREFIX_LABELS: [string, string][] = [['SALES', 'Sales invoices'], ['PURCHASE', 'Purchase bills'], ['CREDIT_NOTE', 'Credit notes'], ['DEBIT_NOTE', 'Debit notes'], ['RECEIPT', 'Receipts'], ['PAYMENT', 'Payments'], ['JOURNAL', 'Journals'], ['CONTRA', 'Contra entries']];

export default function CompanySettings() {
  useTitle('Company settings');
  const { can, refresh } = useAuth();
  const fb = useFeedback();
  const { data, loading, error, reload } = useApi<any>('/company');
  const [f, setF] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const write = can('company.write');
  useEffect(() => { if (data) setF({ ...data, numberPrefixes: { ...(data.numberPrefixes ?? {}) } }); }, [data]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading || !f) return <Loading rows={6} />;
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const text = (k: string, label: string, extra: { full?: boolean; hint?: string; max?: number } = {}) => (
    <Field label={label} error={errors[k]} full={extra.full} hint={extra.hint}><input value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} disabled={!write} maxLength={extra.max ?? 150} /></Field>
  );
  const save = async () => {
    setErrors({}); setBusy(true);
    try {
      const keys = ['name', 'legalName', 'gstin', 'pan', 'address', 'city', 'state', 'stateCode', 'pincode', 'phone', 'email', 'website', 'bankDetails', 'invoiceTerms', 'gstEnabled', 'allowNegativeStock', 'roundOffInvoices'];
      const body: any = Object.fromEntries(keys.map((k) => [k, typeof f[k] === 'string' ? f[k].trim() : f[k]]));
      body.numberPrefixes = Object.fromEntries(Object.entries(f.numberPrefixes).filter(([, v]) => String(v).trim()).map(([k, v]) => [k, String(v).trim()]));
      await put('/company', body);
      await refresh(); reload(); fb.toast('Company details saved');
    } catch (e) { const err = e as ApiError; Object.keys(err.fieldErrors).length ? setErrors(err.fieldErrors) : fb.error(err); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Company" subtitle="These details print on your invoices and decide how GST is split" actions={write ? <Button variant="primary" loading={busy} onClick={save}>Save changes</Button> : undefined} />
      <div className="stack">
        <Card title="Business details">
          <div className="form-grid">
            {text('name', 'Display name')}{text('legalName', 'Legal name', { hint: 'Printed on invoices if different' })}
            {text('gstin', 'GSTIN', { max: 15, hint: '15 characters' })}{text('pan', 'PAN', { max: 10 })}
            {text('address', 'Address', { full: true, max: 500 })}
            {text('city', 'City')}{text('pincode', 'PIN code', { max: 10 })}
            <Field label="State" error={errors.stateCode} hint="Decides CGST + SGST or IGST on each sale"><select value={f.stateCode ?? ''} disabled={!write} onChange={(e) => { const s = (data.states as any[]).find((x) => x.code === e.target.value); set('stateCode', e.target.value); set('state', s?.name ?? ''); }}><option value="">Select state</option>{data.states.map((s: any) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}</select></Field>
            {text('phone', 'Phone', { max: 30 })}{text('email', 'Email')}{text('website', 'Website')}
          </div>
        </Card>
        <Card title="Invoice print">
          <div className="form-grid">
            <Field label="Bank details" hint="Shown at the bottom of invoices" full><textarea rows={3} value={f.bankDetails ?? ''} onChange={(e) => set('bankDetails', e.target.value)} disabled={!write} /></Field>
            <Field label="Terms and conditions" full><textarea rows={3} value={f.invoiceTerms ?? ''} onChange={(e) => set('invoiceTerms', e.target.value)} disabled={!write} /></Field>
          </div>
        </Card>
        <Card title="Behaviour">
          <div className="stack">
            <label className="check"><input type="checkbox" checked={f.gstEnabled} onChange={(e) => set('gstEnabled', e.target.checked)} disabled={!write} /><span><strong>Charge GST</strong><br /><span className="muted small">Turn off if you are not registered. Documents then carry no tax.</span></span></label>
            <label className="check"><input type="checkbox" checked={f.roundOffInvoices} onChange={(e) => set('roundOffInvoices', e.target.checked)} disabled={!write} /><span><strong>Round invoice totals to the nearest rupee</strong><br /><span className="muted small">The difference posts to the Round Off account.</span></span></label>
            <label className="check"><input type="checkbox" checked={f.allowNegativeStock} onChange={(e) => set('allowNegativeStock', e.target.checked)} disabled={!write} /><span><strong>Allow selling more than the stock on hand</strong><br /><span className="muted small">Leave off to block invoices that would take stock below zero.</span></span></label>
          </div>
        </Card>
        <Card title="Document number prefixes">
          <p className="muted" style={{ marginBottom: 12 }}>Numbers look like <strong>{f.numberPrefixes.SALES || 'SAL'}-00001</strong> and restart each financial year. Changing a prefix affects new documents only.</p>
          <div className="form-grid cols3">
            {PREFIX_LABELS.map(([k, label]) => <Field key={k} label={label} error={errors[`numberPrefixes.${k}`]}><input value={f.numberPrefixes[k] ?? ''} placeholder="Default" maxLength={12} disabled={!write} onChange={(e) => setF((x: any) => ({ ...x, numberPrefixes: { ...x.numberPrefixes, [k]: e.target.value } }))} /></Field>)}
          </div>
        </Card>
        {write && <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" loading={busy} onClick={save}>Save changes</Button></div>}
      </div>
    </>
  );
}
