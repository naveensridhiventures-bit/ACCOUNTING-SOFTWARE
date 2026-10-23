import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useTitle } from '../hooks';
import { Button, Card, Combo, ComboItem, Field, PageHeader, useFeedback } from '../components/ui';
import { Icon } from '../components/Icon';
import { addDays, DOC_LABEL, money, num, qty as fmtQty, today } from '../format';
import { calcLine, calcTotals } from '../calc';
import { PartyFormModal } from './Parties';

type DocType = 'SALES_INVOICE' | 'PURCHASE_BILL' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
interface Line { key: number; productId: string; ledgerId: string; description: string; hsn: string; unit: string; qty: string; rate: string; discountPct: string; gstRate: string }
let seq = 1;
const blank = (): Line => ({ key: seq++, productId: '', ledgerId: '', description: '', hsn: '', unit: '', qty: '1', rate: '', discountPct: '0', gstRate: '0' });
const BASE: Record<DocType, string> = { SALES_INVOICE: '/sales/invoices', PURCHASE_BILL: '/purchases/bills', CREDIT_NOTE: '/sales/credit-notes', DEBIT_NOTE: '/purchases/debit-notes' };

export default function DocumentEditor({ type }: { type: DocType }) {
  const label = DOC_LABEL[type];
  useTitle(`New ${label.toLowerCase()}`);
  const nav = useNavigate();
  const { company } = useAuth();
  const fb = useFeedback();
  const [params] = useSearchParams();
  const sales = type === 'SALES_INVOICE' || type === 'CREDIT_NOTE';
  const settleable = type === 'SALES_INVOICE' || type === 'PURCHASE_BILL';
  const partyType = sales ? 'CUSTOMER' : 'SUPPLIER';

  const co = useApi<any>('/company');
  const parties = useApi<any>('/parties', { type: partyType, active: true, pageSize: 200 });
  const products = useApi<any>('/products', { active: true, pageSize: 200 });
  const ledgers = useApi<any>('/ledgers', { active: true, nature: sales ? 'INCOME' : 'EXPENSE' });

  const [partyId, setPartyId] = useState(params.get('party') ?? '');
  const [docDate, setDocDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [dueTouched, setDueTouched] = useState(false);
  const [reference, setReference] = useState('');
  const [pos, setPos] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [originalId, setOriginalId] = useState('');
  const [applyToOriginal, setApplyToOriginal] = useState(true);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newParty, setNewParty] = useState(false);

  const party = parties.data?.items.find((p: any) => p.id === partyId);
  const gstOn = company?.gstEnabled ?? true;
  const posCode = pos || party?.stateCode || company?.stateCode || '';
  const interState = gstOn && !!posCode && !!company?.stateCode && posCode !== company.stateCode;

  // due date follows the party's credit period until the user sets it
  useEffect(() => {
    if (settleable && !dueTouched) setDueDate(addDays(docDate, party?.creditDays ?? 0));
  }, [docDate, party, settleable, dueTouched]);
  useEffect(() => { if (partyId) setPos(''); }, [partyId]);

  // for notes: the party's invoices/bills this note can refer to
  const origType = type === 'CREDIT_NOTE' ? 'SALES_INVOICE' : 'PURCHASE_BILL';
  const originals = useApi<any>(!settleable && partyId ? '/documents' : null, { type: origType, partyId, status: 'ACTIVE', pageSize: 100 });

  const calc = useMemo(() => {
    const per = lines.map((l) => calcLine(l, interState, gstOn));
    return { per, totals: calcTotals(per, company?.roundOffInvoices ?? true) };
  }, [lines, interState, gstOn, company]);

  const prodMap = useMemo(() => new Map<string, any>((products.data?.items ?? []).map((p: any) => [p.id, p])), [products.data]);
  const patchLine = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const pickProduct = (key: number, id: string) => {
    const p = prodMap.get(id);
    if (!p) return patchLine(key, { productId: '' });
    patchLine(key, { productId: id, ledgerId: '', description: p.name, hsn: p.hsn ?? '', unit: p.unit, rate: String(sales ? p.salePrice : p.purchasePrice), gstRate: String(p.gstRate) });
  };

  const partyItems: ComboItem[] = (parties.data?.items ?? []).map((p: any) => ({ value: p.id, label: p.name, sub: p.gstin ?? p.city ?? '' }));
  const productItems: ComboItem[] = (products.data?.items ?? []).map((p: any) => ({ value: p.id, label: p.name, sub: p.kind === 'GOODS' && p.trackStock ? `${fmtQty(p.onHandQty)} ${p.unit}` : p.sku }));

  const save = async () => {
    setError(null);
    if (!partyId) return setError(`Choose a ${partyType.toLowerCase()}.`);
    const valid = lines.filter((l) => l.productId || l.description.trim());
    if (!valid.length) return setError('Add at least one line item.');
    if (valid.some((l) => num(l.qty) <= 0)) return setError('Every line needs a quantity greater than zero.');
    if (calc.totals.total <= 0) return setError('The total must be greater than zero.');
    setSaving(true);
    try {
      let applyTo: { documentId: string; amount: string }[] | undefined;
      if (!settleable && originalId && applyToOriginal) {
        const o = originals.data?.items.find((d: any) => d.id === originalId);
        const amt = Math.min(calc.totals.total, num(o?.balance));
        if (amt > 0) applyTo = [{ documentId: originalId, amount: amt.toFixed(2) }];
      }
      const doc = await post('/documents', {
        type, date: docDate, ...(settleable && dueDate && { dueDate }), partyId, reference: reference || undefined, placeOfSupplyCode: pos || undefined,
        notes: notes || undefined, terms: terms || undefined, originalDocumentId: originalId || undefined, applyTo,
        lines: valid.map((l) => ({ productId: l.productId || undefined, ledgerId: l.ledgerId || undefined, description: l.description || undefined, hsn: l.hsn || undefined, unit: l.unit || undefined, qty: l.qty, rate: l.rate === '' ? 0 : l.rate, discountPct: num(l.discountPct), gstRate: num(l.gstRate) })),
      });
      fb.toast(`${label} ${doc.number} created`);
      nav(`/documents/${doc.id}`, { replace: true });
    } catch (e) {
      const err = e as ApiError;
      setError(err.message + (Object.keys(err.fieldErrors).length ? ': ' + Object.entries(err.fieldErrors).map(([k, v]) => `${k} ${v}`).join('; ') : ''));
    } finally { setSaving(false); }
  };

  const cur = company?.baseCurrency ?? 'INR';
  return (
    <>
      <PageHeader crumb={<a href={BASE[type]} onClick={(e) => { e.preventDefault(); nav(BASE[type]); }}>{label}s</a>} title={`New ${label.toLowerCase()}`} />
      <Card pad={false}>
        <div className="card-pad">
          <div className="form-grid cols3">
            <Field label={sales ? 'Customer' : 'Supplier'} className="full">
              <Combo items={partyItems} value={partyId} onChange={setPartyId} placeholder={`Search ${partyType.toLowerCase()}s`} invalid={!!error && !partyId} onCreate={() => setNewParty(true)} createLabel={`Add new ${partyType.toLowerCase()}`} />
            </Field>
            <Field label={`${label} date`}><input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></Field>
            {settleable && <Field label="Due date" hint={party ? `${party.creditDays} day credit period` : undefined}><input type="date" min={docDate} value={dueDate} onChange={(e) => { setDueDate(e.target.value); setDueTouched(true); }} /></Field>}
            <Field label={type === 'PURCHASE_BILL' ? "Supplier's invoice no." : 'Reference / PO number'}><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} /></Field>
            {gstOn && (
              <Field label="Place of supply" hint={interState ? 'Inter-state: IGST applies' : 'Same state: CGST + SGST apply'}>
                <select value={pos} onChange={(e) => setPos(e.target.value)}>
                  <option value="">{party?.state ?? company?.state ?? 'Same as party'} (default)</option>
                  {(co.data?.states ?? []).map((s: any) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
                </select>
              </Field>
            )}
            {!settleable && (
              <Field label={type === 'CREDIT_NOTE' ? 'Against invoice' : 'Against bill'} hint={!partyId ? `Choose a ${partyType.toLowerCase()} first` : undefined}>
                <select value={originalId} onChange={(e) => setOriginalId(e.target.value)} disabled={!partyId}>
                  <option value="">Not linked</option>
                  {(originals.data?.items ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.number} · {money(d.total)} (due {money(d.balance)})</option>)}
                </select>
              </Field>
            )}
          </div>
          {!settleable && originalId && (
            <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={applyToOriginal} onChange={(e) => setApplyToOriginal(e.target.checked)} />Reduce the balance of that {type === 'CREDIT_NOTE' ? 'invoice' : 'bill'} by this note</label>
          )}
          {party && !party.gstin && gstOn && <div className="muted small" style={{ marginTop: 8 }}>This {partyType.toLowerCase()} has no GSTIN, so it is treated as unregistered (B2C).</div>}
        </div>

        <div className="table-wrap">
          <table className="editor-lines">
            <thead><tr><th style={{ width: 28 }}>#</th><th style={{ minWidth: 230 }}>Item</th><th style={{ minWidth: 190 }}>Description</th><th style={{ width: 90 }}>HSN/SAC</th><th style={{ width: 90 }} className="num">Qty</th><th style={{ width: 120 }} className="num">Rate</th><th style={{ width: 80 }} className="num">Disc %</th>{gstOn && <th style={{ width: 90 }} className="num">GST %</th>}<th style={{ width: 120 }} className="num">Amount</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const p = prodMap.get(l.productId);
                const short = p && p.kind === 'GOODS' && p.trackStock && (type === 'SALES_INVOICE' || type === 'DEBIT_NOTE') && num(l.qty) > num(p.onHandQty);
                return (
                  <tr key={l.key}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <Combo items={productItems} value={l.productId} onChange={(v) => pickProduct(l.key, v)} placeholder="Choose product or service" allowClear />
                      {!l.productId && <select value={l.ledgerId} onChange={(e) => patchLine(l.key, { ledgerId: e.target.value })} aria-label="Account" style={{ marginTop: 4 }}><option value="">{sales ? 'Sales' : type === 'PURCHASE_BILL' ? 'Purchases' : 'Purchase returns'} (default account)</option>{(ledgers.data?.items ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
                    </td>
                    <td><input value={l.description} onChange={(e) => patchLine(l.key, { description: e.target.value })} placeholder="Description" maxLength={300} /></td>
                    <td><input value={l.hsn} onChange={(e) => patchLine(l.key, { hsn: e.target.value })} maxLength={20} /></td>
                    <td><input className="num" inputMode="decimal" value={l.qty} onChange={(e) => patchLine(l.key, { qty: e.target.value })} aria-label="Quantity" style={short ? { borderColor: 'var(--neg)' } : undefined} />{short && <div className="err small" style={{ color: 'var(--neg)' }}>Only {fmtQty(p.onHandQty)} in stock</div>}</td>
                    <td><input className="num" inputMode="decimal" value={l.rate} onChange={(e) => patchLine(l.key, { rate: e.target.value })} aria-label="Rate" /></td>
                    <td><input className="num" inputMode="decimal" value={l.discountPct} onChange={(e) => patchLine(l.key, { discountPct: e.target.value })} aria-label="Discount percent" /></td>
                    {gstOn && <td><select className="num" value={l.gstRate} onChange={(e) => patchLine(l.key, { gstRate: e.target.value })} aria-label="GST rate">{[...new Set(['0', '5', '12', '18', '28', String(num(l.gstRate))])].sort((a, b) => num(a) - num(b)).map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>}
                    <td className="num" style={{ fontWeight: 500 }}>{money(calc.per[i]!.taxable)}</td>
                    <td><Button variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Icon name="trash" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-pad row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <Button icon="plus" onClick={() => setLines((ls) => [...ls, blank()])}>Add line</Button>
            <div className="form-grid" style={{ marginTop: 16 }}>
              <Field label="Notes" full><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="Shown on the document" /></Field>
              {settleable && <Field label="Terms" full hint="Leave blank to use the default terms from Company settings"><textarea value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={2000} /></Field>}
            </div>
          </div>
          <div className="totals-box">
            <div className="t-row"><span>Subtotal</span><span>{money(calc.totals.subtotal)}</span></div>
            {calc.totals.discount > 0 && <div className="t-row"><span>Discount</span><span>-{money(calc.totals.discount)}</span></div>}
            <div className="t-row"><span>Taxable value</span><span>{money(calc.totals.taxable)}</span></div>
            {gstOn && (interState
              ? <div className="t-row"><span>IGST</span><span>{money(calc.totals.igst)}</span></div>
              : <><div className="t-row"><span>CGST</span><span>{money(calc.totals.cgst)}</span></div><div className="t-row"><span>SGST</span><span>{money(calc.totals.sgst)}</span></div></>)}
            {calc.totals.roundOff !== 0 && <div className="t-row muted"><span>Round off</span><span>{calc.totals.roundOff > 0 ? '+' : ''}{calc.totals.roundOff.toFixed(2)}</span></div>}
            <div className="t-row grand"><span>Total</span><span>{cur === 'INR' ? '₹' : cur} {money(calc.totals.total)}</span></div>
          </div>
        </div>
        {error && <div className="card-pad" style={{ paddingTop: 0 }}><div className="alert" role="alert">{error}</div></div>}
        <div className="sticky-actions">
          <span className="muted small grow">Posting creates the journal entry{type === 'SALES_INVOICE' ? ' and the cost of goods sold' : ''} and updates stock.</span>
          <Button onClick={() => nav(BASE[type])}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>Create {label.toLowerCase()}</Button>
        </div>
      </Card>
      {newParty && <PartyFormModal type={partyType} onClose={() => setNewParty(false)} onSaved={async (p) => { setNewParty(false); await parties.reload(); setPartyId(p.id); }} />}
    </>
  );
}
