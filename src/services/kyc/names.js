/**
 * Name comparison for ID vs bank vs profile. Indian names vary a lot in
 * spelling, initials and order, so this scores token overlap rather than
 * exact equality: "R. Kumar" vs "Ravi Kumar" is a partial match, not a failure.
 */
const HONORIFICS = new Set(['MR', 'MRS', 'MS', 'MISS', 'SHRI', 'SMT', 'KUM', 'DR', 'SRI', 'MASTER']);

export const nameTokens = (name) =>
  String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z\s.]/g, ' ')
    .replace(/\./g, ' ')
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t));

/** 0..100. Full words must match; a single letter matches a word starting with it. */
export const nameScore = (a, b) => {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (!x.length || !y.length) return 0;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const pool = [...long];
  let hits = 0;
  for (const t of short) {
    let i = pool.indexOf(t);
    if (i < 0 && t.length === 1) i = pool.findIndex((p) => p.startsWith(t));
    if (i < 0 && t.length > 1) i = pool.findIndex((p) => p.length === 1 && t.startsWith(p));
    if (i >= 0) {
      hits += pool[i] === t ? 1 : 0.6;
      pool.splice(i, 1);
    }
  }
  // Coverage of the shorter name, lightly penalised for extra words in the longer one.
  const coverage = hits / short.length;
  const extra = (long.length - short.length) * 0.05;
  return Math.max(0, Math.round((coverage - extra) * 100));
};

/** "Ravi Kumar" -> "RAVI KUMAR" for display of verified names. */
export const displayName = (name) => nameTokens(name).join(' ');
