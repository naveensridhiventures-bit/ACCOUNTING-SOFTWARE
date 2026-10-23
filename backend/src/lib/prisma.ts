import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Engine-free Prisma client (engineType = "client") using the node-postgres driver adapter.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
