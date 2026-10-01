// ── Color palette (CSS var names) ──
const COL_VARS = ['--col0','--col1','--col2','--col3','--col4','--col5','--col6','--col7'];
function getCol(i) { return getComputedStyle(document.documentElement).getPropertyValue(COL_VARS[i % COL_VARS.length]).trim(); }

let lastResult = null;

const LEVEL_NAMES = {
  homophone: 'homophone', multi: 'multi', riche: 'riche', suffisante: 'suffisante',
  pauvre: 'pauvre', identique: 'même mot', asso: 'assonance',
};
const LEVEL_HINTS = {
  homophone: 'même son exact',
  multi: '2 syllabes ou plus en commun',
  riche: '3 phonèmes ou plus en commun',
  suffisante: '2 phonèmes en commun',
  pauvre: 'seule la voyelle finale',
  asso: 'même voyelle, consonnes différentes',
};

// ── API ──
const API_BASE = '/api';
const rhymeCache = new Map();

async function fetchRhymes(word, { n = 30, syl = '', cat = '' } = {}) {
  const params = new URLSearchParams({ query: word.toLowerCase(), n });
  if (syl) params.set('syl', syl);
  if (cat) params.set('cat', cat);
  const key = params.toString();
  if (rhymeCache.has(key)) return rhymeCache.get(key);
  try {
    const res = await fetch(`${API_BASE}/query?${key}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    rhymeCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

async function fetchAnalysis(lines) {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let savedHistory = JSON.parse(localStorage.getItem('rime-history') || '[]');

function lineTokens(line) {
  return line.trim().split(/\s+/).filter(Boolean);
}

function cleanWord(token) {
  return (token || '').replace(/[‘’ʼ`´′]/g, "'").replace(/[^\p{L}'-]/gu, '').replace(/^['-]+|['-]+$/g, '');
}

// ── Marqueurs : miroir de analysis.py (le serveur reste la référence) ──
const REPEAT_RE = /^(?:[x×][0-9]+|[0-9]+[x×])[.,;:!?…]*$/i;

// Pour chaque token : texte prononcé ('' s'il est muet : (adlib), [didascalie], x2, ce qui suit un # isolé)
// et position [début, fin) de ses lettres prononcées, sans crochets ni ponctuation de bord
function scanTokens(line) {
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

function spokenTokens(line) {
  return scanTokens(line).map(t => t.spoken);
}

function rowType(line) {
  const toks = lineTokens(line);
  if (!toks.length) return 'blank';
  if (toks[0].startsWith('#')) return 'comment';
  if (/\p{L}/u.test(spokenTokens(line).join(''))) return 'verse';
  if (toks[0].startsWith('[')) return 'section';
  if (/[([]/.test(line) || toks.some(t => REPEAT_RE.test(t))) return 'adlib';
  return 'blank';
}

// Mot prononcé d'un vers analysé : « paradis(merde) » → « paradis »
function spokenWord(lineIndex, wordIndex, res = lastResult) {
  return cleanWord(spokenTokens(res.lines[lineIndex])[wordIndex]);
}

// ── Highlighting des mots dans une ligne ──
function highlightLine(line, info, groups, v) {
  const muted = new Set(info.muted);
  const internal = new Map(info.internal.map(it => [it.i, it]));
  const own = groups[info.group];
  const scan = scanTokens(line);
  // Bords d'un mot : « (merde) » collé reste gris, la ponctuation reste neutre
  const edge = s => !s ? '' : /[()[\]]/.test(s) ? `<span class="rw-mute">${escHtml(s)}</span>` : escHtml(s);
  let wordIdx = -1;
  let out = '';
  for (const tok of line.trim().split(/(\s+)/)) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) { out += tok; continue; }
    wordIdx++;
    const span = scan[wordIdx]?.span;
    const attrs = `data-word-index="${wordIdx}" data-token="${escHtml(tok)}"`;
    if (muted.has(wordIdx)) { out += `<span class="rw-mute">${escHtml(tok)}</span>`; continue; }
    if (!span) { out += `<span class="rw-plain" ${attrs}>${escHtml(tok)}</span>`; continue; }
    const [a, b] = span;
    const word = escHtml(tok.slice(a, b));
    out += edge(tok.slice(0, a));
    if (wordIdx === info.end && own) {
      const col = getCol(own.ci);
      const style = info.kind === 'asso'
        ? `color:${col};text-decoration-color:${col}`
        : `background:${col}22;color:${col}`;
      out += `<span class="rw${info.kind === 'asso' ? ' rw-asso' : ''}" ${attrs} data-ph="${escHtml(own.key)}" style="${style}">${word}</span>`;
    } else if (internal.has(wordIdx)) {
      const it = internal.get(wordIdx);
      const g = groups[it.group];
      const col = getCol(g.ci);
      const tag = g.members ? `<sup class="fam-tag">${escHtml(g.label)}</sup>` : '';
      out += `<span class="rw-int${g.members ? ' fam' : ''}" ${attrs} data-ph="${escHtml(g.key)}" title="${escHtml(internalTitle(it, v))}" style="color:${col};text-decoration-color:${col}">${word}${tag}</span>`;
    } else {
      out += `<span class="rw-plain" ${attrs}>${word}</span>`;
    }
    out += edge(tok.slice(b));
  }
  return out;
}

// « Rime interne C avec « côté » (vers 17) · 2 voyelles en commun »
function internalTitle(it, v) {
  const g = lastResult.groups[it.group];
  const [pv, pw] = it.with;
  const where = pv === v ? 'même vers' : `vers ${pv + 1}`;
  const quality = it.k >= 3 ? 'riche' : it.k === 2 ? 'suffisante' : it.v >= 2 ? `${it.v} voyelles en commun` : 'pauvre';
  return `Rime interne ${g.members ? 'famille ' : ''}${g.label} avec « ${spokenWord(pv, pw)} » (${where}) · ${quality}${it.exact ? '' : ' ≈'}`;
}

function internalSummary(l, v) {
  return 'Rimes internes : ' + l.internal.map(it => {
    const [pv, pw] = it.with;
    return `${spokenWord(v, it.i)} ~ ${spokenWord(pv, pw)}${pv === v ? '' : ` (v.${pv + 1})`}`;
  }).join(' · ');
}

// ── Analyse principale ──
let analyzeSeq = 0;
let lastRequested = null;   // texte de la dernière analyse demandée : le blur ne la relance pas pour rien

async function analyze() {
  // Toutes les lignes partent : le serveur distingue vers, titres, sections, adlibs et strophes
  const text = document.getElementById('input').value;
  const sent = text.split('\n');
  if (!sent.some(l => l.trim())) return;

  lastRequested = text;
  const seq = ++analyzeSeq;
  let data;
  try {
    data = await fetchAnalysis(sent);
  } catch (e) {
    if (seq === analyzeSeq) {
      lastRequested = null;
      toast(e.message === 'HTTP 413' ? 'Texte trop long pour l\'analyse' : 'Serveur d\'analyse injoignable');
    }
    return;
  }
  if (seq !== analyzeSeq) return;
  if (!data.rows) { toast('Version obsolète — recharge la page (Ctrl+F5)'); return; }
  if (data.rows.length < sent.length) toast(`Analyse limitée aux ${data.lines.length} premiers vers`);

  // groups : rimes de fin + familles de rimes internes ; groupList : rimes de fin seulement
  const groups = Object.fromEntries([...data.groups, ...data.families].map(g => [g.key, g]));
  lastResult = {
    ...data, sent, groups, groupList: data.groups, info: data.lines,
    lines: data.lines.map(l => sent[l.row].trim()),
  };
  colorFamilies();
  renderAll();
}

// Couleur d'une famille interne : de préférence une couleur qu'aucune rime de fin n'utilise,
// sinon une couleur absente des vers que la famille touche (±1)
function colorFamilies() {
  const { info, groups, groupList, families } = lastResult;
  const used = info.map(() => new Set());
  const mark = (v, ci) => [v - 1, v, v + 1].forEach(j => used[j]?.add(ci % COL_VARS.length));
  info.forEach((l, v) => { if (groups[l.group]) mark(v, groups[l.group].ci); });
  const endCols = new Set(groupList.map(g => g.ci % COL_VARS.length));
  const order = [...COL_VARS.keys()].sort((a, b) => endCols.has(a) - endCols.has(b));
  families.forEach((f, idx) => {
    const verses = [...new Set(f.members.map(([v]) => v))];
    const busy = new Set(verses.flatMap(v => [...used[v]]));
    f.ci = order.find(c => !busy.has(c)) ?? (groupList.length + idx) % COL_VARS.length;
    verses.forEach(v => mark(v, f.ci));
  });
}

function chipLabel(info, groups) {
  const g = groups[info.group];
  if (!g) return '·';
  return info.kind === 'asso' ? g.label.toLowerCase() : g.label;
}

function levelTitle(info, i) {
  const partner = info.partner !== null ? ` avec le vers ${info.partner + 1}` : '';
  let t;
  if (info.kind === 'rime' && info.level) {
    t = info.level === 'identique'
      ? `Même mot${partner}`
      : `Rime ${LEVEL_NAMES[info.level]}${partner} — ${info.k} phonème${info.k > 1 ? 's' : ''}, ${info.syl_match} syllabe${info.syl_match > 1 ? 's' : ''} en commun`;
    if (!info.exact) t += ' (approximative : é/è, o ouvert/fermé, sourde/sonore…)';
  } else if (info.kind === 'asso') {
    t = `Assonance${partner} — ${info.syl_match} voyelle${info.syl_match > 1 ? 's' : ''} en commun`;
  } else {
    t = `Vers ${i + 1} non rimé`;
  }
  if (info.guess) t += ' · prononciation devinée (mot absent du dictionnaire)';
  return t;
}

function levelTag(info) {
  if (info.kind === 'asso') return `<span class="v-level lvl-asso">asso</span>`;
  if (!info.level) return '';
  const name = info.level === 'multi' ? `multi ×${info.syl_match}` : LEVEL_NAMES[info.level];
  return `<span class="v-level lvl-${info.level}">${name}${info.exact ? '' : ' ≈'}</span>`;
}

function renderAll() {
  const { lines, info, groups, groupList, families, sounds, echoes } = lastResult;

  ['emptyState','emptyStateAsso','emptyStateSchema'].forEach(id => document.getElementById(id).style.display = 'none');
  ['analysisContent','assoContent','schemaContent'].forEach(id => document.getElementById(id).style.display = 'block');

  const rhymed = info.filter(l => l.kind === 'rime').length;
  const rich = info.filter(l => l.level === 'riche' || l.level === 'multi').length;
  const avgSyl = info.length ? Math.round(info.reduce((a, l) => a + l.syl, 0) / info.length) : 0;
  const internalCount = info.reduce((a, l) => a + l.internal.length, 0);

  // Stats
  document.getElementById('statsRow').innerHTML = `
    <div class="stat"><div class="stat-num">${lines.length}</div><div class="stat-lbl">Vers</div></div>
    <div class="stat"><div class="stat-num">${rhymed}</div><div class="stat-lbl">Rimés</div></div>
    <div class="stat"><div class="stat-num">${rich}</div><div class="stat-lbl">Riches</div></div>
    <div class="stat"><div class="stat-num">${avgSyl}</div><div class="stat-lbl">Syl. moy.</div></div>
    <div class="stat"><div class="stat-num">${internalCount}</div><div class="stat-lbl">Rimes int.</div></div>
  `;

  // Pattern chips (un espace entre strophes)
  document.getElementById('patternChips').innerHTML = info.map((l, i) => {
    const gap = i && l.stanza !== info[i - 1].stanza ? '<span class="p-gap"></span>' : '';
    const g = groups[l.group];
    if (!g) return gap + `<span class="p-chip" title="${escHtml(levelTitle(l, i))}" style="color:var(--chip-neutral-txt);background:var(--chip-neutral-bg)">·</span>`;
    const col = getCol(g.ci);
    const cls = l.kind === 'asso' ? 'p-chip asso' : 'p-chip';
    return gap + `<span class="${cls}" data-ph="${escHtml(g.key)}" title="${escHtml(levelTitle(l, i))}" style="background:${col}22;color:${col}">${chipLabel(l, groups)}</span>`;
  }).join('');

  // Legend : rimes de fin (et leurs mots internes), puis familles internes
  const intCount = {};
  info.forEach(l => l.internal.forEach(it => { intCount[it.group] = (intCount[it.group] || 0) + 1; }));
  document.getElementById('legendEl').innerHTML = groupList.map(g => {
    const col = getCol(g.ci);
    const count = g.lines.length + g.asso.length;
    const levels = Object.entries(g.levels)
      .sort((a, b) => b[1] - a[1])
      .map(([lvl, c]) => `${c} ${LEVEL_NAMES[lvl]}`).join(', ');
    const extra = [levels, g.type === 'rime' && g.asso.length ? `${g.asso.length} asso` : '',
      intCount[g.key] ? `+${intCount[g.key]} int.` : ''].filter(Boolean).join(' · ');
    const kind = g.type === 'rime' ? 'Rime' : 'Asso.';
    return `<span class="legend-item" data-ph="${escHtml(g.key)}"><span class="legend-dot${g.type === 'asso' ? ' asso' : ''}" style="background:${col};border-color:${col}"></span>${kind} ${g.type === 'rime' ? g.label : g.label.toLowerCase()} — <em style="color:${col}">${escHtml(g.display)}</em> (${count}×)${extra ? ` <span class="legend-extra">${extra}</span>` : ''}</span>`;
  }).join('') + families.map(f => {
    const col = getCol(f.ci);
    const words = [...new Set(f.members.map(([v, w]) => spokenWord(v, w)))].join(' · ');
    return `<span class="legend-item" data-ph="${escHtml(f.key)}"><span class="legend-dot int" style="border-color:${col}"></span>Int. ${escHtml(f.label)} — <em style="color:${col}">${escHtml(f.display)}</em> <span class="legend-extra">${escHtml(words)}</span></span>`;
  }).join('') + (groupList.some(g => g.type === 'asso' || g.asso.length)
    ? '<span class="legend-item legend-note">pointillés = assonance</span>' : '');

  document.getElementById('linesList').innerHTML = renderRows();

  renderSounds(lines, info, groups, groupList, sounds, echoes);

  // Schéma (un espace entre strophes ; Bebas Neue n'a pas de minuscules, les assonances sont soulignées)
  document.getElementById('schemeBadge').innerHTML = info.length ? info.map((l, i) => {
    const label = escHtml(chipLabel(l, groups));
    return (i && l.stanza !== info[i - 1].stanza ? ' ' : '') + (l.kind === 'asso' ? `<span class="sb-asso">${label}</span>` : label);
  }).join('') : '—';
  document.getElementById('schemeDesc').innerHTML = info.map((l, i) => {
    const g = groups[l.group];
    const col = g ? getCol(g.ci) : 'var(--muted)';
    let desc = '<span style="color:var(--muted)">(non rimé)</span>';
    if (g && l.kind === 'rime') {
      desc = `→ rime <strong style="color:${col}">${g.label}</strong>${l.level ? ` ${LEVEL_NAMES[l.level]}` : ''}${l.partner !== null ? ` avec ${l.partner + 1}` : ''}`;
    } else if (g) {
      desc = `→ assonance <strong style="color:${col}">${g.label.toLowerCase()}</strong> avec ${l.partner + 1}`;
    }
    const int = l.internal.length
      ? ` &mdash; int. : ${l.internal.map(it => `${escHtml(spokenWord(i, it.i))} (${escHtml(groups[it.group].label)})`).join(', ')}` : '';
    const gap = i && l.stanza !== info[i - 1].stanza ? '<br>' : '';
    return `${gap}<span>Vers ${i+1} &mdash; <em style="color:${col}">${escHtml(l.phon || '—')}</em> ${desc} &mdash; ${l.syl} syllabes${int}</span>`;
  }).join('<br>');

  restoreLock();
}

// Vers annotés, avec les lignes ignorées (titre, commentaires, sections, adlibs) et les strophes
function renderRows() {
  const { rows, sent, info, families } = lastResult;
  const famOf = {};
  families.forEach(f => f.members.forEach(([v]) => (famOf[v] ||= new Set()).add(f.key)));
  let html = '', gap = false, started = false, seenVerse = false, titled = false;
  rows.forEach((r, row) => {
    if (r.type === 'blank') { gap = started; return; }
    if (gap) { html += '<div class="stanza-gap"></div>'; gap = false; }
    started = true;
    const text = sent[row].trim();
    if (r.type === 'verse') {
      seenVerse = true;
      html += verseRow(r.verse, row, famOf[r.verse]);
    } else if (r.type === 'comment' && !seenVerse && !titled) {
      titled = true;
      html += `<div class="v-title" title="Titre — ignoré par l'analyse">${escHtml(text.replace(/^#+\s*/, ''))}</div>`;
    } else {
      html += `<div class="x-row x-${r.type}" title="Ignoré par l'analyse">${escHtml(text)}</div>`;
    }
  });
  if (!info.length) html += '<p class="muted-note">Aucun vers analysé — toutes les lignes sont ignorées</p>';
  return html;
}

function verseRow(i, row, fams) {
  const { lines, info, groups } = lastResult;
  const l = info[i];
  const g = groups[l.group];
  // Toutes les familles présentes sur la ligne, pour le survol
  const phs = new Set([l.group, ...l.internal.map(it => it.group), ...(fams || [])].filter(Boolean));
  const int = l.internal.length
    ? `<span class="v-int" title="${escHtml(internalSummary(l, i))}">↺${l.internal.length}</span>` : '';
  let badge;
  if (g) {
    const col = getCol(g.ci);
    badge = `<span class="v-badge" title="${escHtml(levelTitle(l, i))}">
         <span class="v-rime${l.kind === 'asso' ? ' asso' : ''}" data-ph="${escHtml(g.key)}" style="background:${col}22;color:${col}">${escHtml(l.rime)}${l.guess ? '?' : ''}</span>
         ${levelTag(l)}${int}
         <button class="btn-suggest" onclick="openSuggest(event,${i})">✦</button>
       </span>`;
  } else if (l.end === null) {
    badge = `<span class="v-badge">${int}<span class="v-level" title="Aucune voyelle : pas de rime possible">—</span></span>`;
  } else {
    badge = `<span class="v-badge">${int}<button class="btn-suggest" title="${escHtml(levelTitle(l, i))}" onclick="openSuggest(event,${i})">✦ rime ?</button></span>`;
  }
  return `<div class="verse-line"${g ? ` data-ph="${escHtml(g.key)}"` : ''} data-phs="${escHtml([...phs].join(' '))}" data-line-index="${i}">
      <span class="v-num" title="Ligne ${row + 1} du texte">${i+1}</span>
      <span class="v-text">${highlightLine(lines[i], l, groups, i)}</span>
      <span class="v-syl">${l.syl}syl</span>
      ${badge}
    </div>`;
}

function renderSounds(lines, info, groups, groupList, sounds, echoes) {
  // Fins de vers
  const sorted = [...groupList].sort((a, b) => (b.lines.length + b.asso.length) - (a.lines.length + a.asso.length));
  const maxC = sorted[0] ? sorted[0].lines.length + sorted[0].asso.length : 1;
  document.getElementById('assoGrid').innerHTML = sorted.slice(0, 8).map(g => {
    const col = getCol(g.ci);
    const count = g.lines.length + g.asso.length;
    const pct = Math.round(count / maxC * 100);
    const sample = [...g.lines, ...g.asso].sort((a, b) => a - b).slice(0, 2).map(i => lines[i]).join(' / ');
    const kind = g.type === 'rime' ? `rime ${g.label}` : `assonance ${g.label.toLowerCase()}`;
    return `<div class="asso-card" data-ph="${escHtml(g.key)}">
      <div class="asso-sound" style="color:${col}">${escHtml(g.display)}</div>
      <div class="asso-bar-wrap"><div class="asso-bar" style="width:${pct}%;background:${col}"></div></div>
      <div class="asso-count">${count}× · ${kind}</div>
      <div class="asso-verses">${escHtml(sample.slice(0,70))}${sample.length>70?'…':''}</div>
    </div>`;
  }).join('') || '<p class="muted-note">Aucune rime ni assonance en fin de vers</p>';

  document.getElementById('vowelList').innerHTML = soundRows(sounds.vowels, 11);
  document.getElementById('consonantList').innerHTML = soundRows(sounds.consonants, 8);

  document.getElementById('echoList').innerHTML = echoes.map(e => {
    const [a, b] = e.lines;
    const ga = groups[info[a].group];
    const col = ga && info[a].group === info[b].group ? getCol(ga.ci) : 'var(--text2)';
    return `<div class="echo-row">
      <div class="echo-head">
        <span class="echo-sound" style="color:${col}">${escHtml(e.display)}</span>
        <span class="v-level ${e.rime ? 'lvl-multi' : 'lvl-asso'}">${e.rime ? 'rime' : 'assonance'} ×${e.syl}</span>
        <span class="echo-nums">vers ${a + 1} ↔ ${b + 1}</span>
      </div>
      <div class="echo-lines">${escHtml(lines[a])}<br>${escHtml(lines[b])}</div>
    </div>`;
  }).join('') || '<p class="muted-note">Aucun écho de 2 syllabes ou plus entre vers proches</p>';
}

function soundRows(rows, limit) {
  if (!rows.length) return '<p class="muted-note">—</p>';
  const max = rows[0].count;
  return rows.slice(0, limit).map(r => {
    const hot = r.ratio !== null && r.ratio >= 1.4;
    const ratio = r.ratio === null ? '' : `×${r.ratio.toFixed(1)}`;
    return `<div class="sound-row${hot ? ' hot' : ''}" title="${Math.round(r.share * 100)}% des sons du texte, ${ratio} par rapport au français courant">
      <span class="sound-name">${escHtml(r.sound)}</span>
      <div class="asso-bar-wrap sound-bar"><div class="asso-bar" style="width:${Math.round(r.count / max * 100)}%;background:${hot ? 'var(--col1)' : 'var(--border2)'}"></div></div>
      <span class="sound-count">${r.count}</span>
      <span class="sound-ratio">${ratio}</span>
      <span class="sound-words">${escHtml(r.words.join(', '))}</span>
    </div>`;
  }).join('');
}

// ── Tabs ──
function showTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-'+name).classList.add('active');
  if (name === 'historique') renderHistory();
}

// ── Theme ──
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('rime-theme', next);
  document.getElementById('themeBtn').textContent = isDark ? '☾' : '☀';
  if (lastResult) renderAll();
}

// Sync button icon with saved theme on load
(function(){
  const saved = localStorage.getItem('rime-theme');
  if (saved === 'light') document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('themeBtn').textContent = '☾';
  });
})();

