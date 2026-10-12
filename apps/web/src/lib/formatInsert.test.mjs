import assert from 'node:assert/strict';
import test from 'node:test';
import { formatInsert } from './formatInsert.ts';

const join = (r) => r.before + r.inner + r.after;

test('wraps the selection, keeping {{ variables }}', () => {
  assert.equal(join(formatInsert('html', 'bold', 'Hi {{ trigger.name }}', 'text')), '<b>Hi {{ trigger.name }}</b>');
  assert.equal(join(formatInsert('markdown', 'bold', 'x', 'text')), '**x**');
  assert.equal(join(formatInsert('slack', 'italic', 'x', 'text')), '_x_');
  assert.equal(join(formatInsert('telegramMarkdown', 'bold', 'x', 'text')), '*x*');
});

test('uses the placeholder when nothing is selected, and selects it', () => {
  const r = formatInsert('telegramHtml', 'italic', '', 'your text');
  assert.equal(join(r), '<i>your text</i>');
  assert.equal(r.inner, 'your text');
});

test('links: a selected address becomes the target, other text the label', () => {
  assert.equal(join(formatInsert('html', 'link', 'https://weav.app', 'text')), '<a href="https://weav.app">https://weav.app</a>');
  assert.equal(join(formatInsert('html', 'link', 'Open', 'text')), '<a href="https://">Open</a>');
  assert.equal(join(formatInsert('slack', 'link', 'Open', 'text')), '<https://|Open>');
  assert.equal(join(formatInsert('markdown', 'link', 'Open', 'text')), '[Open](https://)');
});

test('list makes one item per non-empty line; line break keeps the selection', () => {
  assert.equal(join(formatInsert('html', 'list', 'a\n\nb', 'item')), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.deepEqual(formatInsert('html', 'lineBreak', 'ab', 'x'), { before: 'ab<br>\n', inner: '', after: '' });
});
