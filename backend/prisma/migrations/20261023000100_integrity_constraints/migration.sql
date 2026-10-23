-- Data-integrity rules enforced by the database itself, independent of application code.

ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_dates_check" CHECK ("endDate" > "startDate");
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_openingBalance_check" CHECK ("openingBalance" >= 0);
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_totalAmount_check" CHECK ("totalAmount" > 0);
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_amount_check" CHECK ("amount" > 0);

-- 1. Every voucher must balance (total debits = total credits) at commit time.
CREATE OR REPLACE FUNCTION enforce_voucher_balanced() RETURNS trigger AS $$
DECLARE
  d NUMERIC;
  c NUMERIC;
BEGIN
  SELECT COALESCE(SUM("amount") FILTER (WHERE "side" = 'DR'), 0),
         COALESCE(SUM("amount") FILTER (WHERE "side" = 'CR'), 0)
    INTO d, c
    FROM "VoucherLine" WHERE "voucherId" = NEW."voucherId";
  IF d <> c THEN
    RAISE EXCEPTION 'Voucher % is unbalanced: debit %, credit %', NEW."voucherId", d, c
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "VoucherLine_balanced_trg"
  AFTER INSERT ON "VoucherLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_voucher_balanced();

-- 2. Posted vouchers are immutable: lines can never be changed or deleted.
CREATE OR REPLACE FUNCTION forbid_voucher_line_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Voucher lines are immutable. Post a reversing voucher instead.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "VoucherLine_immutable_trg"
  BEFORE UPDATE OR DELETE ON "VoucherLine"
  FOR EACH ROW EXECUTE FUNCTION forbid_voucher_line_change();

-- 3. Vouchers cannot be deleted; the only permitted change is POSTED -> REVERSED.
CREATE OR REPLACE FUNCTION guard_voucher_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Vouchers cannot be deleted. Post a reversing voucher instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."companyId" <> OLD."companyId"
     OR NEW."financialYearId" <> OLD."financialYearId"
     OR NEW."type" <> OLD."type"
     OR NEW."number" <> OLD."number"
     OR NEW."date" <> OLD."date"
     OR NEW."totalAmount" <> OLD."totalAmount"
     OR NEW."narration" IS DISTINCT FROM OLD."narration"
     OR NEW."reversesId" IS DISTINCT FROM OLD."reversesId"
     OR NEW."createdById" <> OLD."createdById"
     OR (NEW."status" <> OLD."status" AND NOT (OLD."status" = 'POSTED' AND NEW."status" = 'REVERSED')) THEN
    RAISE EXCEPTION 'Posted vouchers are immutable. Post a reversing voucher instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Voucher_guard_trg"
  BEFORE UPDATE OR DELETE ON "Voucher"
  FOR EACH ROW EXECUTE FUNCTION guard_voucher_change();

-- 4. Audit log is append-only.
CREATE OR REPLACE FUNCTION forbid_audit_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit log is append-only.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only_trg"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();