// ── Count ──
function updateCount() {
  const types = document.getElementById('input').value.split('\n').map(rowType);
  const n = types.filter(t => t === 'verse').length;
  const ignored = types.filter(t => t === 'comment' || t === 'section' || t === 'adlib').length;
  document.getElementById('charCount').textContent = `${n} vers${ignored ? ` · ${ignored} ignorée${ignored > 1 ? 's' : ''}` : ''}`;
}

// ── Export ──
function buildReport() {
  if (!lastResult) return '';
  const { rows, sent, lines, info, groups, groupList, sounds, echoes } = lastResult;
  const title = rows.findIndex(r => r.type === 'comment');
  const firstVerse = rows.findIndex(r => r.type === 'verse');
  let r = '=== RIME — Rapport d\'analyse ===\n\n';
  if (title >= 0 && (firstVerse < 0 || title < firstVerse)) r += `Titre : ${sent[title].trim().replace(/^#+\s*/, '')}\n`;
  r += `Vers : ${lines.length} | Rimés : ${info.filter(l => l.kind === 'rime').length} | Groupes : ${groupList.length} | Rimes internes : ${info.reduce((a, l) => a + l.internal.length, 0)}\n`;
  r += `Schéma : ${info.map((l, i) => (i && l.stanza !== info[i - 1].stanza ? ' ' : '') + chipLabel(l, groups)).join('')}  (minuscule = assonance)\n\n`;
  r += '--- Vers ---\n';
  let gap = false, started = false;
  rows.forEach((row, k) => {
    if (row.type === 'blank') { gap = started; return; }
    if (row.type === 'comment' || row.type === 'adlib') return;
    if (gap) { r += '\n'; gap = false; }
    started = true;
    if (row.type === 'section') { r += `${sent[k].trim()}\n`; return; }
    const i = row.verse, it = info[i];
    const lvl = it.kind === 'asso' ? 'assonance' : (it.level ? LEVEL_NAMES[it.level] : '');
    r += `[${i+1}] [${chipLabel(it, groups)}] [${it.syl}syl] [${it.phon}${lvl ? ' · ' + lvl : ''}] ${lines[i]}\n`;
  });
  r += '\n--- Fins de vers ---\n';
  groupList.forEach(g => {
    const levels = Object.entries(g.levels).map(([lvl, c]) => `${c} ${LEVEL_NAMES[lvl]}`).join(', ');
    r += `${g.type === 'rime' ? 'Rime' : 'Assonance'} ${g.label} "${g.display}" × ${g.lines.length + g.asso.length}${levels ? ` (${levels})` : ''}\n`;
  });
  if (info.some(l => l.internal.length)) {
    r += '\n--- Rimes internes ---\n';
    info.forEach((l, i) => {
      if (!l.internal.length) return;
      r += `Vers ${i+1} : ${l.internal.map(it => `${spokenWord(i, it.i)} (${groups[it.group].label}) ~ ${spokenWord(...it.with)}${it.with[0] === i ? '' : ` (v.${it.with[0] + 1})`}`).join(' · ')}\n`;
    });
  }
  const hot = [...sounds.vowels, ...sounds.consonants].filter(s => s.ratio >= 1.4);
  if (hot.length) {
    r += '\n--- Sons sur-représentés ---\n';
    hot.forEach(s => { r += `"${s.sound}" × ${s.count} (×${s.ratio.toFixed(1)} vs français courant) : ${s.words.join(', ')}\n`; });
  }
  if (echoes.length) {
    r += '\n--- Échos multisyllabiques ---\n';
    echoes.forEach(e => { r += `Vers ${e.lines[0]+1} ↔ ${e.lines[1]+1} : ${e.display} (${e.syl} syll., ${e.rime ? 'rime' : 'assonance'})\n`; });
  }
  return r;
}

