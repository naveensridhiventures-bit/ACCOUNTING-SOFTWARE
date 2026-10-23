import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { patch } from '../api';
import { useAuth } from '../auth';
import { useApi, useTitle } from '../hooks';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Pagination, Stat, useFeedback } from '../components/ui';
import { date, money, num, qty, rupee, titleCase } from '../format';
import { ProductFormModal } from './Products';
import { AdjustStockModal } from './StockSummary';

export default function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const fb = useFeedback();
  const [page, setPage] = useState(1);
  const { data: p, loading, error, reload } = useApi<any>(`/products/${id}`);
  const mv = useApi<any>(`/products/${id}/movements`, { page, pageSize: 20 });
  const [edit, setEdit] = useState(false);
  const [adjust, setAdjust] = useState(false);
  useTitle(p?.name ?? 'Product');
  if (loading && !p) return <Loading rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!p) return null;
  const tracked = p.kind === 'GOODS' && p.trackStock;
  const low = tracked && num(p.onHandQty) <= num(p.reorderLevel);
  const toggle = async () => { try { await patch(`/products/${p.id}`, { isActive: !p.isActive }); fb.toast(p.isActive ? 'Marked inactive' : 'Marked active'); reload(); } catch (e) { fb.error(e); } };
  return (
    <>
      <PageHeader crumb={<Link to="/products">Products & services</Link>} title={<span className="row">{p.name} {!p.isActive && <Badge>Inactive</Badge>}{low && <Badge tone="red">Low stock</Badge>}</span>} subtitle={`${p.sku}${p.hsn ? ` · HSN/SAC ${p.hsn}` : ''}${p.category ? ` · ${p.category}` : ''}`}
        actions={<>
          {tracked && can('stock.adjust') && <Button onClick={() => setAdjust(true)}>Adjust stock</Button>}
          {can('product.write') && <Button onClick={() => setEdit(true)}>Edit</Button>}
          {can('product.write') && <Button variant="ghost" onClick={toggle}>{p.isActive ? 'Mark inactive' : 'Mark active'}</Button>}
        </>} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Selling price" value={rupee(p.salePrice)} foot={`GST ${num(p.gstRate)}%`} />
        <Stat label="Purchase price" value={p.kind === 'SERVICE' ? '-' : rupee(p.purchasePrice)} />
        <Stat label="On hand" value={tracked ? `${qty(p.onHandQty)} ${p.unit}` : 'Not tracked'} tone={low ? 'neg' : undefined} foot={tracked ? `Reorder at ${qty(p.reorderLevel)}` : undefined} />
        <Stat label="Stock value" value={tracked ? rupee(p.onHandValue) : '-'} foot={tracked ? `Average cost ${rupee(p.averageCost)}` : undefined} />
      </div>
      {tracked && (
        <Card title="Stock movements" pad={false}>
          {mv.data?.items.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Type</th><th>Source</th><th className="num">Quantity</th><th className="num">Value</th><th className="num">Balance qty</th><th className="num">Balance value</th></tr></thead>
              <tbody>{mv.data.items.map((m: any) => (
                <tr key={m.id} className={m.document ? 'clickable' : ''} onClick={() => m.document && nav(`/documents/${m.document.id}`)}>
                  <td className="nowrap">{date(m.date)}</td><td>{titleCase(m.type)}</td><td>{m.document?.number ?? m.note ?? '-'}</td>
                  <td className={`num ${num(m.qty) < 0 ? 'neg' : 'pos'}`}>{num(m.qty) > 0 ? '+' : ''}{qty(m.qty)}</td><td className="num">{money(m.value)}</td><td className="num">{qty(m.balanceQty)}</td><td className="num">{money(m.balanceValue)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No movements yet">Stock moves when you post purchase bills, sales invoices, notes or adjustments.</Empty>}
          {mv.data && <Pagination page={page} pageSize={20} total={mv.data.total} onPage={setPage} />}
        </Card>
      )}
      {edit && <ProductFormModal product={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
      {adjust && <AdjustStockModal product={p} onClose={() => setAdjust(false)} onSaved={() => { setAdjust(false); reload(); mv.reload(); }} />}
    </>
  );
}
