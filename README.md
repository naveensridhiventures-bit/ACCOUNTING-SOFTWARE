# Ledgerly: accounting software for running a company

Double-entry books, GST invoicing, inventory, payments, banking and financial reports, with a React frontend and a PostgreSQL-backed API.

## What you can do

| Area | Features |
|---|---|
| Sales | Invoices with GST (CGST + SGST or IGST by place of supply), credit notes, receipts, apply advances, print-ready invoice, cancel with reversal |
| Purchases | Bills, debit notes, payments to suppliers, expenses with input tax credit |
| Parties | Customers and suppliers backed by their own ledgers, open items, statements, credit days, GSTIN |
| Inventory | Products and services, HSN/SAC, opening stock, perpetual weighted-average cost, automatic cost of goods sold, stock adjustments, low-stock flags, stock summary as of any date |
| Banking | Cash and bank accounts, transfers, bank reconciliation against your statement |
| Accounting | Chart of accounts with Tally-style groups, manual journal / contra vouchers, day book, account statements with running balance, reversal vouchers |
| Reports | Dashboard, profit and loss, balance sheet, trial balance, group summary, customer and supplier ageing, sales and purchases by party and product (with margin), GST summary with HSN table. All export to CSV. |
| Year end | Financial years, closing entry to Retained Earnings, lock, re-open |
| Control | Users, built-in and custom roles with per-permission access, audit log, password change |

## How the numbers stay right

- Money is `Decimal(18,2)` in PostgreSQL and `decimal.js` in code. Never floats.
- Every document posts a balanced journal. PostgreSQL itself rejects unbalanced vouchers, edits to posted lines, deletes of vouchers and edits to the audit log.
- Corrections are reversal vouchers. Cancelling an invoice reverses its journal and its stock movement.
- Stock quantity and value are updated in the same transaction as the books, so the Stock summary always equals the Inventory ledger.
- Outstanding = document total minus allocations. Receipts, payments, credit notes and debit notes settle documents through allocations.

## Run it locally

You need Node 20+ and PostgreSQL.

```bash
npm run install:all                     # root, backend and frontend dependencies
cd backend
cp .env.example .env                    # set DATABASE_URL, JWT_SECRET, SEED_ADMIN_PASSWORD (10+ characters)
npx prisma generate
npx prisma migrate deploy
npm run seed                            # company, financial year, roles, chart of accounts, admin user
npm run seed:demo                       # optional: ~5 months of realistic sample data
cd ..
npm run dev                             # API on :4000, web app on http://localhost:5173
```

Sign in with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from `backend/.env`.

`npm run seed` is safe to re-run. After every upgrade, run it again so built-in roles and system accounts pick up new permissions.

## Upgrading from the Phase 0-1 backend

Copy the new files over your repository, then in `backend/` run `npm install`, `npx prisma generate`, `npx prisma migrate deploy` (adds the new tables; existing vouchers and ledgers are kept), and `npm run seed`. Cash, Sales and Purchases ledgers you already have are recognised as system accounts automatically.

## Using it day to day

1. **Company** (Settings): set your legal name, GSTIN, state, bank details and number prefixes. The state decides whether sales carry CGST + SGST or IGST.
2. **Chart of accounts**: add your bank accounts, then enter opening balances (debit or credit).
3. **Products & services**: add items; give opening stock a quantity and a cost.
4. **Customers / suppliers**: add parties. Each gets a ledger under Sundry Debtors or Creditors.
5. **Invoices and bills**: pick the party and items. GST, round-off, cost of goods sold and stock all post automatically.
6. **Receipts and payments**: record the money, then allocate it to invoices or bills (or leave it as an advance and apply it later).
7. **Reports and GST**: use the Reports menu. At year end use Settings, Financial years, Close year.

### Good to know

- GST on invoices is rounded per line; the invoice total is rounded to the nearest rupee when that option is on, and the difference goes to the Round Off account.
- A closing entry is dated the last day of the year, so the balance sheet shows current-year profit under "Profit & loss" until that date passes, then under Retained Earnings.
- Selling more than the stock on hand is blocked unless you allow negative stock in Company settings.

## API

Base path `/api/v1`. Everything except login needs `Authorization: Bearer <token>`. Errors look like `{ "error": { "code", "message", "details?" } }`. Dates are `YYYY-MM-DD`; amounts are strings or numbers with at most two decimals.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password` |
| Company | `GET/PUT /company`, `GET/POST /financial-years`, `GET /financial-years/:id/closing-preview`, `POST /financial-years/:id/close`, `POST /financial-years/:id/reopen` |
| Accounts | `/account-groups`, `/ledgers`, `GET /ledgers/:id/statement` |
| Vouchers | `POST/GET /vouchers`, `GET /vouchers/:id`, `POST /vouchers/:id/reverse` |
| Documents | `POST/GET /documents`, `GET /documents/:id`, `POST /documents/:id/cancel`, `POST /documents/:id/apply` |
| Payments | `POST/GET /payments`, `GET /payments/:id`, `POST /payments/:id/allocate`, `POST /payments/:id/cancel`, `DELETE /allocations/:id`, `POST/GET /expenses`, `POST /transfers` |
| Parties | `/parties`, `GET /parties/:id/open-items` |
| Inventory | `/products`, `GET /products/:id/movements`, `GET /stock/summary`, `POST /stock/adjustments` |
| Banking | `GET /banking/accounts`, `GET/POST /banking/reconciliation`, `DELETE /banking/reconciliation/:lineId` |
| Reports | `/reports/dashboard`, `trial-balance`, `profit-loss`, `balance-sheet`, `group-summary`, `receivables`, `payables`, `gst`, `party-summary`, `product-summary` |
| Admin | `/users`, `/roles`, `/permissions`, `/audit-logs` |

## Tests

```bash
cd backend
npx tsc --noEmit
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/acct_test npx prisma migrate deploy   # DATABASE_URL pointing at the same database
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/acct_test npm test
```

Integration tests are skipped when `TEST_DATABASE_URL` is unset. They create their own company and never touch other data.

## Deploying

- **API** (for example Render): root directory `backend`, build `npm install --include=dev && npm run build`, start `npm start`, health check `/health`, env `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL` (the web app's origin). Run migrations and the seed as separate steps from your machine: `DATABASE_URL=<external url> npx prisma migrate deploy` then `npm run seed`.
- **Web app** (static host): root directory `frontend`, build `npm install && npm run build`, publish `dist`, set `VITE_API_URL=https://<your-api>/api/v1` at build time, and add a rewrite of all paths to `/index.html`.
- Check your host's free-tier limits (sleeping services, database expiry) before keeping real books there, and keep regular database backups.

## Design rules (don't break these)

1. Money is never a float.
2. Posted vouchers are never updated or deleted. Reverse and re-post.
3. New financial behaviour posts through `postVoucherTx()` so numbering, financial-year checks, balance checks and the audit log all apply.
4. Every table carries `companyId`; every query filters by it.