function exportCopy() {
  navigator.clipboard.writeText(buildReport()).then(() => toast('Rapport copié ✓'));
}

function exportTxt() {
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(buildReport());
  a.download = 'rime-rapport.txt';
  a.click();
}

// ── History ──
function saveToHistory() {
  const text = document.getElementById('input').value.trim();
  if (!text) return;
  const item = { id: Date.now(), text, date: new Date().toLocaleDateString('fr') };
  savedHistory.unshift(item);
  if (savedHistory.length > 20) savedHistory = savedHistory.slice(0, 20);
  localStorage.setItem('rime-history', JSON.stringify(savedHistory));
  toast('Couplet sauvegardé ✓');
}

function renderHistory() {
  const el = document.getElementById('historyList');
  if (!savedHistory.length) {
    el.innerHTML = '<div class="history-empty">Aucun couplet sauvegardé.<br>Clique sur "Sauver" pour en ajouter.</div>';
    return;
  }
  el.innerHTML = savedHistory.map(item => {
    const rows = item.text.split('\n');
    const first = rows.find(l => ['comment', 'verse'].includes(rowType(l))) || '';
    const preview = rowType(first) === 'comment' ? first.trim().replace(/^#+\s*/, '') : first;
    return `
    <div class="history-item" onclick="loadHistory(${item.id})">
      <div class="history-preview">${escHtml(preview)}</div>
      <div class="history-meta">${item.date} · ${rows.filter(l => rowType(l) === 'verse').length} vers</div>
      <button class="history-del" onclick="deleteHistory(event,${item.id})">×</button>
    </div>`;
  }).join('');
}

function loadHistory(id) {
  const item = savedHistory.find(h => h.id === id);
  if (!item) return;
  document.getElementById('input').value = item.text;
  updateCount();
  analyze();
  document.querySelectorAll('.tab').forEach((t,i) => { t.classList.toggle('active', i===0); });
  document.querySelectorAll('.tab-content').forEach((t,i) => { t.classList.toggle('active', i===0); });
}

function deleteHistory(e, id) {
  e.stopPropagation();
  savedHistory = savedHistory.filter(h => h.id !== id);
  localStorage.setItem('rime-history', JSON.stringify(savedHistory));
  renderHistory();
}

// ── Clear ──
function clearAll() {
  document.getElementById('input').value = '';
  updateCount();
  analyzeSeq++;
  lastRequested = null;
  closePopover();
  lastResult = null;
  lockedPh = null; activePh = null; clearHighlight();
  ['analysisContent','assoContent','schemaContent'].forEach(id => document.getElementById(id).style.display = 'none');
  ['emptyState','emptyStateAsso','emptyStateSchema'].forEach(id => document.getElementById(id).style.display = 'flex');
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ── Auto-analyse ──
let analyzeTimer = null;

// Relance seulement si le texte a changé depuis la dernière analyse demandée
function analyzeIfChanged() {
  const text = document.getElementById('input').value;
  if (text.trim() && text !== lastRequested) analyze();
}

function scheduleAnalyze() {
  clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(analyzeIfChanged, 600);
}

function immediateAnalyze() {
  clearTimeout(analyzeTimer);
  analyzeTimer = null;
  analyzeIfChanged();
}

document.getElementById('input').addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') { clearTimeout(analyzeTimer); analyze(); }
});

