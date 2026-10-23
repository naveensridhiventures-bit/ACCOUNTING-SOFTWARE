import { ReactNode, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { FeedbackProvider, Loading } from './components/ui';
import { Icon } from './components/Icon';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DocumentList from './pages/DocumentList';
import DocumentEditor from './pages/DocumentEditor';
import DocumentView from './pages/DocumentView';
import Parties from './pages/Parties';
import PartyDetail from './pages/PartyDetail';
import Payments from './pages/Payments';
import Expenses from './pages/Expenses';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import StockSummary from './pages/StockSummary';
import Banking from './pages/Banking';
import Reconciliation from './pages/Reconciliation';
import ChartOfAccounts from './pages/ChartOfAccounts';
import Vouchers from './pages/Vouchers';
import VoucherForm from './pages/VoucherForm';
import VoucherView from './pages/VoucherView';
import LedgerStatement from './pages/LedgerStatement';
import ReportsHub from './pages/ReportsHub';
import { TrialBalance, ProfitLoss, BalanceSheet, GroupSummary } from './pages/FinancialReports';
import { Ageing, PartySummary, ProductSummary } from './pages/BusinessReports';
import Gst from './pages/Gst';
import CompanySettings from './pages/CompanySettings';
import FinancialYears from './pages/FinancialYears';
import UsersRoles from './pages/UsersRoles';
import AuditLog from './pages/AuditLog';
import Profile from './pages/Profile';

interface NavItem { to: string; label: string; icon: string; perm?: string; end?: boolean }
const NAV: { title: string; items: NavItem[] }[] = [
  { title: '', items: [{ to: '/', label: 'Dashboard', icon: 'home', end: true }] },
  { title: 'Sales', items: [
    { to: '/sales/invoices', label: 'Invoices', icon: 'invoice', perm: 'sales.read' },
    { to: '/sales/credit-notes', label: 'Credit notes', icon: 'note', perm: 'sales.read' },
    { to: '/sales/receipts', label: 'Receipts', icon: 'cash', perm: 'payment.read' },
    { to: '/customers', label: 'Customers', icon: 'users', perm: 'party.read' },
  ] },
  { title: 'Purchases', items: [
    { to: '/purchases/bills', label: 'Bills', icon: 'bill', perm: 'purchase.read' },
    { to: '/purchases/debit-notes', label: 'Debit notes', icon: 'note', perm: 'purchase.read' },
    { to: '/purchases/payments', label: 'Payments', icon: 'cash', perm: 'payment.read' },
    { to: '/suppliers', label: 'Suppliers', icon: 'truck', perm: 'party.read' },
    { to: '/expenses', label: 'Expenses', icon: 'receipt', perm: 'voucher.read' },
  ] },
  { title: 'Inventory', items: [
    { to: '/products', label: 'Products & services', icon: 'box', perm: 'product.read' },
    { to: '/stock', label: 'Stock summary', icon: 'layers', perm: 'product.read' },
  ] },
  { title: 'Banking', items: [
    { to: '/banking', label: 'Cash & bank', icon: 'bank', perm: 'ledger.read' },
    { to: '/banking/reconcile', label: 'Reconciliation', icon: 'check', perm: 'ledger.read' },
  ] },
  { title: 'Accounting', items: [
    { to: '/accounts', label: 'Chart of accounts', icon: 'list', perm: 'ledger.read' },
    { to: '/vouchers', label: 'Vouchers', icon: 'book', perm: 'voucher.read' },
  ] },
  { title: 'Insights', items: [
    { to: '/reports', label: 'Reports', icon: 'chart', perm: 'report.read' },
    { to: '/gst', label: 'GST', icon: 'pie', perm: 'report.read' },
  ] },
  { title: 'Admin', items: [
    { to: '/settings/company', label: 'Company', icon: 'settings', perm: 'company.read' },
    { to: '/settings/years', label: 'Financial years', icon: 'book', perm: 'company.read' },
    { to: '/settings/users', label: 'Users & roles', icon: 'shield', perm: 'user.read' },
    { to: '/settings/audit', label: 'Audit log', icon: 'file', perm: 'audit.read' },
  ] },
];

function Shell() {
  const { user, company, can, logout, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('ledgerly.theme') === 'dark'; } catch { return false; } });
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { setOpen(false); setMenu(false); }, [loc.pathname]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('ledgerly.theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark]);

  if (loading) return <div style={{ padding: 40 }}><Loading /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <NavLink to="/" className="brand">
          <span className="brand-mark"><svg width="16" height="16" viewBox="0 0 32 32" fill="none"><path d="M9 8v16h14M9 14h9M9 19h9" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></svg></span>
          Ledgerly
        </NavLink>
        <nav className="nav">
          {NAV.map((g) => {
            const items = g.items.filter((i) => !i.perm || can(i.perm));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={g.title || 'top'}>
                {g.title && <div className="nav-title">{g.title}</div>}
                {items.map((i) => <NavLink key={i.to} to={i.to} end={i.end ?? false}><Icon name={i.icon} />{i.label}</NavLink>)}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">Books are append-only: corrections post reversing entries.</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost sm menu-btn" onClick={() => setOpen(!open)} aria-label="Open menu"><Icon name="menu" /></button>
          <span className="company">{company?.name}</span>
          {company?.gstin && <span className="muted small">GSTIN {company.gstin}</span>}
          <span className="grow" />
          <button className="btn ghost sm" onClick={() => setDark(!dark)} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}><Icon name={dark ? 'sun' : 'moon'} /></button>
          <div className="user-menu">
            <button className="avatar" onClick={() => setMenu(!menu)} aria-label="Account menu" aria-expanded={menu}>{initials}</button>
            {menu && (
              <div className="dropdown" role="menu">
                <div style={{ padding: '6px 10px' }}><strong>{user.name}</strong><div className="muted small">{user.email} · {user.roleName}</div></div>
                <button onClick={() => nav('/profile')}>Change password</button>
                <button onClick={() => { logout(); nav('/login'); }}>Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}

function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <div className="alert warn">You do not have permission to open this page ({perm}). Ask an administrator to update your role.</div>;
  return <>{children}</>;
}

const docRoute = (path: string, type: 'SALES_INVOICE' | 'PURCHASE_BILL' | 'CREDIT_NOTE' | 'DEBIT_NOTE', perm: string) => [
  <Route key={path} path={path} element={<Guard perm={perm}><DocumentList type={type} /></Guard>} />,
  <Route key={path + '/new'} path={`${path}/new`} element={<Guard perm={perm}><DocumentEditor type={type} /></Guard>} />,
];

export default function App() {
  return (
    <BrowserRouter>
      <FeedbackProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Shell />}>
              <Route index element={<Dashboard />} />
              {docRoute('/sales/invoices', 'SALES_INVOICE', 'sales.read')}
              {docRoute('/sales/credit-notes', 'CREDIT_NOTE', 'sales.read')}
              {docRoute('/purchases/bills', 'PURCHASE_BILL', 'purchase.read')}
              {docRoute('/purchases/debit-notes', 'DEBIT_NOTE', 'purchase.read')}
              <Route path="/documents/:id" element={<DocumentView />} />
              <Route path="/sales/receipts" element={<Guard perm="payment.read"><Payments direction="RECEIVED" /></Guard>} />
              <Route path="/purchases/payments" element={<Guard perm="payment.read"><Payments direction="PAID" /></Guard>} />
              <Route path="/customers" element={<Guard perm="party.read"><Parties type="CUSTOMER" /></Guard>} />
              <Route path="/suppliers" element={<Guard perm="party.read"><Parties type="SUPPLIER" /></Guard>} />
              <Route path="/parties/:id" element={<Guard perm="party.read"><PartyDetail /></Guard>} />
              <Route path="/expenses" element={<Guard perm="voucher.read"><Expenses /></Guard>} />
              <Route path="/products" element={<Guard perm="product.read"><Products /></Guard>} />
              <Route path="/products/:id" element={<Guard perm="product.read"><ProductDetail /></Guard>} />
              <Route path="/stock" element={<Guard perm="product.read"><StockSummary /></Guard>} />
              <Route path="/banking" element={<Guard perm="ledger.read"><Banking /></Guard>} />
              <Route path="/banking/reconcile" element={<Guard perm="ledger.read"><Reconciliation /></Guard>} />
              <Route path="/accounts" element={<Guard perm="ledger.read"><ChartOfAccounts /></Guard>} />
              <Route path="/ledgers/:id" element={<Guard perm="report.read"><LedgerStatement /></Guard>} />
              <Route path="/vouchers" element={<Guard perm="voucher.read"><Vouchers /></Guard>} />
              <Route path="/vouchers/new" element={<Guard perm="voucher.create"><VoucherForm /></Guard>} />
              <Route path="/vouchers/:id" element={<Guard perm="voucher.read"><VoucherView /></Guard>} />
              <Route path="/reports" element={<Guard perm="report.read"><ReportsHub /></Guard>} />
              <Route path="/reports/trial-balance" element={<Guard perm="report.read"><TrialBalance /></Guard>} />
              <Route path="/reports/profit-loss" element={<Guard perm="report.read"><ProfitLoss /></Guard>} />
              <Route path="/reports/balance-sheet" element={<Guard perm="report.read"><BalanceSheet /></Guard>} />
              <Route path="/reports/group-summary" element={<Guard perm="report.read"><GroupSummary /></Guard>} />
              <Route path="/reports/receivables" element={<Guard perm="report.read"><Ageing kind="receivables" /></Guard>} />
              <Route path="/reports/payables" element={<Guard perm="report.read"><Ageing kind="payables" /></Guard>} />
              <Route path="/reports/sales-by-customer" element={<Guard perm="report.read"><PartySummary kind="SALES" /></Guard>} />
              <Route path="/reports/purchases-by-supplier" element={<Guard perm="report.read"><PartySummary kind="PURCHASE" /></Guard>} />
              <Route path="/reports/sales-by-product" element={<Guard perm="report.read"><ProductSummary kind="SALES" /></Guard>} />
              <Route path="/reports/purchases-by-product" element={<Guard perm="report.read"><ProductSummary kind="PURCHASE" /></Guard>} />
              <Route path="/gst" element={<Guard perm="report.read"><Gst /></Guard>} />
              <Route path="/settings/company" element={<Guard perm="company.read"><CompanySettings /></Guard>} />
              <Route path="/settings/years" element={<Guard perm="company.read"><FinancialYears /></Guard>} />
              <Route path="/settings/users" element={<Guard perm="user.read"><UsersRoles /></Guard>} />
              <Route path="/settings/audit" element={<Guard perm="audit.read"><AuditLog /></Guard>} />
              <Route path="/profile" element={<Profile />} />
              <Route path="*" element={<div className="empty"><h3>Page not found</h3><p>Use the menu to find what you need.</p></div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </FeedbackProvider>
    </BrowserRouter>
  );
}
