// ── Couleurs : classes k0..k7 → --col0..7 ──
const N_COLS = 8;
const kc = ci => `k${ci % N_COLS}`;

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
const MARK_CLASS = { end: 'e', asso: 's', int: 'n', fam: 'f' };
const MARK_NAMES = { end: 'fin de vers', asso: 'assonance de fin', int: 'rime interne', fam: 'famille interne' };
const VOW_CLASS = { a: 'va', 'é': 've', i: 'vi', o: 'vo', ou: 'vou', u: 'vu', eu: 'veu', an: 'van', in: 'vin', on: 'von' };
const ROW_NOTES = {
  comment: 'Titre ou commentaire, ignoré par l\'analyse.',
  section: 'Section, ignorée par l\'analyse : elle coupe la strophe et les rimes internes.',
  adlib: 'Adlib, ignoré par l\'analyse.',
  blank: 'Ligne vide : elle sépare les strophes.',
};

// Éditeur : hauteur d'une ligne (--row) ; la bande auto laisse au texte au moins MIN_TEXT
const ROW = 32;
const MIN_STRIP = 150, MAX_STRIP = 760, MIN_TEXT = 360;

const $ = id => document.getElementById(id);
const ta = $('input'), editor = $('editor'), mirror = $('mirror'), gutter = $('gutter'), strip = $('strip'), metaCol = $('meta');

// ── Préférences et textes, par navigateur ──
function stored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

// Sur petit écran, bande et panneau sont masqués d'abord : le texte garde la place
const wide = window.innerWidth > 760;
const prefs = { mode: 'all', flow: wide, vow: false, rail: wide, strip: null, ...stored('rime-prefs', {}) };
const savePrefs = () => store('rime-prefs', prefs);

// Textes sauvés : { id, text, updated } (updated en ms ; les anciennes entrées n'avaient que leur id)
let docs = stored('rime-history', []).map(d => ({ id: d.id, text: d.text, updated: d.updated ?? d.id }));
const doc = { id: null, text: '', ...stored('rime-current', {}) };   // texte ouvert, même non sauvé

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

