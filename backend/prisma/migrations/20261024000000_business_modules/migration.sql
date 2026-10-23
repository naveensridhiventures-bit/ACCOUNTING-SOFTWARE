-- Business modules: parties, products, inventory, invoices/bills, payments, allocations, bank reconciliation.

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER');
CREATE TYPE "ProductKind" AS ENUM ('GOODS', 'SERVICE');
CREATE TYPE "DocType" AS ENUM ('SALES_INVOICE', 'PURCHASE_BILL', 'CREDIT_NOTE', 'DEBIT_NOTE');
CREATE TYPE "DocStatus" AS ENUM ('ACTIVE', 'CANCELLED');
CREATE TYPE "PaymentDirection" AS ENUM ('RECEIVED', 'PAID');
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'BANK', 'UPI', 'CARD', 'CHEQUE', 'OTHER');
CREATE TYPE "StockMoveType" AS ENUM ('OPENING', 'PURCHASE', 'SALE', 'SALE_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

-- AlterTable Company
ALTER TABLE "Company"
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "pan" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "stateCode" TEXT,
  ADD COLUMN "pincode" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "bankDetails" TEXT,
  ADD COLUMN "invoiceTerms" TEXT,
  ADD COLUMN "numberPrefixes" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "gstEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "roundOffInvoices" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable Ledger
ALTER TABLE "Ledger" ADD COLUMN "systemKey" TEXT, ADD COLUMN "description" TEXT;
CREATE UNIQUE INDEX "Ledger_companyId_systemKey_key" ON "Ledger"("companyId", "systemKey");
-- Backfill keys for the ledgers created by the original seed.
UPDATE "Ledger" SET "systemKey" = 'CASH' WHERE "isSystem" AND "name" = 'Cash';
UPDATE "Ledger" SET "systemKey" = 'SALES' WHERE "isSystem" AND "name" = 'Sales';
UPDATE "Ledger" SET "systemKey" = 'PURCHASES' WHERE "isSystem" AND "name" = 'Purchases';

-- AlterTable Voucher (new columns are not part of the immutability guard; they are write-once at insert)
ALTER TABLE "Voucher" ADD COLUMN "reference" TEXT, ADD COLUMN "source" TEXT;

-- CreateTable Party
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "type" "PartyType" NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "contactPerson" TEXT,
    "billingAddress" TEXT,
    "city" TEXT,
    "state" TEXT,
    "stateCode" TEXT,
    "pincode" TEXT,
    "creditDays" INTEGER NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(18,2),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL DEFAULT 'GOODS',
    "category" TEXT,
    "hsn" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'Nos',
    "salePrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "purchasePrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "trackStock" BOOLEAN NOT NULL DEFAULT true,
    "reorderLevel" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "onHandQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "onHandValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "DocType" NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dueDate" DATE,
    "partyId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "reference" TEXT,
    "placeOfSupply" TEXT,
    "placeOfSupplyCode" TEXT,
    "isInterState" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discountTotal" DECIMAL(18,2) NOT NULL,
    "taxableTotal" DECIMAL(18,2) NOT NULL,
    "cgstTotal" DECIMAL(18,2) NOT NULL,
    "sgstTotal" DECIMAL(18,2) NOT NULL,
    "igstTotal" DECIMAL(18,2) NOT NULL,
    "roundOff" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "terms" TEXT,
    "originalDocumentId" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentLine" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT,
    "ledgerId" TEXT,
    "description" TEXT NOT NULL,
    "hsn" TEXT,
    "unit" TEXT,
    "qty" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(18,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "costAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    CONSTRAINT "DocumentLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "mode" "PaymentMode" NOT NULL DEFAULT 'BANK',
    "amount" DECIMAL(18,2) NOT NULL,
    "date" DATE NOT NULL,
    "reference" TEXT,
    "accountId" TEXT NOT NULL,
    "notes" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "paymentId" TEXT,
    "creditDocumentId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "StockMoveType" NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "balanceQty" DECIMAL(18,3) NOT NULL,
    "balanceValue" DECIMAL(18,2) NOT NULL,
    "documentId" TEXT,
    "voucherId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankReconciliation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "voucherLineId" TEXT NOT NULL,
    "bankDate" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Party_ledgerId_key" ON "Party"("ledgerId");
CREATE UNIQUE INDEX "Party_companyId_name_key" ON "Party"("companyId", "name");
CREATE INDEX "Party_companyId_type_idx" ON "Party"("companyId", "type");
CREATE UNIQUE INDEX "Product_companyId_sku_key" ON "Product"("companyId", "sku");
CREATE UNIQUE INDEX "Product_companyId_name_key" ON "Product"("companyId", "name");
CREATE INDEX "Product_companyId_isActive_idx" ON "Product"("companyId", "isActive");
CREATE UNIQUE INDEX "Document_voucherId_key" ON "Document"("voucherId");
CREATE INDEX "Document_companyId_type_date_idx" ON "Document"("companyId", "type", "date");
CREATE INDEX "Document_partyId_idx" ON "Document"("partyId");
CREATE UNIQUE INDEX "DocumentLine_documentId_lineNo_key" ON "DocumentLine"("documentId", "lineNo");
CREATE INDEX "DocumentLine_productId_idx" ON "DocumentLine"("productId");
CREATE UNIQUE INDEX "Payment_voucherId_key" ON "Payment"("voucherId");
CREATE INDEX "Payment_companyId_date_idx" ON "Payment"("companyId", "date");
CREATE INDEX "Payment_partyId_idx" ON "Payment"("partyId");
CREATE INDEX "Allocation_documentId_idx" ON "Allocation"("documentId");
CREATE INDEX "Allocation_paymentId_idx" ON "Allocation"("paymentId");
CREATE INDEX "Allocation_creditDocumentId_idx" ON "Allocation"("creditDocumentId");
CREATE INDEX "StockMovement_companyId_productId_date_idx" ON "StockMovement"("companyId", "productId", "date");
CREATE INDEX "StockMovement_documentId_idx" ON "StockMovement"("documentId");
CREATE UNIQUE INDEX "BankReconciliation_voucherLineId_key" ON "BankReconciliation"("voucherLineId");
CREATE INDEX "BankReconciliation_companyId_ledgerId_idx" ON "BankReconciliation"("companyId", "ledgerId");

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Party" ADD CONSTRAINT "Party_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_originalDocumentId_fkey" FOREIGN KEY ("originalDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_creditDocumentId_fkey" FOREIGN KEY ("creditDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_voucherLineId_fkey" FOREIGN KEY ("voucherLineId") REFERENCES "VoucherLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity rules for the new tables.
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_amount_check" CHECK ("amount" > 0);
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_source_check" CHECK (("paymentId" IS NOT NULL) <> ("creditDocumentId" IS NOT NULL));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "Document" ADD CONSTRAINT "Document_total_check" CHECK ("total" >= 0);
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_qty_check" CHECK ("qty" > 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_gstRate_check" CHECK ("gstRate" >= 0 AND "gstRate" <= 100);