// ── Rendu des suggestions par richesse ──
function suggestionChips(data, chipClass, { perLevel = 12, exclude = '' } = {}) {
  const sections = [];
  // Ordre explicite : le JSON renvoyé par Flask a ses clés triées alphabétiquement
  for (const lvl of ['homophone', 'multi', 'riche', 'suffisante', 'pauvre']) {
    const shown = (data.levels[lvl] || []).filter(it => it.w !== exclude).slice(0, perLevel);
    if (shown.length) sections.push({ lvl, items: shown });
  }
  const asso = data.asso.filter(it => it.w !== exclude).slice(0, perLevel);
  if (asso.length) sections.push({ lvl: 'asso', items: asso });
  return sections.map(({ lvl, items }) => `<div class="suggest-level">
      <div class="suggest-level-name">${LEVEL_NAMES[lvl]}<span class="level-hint">${LEVEL_HINTS[lvl]}</span></div>
      ${items.map(it => {
        const cls = [chipClass, `lvl-${lvl}`, it.approx ? 'approx' : '', it.derived ? 'derived' : ''].filter(Boolean).join(' ');
        const title = lvl === 'asso'
          ? `${it.syl} voyelle${it.syl > 1 ? 's' : ''} en commun · ${it.n} syll. · ${it.cat}`
          : `${it.k} phonème${it.k > 1 ? 's' : ''} en commun${it.approx ? ' (approximatif)' : ''}${it.derived ? ' · même famille' : ''} · ${it.n} syll. · ${it.cat}`;
        return `<button class="${cls}" data-word="${escHtml(it.w)}" title="${escHtml(title)}">${escHtml(it.w)}</button>`;
      }).join('')}
    </div>`).join('');
}

