import { prisma, Tx } from './prisma';
import { AppError } from './errors';
import { SYSTEM_LEDGERS, SystemKey } from './defaults';

type Db = Tx | typeof prisma;

/**
 * Find (or lazily create) a ledger the system posts to automatically.
 * Lazy creation makes upgrades safe even if the seed was not re-run.
 */
export async function systemLedger(db: Db, companyId: string, key: SystemKey): Promise<string> {
  const existing = await db.ledger.findUnique({ where: { companyId_systemKey: { companyId, systemKey: key } }, select: { id: true } });
  if (existing) return existing.id;

  const def = SYSTEM_LEDGERS[key];
  // The ledger may already exist under the same name (created by hand) - adopt it.
  const byName = await db.ledger.findUnique({ where: { companyId_name: { companyId, name: def.name } }, select: { id: true, systemKey: true } });
  if (byName && !byName.systemKey) {
    await db.ledger.update({ where: { id: byName.id }, data: { systemKey: key, isSystem: true } });
    return byName.id;
  }
  const group = await db.accountGroup.findUnique({ where: { companyId_name: { companyId, name: def.group } }, select: { id: true } });
  if (!group) throw new AppError(500, 'MISSING_GROUP', `Account group "${def.group}" is missing. Run "npm run seed".`);
  const name = byName ? `${def.name} (system)` : def.name;
  const created = await db.ledger.create({ data: { companyId, groupId: group.id, name, systemKey: key, isSystem: true }, select: { id: true } });
  return created.id;
}

export async function systemLedgers<K extends SystemKey>(db: Db, companyId: string, keys: K[]): Promise<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const k of keys) out[k] = await systemLedger(db, companyId, k);
  return out;
}

/** Ids of all cash and bank ledgers (anything under the Cash-in-Hand or Bank Accounts groups). */
export async function cashBankLedgerIds(db: Db, companyId: string): Promise<string[]> {
  const groups = await db.accountGroup.findMany({ where: { companyId }, select: { id: true, name: true, parentId: true } });
  const roots = new Set(groups.filter((g) => g.name === 'Cash-in-Hand' || g.name === 'Bank Accounts').map((g) => g.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) if (g.parentId && roots.has(g.parentId) && !roots.has(g.id)) { roots.add(g.id); grew = true; }
  }
  const ledgers = await db.ledger.findMany({ where: { companyId, groupId: { in: [...roots] } }, select: { id: true } });
  return ledgers.map((l) => l.id);
}

export async function assertCashBank(db: Db, companyId: string, ledgerId: string) {
  const ids = await cashBankLedgerIds(db, companyId);
  if (!ids.includes(ledgerId)) throw new AppError(422, 'INVALID_ACCOUNT', 'Select a cash or bank account');
}
