import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, patch, post } from '../api';
import { useAuth } from '../auth';
import { useApi, useDebounced, useTitle } from '../hooks';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pagination, SearchBox, useFeedback } from '../components/ui';
import { downloadCsv, money, num, qty, today } from '../format';

export function ProductFormModal({ product, onClose, onSaved }: { product?: any; onClose: () => void; onSaved: (p: any) => void }) {
  const fb = useFeedback();
  const editing = !!product;
  const [f, setF] = useState({
    name: product?.name ?? '', sku: product?.sku ?? '', kind: product?.kind ?? 'GOODS', category: product?.category ?? '', hsn: product?.hsn ?? '', unit: product?.unit ?? 'Nos',
    salePrice: String(product?.salePrice ?? ''), purchasePrice: String(product?.purchasePrice ?? ''), gstRate: String(product?.gstRate ?? '18'), trackStock: product?.trackStock ?? true,
    reorderLevel: String(product?.reorderLevel ?? '0'), description: product?.description ?? '', openingQty: '', openingRate: '', openingDate: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const cats = useApi<any>('/products/categories');
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const goods = f.kind === 'GOODS';
  const save = async () => {
    setErrors({});
    if (!f.name.trim()) return setErrors({ name: 'Enter a name' });
    setBusy(true);
    try {
      const body: any = { name: f.name.trim(), sku: f.sku.trim() || undefined, kind: f.kind, category: f.category.trim() || undefined, hsn: f.hsn.trim() || undefined, unit: f.unit.trim() || 'Nos', salePrice: num(f.salePrice).toFixed(2), purchasePrice: num(f.purchasePrice).toFixed(2), gstRate: num(f.gstRate), trackStock: goods && f.trackStock, reorderLevel: num(f.reorderLevel), description: f.description || undefined };
      if (!editing && goods && f.trackStock && num(f.openingQty) > 0) { body.openingQty = f.openingQty; body.openingRate = num(f.openingRate || f.purchasePrice).toFixed(2); if (f.openingDate) body.openingDate = f.openingDate; }
      const saved = editing ? await patch(`/products/${product.id}`, body) : await post('/products', body);
      fb.toast(`${saved.name} ${editing ? 'updated' : 'added'}`);
      onSaved(saved);
    } catch (e) { const err = e as ApiError; Object.keys(err.fieldErrors).length ? setErrors(err.fieldErrors) : setErrors({ _: err.message }); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={editing ? 'Edit product or service' : 'New product or service'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{editing ? 'Save changes' : 'Add item'}</Button></>}>
      <div className="form-grid">
        <Field label="Name" error={errors.name} full><input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={200} /></Field>
        <Field label="Type"><select value={f.kind} onChange={(e) => set('kind', e.target.value)} disabled={editing}><option value="GOODS">Goods (physical items)</option><option value="SERVICE">Service</option></select></Field>
        <Field label="SKU / code" error={errors.sku} hint={editing ? undefined : 'Leave blank to generate one'}><input value={f.sku} onChange={(e) => set('sku', e.target.value)} disabled={editing} maxLength={50} /></Field>
        <Field label="Category"><input list="cats" value={f.category} onChange={(e) => set('category', e.target.value)} /><datalist id="cats">{(cats.data?.items ?? []).map((c: string) => <option key={c} value={c} />)}</datalist></Field>
        <Field label={goods ? 'HSN code' : 'SAC code'}><input value={f.hsn} onChange={(e) => set('hsn', e.target.value)} maxLength={20} /></Field>
        <Field label="Unit"><input list="units" value={f.unit} onChange={(e) => set('unit', e.target.value)} /><datalist id="units">{['Nos', 'Kg', 'Gram', 'Litre', 'Metre', 'Box', 'Pack', 'Ream', 'Set', 'Hour', 'Job', 'Year'].map((u) => <option key={u} value={u} />)}</datalist></Field>
        <Field label="Selling price"><input className="num" inputMode="decimal" value={f.salePrice} onChange={(e) => set('salePrice', e.target.value)} placeholder="0.00" /></Field>
        <Field label="Purchase price"><input className="num" inputMode="decimal" value={f.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)} placeholder="0.00" /></Field>
        <Field label="GST rate"><select value={f.gstRate} onChange={(e) => set('gstRate', e.target.value)}>{['0', '0.25', '3', '5', '12', '18', '28'].map((r) => <option key={r} value={r}>{r}%</option>)}</select></Field>
        {goods && <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={f.trackStock} onChange={(e) => set('trackStock', e.target.checked)} disabled={editing} />Track stock quantity</label>}
        {goods && f.trackStock && <Field label="Reorder level" hint="Warn when stock falls to this quantity"><input className="num" inputMode="decimal" value={f.reorderLevel} onChange={(e) => set('reorderLevel', e.target.value)} /></Field>}
        {!editing && goods && f.trackStock && (
          <>
            <Field label="Opening stock quantity" hint="What you already have on the shelf"><input className="num" inputMode="decimal" value={f.openingQty} onChange={(e) => set('openingQty', e.target.value)} placeholder="0" /></Field>
            <Field label="Opening cost per unit" hint="Defaults to the purchase price"><input className="num" inputMode="decimal" value={f.openingRate} onChange={(e) => set('openingRate', e.target.value)} /></Field>
            {num(f.openingQty) > 0 && <Field label="Opening stock date" hint="Defaults to the start of this financial year"><input type="date" value={f.openingDate || today()} onChange={(e) => set('openingDate', e.target.value)} /></Field>}
          </>
        )}
        <Field label="Description" full><textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={2} /></Field>
      </div>
      {errors._ && <div className="alert" role="alert" style={{ marginTop: 12 }}>{errors._}</div>}
    </Modal>
  );
}

export default function Products() {
  useTitle('Products & services');
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [low, setLow] = useState(false);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useApi<any>('/products', { q: dq, kind: kind || undefined, lowStock: low || undefined, page, pageSize: 25 });
  return (
    <>
      <PageHeader title="Products & services" subtitle="Everything you sell or buy"
        actions={<>
          <Button icon="download" onClick={() => data && downloadCsv('products.csv', [['SKU', 'Name', 'Type', 'HSN/SAC', 'Unit', 'Selling price', 'Purchase price', 'GST %', 'On hand', 'Stock value'], ...data.items.map((p: any) => [p.sku, p.name, p.kind, p.hsn, p.unit, p.salePrice, p.purchasePrice, p.gstRate, p.trackStock ? p.onHandQty : '', p.trackStock ? p.onHandValue : ''])])}>Export CSV</Button>
          {can('product.write') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>New item</Button>}
        </>} />
      <Card pad={false}>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name, SKU or HSN" />
          <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label="Type"><option value="">Goods and services</option><option value="GOODS">Goods only</option><option value="SERVICE">Services only</option></select>
          <label className="check small"><input type="checkbox" checked={low} onChange={(e) => { setLow(e.target.checked); setPage(1); }} />Low stock only</label>
        </div>
        {error && <div className="card-pad"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && !data.items.length ? <Empty title={q || low ? 'No match' : 'No products or services yet'} action={!q && can('product.write') ? <Button variant="primary" onClick={() => setAdding(true)}>Add your first item</Button> : undefined}>Add what you sell so invoices fill in prices and GST automatically.</Empty> : data && (
          <div className="table-wrap"><table>
            <thead><tr><th>Item</th><th>SKU</th><th>HSN/SAC</th><th className="num">Selling price</th><th className="num">Purchase price</th><th className="num">GST</th><th className="num">On hand</th><th className="num">Stock value</th></tr></thead>
            <tbody>{data.items.map((p: any) => {
              const low = p.kind === 'GOODS' && p.trackStock && num(p.onHandQty) <= num(p.reorderLevel);
              return (
                <tr key={p.id} className={`clickable ${p.isActive ? '' : 'muted-row'}`} onClick={() => nav(`/products/${p.id}`)}>
                  <td style={{ fontWeight: 500 }}>{p.name} {p.kind === 'SERVICE' && <Badge tone="blue">Service</Badge>} {!p.isActive && <Badge>Inactive</Badge>}<div className="muted small">{p.category}</div></td>
                  <td className="mono-id">{p.sku}</td><td>{p.hsn ?? '-'}</td><td className="num">{money(p.salePrice)}</td><td className="num">{p.kind === 'SERVICE' ? '-' : money(p.purchasePrice)}</td><td className="num">{num(p.gstRate)}%</td>
                  <td className="num">{p.trackStock ? <span className={low ? 'neg' : ''}>{qty(p.onHandQty)} {p.unit}{low && ' (low)'}</span> : <span className="faint">Not tracked</span>}</td>
                  <td className="num">{p.trackStock ? money(p.onHandValue) : '-'}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      {adding && <ProductFormModal onClose={() => setAdding(false)} onSaved={(p) => { setAdding(false); nav(`/products/${p.id}`); }} />}
    </>
  );
}