// ── Suggest popover ──
let popoverState = null; // { lineIndex, wordIndex, row, res } — row : la ligne du textarea, res : l'analyse du clic

function suggestState(lineIndex, wordIndex) {
  return { lineIndex, wordIndex, row: lastResult.info[lineIndex].row, res: lastResult };
}

function openSuggest(e, lineIndex) {
  e.stopPropagation();
  if (!lastResult) return;
  const info = lastResult.info[lineIndex];
  if (!info || info.end === null) return;
  const word = spokenWord(lineIndex, info.end);
  if (!word) return;
  popoverState = suggestState(lineIndex, info.end);
  openContextualPopover(e.currentTarget.getBoundingClientRect(), lineIndex, word);
}

function endWordOf(i, res = lastResult) {
  const info = res.info[i];
  return info.end === null ? '' : spokenWord(i, info.end, res);
}

async function openContextualPopover(rect, lineIndex, word) {
  if (!lastResult) return;
  const el = getOrCreatePopover();
  el.innerHTML = `<div class="suggest-header">Suggestions — vers ${lineIndex + 1}</div>
    <div class="suggest-body"><span class="suggest-empty">…</span></div>`;
  positionPopover(el, rect);
  el.classList.add('show');
  const state = popoverState;
  // L'analyse peut être relancée pendant le chargement (blur du textarea) : on garde celle du clic
  const res = state.res;

  const { groupList, info } = res;
  const l = info[lineIndex];
  // Le groupe du mot : sa famille interne (une fin de vers sans rime peut en avoir une), sinon sa rime de fin
  const ownGroup = l.internal.find(it => it.i === state.wordIndex)?.group
    ?? (state.wordIndex === l.end ? l.group : null);

  // Le mot lui-même, puis les groupes de rimes les plus proches du vers
  const targets = [{ query: word, group: res.groups[ownGroup], current: true }];
  groupList
    .filter(g => g.type === 'rime' && g.key !== ownGroup)
    .map(g => ({ g, near: g.lines.reduce((best, j) => Math.abs(j - lineIndex) < Math.abs(best - lineIndex) ? j : best) }))
    .sort((a, b) => Math.abs(a.near - lineIndex) - Math.abs(b.near - lineIndex))
    .slice(0, 3)
    .forEach(({ g, near }) => targets.push({ query: endWordOf(near, res), group: g, current: false }));

  const fetched = await Promise.all(targets.map(async t => ({ ...t, data: await fetchRhymes(t.query, { n: 12 }) })));

  if (!el.classList.contains('show') || popoverState !== state) return;
  const body = el.querySelector('.suggest-body');
  const sections = fetched
    .filter(({ data }) => data && (Object.values(data.levels).some(l => l.length) || data.asso.length))
    .map(({ group, current, data, query }) => {
      const col = group ? getCol(group.ci) : 'var(--text2)';
      const refWords = !group ? []
        : group.members
          ? [...new Set(group.members.filter(([v, w]) => v !== lineIndex || w !== state.wordIndex).map(([v, w]) => spokenWord(v, w, res)))].slice(0, 3)
          : [...group.lines].filter(idx => idx !== lineIndex).slice(0, 3).map(idx => endWordOf(idx, res)).filter(Boolean);
      return `<div class="suggest-section">
        <div class="suggest-section-title">
          ${group ? `<span style="color:${col}">${group.members ? 'Int.' : 'Rime'} ${escHtml(group.label)}</span>` : ''}
          ${refWords.length ? `<span class="suggest-refs">${escHtml(refWords.join(', '))}</span>` : `<span class="suggest-refs">${escHtml(query)}</span>`}
          <em style="color:${col}">${escHtml(data.rime)}</em>
          ${current ? '<span class="suggest-current">actuel</span>' : ''}
        </div>
        ${suggestionChips(data, 'suggest-chip', { perLevel: 10, exclude: word })}
      </div>`;
    }).join('');

  body.innerHTML = sections || '<span class="suggest-empty">Aucune suggestion trouvée</span>';
}

