/**
 * Controlled, idempotent seed. Safe to re-run (and meant to be re-run after upgrades):
 * it only creates what is missing and refreshes the system roles' permission lists.
 * SEED_ADMIN_PASSWORD is only required when the admin user does not exist yet.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { STARTER_LEDGERS, SYSTEM_ROLES } from '../src/lib/defaults';
import { ensureGroups, ensureSystemLedgers } from '../src/lib/bootstrap';

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? '').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';

  let company = await prisma.company.findFirst();
  const isNew = !company;
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: process.env.SEED_COMPANY_NAME ?? 'My Company',
        stateCode: process.env.SEED_COMPANY_STATE_CODE || null,
        numberPrefixes: { SALES: 'INV', PURCHASE: 'BILL', CREDIT_NOTE: 'CN', DEBIT_NOTE: 'DN', RECEIPT: 'RCT', PAYMENT: 'PAY' },
      },
    });
  }

  // Financial year containing today
  const startMonth = Number(process.env.SEED_FY_START_MONTH ?? 4);
  const now = new Date();
  const startYear = now.getUTCMonth() + 1 >= startMonth ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const start = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(startYear + 1, startMonth - 1, 0));
  const fyName = startMonth === 1 ? String(startYear) : `${startYear}-${String(startYear + 1).slice(2)}`;
  const covering = await prisma.financialYear.findFirst({ where: { companyId: company.id, startDate: { lte: now }, endDate: { gte: now } } });
  if (!covering) {
    await prisma.financialYear.upsert({
      where: { companyId_name: { companyId: company.id, name: fyName } },
      update: {},
      create: { companyId: company.id, name: fyName, startDate: start, endDate: end },
    });
  }

  const roleIds: Record<string, string> = {};
  for (const [name, permissions] of Object.entries(SYSTEM_ROLES)) {
    const r = await prisma.role.upsert({
      where: { companyId_name: { companyId: company.id, name } },
      update: { permissions, isSystem: true },
      create: { companyId: company.id, name, permissions, isSystem: true },
    });
    roleIds[name] = r.id;
  }

  const groupIds = await ensureGroups(company.id);
  await ensureSystemLedgers(company.id, groupIds);
  // Starter chart of accounts only for a brand-new company, so deleted ledgers never come back.
  if (isNew) {
    for (const l of STARTER_LEDGERS) {
      await prisma.ledger.upsert({
        where: { companyId_name: { companyId: company.id, name: l.name } },
        update: {},
        create: { companyId: company.id, name: l.name, groupId: groupIds[l.group]! },
      });
    }
  }

  if (email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      if (password.length < 10) throw new Error('Set SEED_ADMIN_PASSWORD (min 10 chars) to create the admin user.');
      await prisma.user.create({
        data: { companyId: company.id, roleId: roleIds.Admin!, email, name: 'Administrator', passwordHash: await bcrypt.hash(password, 12) },
      });
      console.log(`Created admin user ${email}`);
    } else {
      console.log(`Admin user ${email} already exists; password unchanged`);
    }
  } else if ((await prisma.user.count()) === 0) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 10 chars) to run the seed.');
  }
  console.log(`Seed complete. Company: ${company.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
