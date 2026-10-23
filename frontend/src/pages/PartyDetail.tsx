import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { patch } from '../api';
import { useAuth } from '../auth';
import { useApi, useTitle } from '../hooks';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Stat, Tabs, statusBadge, useFeedback } from '../components/ui';
import { date, money, num, rupee, titleCase } from '../format';
import { PartyFormModal } from './Parties';
import { PaymentModal } from './Payments';

export default function PartyDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const fb = useFeedback();
  const { data: p, loading, error, reload } = useApi<any>(`/parties/${id}`);
  const docs = useApi<any>('/documents', { partyId: id, pageSize: 100 });
  const pays = useApi<any>(can('payment.read') ? '/payments' : null, { partyId: id, pageSize: 100 });
  const [tab, setTab] = useState<'docs' | 'payments'>('docs');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  useTitle(p?.name ?? 'Party');
  if (loading && !p) return <Loading rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!p) return null;
  const cust = p.type === 'CUSTOMER';
  const base = cust ? '/sales/invoices' : '/purchases/bills';
  const toggle = async () => { try { await patch(`/parties/${p.id}`, { isActive: !p.isActive }); fb.toast(p.isActive ? 'Marked inactive' : 'Marked active'); reload(); } catch (e) { fb.error(e); } };

  return (
    <>
      <PageHeader crumb={<Link to={cust ? '/customers' : '/suppliers'}>{cust ? 'Customers' : 'Suppliers'}</Link>} title={<span className="row">{p.name} {!p.isActive && <Badge>Inactive</Badge>}</span>}
        subtitle={[p.gstin ? `GSTIN ${p.gstin}` : 'Unregistered', [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
        actions={<>
          <Button onClick={() => nav(`/ledgers/${p.ledgerId}`)}>Statement</Button>
          {can('party.write') && <Button onClick={() => setEdit(true)}>Edit</Button>}
          {can('party.write') && <Button variant="ghost" onClick={toggle}>{p.isActive ? 'Mark inactive' : 'Mark active'}</Button>}
          {can('payment.write') && <Button onClick={() => setPay(true)}>{cust ? 'Record receipt' : 'Record payment'}</Button>}
          {can(cust ? 'sales.write' : 'purchase.write') && p.isActive && <Button variant="primary" icon="plus" onClick={() => nav(`${base}/new?party=${p.id}`)}>New {cust ? 'invoice' : 'bill'}</Button>}
        </>} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label={cust ? 'Balance (they owe you)' : 'Balance (you owe them)'} value={rupee(p.balance)} tone={num(p.balance) < 0 ? 'pos' : undefined} foot={num(p.balance) < 0 ? 'Advance on account' : undefined} />
        <Stat label="Outstanding documents" value={rupee(p.outstanding)} />
        <Stat label="Overdue" value={rupee(p.overdue)} tone={num(p.overdue) > 0 ? 'neg' : undefined} />
        <Stat label="Credit terms" value={`${p.creditDays} days`} foot={p.creditLimit ? `Limit ${rupee(p.creditLimit)}` : 'No credit limit'} />
      </div>
      <div className="grid g-main">
        <Card pad={false}>
          <div style={{ padding: '0 18px' }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'docs', label: `Documents${docs.data ? ` (${docs.data.total})` : ''}` }, { id: 'payments', label: `${cust ? 'Receipts' : 'Payments'}${pays.data ? ` (${pays.data.total})` : ''}` }]} /></div>
          {tab === 'docs' ? (docs.loading && !docs.data ? <Loading rows={3} /> : docs.data?.items.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Number</th><th>Type</th><th>Date</th><th className="num">Total</th><th className="num">Balance</th><th>Status</th></tr></thead>
              <tbody>{docs.data.items.map((d: any) => (
                <tr key={d.id} className={`clickable ${d.status === 'CANCELLED' ? 'muted-row' : ''}`} onClick={() => nav(`/documents/${d.id}`)}>
                  <td className="mono-id">{d.number}</td><td>{titleCase(d.type)}</td><td className="nowrap">{date(d.date)}</td><td className="num">{money(d.total)}</td><td className="num">{d.status === 'CANCELLED' ? '-' : money(d.balance)}</td>
                  <td>{d.type === 'SALES_INVOICE' || d.type === 'PURCHASE_BILL' ? statusBadge(d.paymentStatus, d.overdue) : statusBadge(d.status)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No documents yet" />) : (
            pays.data?.items.length ? (
              <div className="table-wrap"><table>
                <thead><tr><th>Number</th><th>Date</th><th>Mode</th><th>Reference</th><th className="num">Amount</th><th className="num">On account</th></tr></thead>
                <tbody>{pays.data.items.map((x: any) => <tr key={x.id} className={x.status === 'CANCELLED' ? 'muted-row' : ''}><td className="mono-id">{x.number}</td><td className="nowrap">{date(x.date)}</td><td>{titleCase(x.mode)}</td><td>{x.reference ?? '-'}</td><td className="num">{money(x.amount)}</td><td className="num">{x.status === 'CANCELLED' ? 'Cancelled' : money(x.unallocated)}</td></tr>)}</tbody>
              </table></div>
            ) : <Empty title="Nothing recorded yet" />
          )}
        </Card>
        <Card title="Details">
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px' }}>
            {([['Contact', p.contactPerson], ['Phone', p.phone], ['Email', p.email], ['PAN', p.pan], ['Address', [p.billingAddress, p.city, p.state, p.pincode].filter(Boolean).join(', ')], ['Notes', p.notes]] as [string, string][]).filter(([, v]) => v).map(([k, v]) => (
              <Fragment key={k}><dt className="muted">{k}</dt><dd style={{ margin: 0, textAlign: 'right' }}>{v}</dd></Fragment>
            ))}
          </dl>
        </Card>
      </div>
      {edit && <PartyFormModal type={p.type} party={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
      {pay && <PaymentModal direction={cust ? 'RECEIVED' : 'PAID'} partyId={p.id} onClose={() => setPay(false)} onSaved={() => { setPay(false); reload(); docs.reload(); pays.reload(); }} />}
    </>
  );
}
