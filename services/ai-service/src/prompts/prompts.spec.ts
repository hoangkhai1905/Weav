import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSISTANT_SYSTEM_PROMPT } from '../application/assistant/system-prompt';
import { GENERATE_SYSTEM } from './prompts';

describe('GENERATE_SYSTEM', () => {
  it('keeps the json reply contract', () => {
    expect(GENERATE_SYSTEM.toLowerCase()).toContain('json');
    expect(GENERATE_SYSTEM).toContain('"status":"ready"');
  });

  it('lists google.docs outputs', () => {
    expect(GENERATE_SYSTEM).toContain(
      'google.docs create -> {documentId, title, url}',
    );
    expect(GENERATE_SYSTEM).toContain(
      'google.docs append -> {documentId, url, appendedCharacters}',
    );
  });

  it('lists every node operation exactly as the node schemas allow', () => {
    const dir = join(__dirname, '../../../../packages/workflow-schema/nodes');
    const listed = readdirSync(dir).flatMap((file) => {
      const schema = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
        properties?: { operation?: { enum?: string[] } };
      };
      const values = schema.properties?.operation?.enum;
      return values
        ? [`${file.slice(0, -'.json'.length)} ${values.join('|')}`]
        : [];
    });
    expect(listed.length).toBeGreaterThan(5);
    for (const entry of listed) expect(GENERATE_SYSTEM).toContain(entry);
  });

  it.each([
    'google.sheets lookup -> {range, rows:[{row, values}], count, truncated}',
    'google.calendar list -> {events:',
    'email.send -> {messageId, threadId, status}',
    '"combinator":"and"|"or"',
    '{{trigger.input.attachments}}',
    'replyToMessageId',
    'attachments[0]',
    'same language as the request',
    'node ids stay ASCII snake_case',
    '{{now}}',
    '{{run.id}}',
    '{{workflow.name}}',
    '"name":string,"config":object',
    'readable step title',
  ])('documents %s', (fragment) => {
    expect(GENERATE_SYSTEM).toContain(fragment);
  });
});

describe('ASSISTANT_SYSTEM_PROMPT', () => {
  it.each([
    'attachments',
    'look up rows',
    'upcoming events',
    'AND/OR',
    'MarkdownV2',
  ])('explains %s', (fragment) => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(fragment);
  });
});
