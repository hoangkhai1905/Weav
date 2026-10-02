import { defineConfig } from 'prisma/config';
// Supply a direct, non-pooled URL for migration deployment; never print it.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.NOTIFICATION_MIGRATION_URL },
});