const typeMemo = new Map();
function rowType(line) {
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
function tokenOffsets(line) {
  return [...line.matchAll(/\S+/g)].map(m => ({ from: m.index, to: m.index + m[0].length }));
}

// Mot prononcé d'un vers analysé : « paradis(merde) » → « paradis »
function spokenWord(lineIndex, wordIndex, res = lastResult) {
  return cleanWord(spokenTokens(res.lines[lineIndex])[wordIndex]);
}

function endWordOf(i, res = lastResult) {
  const info = res.info[i];
  return info.end === null ? '' : spokenWord(i, info.end, res);
}

// Titre d'un texte : sa première ligne « # … » avant le premier vers ; sinon, hors strict, son premier vers
function docTitle(text, strict = false) {
  const first = text.split('\n').find(l => ['comment', 'verse'].includes(rowType(l))) || '';
  if (rowType(first) === 'comment') return first.trim().replace(/^#+\s*/, '');
  return strict ? '' : first.trim();
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
  const text = ta.value;
  const sent = text.split('\n');
  lastRequested = text;
  const seq = ++analyzeSeq;
  if (!sent.some(l => l.trim())) {
    setResult(null);
    return;
  }
  setStatus('Analyse…');
  let data;
  try {
    data = await fetchAnalysis(sent);
  } catch (e) {
    if (seq === analyzeSeq) {
      lastRequested = null;
      setStatus('Analyse indisponible');
      toast(e.message === 'HTTP 413' ? 'Texte trop long pour l\'analyse' : 'Serveur d\'analyse injoignable');
    }
    return;
  }
  if (seq !== analyzeSeq) return;
  if (!data.rows || data.lines.some(l => !l.cells)) { toast('Version obsolète — recharge la page (Ctrl+F5)'); return; }
  if (data.rows.length < sent.length) toast(`Analyse limitée aux ${data.lines.length} premiers vers`);

  // groups : rimes de fin + familles de rimes internes ; groupList : rimes de fin seulement
  const groups = Object.fromEntries([...data.groups, ...data.families].map(g => [g.key, g]));
  // famOf : familles de chaque mot (« vers:mot »), car une fin en assonance peut aussi être membre d'une famille
  const famOf = new Map();
  data.families.forEach(f => f.members.forEach(([v, w]) => {
    const k = `${v}:${w}`;
    famOf.set(k, [...(famOf.get(k) || []), f.key]);
  }));
  const rowKeys = data.lines.map(() => new Set());
  data.lines.forEach((l, v) => [l.group, ...l.internal.map(it => it.group)].forEach(k => k && rowKeys[v].add(k)));
  data.families.forEach(f => f.members.forEach(([v]) => rowKeys[v].add(f.key)));
  setResult({
    ...data, sent, groups, groupList: data.groups, info: data.lines, famOf,
    rowKeys: rowKeys.map(s => [...s].join(' ')),
    lines: data.lines.map(l => sent[l.row].trim()),
  });
}

function setResult(res) {
  lastResult = res;
  if (res) colorFamilies();
  rowMemo.clear();
  setStatus(res ? 'Analyse en direct' : '');
  renderEditor();
  layoutStrip();
  renderRail();
  restoreLock();
  renderCurrent();
}

// Couleur d'une famille interne : de préférence une couleur qu'aucune rime de fin n'utilise,
// sinon une couleur absente des vers que la famille touche (±1)
function colorFamilies() {
  const { info, groups, groupList, families } = lastResult;
  const used = info.map(() => new Set());
  const mark = (v, ci) => [v - 1, v, v + 1].forEach(j => used[j]?.add(ci % N_COLS));
  info.forEach((l, v) => { if (groups[l.group]) mark(v, groups[l.group].ci); });
  const endCols = new Set(groupList.map(g => g.ci % N_COLS));
  const order = [...Array(N_COLS).keys()].sort((a, b) => endCols.has(a) - endCols.has(b));
  families.forEach((f, idx) => {
    const verses = [...new Set(f.members.map(([v]) => v))];
    const busy = new Set(verses.flatMap(v => [...used[v]]));
    f.ci = order.find(c => !busy.has(c)) ?? (groupList.length + idx) % N_COLS;
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

function levelName(info) {
  if (info.kind === 'asso') return 'assonance';
  if (!info.level) return info.end === null ? 'aucune voyelle' : 'sans rime';
  return (info.level === 'multi' ? `multi ×${info.syl_match}` : LEVEL_NAMES[info.level]) + (info.exact ? '' : ' ≈');
}

// ── Éditeur : gouttière, miroir surligné sous la textarea, bande de flow, méta ──
let shown = [];          // lignes affichées
let shownTypes = [];
let match = [];          // pour chaque ligne : le vers de la dernière analyse dont elle reprend les surlignages, ou -1
const rowMemo = new Map();   // « vers \n ligne » → HTML du miroir, de la bande et de la méta ; vidé à chaque analyse

// Une ligne reprend l'analyse de la ligne analysée de même texte : même index, sinon la plus proche
function matchVerses(raw) {
  if (!lastResult) return raw.map(() => -1);
  const { sent, rows } = lastResult;
  let byText = null;
  return raw.map((line, i) => {
    let j = sent[i] === line ? i : -1;
    if (j < 0) {
      if (!byText) {
        byText = new Map();
        sent.forEach((l, k) => { if (rows[k]?.type === 'verse') byText.set(l, [...(byText.get(l) || []), k]); });
      }
      j = byText.get(line)?.reduce((a, b) => Math.abs(b - i) < Math.abs(a - i) ? b : a) ?? -1;
    }
    return j >= 0 && rows[j]?.type === 'verse' ? rows[j].verse : -1;
  });
}

function renderEditor() {
  const raw = ta.value.split('\n');
  const types = raw.map(rowType);
  match = matchVerses(raw);
  if (rowMemo.size > 4000) rowMemo.clear();
  const g = [], m = [], s = [], t = [];
  raw.forEach((line, i) => {
    const type = types[i], v = type === 'verse' ? match[i] : -1;
    const key = `${v}\n${line}`;
    let h = rowMemo.get(key);
    if (!h) rowMemo.set(key, h = { g: gutterLine(type, v), m: mirrorLine(line, type, v), s: stripLine(v), t: metaLine(v) });
    g.push(h.g); m.push(h.m); s.push(h.s); t.push(h.t);
  });
  patch(gutter, g); patch(mirror, m); patch(strip, s); patch(metaCol, t);
  shown = raw;
  shownTypes = types;
  ta.scrollTop = ta.scrollLeft = 0;
  renderCounts();
  updateCursor();
}

// Remplace seulement les rangées qui ont changé : préfixe et suffixe communs restent en place
function patch(el, rows) {
  const prev = el._rows || [];
  let a = 0, b = 0;
  while (a < rows.length && a < prev.length && rows[a] === prev[a]) a++;
  while (b < rows.length - a && b < prev.length - a && rows[rows.length - 1 - b] === prev[prev.length - 1 - b]) b++;
  for (let k = prev.length - b - 1; k >= a; k--) el.children[k].remove();
  const html = rows.slice(a, rows.length - b).join('');
  if (html) {
    if (el.children[a]) el.children[a].insertAdjacentHTML('beforebegin', html);
    else el.insertAdjacentHTML('beforeend', html);
  }
  el._rows = rows;
}

const rowAttr = v => v >= 0 ? ` data-phs="${escHtml(lastResult.rowKeys[v])}"` : '';

// Le numéro du vers vient d'un compteur CSS : insérer une ligne ne redessine pas les suivantes
function gutterLine(type, v) {
  if (type !== 'verse') return '<div class="row gr"></div>';
  const l = v >= 0 ? lastResult.info[v] : null;
  const g = l && lastResult.groups[l.group];
  const letter = g && prefs.mode !== 'text'
    ? `<span class="gl ${kc(g.ci)}${l.kind === 'asso' ? ' s' : ''}" data-tip="${escHtml(levelTitle(l, v))}">${escHtml(chipLabel(l, lastResult.groups))}</span>`
    : '<span></span>';
  return `<div class="row gr v"${rowAttr(v)}><span class="gn"></span>${letter}</div>`;
}

// Le texte brut est conservé à l'identique (espaces de tête, doubles, tabulations) ;
// seuls des styles sans effet sur la largeur sont posés, sinon le texte coloré se décale du curseur
function mirrorLine(line, type, v) {
  if (type !== 'verse') return `<div class="ml${type === 'blank' ? '' : ' x'}">${escHtml(line)}</div>`;
  const scan = scanTokens(line);
  const marks = v >= 0 && prefs.mode !== 'text' ? wordMarks(v) : null;
  let out = '', pos = 0, w = 0;
  for (const m of line.matchAll(/\S+/g)) {
    out += line.slice(pos, m.index) + tokenHtml(m[0], scan[w], marks?.get(w), w);
    pos = m.index + m[0].length;
    w++;
  }
  return `<div class="ml${v >= 0 ? ' v' : ''}"${rowAttr(v)}>${out}${line.slice(pos)}</div>`;
}

// Bords d'un mot : « (merde) » collé reste gris, la ponctuation reste neutre
const edge = s => !s ? '' : /[()[\]]/.test(s) ? `<span class="mu">${escHtml(s)}</span>` : escHtml(s);

function tokenHtml(tok, { spoken, span }, mark, w) {
  if (!spoken) return `<span class="mu">${escHtml(tok)}</span>`;
  if (!span) return escHtml(tok);
  const [a, b] = span;
  const word = escHtml(tok.slice(a, b));
  const inner = mark
    ? `<span class="${mark.cls}" data-w="${w}" data-k="${escHtml(mark.keys)}"${mark.tag ? ` data-tag="${escHtml(mark.tag)}"` : ''}>${word}</span>`
    : word;
  return edge(tok.slice(0, a)) + inner + edge(tok.slice(b));
}

// Mots surlignés d'un vers analysé : index du mot → { classes, clés de famille, label de famille }
function wordMarks(v) {
  const { info, groups } = lastResult;
  const l = info[v], marks = new Map();
  if (prefs.mode === 'all') l.internal.forEach(it => {
    const g = groups[it.group];
    marks.set(it.i, { cls: `${g.members ? 'f' : 'n'} ${kc(g.ci)}`, keys: it.group, tag: g.members ? g.label : '' });
  });
  const own = groups[l.group];
  if (own && l.end !== null) marks.set(l.end, { cls: `${l.kind === 'asso' ? 's' : 'e'} ${kc(own.ci)}`, keys: wordKeys(v, l.end, l.group) });
  return marks;
}

// Une fin de vers en assonance peut aussi être membre d'une famille interne
function wordKeys(v, w, key) {
  return [key, ...(lastResult.famOf.get(`${v}:${w}`) || [])].join(' ');
}

function stripLine(v) {
  if (v < 0) return '<div class="row sr"></div>';
  return `<div class="row sr v"${rowAttr(v)}>${lastResult.info[v].cells.map(c => cellHtml(c, v)).join('')}</div>`;
}

function cellHtml(c, v) {
  const m = prefs.mode === 'ends' && (c.m === 'int' || c.m === 'fam') ? '' : c.m;
  const base = `c ${VOW_CLASS[c.v] || ''}`;
  if (!m) return `<i class="${base}" data-s="${escHtml(c.s)}"></i>`;
  const keys = m === 'end' || m === 'asso' ? wordKeys(v, c.w, c.g) : c.g;
  return `<i class="${base} ${MARK_CLASS[m]} ${kc(lastResult.groups[c.g].ci)}" data-s="${escHtml(c.s)}" data-k="${escHtml(keys)}"></i>`;
}

function metaLine(v) {
  if (v < 0) return '<div class="row mr"></div>';
  const l = lastResult.info[v];
  const int = l.internal.length && prefs.mode === 'all'
    ? `<span class="mi" data-tip="${escHtml(internalSummary(l, v))}">↺${l.internal.length}</span>` : '';
  return `<div class="row mr v"${rowAttr(v)}><span class="ms">${l.syl}</span>${int}</div>`;
}

// ── Bande de flow : largeur, taille des cases, poignée ──
let stripW = 300;
const flowShown = () => prefs.flow && prefs.mode !== 'text';

function layoutStrip() {
  if (!flowShown()) return;
  // Place du texte et de la bande : la largeur de l'éditeur moins les colonnes fixes (gouttière, poignée, méta)
  const avail = $('textCol').offsetWidth + strip.offsetWidth;
  const max = Math.max(MIN_STRIP, Math.min(MAX_STRIP, avail - 160));
  // Largeur auto : le vers le plus long tient en entier
  stripW = Math.round(Math.min(max, Math.max(MIN_STRIP, prefs.strip ?? avail - Math.max(longestVerse(), MIN_TEXT) - 16)));
  const maxSyl = lastResult?.info.length ? Math.max(1, ...lastResult.info.map(l => l.cells.length)) : 12;
  const gap = stripW / maxSyl >= 14 ? 2 : 1;
  const cw = Math.max(5, Math.floor((stripW - (maxSyl - 1) * gap) / maxSyl));
  const s = editor.style;
  s.setProperty('--strip', `${stripW}px`);
  s.setProperty('--cw', `${cw}px`);
  s.setProperty('--cgap', `${gap}px`);
  s.setProperty('--cbw', cw < 10 ? '1px' : '1.5px');
  // Plus la bande est large, plus les cases en disent
  editor.dataset.zoom = cw >= 34 ? 'all' : cw >= 26 ? 'syl' : cw >= 15 ? 'vow' : 'none';
  $('flowHint').textContent = cw >= 26 ? 'Flow, une case par syllabe' : cw >= 15 ? 'Flow' : 'Rythme';
}

function longestVerse() {
  let w = 0;
  shownTypes.forEach((t, i) => { if (t === 'verse') w = Math.max(w, mirror.children[i].offsetWidth); });
  return w;
}

let drag = null;
function setStrip(w) {
  prefs.strip = w;
  layoutStrip();
}
[$('grip'), $('handleCol')].forEach(el => {
  el.addEventListener('pointerdown', e => {
    if (e.button) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, w: stripW };
    editor.classList.add('dragging');
  });
  el.addEventListener('pointermove', e => { if (drag) setStrip(drag.w - (e.clientX - drag.x)); });
  const end = () => {
    if (!drag) return;
    drag = null;
    editor.classList.remove('dragging');
    prefs.strip = stripW;
    savePrefs();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener('dblclick', () => { setStrip(null); savePrefs(); });
});
$('grip').addEventListener('keydown', e => {
  const step = e.shiftKey ? 60 : 20;
  if (e.key === 'ArrowLeft') setStrip(stripW + step);
  else if (e.key === 'ArrowRight') setStrip(stripW - step);
  else if (e.key === 'Home') setStrip(null);
  else return;
  e.preventDefault();
  if (prefs.strip !== null) prefs.strip = stripW;
  savePrefs();
});

// ── Vers courant ──
let curRow = -1, lastCaret = null;

const caretPos = () => ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;

function lineStart(row) {
  let p = 0;
  for (let k = 0; k < row; k++) p += shown[k].length + 1;
  return p;
}

function updateCursor(force = false) {
  const pos = caretPos();
  if (!force && lastCaret && lastCaret.pos === pos && lastCaret.value === ta.value) return;
  lastCaret = { pos, value: ta.value };
  let row = 0;
  for (let i = ta.value.indexOf('\n'); i >= 0 && i < pos; i = ta.value.indexOf('\n', i + 1)) row++;
  curRow = row;
  $('curBand').style.transform = `translateY(${row * ROW}px)`;
  renderCurrent();
}

// Mot à rimer : celui sous le curseur, sinon la fin du vers
function caretTarget() {
  const line = shown[curRow];
  if (shownTypes[curRow] !== 'verse') return null;
  const col = caretPos() - lineStart(curRow);
  const scan = scanTokens(line), offs = tokenOffsets(line);
  let w = offs.findIndex(o => col >= o.from && col <= o.to);
  if (w < 0 || !scan[w].span) {
    const v = match[curRow];
    w = v >= 0 ? lastResult.info[v].end ?? -1 : scan.findLastIndex(t => t.span);
  }
  const word = w >= 0 && scan[w].span ? cleanWord(scan[w].spoken) : '';
  if (!word) return null;
  const [a, b] = scan[w].span;
  return { row: curRow, w, word, line, from: offs[w].from + a, to: offs[w].from + b };
}

function verseNumber(row) {
  let n = 0;
  for (let i = 0; i <= row; i++) n += shownTypes[i] === 'verse';
  return n;
}

function setHtml(el, html) {
  if (el._html !== html) el.innerHTML = el._html = html;
}

function renderCurrent(force = false) {
  const type = shownTypes[curRow] ?? 'blank';
  const v = type === 'verse' ? match[curRow] : -1;
  const l = v >= 0 ? lastResult.info[v] : null;
  const g = l && lastResult.groups[l.group];
  const rime = $('curRime');
  rime.className = `cur-rime${g ? ` ${kc(g.ci)}${l.kind === 'asso' ? ' s' : ''}` : ''}`;
  rime.textContent = g ? l.rime + (l.guess ? '?' : '') : '';
  $('curLevel').textContent = l ? levelName(l) : '';
  $('curLevel').dataset.tip = l ? levelTitle(l, v) : '';
  let links;
  if (!ta.value.trim()) {
    $('curTitle').textContent = 'Vers';
    links = note('Écris ou colle des paroles : l\'analyse se fait en direct.');
  } else if (type !== 'verse') {
    $('curTitle').textContent = `Ligne ${curRow + 1}`;
    links = note(ROW_NOTES[type]);
  } else {
    $('curTitle').textContent = `Vers ${verseNumber(curRow)}`;
    links = l ? verseLinks(l, v) : note(lastResult ? 'Modifié, analyse dans un instant…' : 'Analyse dans un instant…');
  }
  setHtml($('curLinks'), links);
  updateSuggestions(type === 'verse' ? caretTarget() : null, force);
}

const note = text => `<p class="link">${escHtml(text)}</p>`;

// Ce qui rime : partenaires de fin, puis rimes internes du vers
function verseLinks(l, v) {
  const { groups } = lastResult;
  const out = [];
  const g = groups[l.group];
  if (g) {
    const others = [...g.lines, ...g.asso].filter(j => j !== v).sort((a, b) => a - b);
    const words = others.slice(0, 6).map(j => `${endWordOf(j)} (v.${j + 1})`).join(', ') + (others.length > 6 ? '…' : '');
    out.push(link(g, chipLabel(l, groups), `${l.kind === 'asso' ? 'Assonance de fin avec' : 'Fin de vers, rime avec'} ${words}`));
  }
  l.internal.forEach(it => {
    const [pv, pw] = it.with;
    out.push(link(groups[it.group], groups[it.group].label,
      `${spokenWord(v, it.i)} rime avec ${spokenWord(pv, pw)}${pv === v ? ' dans le même vers' : ` (v.${pv + 1})`}`));
  });
  return out.join('') || note(l.end === null ? 'Pas de voyelle : pas de rime possible.' : 'Pas de rime détectée pour ce vers.');
}

const link = (g, mark, text) =>
  `<p class="link"><span class="link-mark ${kc(g.ci)}${g.members ? ' f' : ''}" data-k="${escHtml(g.key)}">${escHtml(mark)}</span> ${escHtml(text)}</p>`;

// Rimes proposées pour le mot visé ; shownKey : le mot pour lequel les pastilles affichées ont été calculées
let sugKey = null, shownKey = null, sugSeq = 0, sugTimer = null;

function updateSuggestions(t, force) {
  const key = t ? t.word.toLowerCase() : null;
  if (key === sugKey && !force) return;
  sugKey = key;
  const seq = ++sugSeq;
  clearTimeout(sugTimer);
  const el = $('curSug');
  if (!t) { shownKey = null; setHtml(el, ''); return; }
  sugTimer = setTimeout(async () => {
    const data = await fetchRhymes(t.word, { n: 12 });
    if (seq !== sugSeq) return;
    const has = data && (Object.values(data.levels).some(x => x.length) || data.asso.length);
    shownKey = key;
    setHtml(el, `<h3 class="sug-title">Rimes pour « ${escHtml(t.word)} »</h3>`
      + (has ? suggestionChips(data, 'chip', { perLevel: 8, exclude: key }) : '<p class="empty-note">Aucune rime trouvée</p>'));
  }, 150);
}

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
  return sections.map(({ lvl, items }) => `<div class="sug-level">
      <div class="sug-level-name">${LEVEL_NAMES[lvl]}<span class="level-hint">${LEVEL_HINTS[lvl]}</span></div>
      ${items.map(it => {
        const cls = [chipClass, `lvl-${lvl}`, it.approx ? 'approx' : '', it.derived ? 'derived' : ''].filter(Boolean).join(' ');
        const title = lvl === 'asso'
          ? `${it.syl} voyelle${it.syl > 1 ? 's' : ''} en commun · ${it.n} syll. · ${it.cat}`
          : `${it.k} phonème${it.k > 1 ? 's' : ''} en commun${it.approx ? ' (approximatif)' : ''}${it.derived ? ' · même famille' : ''} · ${it.n} syll. · ${it.cat}`;
        return `<button class="${cls}" data-word="${escHtml(it.w)}" data-tip="${escHtml(title)}">${escHtml(it.w)}</button>`;
      }).join('')}
    </div>`).join('');
}

// Remplace le mot visé par une suggestion, par la pile d'annulation du navigateur (Ctrl+Z fonctionne).
// Garde-fou : le mot visé maintenant doit être celui pour lequel les suggestions ont été calculées.
function replaceWord(newWord) {
  const t = caretTarget();
  if (!t || t.word.toLowerCase() !== shownKey) {
    toast('Le texte a changé — choisis à nouveau');
    renderCurrent(true);
    return;
  }
  const start = lineStart(t.row);
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(start + t.from, start + t.to);
  insertText(newWord);
}

function insertText(text) {
  if (!document.execCommand('insertText', false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }
}

function insertWord(word) {
  ta.focus({ preventScroll: true });
  insertText(word);
  toast(`« ${word} » inséré`);
}

// ── Chercher une rime ──
let searchSeq = 0;

async function searchRhymes() {
  const word = $('searchInput').value.trim();
  const el = $('searchResults');
  const seq = ++searchSeq;
  if (!word) { el.innerHTML = ''; return; }
  el.innerHTML = '<p class="empty-note search-head">Recherche…</p>';
  const data = await fetchRhymes(word, { n: 40, syl: $('searchSyl').value, cat: $('searchCat').value });
  if (seq !== searchSeq) return;
  if (!data || !(Object.values(data.levels).some(l => l.length) || data.asso.length)) {
    el.innerHTML = '<p class="empty-note search-head">Aucune rime trouvée</p>';
    return;
  }
  el.innerHTML = `<div class="search-head">
      « ${escHtml(word)} » se prononce <em>${escHtml(data.display)}</em> · rime en <em>${escHtml(data.rime)}</em>
      ${data.guess ? '<span class="search-guess">prononciation devinée</span>' : ''} — clic pour insérer au curseur
    </div>${suggestionChips(data, 'chip', { perLevel: 24 })}`;
}

$('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') searchRhymes(); });
$('searchInput').addEventListener('input', e => { if (!e.target.value.trim()) searchRhymes(); });
$('searchSyl').addEventListener('change', searchRhymes);
$('searchCat').addEventListener('change', searchRhymes);

// ── Panneau : schéma, familles, sons ; pied ──
function renderRail() {
  renderScheme();
  renderFams();
  renderSounds();
  renderStats();
}

function renderScheme() {
  if (!lastResult?.info.length) { setHtml($('scheme'), '<span class="empty-note">—</span>'); return; }
  const { info, groups } = lastResult;
  let html = '';
  info.forEach((l, i) => {
    if (!i || l.stanza !== info[i - 1].stanza) html += `${i ? '</span>' : ''}<span class="stanza">`;
    const g = groups[l.group];
    const tip = escHtml(`Vers ${i + 1} · ${levelTitle(l, i)}`);
    html += g
      ? `<span class="sl ${kc(g.ci)}${l.kind === 'asso' ? ' s' : ''}" data-k="${escHtml(g.key)}" data-tip="${tip}">${escHtml(chipLabel(l, groups))}</span>`
      : `<span class="sl none" data-tip="${tip}">·</span>`;
  });
  setHtml($('scheme'), html + '</span>');
}

function renderFams() {
  if (!lastResult) { setHtml($('fams'), '<span class="empty-note">—</span>'); return; }
  const { groupList, families, info } = lastResult;
  const intCount = {};
  info.forEach(l => l.internal.forEach(it => { intCount[it.group] = (intCount[it.group] || 0) + 1; }));
  const chip = (key, ci, mark, markCls, display, title) =>
    `<button class="fam ${kc(ci)}" data-k="${escHtml(key)}" aria-pressed="${lockedPh === key}" data-tip="${escHtml(title)}"><span class="fam-mark ${markCls}">${escHtml(mark)}</span>${escHtml(display)}</button>`;
  setHtml($('fams'), groupList.map(g => {
    const n = g.lines.length + g.asso.length;
    const levels = Object.entries(g.levels).sort((a, b) => b[1] - a[1]).map(([lvl, c]) => `${c} ${LEVEL_NAMES[lvl]}`).join(', ');
    const title = g.type === 'rime'
      ? `Rime ${g.label} en « ${g.display} » : ${n} vers${levels ? ` (${levels})` : ''}${g.asso.length ? `, dont ${g.asso.length} en assonance` : ''}${intCount[g.key] ? `, ${intCount[g.key]} en interne` : ''}`
      : `Assonance ${g.label.toLowerCase()} en « ${g.display} » : ${n} vers`;
    return chip(g.key, g.ci, g.type === 'rime' ? g.label : g.label.toLowerCase(), g.type === 'rime' ? 'e' : 's', g.display, title);
  }).join('') + families.map(f =>
    chip(f.key, f.ci, f.label, 'f', f.display, `Famille interne ${f.label} : ${[...new Set(f.members.map(([v, w]) => spokenWord(v, w)))].join(' ~ ')}`)
  ).join('') || '<span class="empty-note">Aucune rime pour l\'instant</span>');
}

function renderSounds() {
  if (!lastResult) { setHtml($('sounds'), '<p class="empty-note">—</p>'); return; }
  const { vowels, consonants } = lastResult.sounds;
  const hot = [...vowels, ...consonants].filter(s => s.ratio !== null && s.ratio >= 1.4).sort((a, b) => b.ratio - a.ratio).slice(0, 8);
  if (!hot.length) { setHtml($('sounds'), '<p class="empty-note">Aucun son ne revient plus qu\'en français courant.</p>'); return; }
  const top = hot[0].ratio;
  setHtml($('sounds'), hot.map(s => `<div class="sound" data-tip="${escHtml(`${Math.round(s.share * 100)} % des sons du texte, ×${s.ratio.toFixed(1)} par rapport au français courant · ${s.words.join(', ')}`)}">
      <span class="sound-name">${escHtml(s.sound)}</span>
      <span class="sound-track"><span class="sound-bar" style="width:${Math.max(6, Math.round((s.ratio - 1) / (top - 1 || 1) * 100))}%"></span></span>
      <span class="sound-ratio">×${s.ratio.toFixed(1).replace('.', ',')}</span>
    </div>`).join(''));
}

function renderCounts() {
  const n = shownTypes.filter(t => t === 'verse').length;
  const ignored = shownTypes.filter(t => t === 'comment' || t === 'section' || t === 'adlib').length;
  $('statVerses').textContent = `${n} vers`;
  $('statIgnored').textContent = ignored ? `${ignored} ligne${ignored > 1 ? 's' : ''} ignorée${ignored > 1 ? 's' : ''}` : '';
}

function renderStats() {
  const info = lastResult?.info || [];
  const internal = info.reduce((a, l) => a + l.internal.length, 0);
  $('statSyl').textContent = info.length ? `${Math.round(info.reduce((a, l) => a + l.syl, 0) / info.length)} syllabes en moyenne` : '';
  $('statInt').textContent = info.length ? `${internal} rime${internal > 1 ? 's' : ''} interne${internal > 1 ? 's' : ''}` : '';
}

function renderLegend() {
  $('legend').innerHTML = prefs.vow
    ? Object.entries(VOW_CLASS).map(([v, cls]) => `<i class="c ${cls}" data-s="${v}"></i>`).join('')
    : '<span><i class="c e k0" data-s="di"></i>fin de vers</span><span><i class="c n k0" data-s="kro"></i>interne</span><span><i class="c f k6" data-s="rid"></i>famille</span>';
}

function setStatus(text) {
  $('status').textContent = text || 'phonétique Lexique 3.83';
}

// ── Bascules de l'en-tête ──
function applyPrefs() {
  editor.dataset.mode = prefs.mode;
  editor.classList.toggle('no-flow', !flowShown());
  editor.classList.toggle('vowels', prefs.vow && flowShown());
  document.querySelectorAll('.seg [data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === prefs.mode));
  $('flowBtn').setAttribute('aria-pressed', prefs.flow);
  $('vowBtn').setAttribute('aria-pressed', prefs.vow && flowShown());
  $('vowBtn').disabled = !flowShown();
  document.querySelector('.body').classList.toggle('no-rail', !prefs.rail);
  $('railBtn').setAttribute('aria-pressed', prefs.rail);
  renderLegend();
}

function prefsChanged(rerender = false) {
  savePrefs();
  applyPrefs();
  if (rerender) {
    rowMemo.clear();
    renderEditor();
  }
  layoutStrip();
}

document.querySelectorAll('.seg [data-mode]').forEach(b => b.addEventListener('click', () => {
  prefs.mode = b.dataset.mode;
  prefsChanged(true);
}));
$('flowBtn').addEventListener('click', () => { prefs.flow = !prefs.flow; prefsChanged(); });
$('vowBtn').addEventListener('click', () => { prefs.vow = !prefs.vow; prefsChanged(); });
$('railBtn').addEventListener('click', () => { prefs.rail = !prefs.rail; prefsChanged(); });

// ── Menus ──
function toggleMenu(btn) {
  const menu = $(btn.getAttribute('aria-controls'));
  const open = menu.hidden;
  closeMenus();
  if (!open) return;
  if (menu.id === 'docMenu') renderDocList();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
}

function closeMenus() {
  document.querySelectorAll('.menu').forEach(m => { m.hidden = true; });
  document.querySelectorAll('[aria-controls]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

// ── Textes sauvés : un texte = une entrée ──
function isDirty() {
  const saved = docs.find(d => d.id === doc.id);
  return saved ? saved.text !== ta.value : !!ta.value.trim();
}

function renderDocState() {
  const saved = docs.find(d => d.id === doc.id);
  const state = saved ? (saved.text === ta.value ? 'Enregistré' : 'Modifié') : ta.value.trim() ? 'Non enregistré' : '';
  $('docState').textContent = state;
  $('docState').classList.toggle('dirty', state === 'Modifié' || state === 'Non enregistré');
  const title = docTitle(ta.value, true);
  $('docTitle').textContent = title || 'Sans titre';
  document.title = title ? `${title} — Rime` : 'Rime — Analyse de schémas de rimes';
}

function renderDocList() {
  $('docList').innerHTML = docs.map(d => `
    <div class="doc-item${d.id === doc.id ? ' current' : ''}">
      <button class="doc-open" onclick="openDoc(${d.id})">
        <span class="doc-name">${escHtml(docTitle(d.text) || 'Sans titre')}</span>
        <span class="doc-meta">${new Date(d.updated).toLocaleDateString('fr')} · ${d.text.split('\n').filter(l => rowType(l) === 'verse').length} vers</span>
      </button>
      <button class="doc-del" onclick="deleteDoc(${d.id})" aria-label="Supprimer ce texte">×</button>
    </div>`).join('') || '<p class="menu-empty">Aucun texte sauvé pour l\'instant.</p>';
}

function saveDoc() {
  const text = ta.value;
  if (!text.trim()) { toast('Rien à sauver'); return; }
  const item = { id: doc.id ?? Date.now(), text, updated: Date.now() };
  // Pas de plafond : seul le quota du navigateur limite le nombre de textes sauvés
  const next = [item, ...docs.filter(d => d.id !== item.id)];
  if (!store('rime-history', next)) { toast('Stockage du navigateur plein ou bloqué : supprime d\'anciens textes'); return; }
  docs = next;
  doc.id = item.id;
  persistDraft();
  renderDocState();
  toast('Texte enregistré ✓');
}

function newDoc() {
  if (isDirty() && !confirm('Le texte en cours n\'est pas enregistré. Commencer un nouveau texte quand même ?')) return;
  setText('', null);
  ta.focus();
}

function openDoc(id) {
  const item = docs.find(d => d.id === id);
  if (!item || id === doc.id && !isDirty()) return;
  if (isDirty() && !confirm('Le texte en cours n\'est pas enregistré. L\'abandonner pour ouvrir celui-ci ?')) return;
  setText(item.text, id);
}

function deleteDoc(id) {
  const item = docs.find(d => d.id === id);
  if (!item || !confirm(`Supprimer « ${docTitle(item.text) || 'Sans titre'} » des textes sauvés ?`)) return;
  docs = docs.filter(d => d.id !== id);
  store('rime-history', docs);
  if (doc.id === id) { doc.id = null; persistDraft(); }
  renderDocList();
  renderDocState();
}

function setText(text, id) {
  doc.id = id;
  ta.value = text;
  ta.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  persistDraft();
  renderDocState();
  analyzeSeq++;
  setResult(null);
  if (text.trim()) analyze();
}

let draftTimer = null;
function persistDraft() {
  clearTimeout(draftTimer);
  store('rime-current', { id: doc.id, text: ta.value });
}
addEventListener('pagehide', persistDraft);

// Sauvegarde de tous les textes sauvés, réimportable
function exportAll() {
  if (!docs.length) { toast('Aucun texte sauvé à exporter'); return; }
  const now = new Date();
  download(`rime-textes-${now.toISOString().slice(0, 10)}.json`,
    JSON.stringify({ app: 'rime', version: 1, exported: now.toISOString(), texts: docs }, null, 2), 'application/json');
}

// Importe des sauvegardes Rime (.json) et des paroles (.txt) dans les textes sauvés.
// Rien n'est jamais écrasé : un texte déjà sauvé à l'identique est ignoré, un id déjà pris est remplacé.
async function importFiles(files) {
  const found = [], unreadable = [];
  for (const f of files) {
    const raw = (await f.text()).replace(/\r\n?/g, '\n');
    if (!/\.json$/i.test(f.name)) { found.push({ text: raw }); continue; }
    try {
      const data = JSON.parse(raw);
      if (data?.app !== 'rime' || !Array.isArray(data.texts)) throw new Error();
      data.texts.forEach(t => { if (typeof t?.text === 'string') found.push({ ...t, text: t.text.replace(/\r\n?/g, '\n') }); });
    } catch {
      unreadable.push(f.name);
    }
  }
  const texts = new Set(docs.map(d => d.text)), ids = new Set(docs.map(d => d.id));
  let fresh = Date.now();
  const added = [];
  for (const t of found) {
    if (!t.text.trim() || texts.has(t.text)) continue;
    texts.add(t.text);
    let id = Number.isSafeInteger(t.id) && !ids.has(t.id) ? t.id : null;
    while (id === null || ids.has(id)) id = fresh++;
    ids.add(id);
    added.push({ id, text: t.text, updated: Number.isFinite(t.updated) ? t.updated : Date.now() });
  }
  const skipped = found.length - added.length;
  const note = [skipped && `${skipped} déjà présent${skipped > 1 ? 's' : ''} ou vide${skipped > 1 ? 's' : ''}`,
    unreadable.length && `illisible : ${unreadable.join(', ')}`].filter(Boolean).join(' · ');
  if (!added.length) { toast(`Rien de nouveau à importer${note ? ` (${note})` : ''}`); return; }
  const next = [...added, ...docs].sort((a, b) => b.updated - a.updated);
  if (!store('rime-history', next)) { toast('Stockage du navigateur plein ou bloqué : supprime d\'anciens textes'); return; }
  docs = next;
  renderDocState();
  toast(`${added.length} texte${added.length > 1 ? 's' : ''} importé${added.length > 1 ? 's' : ''}${note ? ` (${note})` : ''}`);
  if (added.length === 1) openDoc(added[0].id);
}

$('importInput').addEventListener('change', async e => {
  await importFiles([...e.target.files]);
  e.target.value = '';
});

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

function copyReport() {
  if (!lastResult) { toast('Rien à exporter'); return; }
  navigator.clipboard.writeText(buildReport()).then(() => toast('Rapport copié ✓'), () => toast('Copie refusée par le navigateur'));
}

function downloadReport() {
  if (!lastResult) { toast('Rien à exporter'); return; }
  download(`${fileStem(ta.value)}-rapport.txt`, buildReport());
}

function downloadText() {
  if (!ta.value.trim()) { toast('Rien à exporter'); return; }
  download(`${fileStem(ta.value)}.txt`, ta.value);
}

// Feuille de partage du système : Notes, Mail, Drive… selon l'appareil.
// Sans elle (Firefox sur ordinateur…), le texte est copié pour être collé ailleurs.
async function shareText() {
  if (!ta.value.trim()) { toast('Rien à partager'); return; }
  if (navigator.share) {
    try {
      await navigator.share({ title: docTitle(ta.value) || 'Rime', text: ta.value });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  navigator.clipboard.writeText(ta.value).then(
    () => toast('Partage indisponible ici : texte copié, colle-le où tu veux'),
    () => toast('Partage et copie refusés par le navigateur'));
}

// Nom de fichier tiré du titre : « Coûts irrécupérables » → « couts-irrecuperables »
function fileStem(text) {
  return docTitle(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'rime-texte';
}

function download(name, content, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function toast(msg) {
  let el = $('toast');
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
  if (ta.value !== lastRequested) analyze();
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

ta.addEventListener('input', () => {
  hideTip();
  renderEditor();
  renderDocState();
  scheduleAnalyze();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 400);
});
ta.addEventListener('blur', immediateAnalyze);
// La textarea fait la hauteur et la largeur de son texte : elle ne défile jamais elle-même
ta.addEventListener('scroll', () => { ta.scrollTop = ta.scrollLeft = 0; });
ta.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); clearTimeout(analyzeTimer); analyze(); }
});
document.addEventListener('selectionchange', () => { if (document.activeElement === ta) updateCursor(); });
['keyup', 'mouseup', 'focus'].forEach(ev => ta.addEventListener(ev, () => updateCursor()));

// ── Survol, focus et verrou d'une famille ──
let activePh = null;
let lockedPh = null;
let lockedRes = null;   // analyse sur laquelle le verrou a été posé

// Une famille (rime de fin ou interne) : ses vers restent nets, ses mots et ses cases sont entourés.
// Une seule règle CSS générée, qui survit aux redessins de l'éditeur.
function applyHighlight(ph) {
  if (!ph) { $('focusStyle').textContent = ''; return; }
  const k = `"${ph.replace(/["\\]/g, '\\$&')}"`;
  $('focusStyle').textContent = `
    :is(.row, .ml).v:not([data-phs~=${k}]) { opacity: .4; }
    .mirror [data-k]:not([data-k~=${k}]), .col-strip .c:not([data-k~=${k}]), .rail [data-k]:not([data-k~=${k}]) { opacity: .3; }
    .mirror [data-k~=${k}], .col-strip .c[data-k~=${k}] { box-shadow: 0 0 0 1.5px var(--c); }`;
}

function setLock(ph) {
  lockedPh = ph;
  lockedRes = lastResult;
  activePh = ph;
  applyHighlight(ph);
  document.querySelectorAll('.fam').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === ph));
}

// Après une analyse : le verrou tient s'il vise une rime de fin, ou une famille interne de la même
// analyse (leurs clés sont des numéros qui changent d'une analyse à l'autre)
function restoreLock() {
  const g = lockedPh && lastResult?.groups[lockedPh];
  setLock(g && (!g.members || lockedRes === lastResult) ? lockedPh : null);
}

function activatePhoneme(ph) {
  if (!ph || lockedPh || activePh === ph) return;
  activePh = ph;
  applyHighlight(ph);
}

function deactivatePhoneme() {
  if (lockedPh || !activePh) return;
  activePh = null;
  applyHighlight(null);
}

// ── Infobulles ──
const tip = $('tip');
let tipTimer = null, hoverEl = null;

function setHover(el) {
  if (el === hoverEl) return;
  hoverEl = el;
  const key = el?.dataset.k?.split(' ')[0];
  if (key) activatePhoneme(key);
  else deactivatePhoneme();
  hideTip();
  const text = el && tipText(el);
  if (text) tipTimer = setTimeout(() => showTip(el, text), 250);
}

// Mot du miroir sous le pointeur : la textarea capte la souris, le miroir est dessous
function mirrorWordAt(x, y) {
  return document.elementsFromPoint(x, y).find(el => el.dataset?.w !== undefined && mirror.contains(el)) || null;
}

const indexIn = (parent, child) => Array.prototype.indexOf.call(parent.children, child);

function tipText(el) {
  if (el.dataset.tip) return el.dataset.tip;
  if (!lastResult) return '';
  if (mirror.contains(el)) {
    const v = match[indexIn(mirror, el.parentElement)], w = +el.dataset.w;
    const l = lastResult.info[v];
    if (!l) return '';
    const it = l.internal.find(x => x.i === w);
    return w === l.end && l.group ? levelTitle(l, v) : it ? internalTitle(it, v) : '';
  }
  if (el.classList.contains('c')) {
    const row = el.parentElement;
    const c = lastResult.info[match[indexIn(strip, row)]]?.cells[indexIn(row, el)];
    if (!c) return '';
    if (prefs.vow) return `${c.s} · voyelle ${c.v}`;
    const m = el.dataset.k ? c.m : '';
    return m ? `${c.s} · ${MARK_NAMES[m]} ${lastResult.groups[c.g].label}` : c.s;
  }
  return '';
}

function showTip(el, text) {
  tip.textContent = text;
  tip.hidden = false;
  const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
  let top = r.bottom + 6;
  if (top + t.height > innerHeight - 8) top = r.top - t.height - 6;
  tip.style.top = `${top}px`;
  tip.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8)}px`;
}

function hideTip() {
  clearTimeout(tipTimer);
  tip.hidden = true;
}

document.addEventListener('mouseover', e => {
  if (e.target === ta) return;   // géré par mousemove
  setHover(e.target.closest?.('[data-k], [data-tip], .col-strip .c') || null);
});
ta.addEventListener('mousemove', e => setHover(mirrorWordAt(e.clientX, e.clientY)));
ta.addEventListener('mouseleave', () => setHover(null));
editor.addEventListener('scroll', hideTip, { passive: true });

// Les pastilles ne prennent pas le focus : la textarea garde son curseur
$('rail').addEventListener('mousedown', e => { if (e.target.closest('.chip')) e.preventDefault(); });

document.addEventListener('click', e => {
  const menuBtn = e.target.closest('[aria-controls]');
  if (menuBtn) { toggleMenu(menuBtn); return; }
  if (!e.target.closest('.menu') || e.target.closest('.menu-item, .doc-open')) closeMenus();
  const chip = e.target.closest('.chip');
  if (chip) {
    if (chip.closest('#curSug')) replaceWord(chip.dataset.word);
    else insertWord(chip.dataset.word);
    return;
  }
  // Clic sur une famille (panneau, bande) : l'isoler, ou la relâcher
  const k = e.target.closest('.rail [data-k], .col-strip .c[data-k]');
  if (k) setLock(lockedPh === k.dataset.k.split(' ')[0] ? null : k.dataset.k.split(' ')[0]);
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveDoc(); }
  else if (e.key === 'Escape') {
    closeMenus();
    hideTip();
    if (lockedPh) setLock(null);
  }
});

addEventListener('resize', () => layoutStrip());

// ── Démarrage : le dernier texte ouvert revient ──
(function init() {
  if (!docs.some(d => d.id === doc.id)) doc.id = null;
  ta.value = doc.text || '';
  applyPrefs();
  renderDocState();
  setResult(null);
  if (ta.value.trim()) analyze();
  document.fonts?.ready.then(() => layoutStrip());
})();
