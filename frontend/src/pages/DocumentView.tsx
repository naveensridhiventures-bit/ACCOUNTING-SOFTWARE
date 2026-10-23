import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, del, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useTitle } from '../hooks';
import { Button, ErrorBox, Loading, Modal, PageHeader, statusBadge, useFeedback, Card } from '../components/ui';
import { amountInWords, date, DOC_LABEL, money, num, qty } from '../format';
import { PaymentModal } from './Payments';

const LIST: Record<string, string> = { SALES_INVOICE: '/sales/invoices', PURCHASE_BILL: '/purchases/bills', CREDIT_NOTE: '/sales/credit-notes', DEBIT_NOTE: '/purchases/debit-notes' };

export default function DocumentView() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, company: sess } = useAuth();
  const fb = useFeedback();
  const { data: d, loading, error, reload } = useApi<any>(`/documents/${id}`);
  const co = useApi<any>(can('company.read') ? '/company' : null);
  const [paying, setPaying] = useState(false);
  const [applying, setApplying] = useState(false);
  useTitle(d ? `${d.number}` : 'Document');
  if (loading && !d) return <Loading rows={8} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!d) return null;

  const company = co.data ?? sess ?? {};
  const settleable = d.type === 'SALES_INVOICE' || d.type === 'PURCHASE_BILL';
  const sales = d.type === 'SALES_INVOICE' || d.type === 'CREDIT_NOTE';
  const active = d.status === 'ACTIVE';
  const cancel = async () => {
    const reason = await fb.confirm({ title: `Cancel ${d.number}?`, message: `This posts a reversing entry${d.lines.some((l: any) => l.productId) ? ' and returns the stock' : ''}. The ${DOC_LABEL[d.type].toLowerCase()} stays on record marked as cancelled.`, confirmLabel: `Cancel ${DOC_LABEL[d.type].toLowerCase()}`, danger: true, reason: true });
    if (reason === null) return;
    try { await post(`/documents/${d.id}/cancel`, { reason: reason || undefined }); fb.toast(`${d.number} cancelled`); reload(); } catch (e) { fb.error(e); }
  };
  const unlink = async (allocId: string) => {
    const ok = await fb.confirm({ title: 'Remove this settlement?', message: 'The document becomes outstanding again by this amount. The payment itself stays in the books.', confirmLabel: 'Remove', danger: true });
    if (ok === null) return;
    try { await del(`/allocations/${allocId}`); reload(); } catch (e) { fb.error(e); }
  };

  const showGst = num(d.cgstTotal) + num(d.sgstTotal) + num(d.igstTotal) > 0 || d.lines.some((l: any) => num(l.gstRate) > 0);
  // GST summary by rate for the paper
  const byRate = new Map<string, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const l of d.lines) {
    const k = num(l.gstRate).toFixed(2);
    const e = byRate.get(k) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    e.taxable += num(l.taxableAmount); e.cgst += num(l.cgstAmount); e.sgst += num(l.sgstAmount); e.igst += num(l.igstAmount);
    byRate.set(k, e);
  }
  const p = d.party;
  const title = d.type === 'SALES_INVOICE' ? (showGst ? 'Tax invoice' : 'Invoice') : DOC_LABEL[d.type];

  return (
    <>
      <PageHeader crumb={<Link to={LIST[d.type]!}>{DOC_LABEL[d.type]}s</Link>} title={<span className="row">{d.number} {d.status === 'CANCELLED' ? statusBadge('CANCELLED') : settleable ? statusBadge(d.paymentStatus, d.overdue) : null}</span>}
        subtitle={`${p.name} · ${date(d.date)}`}
        actions={<>
          <Button icon="print" onClick={() => window.print()}>Print / save PDF</Button>
          {active && settleable && num(d.balance) > 0 && can('payment.write') && <Button variant="primary" onClick={() => setPaying(true)}>{sales ? 'Record receipt' : 'Record payment'}</Button>}
          {active && !settleable && num(d.balance) > 0 && can(sales ? 'sales.write' : 'purchase.write') && <Button variant="primary" onClick={() => setApplying(true)}>Apply to {sales ? 'invoices' : 'bills'}</Button>}
          {active && d.type === 'SALES_INVOICE' && can('sales.write') && <Button onClick={() => nav(`/sales/credit-notes/new?party=${d.partyId}`)}>Issue credit note</Button>}
          {active && d.type === 'PURCHASE_BILL' && can('purchase.write') && <Button onClick={() => nav(`/purchases/debit-notes/new?party=${d.partyId}`)}>Issue debit note</Button>}
          {active && can('document.cancel') && <Button variant="danger" onClick={cancel}>Cancel</Button>}
        </>} />

      <div className="grid g-main">
        <div className={`invoice-paper watermark ${d.status === 'CANCELLED' ? 'cancelled' : ''}`}>
          <div className="inv-head">
            <div>
              <h1>{company.legalName || company.name}</h1>
              <div className="small" style={{ whiteSpace: 'pre-line', color: '#444' }}>{[company.address, [company.city, company.state, company.pincode].filter(Boolean).join(', '), company.phone && `Phone: ${company.phone}`, company.email].filter(Boolean).join('\n')}</div>
              {company.gstin && <div className="small"><strong>GSTIN:</strong> {company.gstin}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <h1 style={{ textTransform: 'none' }}>{title}</h1>
              <div><strong>{d.number}</strong></div>
              <div className="small">Date: {date(d.date)}</div>
              {d.dueDate && <div className="small">Due: {date(d.dueDate)}</div>}
              {d.reference && <div className="small">Ref: {d.reference}</div>}
              {d.originalDocument && <div className="small">Against: {d.originalDocument.number}</div>}
            </div>
          </div>
          <div className="inv-meta">
            <div>
              <h4>{sales ? 'Bill to' : 'Supplier'}</h4>
              <strong>{p.name}</strong>
              <div className="small" style={{ whiteSpace: 'pre-line' }}>{[p.billingAddress, [p.city, p.state, p.pincode].filter(Boolean).join(', ')].filter(Boolean).join('\n')}</div>
              {p.gstin && <div className="small">GSTIN: {p.gstin}</div>}
              {p.phone && <div className="small">Phone: {p.phone}</div>}
            </div>
            <div>
              <h4>Place of supply</h4>
              <div>{d.placeOfSupply ?? '-'}{d.placeOfSupplyCode ? ` (${d.placeOfSupplyCode})` : ''}</div>
              {showGst && <div className="small">{d.isInterState ? 'Inter-state supply (IGST)' : 'Intra-state supply (CGST + SGST)'}</div>}
            </div>
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>Description</th>{showGst && <th>HSN/SAC</th>}<th className="num">Qty</th><th className="num">Rate</th>{d.lines.some((l: any) => num(l.discountPct) > 0) && <th className="num">Disc %</th>}<th className="num">Taxable</th>{showGst && <th className="num">GST</th>}<th className="num">Amount</th></tr></thead>
            <tbody>{d.lines.map((l: any) => (
              <tr key={l.id}>
                <td>{l.lineNo}</td><td>{l.description}{l.product && <div className="small" style={{ color: '#666' }}>{l.product.sku}</div>}</td>
                {showGst && <td>{l.hsn ?? ''}</td>}
                <td className="num">{qty(l.qty)} {l.unit ?? ''}</td><td className="num">{money(l.rate)}</td>
                {d.lines.some((x: any) => num(x.discountPct) > 0) && <td className="num">{num(l.discountPct) || ''}</td>}
                <td className="num">{money(l.taxableAmount)}</td>
                {showGst && <td className="num">{money(num(l.cgstAmount) + num(l.sgstAmount) + num(l.igstAmount))}<div className="small" style={{ color: '#666' }}>{num(l.gstRate)}%</div></td>}
                <td className="num">{money(l.lineTotal)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 14, gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 300px' }}>
              {showGst && (
                <table style={{ fontSize: 12 }}>
                  <thead><tr><th>GST rate</th><th className="num">Taxable</th>{d.isInterState ? <th className="num">IGST</th> : <><th className="num">CGST</th><th className="num">SGST</th></>}</tr></thead>
                  <tbody>{[...byRate.entries()].map(([r, e]) => <tr key={r}><td>{r}%</td><td className="num">{money(e.taxable)}</td>{d.isInterState ? <td className="num">{money(e.igst)}</td> : <><td className="num">{money(e.cgst)}</td><td className="num">{money(e.sgst)}</td></>}</tr>)}</tbody>
                </table>
              )}
            </div>
            <div className="totals-box" style={{ color: '#111' }}>
              <div className="t-row"><span>Subtotal</span><span>{money(d.subtotal)}</span></div>
              {num(d.discountTotal) > 0 && <div className="t-row"><span>Discount</span><span>-{money(d.discountTotal)}</span></div>}
              {showGst && (num(d.igstTotal) > 0 ? <div className="t-row"><span>IGST</span><span>{money(d.igstTotal)}</span></div> : <><div className="t-row"><span>CGST</span><span>{money(d.cgstTotal)}</span></div><div className="t-row"><span>SGST</span><span>{money(d.sgstTotal)}</span></div></>)}
              {num(d.roundOff) !== 0 && <div className="t-row"><span>Round off</span><span>{num(d.roundOff) > 0 ? '+' : ''}{money(d.roundOff)}</span></div>}
              <div className="t-row grand"><span>Total</span><span>{'₹'} {money(d.total)}</span></div>
              {settleable && num(d.paid) > 0 && <div className="t-row"><span>Paid</span><span>{money(d.paid)}</span></div>}
              {settleable && <div className="t-row" style={{ fontWeight: 600 }}><span>Balance due</span><span>{money(d.balance)}</span></div>}
            </div>
          </div>
          <p className="small" style={{ marginTop: 12 }}><strong>Amount in words:</strong> {amountInWords(d.total)}</p>
          {d.notes && <p className="small" style={{ marginTop: 8, whiteSpace: 'pre-line' }}><strong>Notes:</strong> {d.notes}</p>}
          <div className="inv-meta" style={{ marginTop: 22 }}>
            <div>{d.type === 'SALES_INVOICE' && company.bankDetails && <><h4>Bank details</h4><div className="small" style={{ whiteSpace: 'pre-line' }}>{company.bankDetails}</div></>}
              {d.terms && <><h4 style={{ marginTop: 10 }}>Terms</h4><div className="small" style={{ whiteSpace: 'pre-line' }}>{d.terms}</div></>}</div>
            <div style={{ textAlign: 'right', alignSelf: 'end' }}><div className="small" style={{ marginBottom: 36 }}>For {company.legalName || company.name}</div><div className="small" style={{ borderTop: '1px solid #999', display: 'inline-block', paddingTop: 4, minWidth: 160 }}>Authorised signatory</div></div>
          </div>
        </div>

        <div className="stack no-print">
          <Card title="Summary">
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px' }}>
              <dt className="muted">Status</dt><dd style={{ margin: 0, textAlign: 'right' }}>{d.status === 'CANCELLED' ? statusBadge('CANCELLED') : settleable ? statusBadge(d.paymentStatus, d.overdue) : num(d.balance) > 0 ? 'Credit not fully used' : 'Fully applied'}</dd>
              <dt className="muted">Total</dt><dd className="num" style={{ margin: 0 }}>{money(d.total)}</dd>
              <dt className="muted">{settleable ? 'Balance due' : 'Unused credit'}</dt><dd className="num" style={{ margin: 0, fontWeight: 600 }}>{money(d.balance)}</dd>
              <dt className="muted">Journal entry</dt><dd style={{ margin: 0, textAlign: 'right' }}><Link to={`/vouchers/${d.voucherId}`}>{d.voucher.number}</Link></dd>
              <dt className="muted">Created by</dt><dd style={{ margin: 0, textAlign: 'right' }}>{d.createdByName ?? '-'}</dd>
            </dl>
            {d.status === 'CANCELLED' && <div className="alert" style={{ marginTop: 12 }}>Cancelled{d.cancelReason ? `: ${d.cancelReason}` : ''}</div>}
          </Card>
          {(d.allocations.length > 0 || d.creditAllocations.length > 0) && (
            <Card title={settleable ? 'Payments and credits applied' : 'Applied to'} pad={false}>
              <table><tbody>
                {d.allocations.map((a: any) => (
                  <tr key={a.id}><td>{a.payment ? <>{a.payment.voucher.number}<div className="muted small">{date(a.payment.date)} · {a.payment.reference ?? a.payment.mode}</div></> : <Link to={`/documents/${a.creditDocument.id}`}>{a.creditDocument.number}</Link>}</td><td className="num">{money(a.amount)}</td><td className="right">{active && can('payment.write') && <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => unlink(a.id)}>Remove</Button>}</td></tr>
                ))}
                {d.creditAllocations.map((a: any) => (
                  <tr key={a.id}><td><Link to={`/documents/${a.document.id}`}>{a.document.number}</Link></td><td className="num">{money(a.amount)}</td><td className="right">{active && can('payment.write') && <Button size="sm" variant="ghost" onClick={() => unlink(a.id)}>Remove</Button>}</td></tr>
                ))}
              </tbody></table>
            </Card>
          )}
          {d.linkedDocuments.length > 0 && (
            <Card title="Credit / debit notes against this" pad={false}>
              <table><tbody>{d.linkedDocuments.map((n: any) => <tr key={n.id}><td><Link to={`/documents/${n.id}`}>{n.number}</Link> {n.status === 'CANCELLED' && statusBadge('CANCELLED')}</td><td className="num">{money(n.total)}</td></tr>)}</tbody></table>
            </Card>
          )}
        </div>
      </div>
      {paying && <PaymentModal direction={sales ? 'RECEIVED' : 'PAID'} partyId={d.partyId} documentId={d.id} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); reload(); }} />}
      {applying && <ApplyNoteModal doc={d} sales={sales} onClose={() => setApplying(false)} onSaved={() => { setApplying(false); reload(); }} />}
    </>
  );
}

