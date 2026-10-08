const { test } = require('node:test');
const assert = require('node:assert/strict');
const { palette } = require('./palette.ts');

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

for (const mode of ['light', 'dark']) {
  const p = palette[mode];
  test(`${mode}: status text >= 4.5 on its own background`, () => {
    for (const [tone, c] of Object.entries(p.tones)) {
      assert.ok(ratio(c.fg, c.bg) >= 4.5, `${mode} ${tone} on tone bg: ${ratio(c.fg, c.bg).toFixed(2)}`);
      assert.ok(ratio(c.fg, p.card) >= 4.5, `${mode} ${tone} on card: ${ratio(c.fg, p.card).toFixed(2)}`);
    }
  });
  test(`${mode}: body text, muted text, primary button >= 4.5`, () => {
    for (const bg of [p.bg, p.card, p.cardSecondary]) {
      assert.ok(ratio(p.text, bg) >= 4.5);
      assert.ok(ratio(p.textMuted, bg) >= 4.5, `textMuted on ${bg}`);
      assert.ok(ratio(p.textSubtle, bg) >= 4.5, `textSubtle on ${bg}`);
    }
    assert.ok(ratio(p.onPrimary, p.primary) >= 4.5, `onPrimary ${ratio(p.onPrimary, p.primary).toFixed(2)}`);
    assert.ok(ratio(p.primary, p.card) >= 4.5, 'primary link text on card');
  });
}
