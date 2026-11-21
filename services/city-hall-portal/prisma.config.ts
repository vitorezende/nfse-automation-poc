import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Optional so `prisma generate` (build time) works without a database.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