function getOrCreatePopover() {
  let el = document.getElementById('suggest-popover');
  if (!el) {
    el = document.createElement('div');
    el.id = 'suggest-popover';
    el.className = 'suggest-popover';
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      const chip = e.target.closest('.suggest-chip');
      if (!chip || !popoverState) return;
      applyWordReplacement(popoverState, chip.dataset.word);
    });
  }
  return el;
}

function positionPopover(el, rect) {
  let left = rect.left;
  if (left + 390 > window.innerWidth) left = Math.max(10, window.innerWidth - 400);
  el.style.left = `${left}px`;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 360 && rect.top > spaceBelow) {
    el.style.top    = 'auto';
    el.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  } else {
    el.style.bottom = 'auto';
    el.style.top    = `${rect.bottom + 6}px`;
  }
}

function closePopover() {
  document.getElementById('suggest-popover')?.classList.remove('show');
  popoverState = null;
}

function applyWordReplacement(state, newWord) {
  const ta = document.getElementById('input');
  const allLines = ta.value.split('\n');
  // Le texte a bougé au-dessus de la ligne depuis l'analyse (frappe, ligne insérée ou supprimée) :
  // on n'écrit rien à l'aveugle, même si une ligne identique a pris sa place
  if (allLines.slice(0, state.row + 1).some((l, k) => l !== state.res.sent[k])) {
    closePopover();
    toast('Le texte a changé — nouvelle analyse');
    analyze();
    return;
  }
  const line = allLines[state.row];
  const lead = line.match(/^\s*/)[0];
  const parts = line.slice(lead.length).split(/(\s+)/);
  // Seules les lettres prononcées changent : « paradis, » → « nouveau, », « paradis(merde) » → « nouveau(merde) »
  const span = scanTokens(line)[state.wordIndex]?.span;
  let wi = 0;
  for (let j = 0; j < parts.length; j++) {
    if (/^\s+$/.test(parts[j]) || !parts[j]) continue;
    if (wi === state.wordIndex) {
      parts[j] = span ? parts[j].slice(0, span[0]) + newWord + parts[j].slice(span[1]) : newWord;
      break;
    }
    wi++;
  }
  allLines[state.row] = lead + parts.join('');
  ta.value = allLines.join('\n');
  closePopover();
  updateCount();
  analyze();
}

