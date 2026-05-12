const NOISE_WORDS = new Set([
  'official', 'video', 'audio', 'hd', '4k', 'lyrics', 'lyric',
  'feat', 'ft', 'featuring', 'remastered', 'remaster', 'explicit',
  'clean', 'version', 'edit', 'remix', 'extended', 'radio',
]);

export const normalizeTitle = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NOISE_WORDS.has(w))
    .join(' ');

const bigrams = (s: string): Set<string> => {
  const result = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    result.add(s.slice(i, i + 2));
  }
  return result;
};

export const diceCoefficient = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
};
