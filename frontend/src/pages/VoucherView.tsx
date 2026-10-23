import { Link, useNavigate, useParams } from 'react-router-dom';
import { post } from '../api';
import { useAuth } from '../auth';
import { useApi, useTitle } from '../hooks';
import { Button, Card, ErrorBox, Loading, PageHeader, statusBadge, useFeedback } from '../components/ui';
import { VOUCHER_LABEL, date, dateTime, money, titleCase } from '../format';

export default function VoucherView() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const fb = useFeedback();
  const { data: v, loading, error, reload } = useApi<any>(`/vouchers/${id}`);
  useTitle(v?.number ?? 'Voucher');
  if (loading && !v) return <Loading rows={5} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!v) return null;
  const owned = v.document || v.payment || v.source === 'CLOSING';
  const canReverse = can('voucher.reverse') && v.status === 'POSTED' && !v.reverses && !owned;
  const reverse = async () => {
    const reason = await fb.confirm({ title: `Reverse ${v.number}?`, message: 'A new voucher with debits and credits swapped is posted. The original stays in the books marked Reversed.', confirmLabel: 'Reverse voucher', danger: true, reason: true });
    if (reason === null) return;
    try { const r = await post(`/vouchers/${v.id}/reverse`, { reason: reason || undefined }); fb.toast(`Reversed by ${r.number}`); nav(`/vouchers/${r.id}`); } catch (e) { fb.error(e); }
  };
  const dr = v.lines.filter((l: any) => l.side === 'DR');
  const cr = v.lines.filter((l: any) => l.side === 'CR');
  return (
    <>
      <PageHeader crumb={<Link to="/vouchers">Vouchers</Link>} title={<span className="row">{v.number} {statusBadge(v.status)}</span>} subtitle={`${VOUCHER_LABEL[v.type] ?? v.type} · ${date(v.date)}`}
        actions={<>
          {v.document && <Button onClick={() => nav(`/documents/${v.document.id}`)}>Open {v.document.number}</Button>}
          {v.payment && <Button onClick={() => nav(`/${v.payment.direction === 'RECEIVED' ? 'sales/receipts' : 'purchases/payments'}`)}>Open receipts / payments</Button>}
          {canReverse && <Button variant="danger" onClick={reverse}>Reverse</Button>}
        </>} />
      {v.source === 'CLOSING' && <div className="alert info" style={{ marginBottom: 14 }}>This is a year-end closing entry. Re-open the financial year to undo it.</div>}
      {v.document && <div className="alert info" style={{ marginBottom: 14 }}>Created by {v.document.number}. Cancel the document to reverse this voucher.</div>}
      {v.reverses && <div className="alert warn" style={{ marginBottom: 14 }}>Reversal of <Link to={`/vouchers/${v.reverses.id}`}>{v.reverses.number}</Link>.</div>}
      {v.reversedBy?.length ? <div className="alert warn" style={{ marginBottom: 14 }}>Reversed by {v.reversedBy.map((r: any) => <Link key={r.id} to={`/vouchers/${r.id}`}>{r.number}</Link>)}.</div> : v.reversedBy && !Array.isArray(v.reversedBy) ? <div className="alert warn" style={{ marginBottom: 14 }}>Reversed by <Link to={`/vouchers/${v.reversedBy.id}`}>{v.reversedBy.number}</Link>.</div> : null}
      <Card pad={false}>
        <div className="table-wrap"><table>
          <thead><tr><th>Account</th><th>Note</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{[...dr, ...cr].map((l: any) => (
            <tr key={l.id}>
              <td style={{ paddingLeft: l.side === 'CR' ? 36 : undefined }}><Link to={`/ledgers/${l.ledger.id}`}>{l.ledger.name}</Link></td><td className="muted">{l.narration ?? ''}</td>
              <td className="num">{l.side === 'DR' ? money(l.amount) : ''}</td><td className="num">{l.side === 'CR' ? money(l.amount) : ''}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={2}>Total</td><td className="num">{money(v.totalAmount)}</td><td className="num">{money(v.totalAmount)}</td></tr></tfoot>
        </table></div>
      </Card>
      <Card className="mt">
        <dl className="kv">
          <dt>Narration</dt><dd>{v.narration ?? '-'}</dd>
          {v.reference && <><dt>Reference</dt><dd>{v.reference}</dd></>}
          <dt>Created from</dt><dd>{titleCase(v.source)}</dd>
          <dt>Posted by</dt><dd>{v.createdByName ?? '-'} on {dateTime(v.createdAt)}</dd>
        </dl>
      </Card>
    </>
  );
}
