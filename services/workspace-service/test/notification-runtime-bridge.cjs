/* Test-only Nest/Fastify consumer bridge for the Workspace-to-Notification runtime test. */
const { NestFactory } = require('@nestjs/core');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { createHmac } = require('node:crypto');

// Minimal HS256 signer (notification-service no longer ships jsonwebtoken).
const b64url = (value) => Buffer.from(value).toString('base64url');
const signHs256 = (claims, secret) => {
  const unsigned = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
};
const { Pool } = require('pg');
const { mkdtempSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const env = process.env;
const required = [
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USERNAME', 'DB_PASSWORD',
  'RABBITMQ_HOST', 'RABBITMQ_PORT', 'JWT_ACCESS_SECRET',
  'TASK4_OWNER_ID', 'TASK4_MEMBER_ID',
];
for (const key of required) {
  if (!env[key]) throw new Error(`Missing test setting ${key}`);
}

let app;
let isolatedConfigDirectory;
let stage = 'before-database-migrations';

async function main() {
  const pool = new Pool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    ssl: false,
    max: 1,
  });
  try {
    const migrationsRoot = join(__dirname, '../../notification-service/prisma/migrations');
    const directories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const directory of directories) {
      await pool.query(readFileSync(join(migrationsRoot, directory, 'migration.sql'), 'utf8'));
    }
  } finally {
    await pool.end();
  }

  stage = 'after-database-migrations';
  isolatedConfigDirectory = mkdtempSync(join(tmpdir(), 'weav-task4-notification-no-env-'));
  process.chdir(isolatedConfigDirectory);
  stage = 'loading-compiled-notification-module';
  const { AppModule } = require('../../notification-service/dist/app.module');
  const { RabbitConsumer } = require('../../notification-service/dist/infrastructure/rabbit.consumer');
  stage = 'creating-notification-application';
  app = await NestFactory.create(AppModule, new FastifyAdapter(), {
    logger: false,
    abortOnError: false,
  });
  await app.listen(0, '127.0.0.1');
  stage = 'waiting-for-notification-rabbit-consumer';
  const consumer = app.get(RabbitConsumer);
  const deadline = Date.now() + 20000;
  while (!consumer.isReady && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!consumer.isReady) throw new Error('Test-owned Notification consumer did not become ready');

  stage = 'creating-test-access-tokens';
  const settings = require('../../notification-service/dist/config/settings').loadSettings(env);
  const tokenFor = (subject) => {
    const now = Math.floor(Date.now() / 1000);
    return signHs256({
      sub: subject,
      sid: require('node:crypto').randomUUID(),
      jti: require('node:crypto').randomUUID(),
      token_use: 'access',
      user_status: 'ACTIVE',
      system_role: 'USER',
      iat: now,
      nbf: now,
      exp: now + 300,
      iss: settings.JWT_ISSUER,
      aud: settings.JWT_AUDIENCE,
    }, settings.JWT_ACCESS_SECRET);
  };
  process.stdout.write(`TASK4_READY:${JSON.stringify({
    url: await app.getUrl(),
    ownerToken: tokenFor(env.TASK4_OWNER_ID),
    memberToken: tokenFor(env.TASK4_MEMBER_ID),
  })}\n`);

  process.stdin.setEncoding('utf8');
  let pending = '';
  process.stdin.on('data', async (chunk) => {
    pending += chunk;
    if (!pending.includes('\n')) return;
    if (pending.trim() === 'STOP') {
      await shutdown();
      process.exit(0);
    }
  });
  process.stdin.resume();
}

async function shutdown() {
  if (app) await app.close();
  if (isolatedConfigDirectory) rmSync(isolatedConfigDirectory, { recursive: true, force: true });
}

main().catch(async (error) => {
  const message = String(error?.message ?? '')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-database-url]')
    .replace(/(password|token|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]');
  process.stderr.write(`Task4 Notification test bridge failed at ${stage} `
    + `(${error?.constructor?.name ?? 'Error'}): ${message}\n`);
  await shutdown().catch(() => {});
  process.exit(1);
});
