// ── Diff des versions : lignes (plus longue sous-suite commune), puis mots dans les lignes modifiées ──
// Module pur, sans DOM.

export const splitLines = text => text ? text.split('\n') : [];

export function lcsOps(a, b) {
  // Début et fin communs écartés d'abord : seule la partie modifiée passe par la table
  let p = 0, s = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const x = a.slice(p, a.length - s), y = b.slice(p, b.length - s), n = x.length, m = y.length;
  const ops = a.slice(0, p).map(t => ['=', t]);
  if (n * m > 4e6) {   // texte piégé : tout retiré puis tout ajouté, sans table géante
    x.forEach(t => ops.push(['-', t]));
    y.forEach(t => ops.push(['+', t]));
  } else {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { ops.push(['=', x[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', x[i++]]);
      else ops.push(['+', y[j++]]);
    }
    while (i < n) ops.push(['-', x[i++]]);
    while (j < m) ops.push(['+', y[j++]]);
  }
  return ops.concat(a.slice(a.length - s).map(t => ['=', t]));
}

export function lineStats(before, after) {
  const ops = lcsOps(splitLines(before), splitLines(after));
  return { added: ops.filter(o => o[0] === '+').length, removed: ops.filter(o => o[0] === '-').length };
}

// Mots d'une ligne modifiée, espaces compris : [{ k: '=' | '-' | '+', t }]
export function wordOps(a, b) {
  const segs = [];
  for (const [k, t] of lcsOps(a.split(/(\s+)/).filter(Boolean), b.split(/(\s+)/).filter(Boolean))) {
    const last = segs[segs.length - 1];
    if (last?.k === k) last.t += t;
    else segs.push({ k, t });
  }
  return segs;
}

// Chaque rangée porte ses deux rendus : côte à côte (left, right) et fusionné (segs)
export function diffRows(oldLines, newLines) {
  const ops = lcsOps(oldLines, newLines), rows = [];
  let k = 0, ln = 0, rn = 0;
  while (k < ops.length) {
    if (ops[k][0] === '=') {
      const seg = [{ k: '=', t: ops[k][1] }];
      rows.push({ kind: 'same', ln: ++ln, rn: ++rn, left: seg, right: seg, segs: seg });
      k++;
      continue;
    }
    const dels = [], adds = [];
    while (k < ops.length && ops[k][0] !== '=') { (ops[k][0] === '-' ? dels : adds).push(ops[k][1]); k++; }
    for (let x = 0; x < Math.max(dels.length, adds.length); x++) {
      if (x < dels.length && x < adds.length) {
        const w = wordOps(dels[x], adds[x]);
        rows.push({ kind: 'mod', ln: ++ln, rn: ++rn, left: w.filter(s => s.k !== '+'), right: w.filter(s => s.k !== '-'), segs: w });
      } else if (x < dels.length) {
        const seg = [{ k: '-', t: dels[x] }];
        rows.push({ kind: 'del', ln: ++ln, rn: '', left: seg, right: [], segs: seg });
      } else {
        const seg = [{ k: '+', t: adds[x] }];
        rows.push({ kind: 'add', ln: '', rn: ++rn, left: [], right: seg, segs: seg });
      }
    }
  }
  return rows;
}

// Les lignes identiques à plus d'une ligne d'un changement sont repliées (sauf celles dépliées d'un clic)
export function foldRows(rows, unfolded) {
  const near = rows.map((r, i) => rows.slice(Math.max(0, i - 1), i + 2).some(x => x.kind !== 'same'));
  const out = [];
  for (let i = 0; i < rows.length;) {
    let j = i;
    while (j < rows.length && !near[j]) j++;
    if (j - i >= 2 && !unfolded.has(i)) { out.push({ kind: 'fold', from: i, n: j - i }); i = j; }
    else if (j > i) { out.push(...rows.slice(i, j)); i = j; }
    else out.push(rows[i++]);
  }
  return out;
}