function ApplyNoteModal({ doc, sales, onClose, onSaved }: { doc: any; sales: boolean; onClose: () => void; onSaved: () => void }) {
  const fb = useFeedback();
  const open = useApi<any>(`/parties/${doc.partyId}/open-items`);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const docs = open.data?.documents ?? [];
  const sum = Object.values(alloc).reduce((a, v) => a + num(v), 0);
  const left = num(doc.balance) - sum;
  const save = async () => {
    setBusy(true);
    try {
      const items = Object.entries(alloc).filter(([, v]) => num(v) > 0).map(([documentId, v]) => ({ documentId, amount: num(v).toFixed(2) }));
      await post(`/documents/${doc.id}/apply`, { items });
      fb.toast('Applied'); onSaved();
    } catch (e) { fb.error(e instanceof ApiError ? e : e); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={`Apply ${doc.number}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={sum <= 0 || left < 0} onClick={save}>Apply</Button></>}>
      <p className="muted" style={{ marginBottom: 10 }}>{money(doc.balance)} of this note is unused. Choose the {sales ? 'invoices' : 'bills'} it should reduce.</p>
      {docs.length ? (
        <div className="table-wrap card"><table>
          <thead><tr><th>Document</th><th className="num">Outstanding</th><th className="num" style={{ width: 150 }}>Apply</th></tr></thead>
          <tbody>{docs.map((x: any) => <tr key={x.id}><td className="mono-id">{x.number}</td><td className="num">{money(x.outstanding)}</td><td><input className="num" aria-label={`Apply to ${x.number}`} value={alloc[x.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [x.id]: e.target.value })} /></td></tr>)}</tbody>
        </table></div>
      ) : <div className="muted">Nothing is outstanding for this party.</div>}
      <div className={`small ${left < 0 ? 'neg' : 'muted'}`} style={{ marginTop: 8, textAlign: 'right' }}>{left < 0 ? 'More than available by' : 'Remaining'} {money(Math.abs(left))}</div>
    </Modal>
  );
}
