// CHANGED (Phase 8): load .env.local (where our real secrets live — Next.js + Clerk
// already use it) instead of the default .env, and point the CLI/migrations at the
// DIRECT (unpooled) connection. Runtime queries use the pooled DATABASE_URL via the
// Neon adapter in src/lib/db.ts.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Plain process.env (not the strict env() helper) so `prisma generate` works
    // before the Neon URLs are filled in; `migrate` will error clearly if unset.
    url: process.env.DIRECT_URL,
  },
});
