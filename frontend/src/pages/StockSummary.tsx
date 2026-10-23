import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useDebounced, useTitle } from '../hooks';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, SearchBox, Stat, useFeedback } from '../components/ui';
import { downloadCsv, money, num, qty, rupee, today } from '../format';

export function AdjustStockModal({ product, onClose, onSaved }: { product: any; onClose: () => void; onSaved: () => void }) {
  const fb = useFeedback();
  const [f, setF] = useState({ date: today(), direction: 'OUT', qty: '', unitCost: '', reason: 'COUNT_CORRECTION', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setError('');
    if (num(f.qty) <= 0) return setError('Enter a quantity greater than zero.');
    setBusy(true);
    try { const r = await post('/stock/adjustments', { productId: product.id, date: f.date, direction: f.direction, qty: f.qty, unitCost: f.direction === 'IN' && f.unitCost ? num(f.unitCost).toFixed(2) : undefined, reason: f.reason, notes: f.notes || undefined }); fb.toast(`Stock adjusted (${money(r.value)})`); onSaved(); }
    catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Adjust stock: ${product.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Post adjustment</Button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>Currently {qty(product.onHandQty ?? product.qty)} {product.unit} in stock. The change is posted to the books at average cost.</p>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Change"><select value={f.direction} onChange={(e) => set('direction', e.target.value)}><option value="OUT">Decrease stock</option><option value="IN">Increase stock</option></select></Field>
        <Field label="Quantity"><input className="num" inputMode="decimal" value={f.qty} onChange={(e) => set('qty', e.target.value)} /></Field>
        {f.direction === 'IN' && <Field label="Cost per unit" hint="Blank uses average cost"><input className="num" inputMode="decimal" value={f.unitCost} onChange={(e) => set('unitCost', e.target.value)} /></Field>}
        <Field label="Reason"><select value={f.reason} onChange={(e) => set('reason', e.target.value)}><option value="COUNT_CORRECTION">Stock count correction</option><option value="DAMAGE">Damaged</option><option value="LOSS">Lost or stolen</option><option value="SAMPLE">Samples given</option><option value="OTHER">Other</option></select></Field>
        <Field label="Notes"><input value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      {error && <div className="alert" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

export default function StockSummary() {
  useTitle('Stock summary');
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [asOf, setAsOf] = useState(today());
  const [adjust, setAdjust] = useState<any>(null);
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useApi<any>('/stock/summary', { q: dq, asOf });
  const lowCount = data?.items.filter((i: any) => i.low).length ?? 0;
  return (
    <>
      <PageHeader title="Stock summary" subtitle="Quantity and value of every stock-tracked item (weighted average cost)"
        actions={<Button icon="download" onClick={() => data && downloadCsv('stock-summary.csv', [['SKU', 'Item', 'Category', 'Unit', 'Quantity', 'Average cost', 'Value'], ...data.items.map((i: any) => [i.sku, i.name, i.category, i.unit, i.qty, i.averageCost, i.value])])}>Export CSV</Button>} />
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat label="Total stock value" value={rupee(data?.totalValue ?? 0)} foot="Matches the Inventory ledger" />
        <Stat label="Items tracked" value={data?.items.length ?? 0} />
        <Stat label="At or below reorder level" value={lowCount} tone={lowCount ? 'neg' : undefined} />
      </div>
      <Card pad={false}>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Search item or SKU" />
          <label className="row small muted">As of <input type="date" value={asOf} max={today()} onChange={(e) => e.target.value && setAsOf(e.target.value)} style={{ width: 'auto' }} /></label>
        </div>
        {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && !data.items.length ? <Empty title="No stock-tracked items">Add goods with stock tracking turned on to see them here.</Empty> : data && (
          <div className="table-wrap"><table>
            <thead><tr><th>Item</th><th>Category</th><th className="num">Quantity</th><th className="num">Average cost</th><th className="num">Value</th><th className="num">Selling price</th><th /></tr></thead>
            <tbody>{data.items.map((i: any) => (
              <tr key={i.id} className="clickable" onClick={() => nav(`/products/${i.id}`)}>
                <td style={{ fontWeight: 500 }}>{i.name} {i.low && <Badge tone="red">Low</Badge>}<div className="muted small">{i.sku}</div></td><td>{i.category ?? '-'}</td>
                <td className="num">{qty(i.qty)} {i.unit}</td><td className="num">{money(i.averageCost)}</td><td className="num" style={{ fontWeight: 500 }}>{money(i.value)}</td><td className="num">{money(i.salePrice)}</td>
                <td className="right">{can('stock.adjust') && asOf === today() && <Button size="sm" onClick={(e) => { e.stopPropagation(); setAdjust({ id: i.id, name: i.name, unit: i.unit, onHandQty: i.qty }); }}>Adjust</Button>}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={4}>Total</td><td className="num">{money(data.totalValue)}</td><td colSpan={2} /></tr></tfoot>
          </table></div>
        )}
      </Card>
      {adjust && <AdjustStockModal product={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); reload(); }} />}
    </>
  );
}
