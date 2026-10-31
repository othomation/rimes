// ── Marqueurs des paroles : miroir de analysis.py (_spoken, _row_type, _REPEAT), le serveur reste la référence ──
// Module pur, sans DOM : tools/parity.mjs le compare à l'API.

export const REPEAT_RE = /^(?:[x×][0-9]+|[0-9]+[x×])[.,;:!?…]*$/i;

// Même découpage que _WS côté Python
export function lineTokens(line) {
  return line.trim().split(/\s+/).filter(Boolean);
}

export function cleanWord(token) {
  return (token || '').replace(/[‘’ʼ`´′]/g, "'").replace(/[^\p{L}'-]/gu, '').replace(/^['-]+|['-]+$/g, '');
}

// Pour chaque token : texte prononcé ('' s'il est muet : (adlib), [didascalie], x2, ce qui suit un # isolé)
// et position [début, fin) de ses lettres prononcées, sans crochets ni ponctuation de bord
export function scanTokens(line) {
  let depth = 0, cut = false;
  return lineTokens(line).map((tok, i) => {
    cut = cut || (tok === '#' && i > 0);
    let spoken = '', first = -1, last = -1;
    if (!cut) for (let k = 0; k < tok.length; k++) {
      const c = tok[k];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
      else if (!depth) {
        spoken += c;
        if (/\p{L}/u.test(c)) { if (first < 0) first = k; last = k + 1; }
      }
    }
    if (REPEAT_RE.test(spoken)) return { spoken: '', span: null };
    return { spoken, span: first < 0 ? null : [first, last] };
  });
}

export function spokenTokens(line) {
  return scanTokens(line).map(t => t.spoken);
}

const typeMemo = new Map();
// verse | comment | section | adlib | blank
export function rowType(line) {
  let t = typeMemo.get(line);
  if (t) return t;
  const toks = lineTokens(line);
  if (!toks.length) t = 'blank';
  else if (toks[0].startsWith('#')) t = 'comment';
  else if (/\p{L}/u.test(spokenTokens(line).join(''))) t = 'verse';
  else if (toks[0].startsWith('[')) t = 'section';
  else if (/[([]/.test(line) || toks.some(t => REPEAT_RE.test(t))) t = 'adlib';
  else t = 'blank';
  if (typeMemo.size > 5000) typeMemo.clear();
  typeMemo.set(line, t);
  return t;
}

// Position [from, to) de chaque token dans la ligne brute (même découpage que lineTokens)
export function tokenOffsets(line) {
  return [...line.matchAll(/\S+/g)].map(m => ({ from: m.index, to: m.index + m[0].length }));
}

// Titre d'un texte : sa première ligne « # … » avant le premier vers ; sinon, hors strict, son premier vers
export function docTitle(text, strict = false) {
  const first = text.split('\n').find(l => ['comment', 'verse'].includes(rowType(l))) || '';
  if (rowType(first) === 'comment') return first.trim().replace(/^#+\s*/, '');
  return strict ? '' : first.trim();
}

export const verseCount = text => text.split('\n').filter(l => rowType(l) === 'verse').length;
