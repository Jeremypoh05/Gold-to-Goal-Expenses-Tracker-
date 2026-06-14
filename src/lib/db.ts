// ADDED (Phase 8): the single Prisma client for the whole app.
// Prisma 7 requires a driver adapter — we use Neon's, pointed at the POOLED
// DATABASE_URL (runtime). Next.js already loads .env.local into process.env.
// The globalThis cache stops dev hot-reload from opening a new pool every edit.
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
