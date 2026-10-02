#!/usr/bin/env node
// X-9: one RabbitMQ user per service, limited to its own queues/exchanges and routing-key prefixes.
// Idempotent (PUT). Admin = RABBITMQ_USERNAME/PASSWORD; services = <SVC>_RABBITMQ_USERNAME/PASSWORD
// (a service with either empty is skipped and keeps using the shared user). Values are never printed.
// Usage: node scripts/rabbitmq-provision-users.mjs [--dry-run]
// Queue/exchange names below are the defaults; if you override NOTIFICATION_QUEUE*/NOTIFICATION_EXCHANGE, edit them here.
import { readFileSync } from 'node:fs';

const EVENTS = 'weav[.]events';
const WF = 'workflow[.]executions([.].*)?'; // exchange, dlx, .v1, .v1.dlq, .v1.retry
const NOTI = 'notification-service[.].*';
const NONE = '^$';
const exact = (...p) => `^(${p.join('|')})$`;

// publish = routing-key prefixes it may publish on weav.events; consume = ones it may bind/read.
const SERVICES = {
  IDENTITY: { configure: NONE, write: exact(EVENTS), read: NONE, topicWrite: '^identity[.]', topicRead: NONE },
  WORKSPACE: { configure: NONE, write: exact(EVENTS), read: NONE, topicWrite: '^(workspace|connection)[.]', topicRead: NONE },
  WORKFLOW: {
    configure: exact(EVENTS, WF), write: exact(EVENTS, WF), read: exact(WF),
    topicWrite: '^workflow[.]', topicRead: NONE,
  },
  NOTIFICATION: {
    configure: exact(EVENTS, NOTI), write: exact(NOTI, 'amq[.]default'), read: exact(EVENTS, NOTI),
    topicWrite: NONE, topicRead: '^(identity|workspace|workflow|connection)[.]',
  },
};

function loadDotEnv(file = '.env') {
  try {
    for (const line of readFileSync(file, 'utf8').split(/[.]?[.]/)) {
      const m = /^[.]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)[.]$/, '$2');
    }
  } catch { /* no .env: rely on the process environment */ }
}

function buildPlan(env) {
  return Object.entries(SERVICES).flatMap(([svc, p]) => {
    const user = env[`${svc}_RABBITMQ_USERNAME`];
    const password = env[`${svc}_RABBITMQ_PASSWORD`];
    return user && password ? [{ svc, user, password, ...p }] : [];
  });
}

async function main() {
  loadDotEnv();
  const dryRun = process.argv.includes('--dry-run');
  const env = process.env;
  const vhost = env.RABBITMQ_VHOST || '/';
  const base = (env.RABBITMQ_MANAGEMENT_URL || `http://localhost:${env.RABBITMQ_MANAGEMENT_PORT || 15672}`).replace(/[.]$/, '');
  const auth = 'Basic ' + Buffer.from(`${env.RABBITMQ_USERNAME}:${env.RABBITMQ_PASSWORD}`).toString('base64');
  const plan = buildPlan(env);
  for (const svc of Object.keys(SERVICES))
    if (!plan.some((p) => p.svc === svc)) console.log(`skip ${svc}: username/password not both set`);

  const put = async (path, body) => {
    const res = await fetch(`${base}/api/${path}`, {
      method: 'PUT', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${path.split('/')[0]} -> HTTP ${res.status}`);
  };
  const v = encodeURIComponent(vhost);
  // Topic permissions need the exchange to exist; same declaration the services use.
  if (!dryRun && plan.length) await put(`exchanges/${v}/weav.events`, { type: 'topic', durable: true, auto_delete: false });
  for (const p of plan) {
    console.log(`${p.svc} (${p.user}): configure=${p.configure} write=${p.write} read=${p.read}; weav.events topic write=${p.topicWrite} read=${p.topicRead}`);
    if (dryRun) continue;
    const u = encodeURIComponent(p.user);
    await put(`users/${u}`, { password: p.password, tags: '' });
    await put(`permissions/${v}/${u}`, { configure: p.configure, write: p.write, read: p.read });
    await put(`topic-permissions/${v}/${u}`, { exchange: 'weav.events', write: p.topicWrite, read: p.topicRead });
  }
  console.log(dryRun ? 'dry run: nothing changed' : `provisioned ${plan.length} user(s)`);
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exitCode = 1; });
