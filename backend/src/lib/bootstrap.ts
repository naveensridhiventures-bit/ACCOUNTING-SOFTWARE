import { prisma } from './prisma';
import { DEFAULT_GROUPS, SYSTEM_LEDGERS, SystemKey } from './defaults';

/** Create any missing default account groups; returns name -> id. */
export async function ensureGroups(companyId: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [name, parent, nature] of DEFAULT_GROUPS) {
    const g = await prisma.accountGroup.upsert({
      where: { companyId_name: { companyId, name } },
      update: {},
      create: { companyId, name, nature, isSystem: true, parentId: parent ? ids[parent] ?? null : null },
    });
    ids[name] = g.id;
  }
  return ids;
}

/** Create any missing system ledgers (adopting same-named ledgers from older versions). */
export async function ensureSystemLedgers(companyId: string, groupIds: Record<string, string>) {
  for (const [key, def] of Object.entries(SYSTEM_LEDGERS) as [SystemKey, { name: string; group: string }][]) {
    if (await prisma.ledger.findUnique({ where: { companyId_systemKey: { companyId, systemKey: key } } })) continue;
    const byName = await prisma.ledger.findUnique({ where: { companyId_name: { companyId, name: def.name } } });
    if (byName) await prisma.ledger.update({ where: { id: byName.id }, data: { systemKey: key, isSystem: true } });
    else await prisma.ledger.create({ data: { companyId, name: def.name, groupId: groupIds[def.group]!, systemKey: key, isSystem: true } });
  }
}
