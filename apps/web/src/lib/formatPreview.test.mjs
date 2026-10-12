import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPreview } from './formatPreview.ts';
import { formatInsert } from './formatInsert.ts';

const join = (r) => r.before + r.inner + r.after;

test('email HTML keeps whitelisted tags and turns everything else into text', () => {
  assert.deepEqual(formatPreview('html', 'Hi <b>{{ trigger.name }}</b><br>Bye'), [
    'Hi ', { tag: 'b', href: undefined, children: ['{{ trigger.name }}'] }, { tag: 'br', children: [] }, 'Bye',
  ]);
  // <script> is not a preview tag: it stays visible text and never becomes an element.
  assert.deepEqual(formatPreview('html', '<script>x</script>&amp;'), ['<script>x</script>&']);
});

test('links keep only web addresses or variables as targets', () => {
  const [ok] = formatPreview('html', '<a href="https://weav.app">W</a>');
  assert.equal(ok.href, 'https://weav.app');
  const [bad] = formatPreview('html', '<a href="javascript:alert(1)">W</a>');
  assert.equal(bad.href, undefined);
  const [md] = formatPreview('markdown', '[W]({{ nodes.a.output.url }})');
  assert.equal(md.href, '{{ nodes.a.output.url }}');
});

test('Markdown flavours: bold/italic per receiver, variables are never markup', () => {
  assert.deepEqual(formatPreview('markdown', '**a** *b*'), [{ tag: 'b', children: ['a'] }, ' ', { tag: 'i', children: ['b'] }]);
  assert.deepEqual(formatPreview('slack', '*a* _b_'), [{ tag: 'b', children: ['a'] }, ' ', { tag: 'i', children: ['b'] }]);
  assert.deepEqual(formatPreview('teams', '**a** _b_'), [{ tag: 'b', children: ['a'] }, ' ', { tag: 'i', children: ['b'] }]);
  assert.deepEqual(formatPreview('teams', '{{ nodes.send_mail.output.message_id }}'), ['{{ nodes.send_mail.output.message_id }}']);
});

test('Teams and Discord turn "- " lines into a list; line breaks stay', () => {
  assert.deepEqual(formatPreview('teams', 'Todo\n- a\n- b\nend'), [
    'Todo',
    { tag: 'ul', children: [{ tag: 'li', children: ['a'] }, { tag: 'li', children: ['b'] }] },
    'end',
  ]);
  assert.deepEqual(formatPreview('slack', 'a\nb'), ['a', { tag: 'br', children: [] }, 'b']);
});

test('Teams toolbar writes Adaptive Card Markdown', () => {
  assert.equal(join(formatInsert('teams', 'bold', 'x', 't')), '**x**');
  assert.equal(join(formatInsert('teams', 'italic', 'x', 't')), '_x_');
  assert.equal(join(formatInsert('teams', 'link', 'Open', 't')), '[Open](https://)');
  assert.equal(join(formatInsert('teams', 'list', 'a\nb', 't')), '\n- a\n- b\n');
});
