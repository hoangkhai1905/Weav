/* Real RabbitMQ (test/compose.yml, port 15689): quorum queue delivery limit, DLQ keeps the original body, old queue drained and unbound. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { connect } = require('amqplib');
const { loadSettings } = require('../dist/config/settings');
const { RabbitConsumer } = require('../dist/infrastructure/rabbit.consumer');

const suffix = randomUUID().slice(0, 8);
const settings = loadSettings({
  DB_HOST: '127.0.0.1',
  DB_NAME: 'unused',
  DB_USERNAME: 'unused',
  DB_PASSWORD: 'unused',
  JWT_ACCESS_SECRET: 'test-only-key-not-for-production-123456',
  RABBITMQ_HOST: '127.0.0.1',
  RABBITMQ_PORT: '15689',
  NOTIFICATION_EXCHANGE: `weav.poison.${suffix}.events`,
  NOTIFICATION_QUEUE: `weav.poison.${suffix}.queue`,
  NOTIFICATION_DLQ: `weav.poison.${suffix}.dlq`,
  NOTIFICATION_DELIVERY_LIMIT: '3',
});
const until = async (check) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail('timeout');
};

test('poison events end in the DLQ with their original body; healthy events still flow', async () => {
  const connection = await connect('amqp://guest:guest@127.0.0.1:15689');
  const channel = await connection.createConfirmChannel();
  await channel.assertExchange(settings.NOTIFICATION_EXCHANGE, 'topic', {
    durable: true,
  });
  // A pre-existing classic queue (old topology) still bound and holding a message.
  await channel.assertQueue(settings.NOTIFICATION_QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': settings.NOTIFICATION_DLQ,
    },
  });
  await channel.bindQueue(
    settings.NOTIFICATION_QUEUE,
    settings.NOTIFICATION_EXCHANGE,
    'workflow.completed',
  );
  const legacyBody = { eventId: randomUUID(), eventType: 'workflow.completed' };
  channel.publish(
    settings.NOTIFICATION_EXCHANGE,
    'workflow.completed',
    Buffer.from(JSON.stringify(legacyBody)),
    { persistent: true },
  );
  await channel.waitForConfirms();

  const handled = [];
  let poisonAttempts = 0;
  const consumer = new RabbitConsumer(
    {
      consume: async (value) => {
        if (value.poison) {
          poisonAttempts++;
          throw new Error('database unavailable');
        }
        handled.push(value.eventId);
      },
    },
    settings,
  );
  consumer.sleep = () => Promise.resolve();
  try {
    consumer.onModuleInit();
    await until(() => consumer.isReady);
    await until(() => handled.includes(legacyBody.eventId));

    const publish = (body) =>
      channel.publish(
        settings.NOTIFICATION_EXCHANGE,
        'workflow.completed',
        Buffer.from(JSON.stringify(body)),
        { persistent: true },
      );
    const poison = {
      eventId: randomUUID(),
      eventType: 'workflow.completed',
      poison: true,
    };
    const healthy = { eventId: randomUUID(), eventType: 'workflow.completed' };
    publish(poison);
    publish(healthy);
    await channel.waitForConfirms();
    // Not blocked: the healthy event after the poison one is processed.
    await until(() => handled.includes(healthy.eventId));

    let dead;
    await until(
      async () =>
        (dead = await channel.get(settings.NOTIFICATION_DLQ, { noAck: true })),
    );
    assert.deepEqual(JSON.parse(dead.content.toString()), poison);
    assert(dead.properties.headers['x-death']);
    // x-delivery-limit counts redeliveries: first delivery + 3.
    assert.equal(poisonAttempts, 4);

    // New publishes no longer land in the old queue (unbound) and the connection was never torn down.
    assert.equal(
      (await channel.checkQueue(settings.NOTIFICATION_QUEUE)).messageCount,
      0,
    );
    const q = await channel.checkQueue(`${settings.NOTIFICATION_QUEUE}.v2`);
    assert.equal(q.messageCount, 0);
    assert.equal(consumer.isReady, true);
  } finally {
    await consumer.onModuleDestroy();
    for (const q of [
      settings.NOTIFICATION_QUEUE,
      `${settings.NOTIFICATION_QUEUE}.v2`,
      settings.NOTIFICATION_DLQ,
    ])
      await channel.deleteQueue(q).catch(() => undefined);
    await channel
      .deleteExchange(settings.NOTIFICATION_EXCHANGE)
      .catch(() => undefined);
    await connection.close();
  }
});
