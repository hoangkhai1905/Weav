export const codePointLength = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function truncateGraphemes(text: string, maxCodePoints: number): { text: string; truncated: boolean } {
  if (codePointLength(text) <= maxCodePoints) return { text, truncated: false };
  let out = '';
  let count = 0;
  for (const { segment } of segmenter.segment(text)) {
    const size = codePointLength(segment);
    if (count + size > maxCodePoints) break;
    out += segment;
    count += size;
  }
  return { text: out, truncated: true };
}
