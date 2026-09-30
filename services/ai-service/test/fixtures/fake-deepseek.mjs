// Local fixture: fake DeepSeek chat-completions server for AI Service V1 acceptance.
// Listens on 127.0.0.1:18080. Answers POST /chat/completions with an OpenAI-style
// envelope. messages[0].content (system prompt) selects the operation; markers in
// messages[1].content (user JSON) select scripted scenarios. Anything else → 404.
import { createServer } from 'node:http';

const PORT = 18080;

const SCENARIOS = {
  NEEDS_INPUT: 'scenario:needs-input',
  UNSUPPORTED: 'scenario:unsupported',
  INVALID: 'scenario:invalid',
  SLOW: 'scenario:slow',
  AUTH: 'scenario:auth',
};

const READY_INTENT = {
  status: 'ready',
  intent: {
    name: 'Ping then summarize',
    nodes: [
      { id: 'start', type: 'trigger.manual', config: {} },
      { id: 'ping', type: 'http.request', config: { method: 'GET', url: 'https://example.com' } },
      { id: 'sum', type: 'ai.summarize', config: { inputText: '{{nodes.ping.output.data}}', maxLength: 200 } },
    ],
    edges: [
      { from: 'start', to: 'ping' },
      { from: 'ping', to: 'sum' },
    ],
  },
};

function sampleForSchema(schema) {
  if (!schema || typeof schema !== 'object') return {};
  if (schema.type === 'object') {
    const out = {};
    for (const [key, sub] of Object.entries(schema.properties ?? {})) out[key] = sampleForSchema(sub);
    return out;
  }
  if (schema.type === 'string') return 'sample';
  if (schema.type === 'number' || schema.type === 'integer') return 1;
  if (schema.type === 'boolean') return true;
  if (schema.type === 'array') return [];
  return null;
}

function envelope(content) {
  return JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
  });
}

function operationOf(system) {
  const text = String(system ?? '').toLowerCase();
  if (text.includes('extract facts')) return 'extract';
  if (text.includes('classify')) return 'classify';
  if (text.includes('summarize')) return 'summarize';
  if (text.includes('design automation workflows')) return 'generate';
  return 'unknown';
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => resolve(raw));
    request.on('error', reject);
  });
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/chat/completions') {
    response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid JSON' }));
    return;
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const userContent = String(messages[1]?.content ?? '');
  const operation = operationOf(messages[0]?.content);

  if (userContent.includes(SCENARIOS.AUTH)) {
    response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  if (userContent.includes(SCENARIOS.SLOW)) {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(envelope(JSON.stringify({ summary: 'slow' })));
    }, 70_000);
    return;
  }
  if (userContent.includes(SCENARIOS.NEEDS_INPUT)) {
    const body = JSON.stringify({ status: 'needs_input', questions: [{ code: 'URL', field: 'ping.config.url' }] });
    response.writeHead(200, { 'content-type': 'application/json' }).end(envelope(body));
    return;
  }
  if (userContent.includes(SCENARIOS.UNSUPPORTED)) {
    const body = JSON.stringify({ status: 'unsupported', reasons: [{ code: 'CAPABILITY_UNAVAILABLE' }] });
    response.writeHead(200, { 'content-type': 'application/json' }).end(envelope(body));
    return;
  }
  if (userContent.includes(SCENARIOS.INVALID)) {
    response.writeHead(200, { 'content-type': 'application/json' }).end(envelope('not json'));
    return;
  }

  let user;
  try {
    user = JSON.parse(userContent);
  } catch {
    user = {};
  }
  if (operation === 'generate') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(envelope(JSON.stringify(READY_INTENT)));
  } else if (operation === 'extract') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(envelope(JSON.stringify(sampleForSchema(user.schema))));
  } else if (operation === 'classify') {
    const categories = Array.isArray(user.categories) && user.categories.length > 0 ? user.categories : ['general'];
    response.writeHead(200, { 'content-type': 'application/json' }).end(envelope(JSON.stringify({ category: categories[0], confidence: 0.9 })));
  } else if (operation === 'summarize') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(envelope(JSON.stringify({ summary: 'Tóm tắt 👍' })));
  } else {
    response.writeHead(422, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unknown operation' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`fake-deepseek listening on 0.0.0.0:${PORT}`);
});