// ── Atelier ──
let atelierSeq = 0;

async function atelierSearch() {
  const word = document.getElementById('atelierInput').value.trim();
  if (!word) return;
  const syl = document.getElementById('atelierSyl').value;
  const cat = document.getElementById('atelierCat').value;
  const el = document.getElementById('atelierResults');
  el.innerHTML = '<div class="atelier-empty">Recherche…</div>';
  const seq = ++atelierSeq;
  const data = await fetchRhymes(word, { n: 40, syl, cat });
  if (seq !== atelierSeq) return;
  const hasResults = data && (Object.values(data.levels).some(l => l.length) || data.asso.length);
  if (!hasResults) {
    el.innerHTML = '<div class="atelier-empty">Aucune rime trouvée</div>';
    return;
  }
  el.innerHTML = `
    <div class="atelier-head">
      « ${escHtml(word)} » se prononce <strong>${escHtml(data.display)}</strong>
      · rime en <em>${escHtml(data.rime)}</em>
      ${data.guess ? '<span class="atelier-guess">prononciation devinée</span>' : ''}
      <span class="atelier-hint">— clic pour insérer au curseur</span>
    </div>
    <div class="atelier-section">${suggestionChips(data, 'atelier-chip', { perLevel: 40 })}</div>`;
}

// ── Hover highlight ──
let activePh = null;
let lockedPh = null;
let lockedRes = null;   // analyse sur laquelle le verrou a été posé

// Une famille (rime de fin ou interne) : ses vers restent visibles, ses mots sont entourés
function applyHighlight(ph) {
  document.querySelectorAll('.verse-line[data-phs]').forEach(el => {
    const match = el.dataset.phs.split(' ').includes(ph);
    el.classList.toggle('ph-active', match);
    el.classList.toggle('ph-dim', !match);
  });
  document.querySelectorAll('.p-chip[data-ph], .legend-item[data-ph]').forEach(el => {
    const match = el.dataset.ph === ph;
    el.classList.toggle('ph-active', match);
    el.classList.toggle('ph-dim', !match);
  });
  document.querySelectorAll('.v-text [data-ph]').forEach(el => el.classList.toggle('ph-on', el.dataset.ph === ph));
  // Une fin de vers en assonance (dessinée avec son groupe) peut aussi être membre d'une famille interne
  lastResult?.groups[ph]?.members?.forEach(([v, w]) =>
    document.querySelector(`.verse-line[data-line-index="${v}"] [data-word-index="${w}"]`)?.classList.add('ph-on'));
}

function clearHighlight() {
  document.querySelectorAll('.ph-active, .ph-dim, .ph-locked, .ph-on').forEach(el =>
    el.classList.remove('ph-active', 'ph-dim', 'ph-locked', 'ph-on')
  );
}

// Après un nouveau rendu : le verrou tient s'il vise une rime de fin, ou une famille interne de la même
// analyse (leurs clés sont des numéros qui changent d'une analyse à l'autre)
function restoreLock() {
  const g = lockedPh && lastResult.groups[lockedPh];
  if (g && (!g.members || lockedRes === lastResult)) {
    activePh = lockedPh;
    applyHighlight(lockedPh);
    document.querySelectorAll('.ph-active').forEach(el => el.classList.add('ph-locked'));
  } else {
    lockedPh = null;
    activePh = null;
  }
}

function activatePhoneme(ph) {
  if (!ph || lockedPh || activePh === ph) return;
  activePh = ph;
  applyHighlight(ph);
}

function deactivatePhoneme() {
  if (lockedPh) return;
  activePh = null;
  clearHighlight();
}

function toggleLock(ph) {
  if (lockedPh === ph) {
    lockedPh = null;
    activePh = null;
    clearHighlight();
  } else {
    lockedPh = ph;
    lockedRes = lastResult;
    activePh = ph;
    clearHighlight();
    applyHighlight(ph);
    document.querySelectorAll('.ph-active').forEach(el => el.classList.add('ph-locked'));
  }
}

document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-ph]');
  if (el?.dataset.ph) activatePhoneme(el.dataset.ph);
});

document.addEventListener('mouseout', e => {
  if (!e.target.closest('[data-ph]')) return;
  if (!e.relatedTarget?.closest('[data-ph]')) deactivatePhoneme();
});

document.addEventListener('click', e => {
  // 1. Atelier chip → insérer au curseur
  const ac = e.target.closest('#atelierResults .atelier-chip');
  if (ac) {
    const ta = document.getElementById('input');
    ta.setRangeText(ac.dataset.word, ta.selectionStart, ta.selectionEnd, 'end');
    ta.focus(); updateCount();
    toast(`"${ac.dataset.word}" inséré`);
    return;
  }
  // 2. Clic dans le popover → géré par son propre listener
  if (e.target.closest('#suggest-popover')) return;
  // 3. Bouton ✦ → géré par openSuggest
  if (e.target.closest('.btn-suggest')) return;
  // 4. Clic sur un mot dans un vers → ouvrir suggestions contextuelles pour ce mot
  const wordEl = e.target.closest('.v-text .rw, .v-text .rw-int, .v-text .rw-plain');
  if (wordEl && lastResult) {
    const verseLine = wordEl.closest('[data-line-index]');
    const lineIndex = parseInt(verseLine?.dataset.lineIndex ?? '-1');
    const wordIndex = parseInt(wordEl.dataset.wordIndex);
    const word = lineIndex >= 0 ? spokenWord(lineIndex, wordIndex) : '';
    if (word.length >= 3) {
      popoverState = suggestState(lineIndex, wordIndex);
      openContextualPopover(wordEl.getBoundingClientRect(), lineIndex, word);
      return;
    }
  }
  // 5. Clic ailleurs → fermer le popover
  closePopover();
  // 6. Lock/unlock phonème
  const el = e.target.closest('[data-ph]');
  if (el?.dataset.ph) toggleLock(el.dataset.ph);
  else if (lockedPh) { lockedPh = null; activePh = null; clearHighlight(); }
});

// ── Resize columns ──
(function () {
  const handle = document.getElementById('resizeHandle');
  const main = document.querySelector('main');
  if (!handle || !main) return;

  let dragging = false;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const { left, width } = main.getBoundingClientRect();
    const pct = Math.min(Math.max((e.clientX - left) / width * 100, 20), 80);
    main.style.gridTemplateColumns = `${pct}fr 4px ${100 - pct}fr`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();
