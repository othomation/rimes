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
// stanza : rimes de strophe ; lib : panneau Textes ; libOpen : dossiers repliés (false) ; prodLoop : boucle des prods
// Le panneau Textes s'ouvre d'office sur un grand écran seulement : avec les deux panneaux, l'éditeur a besoin de place
const prefs = { mode: 'all', flow: wide, vow: false, rail: wide, strip: null, stanza: false, lib: window.innerWidth >= 1280, libOpen: {}, prodLoop: true, ...stored('rime-prefs', {}) };
const savePrefs = () => store('rime-prefs', prefs);

// Textes sauvés : { id, text, updated, folder, tags, prods, prod, drive, pending, metaPending, conflict }
// (updated en ms ; les anciennes entrées n'avaient que leur id). Tous les champs sont gardés au chargement.
let docs = stored('rime-history', []).map(d => ({ ...d, updated: d.updated ?? d.id }));
// Texte ouvert, même non sauvé ; pas encore sauvé, il porte lui-même son dossier, ses tags et ses prods
const doc = { id: null, text: '', folder: null, tags: [], prods: [], prod: null, ...stored('rime-current', {}) };
// Dossiers : { id, name, drive, pending } ; un texte est dans un dossier ou dans aucun
let folders = stored('rime-folders', []);
const saveFolders = () => store('rime-folders', folders);

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
    body: JSON.stringify({ lines, stanza: !!prefs.stanza }),
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
  return `Rime interne ${g.members ? 'famille ' : ''}${g.label} avec « ${spokenWord(pv, pw)} » (${where}) · ${quality}${it.exact ? '' : ' ≈'}${it.echo ? ' · rime de strophe' : ''}`;
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
  if (!flowShown() || vstate.open) return;   // éditeur masqué : rien à mesurer, refait à la sortie
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
      `${spokenWord(v, it.i)} rime avec ${spokenWord(pv, pw)}${pv === v ? ' dans le même vers' : ` (v.${pv + 1})`}`, it.echo));
  });
  return out.join('') || note(l.end === null ? 'Pas de voyelle : pas de rime possible.' : 'Pas de rime détectée pour ce vers.');
}

const link = (g, mark, text, echo = false) =>
  `<p class="link"><span class="link-mark ${kc(g.ci)}${g.members ? ' f' : ''}" data-k="${escHtml(g.key)}">${escHtml(mark)}</span> ${escHtml(text)}${echo ? ' <span class="link-tag" data-tip="Rime de strophe : reliée à une fin de vers de la strophe, à toute distance">strophe</span>' : ''}</p>`;

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
  const echoes = info.reduce((a, l) => a + l.internal.filter(it => it.echo).length, 0);
  $('statSyl').textContent = info.length ? `${Math.round(info.reduce((a, l) => a + l.syl, 0) / info.length)} syllabes en moyenne` : '';
  $('statInt').textContent = info.length ? `${internal} rime${internal > 1 ? 's' : ''} interne${internal > 1 ? 's' : ''}${echoes ? `, dont ${echoes} de strophe` : ''}` : '';
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
  $('stanzaBtn').setAttribute('aria-pressed', !!prefs.stanza);
  document.querySelector('.body').classList.toggle('no-rail', !prefs.rail);
  document.querySelector('.body').classList.toggle('with-lib', !!prefs.lib);
  $('railBtn').setAttribute('aria-pressed', prefs.rail);
  $('libBtn').setAttribute('aria-pressed', !!prefs.lib);
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
// Sur mobile, les deux panneaux passent par-dessus l'éditeur : un seul à la fois
const narrow = () => window.innerWidth <= 760;
$('railBtn').addEventListener('click', () => {
  prefs.rail = !prefs.rail;
  if (prefs.rail && narrow()) prefs.lib = false;
  if (!prefs.rail) pauseProd('rail');   // le lecteur part avec le panneau : la lecture se met en pause
  prefsChanged();
});
$('libBtn').addEventListener('click', () => {
  prefs.lib = !prefs.lib;
  if (prefs.lib && narrow()) { prefs.rail = false; pauseProd('rail'); }
  prefsChanged();
  if (prefs.lib) renderLib();
});
// Rimes de strophe : l'analyse change, elle est relancée
$('stanzaBtn').addEventListener('click', () => {
  prefs.stanza = !prefs.stanza;
  prefsChanged();
  lastRequested = null;
  if (ta.value.trim()) analyze();
});

// ── Menus ──
function toggleMenu(btn) {
  const menu = $(btn.getAttribute('aria-controls'));
  const open = menu.hidden;
  closeMenus();
  if (!open) return;
  if (menu.id === 'docMenu') loadGis().catch(() => {});   // prêt avant le clic : la fenêtre Google doit s'ouvrir dans le clic même
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
  $('versionsBtn').disabled = !doc.id;
  $('versionsBtn').dataset.tip = doc.id ? 'Historique des versions (Ctrl+Maj+H)' : 'Sauve le texte pour commencer son historique';
  const title = docTitle(ta.value, true);
  $('docTitle').textContent = title || 'Sans titre';
  document.title = title ? `${title} — Rime` : 'Rime — Analyse de schémas de rimes';
}

// ── Métadonnées du texte ouvert : dossier, tags, prods ──
// Elles vivent sur son entrée sauvée, ou sur le brouillon tant qu'il n'est pas sauvé, et s'appliquent
// sans « Sauver ». Sur un texte sauvé, metaPending les fait partir vers Drive sans renvoyer le contenu.
const cur = () => docs.find(d => d.id === doc.id) || doc;
const draftMeta = d => ({ folder: d.folder ?? null, tags: [...(d.tags || [])], prods: (d.prods || []).map(p => ({ ...p })), prod: d.prod ?? null });

function metaChanged(target = cur()) {
  if (target === doc) persistDraft();
  else {
    target.metaPending = true;
    store('rime-history', docs);
    requestSync();
  }
  renderLib();
  renderMeta();
  renderProd();
}

function saveDoc() {
  const text = ta.value;
  if (!text.trim()) { toast('Rien à sauver'); return; }
  // pending : à envoyer sur Drive ; une copie « (conflit) » sauvée devient un texte ordinaire.
  // Un nouveau texte emporte le dossier, les tags et les prods du brouillon.
  const old = docs.find(d => d.id === doc.id);
  const { conflict, ...prev } = old || { id: Date.now(), ...draftMeta(doc) };
  const item = { ...prev, text, updated: Date.now(), pending: true };
  // Pas de plafond : seul le quota du navigateur limite le nombre de textes sauvés
  const next = [item, ...docs.filter(d => d.id !== item.id)];
  if (!store('rime-history', next)) { toast('Stockage du navigateur plein ou bloqué : supprime d\'anciens textes'); return; }
  docs = next;
  doc.id = item.id;
  persistDraft();
  renderDocState();
  renderLib();
  toast('Texte enregistré ✓');
  addVersion(item.id, text, { before: old && { text: old.text, at: old.updated } });
  saveToDrive();
}

// Un nouveau texte naît dans le dossier du texte ouvert
function newDoc() {
  if (isDirty() && !confirm('Le texte en cours n\'est pas enregistré. Commencer un nouveau texte quand même ?')) return;
  const folder = cur().folder ?? null;
  setText('', null);
  doc.folder = folder;
  persistDraft();
  renderMeta();
  renderLib();
  ta.focus();
}

function openDoc(id) {
  const item = docs.find(d => d.id === id);
  if (!item || id === doc.id && !isDirty()) return;
  if (isDirty() && !confirm('Le texte en cours n\'est pas enregistré. L\'abandonner pour ouvrir celui-ci ?')) return;
  setText(item.text, id);
}

// Le texte et tout son historique ; dans Drive, à la corbeille
async function deleteDoc(id) {
  const item = docs.find(d => d.id === id);
  if (!item) return;
  const n = (await versionsOf(id).catch(() => [])).length;
  const history = n > 1 ? ` et ses ${n} versions` : n ? ' et sa version' : '';
  if (!confirm(`Supprimer « ${docTitle(item.text) || 'Sans titre'} »${history} des textes sauvés ?`)) return;
  docs = docs.filter(d => d.id !== id);
  store('rime-history', docs);
  if (item.drive) { drive.trash.push(item.drive.id); saveDrive(); }
  await dropDocVersions(id);
  // Le texte reste dans l'éditeur, comme un brouillon, avec son dossier, ses tags et ses prods
  if (doc.id === id) { Object.assign(doc, { id: null }, draftMeta(item)); persistDraft(); closeVersions(); }
  renderLib();
  renderMeta();
  renderDocState();
  requestSync();
}

function setText(text, id) {
  closeVersions();
  // Changer de texte arrête la prod en cours ; un nouveau texte part sans dossier, tags ni prods
  if (id !== doc.id || !id) stopProd();
  doc.id = id;
  if (!id) Object.assign(doc, draftMeta({}));
  ta.value = text;
  ta.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  persistDraft();
  renderDocState();
  renderLib();
  renderMeta();
  renderProd();
  analyzeSeq++;
  setResult(null);
  if (text.trim()) analyze();
}

let draftTimer = null;
function persistDraft() {
  clearTimeout(draftTimer);
  store('rime-current', { id: doc.id, text: ta.value, ...(doc.id ? {} : draftMeta(doc)) });
}
addEventListener('pagehide', persistDraft);

// Sauvegarde de tous les textes sauvés, réimportable ; avec leur historique si la case est cochée
async function exportAll() {
  if (!docs.length) { toast('Aucun texte sauvé à exporter'); return; }
  const now = new Date();
  const backup = {
    app: 'rime', version: 3, exported: now.toISOString(),
    folders: folders.map(({ id, name }) => ({ id, name })),
    texts: docs.map(({ id, text, updated, folder, tags, prods, prod }) => ({ id, text, updated, folder: folder ?? null, tags: tags || [], prods: prods || [], prod: prod ?? null })),
  };
  if ($('exportHistory').checked) {
    const ids = new Set(docs.map(d => d.id));
    backup.versions = (await allVersions().catch(() => []))
      .filter(v => ids.has(v.docId))
      .map(({ id, docId, at, text, source, label, pinned }) => ({ id, docId, at, text, source, label, pinned }));
  }
  download(`rime-textes-${now.toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json');
}

// Importe des sauvegardes Rime (.json) et des paroles (.txt) dans les textes sauvés.
// Rien n'est jamais écrasé : un texte déjà sauvé à l'identique est ignoré, un id déjà pris est remplacé.
async function importFiles(files) {
  const found = [], foundVersions = [], foundFolders = [], unreadable = [];
  const norm = s => s.replace(/\r\n?/g, '\n');
  for (const f of files) {
    const raw = norm(await f.text());
    if (!/\.json$/i.test(f.name)) { found.push({ text: raw }); continue; }
    try {
      const data = JSON.parse(raw);
      if (data?.app !== 'rime' || !Array.isArray(data.texts)) throw new Error();
      data.texts.forEach(t => { if (typeof t?.text === 'string') found.push({ ...t, text: norm(t.text) }); });
      // Format 3 : dossiers, tags et prods
      (Array.isArray(data.folders) ? data.folders : []).forEach(f => { if (f?.id && typeof f.name === 'string') foundFolders.push(f); });
      // Format 2 : l'historique des versions suit ses textes
      (Array.isArray(data.versions) ? data.versions : []).forEach(v => {
        if (typeof v?.text === 'string' && Number.isFinite(v.at)) foundVersions.push({ ...v, text: norm(v.text) });
      });
    } catch {
      unreadable.push(f.name);
    }
  }
  const texts = new Set(docs.map(d => d.text)), ids = new Set(docs.map(d => d.id));
  const idMap = new Map();   // id du texte dans la sauvegarde → id ici
  // Dossiers de la sauvegarde : retrouvés ici par leur nom, sinon créés quand un texte importé y va
  const folderNames = new Map(foundFolders.map(f => [f.id, f.name]));
  const folderFor = fid => folderNames.has(fid) ? ensureFolder(folderNames.get(fid))?.id ?? null : null;
  let fresh = Date.now();
  const added = [];
  for (const t of found) {
    if (!t.text.trim() || texts.has(t.text)) continue;
    texts.add(t.text);
    let id = Number.isSafeInteger(t.id) && !ids.has(t.id) ? t.id : null;
    while (id === null || ids.has(id)) id = fresh++;
    ids.add(id);
    if (t.id !== undefined) idMap.set(t.id, id);
    const prods = (Array.isArray(t.prods) ? t.prods : []).filter(p => /^[\w-]{11}$/.test(p?.v)).map(p => ({ v: p.v, t: String(p.t || ''), bpm: validBpm(p.bpm) }));
    added.push({
      id, text: t.text, updated: Number.isFinite(t.updated) ? t.updated : Date.now(),
      folder: folderFor(t.folder), tags: cleanTags(Array.isArray(t.tags) ? t.tags : []),
      prods, prod: prods.some(p => p.v === t.prod) ? t.prod : prods[0]?.v ?? null,
    });
  }
  const skipped = found.length - added.length;
  const note = [skipped && `${skipped} déjà présent${skipped > 1 ? 's' : ''} ou vide${skipped > 1 ? 's' : ''}`,
    unreadable.length && `illisible : ${unreadable.join(', ')}`].filter(Boolean).join(' · ');
  if (!added.length) { toast(`Rien de nouveau à importer${note ? ` (${note})` : ''}`); return; }
  const next = [...added, ...docs].sort((a, b) => b.updated - a.updated);
  if (!store('rime-history', next)) { toast('Stockage du navigateur plein ou bloqué : supprime d\'anciens textes'); return; }
  docs = next;
  saveFolders();
  renderLib();
  // Historique : celui de la sauvegarde pour les textes importés, sinon une première version
  const known = new Set((await allVersions().catch(() => [])).map(v => v.id));
  const history = foundVersions.filter(v => idMap.has(v.docId)).map(v => ({
    id: Number.isSafeInteger(v.id) && !known.has(v.id) ? v.id : versionId(), docId: idMap.get(v.docId), at: v.at, text: v.text,
    source: v.source || 'import', label: String(v.label || '').slice(0, 50), pinned: !!v.pinned, stats: null, drive: null,
  }));
  if (history.length) await putVersions(history).catch(() => {});
  for (const d of added) if (!history.some(v => v.docId === d.id)) await addVersion(d.id, d.text, { source: 'import' });
  renderDocState();
  toast(`${added.length} texte${added.length > 1 ? 's' : ''} importé${added.length > 1 ? 's' : ''}${history.length ? ` avec ${history.length} version${history.length > 1 ? 's' : ''}` : ''}${note ? ` (${note})` : ''}`);
  if (added.length === 1) openDoc(added[0].id);
  requestSync();
}

$('importInput').addEventListener('change', async e => {
  await importFiles([...e.target.files]);
  e.target.value = '';
});

// ── Bibliothèque : dossiers et tags, dans le panneau Textes ──
// menu : menu « … » ouvert ('f:<dossier>' ou 'd:<texte>') ; filter : tags demandés (un texte doit tous les porter)
const libState = { menu: null, filter: new Set() };
const ICONS = {
  folder: 'M2.5 12.5V3.8h3.8l1.4 1.6h5.8v7.1Z',
  none: 'M2.5 9h3l1 1.6h3l1-1.6h3 M2.5 9 4 3.5h8l1.5 5.5v3.5h-11Z',
  doc: 'M4 2.5h5l3 3v8H4Z M9 2.5v3h3',
  right: 'M6.5 4.5 10 8l-3.5 3.5',
  down: 'M4.5 6.5 8 10l3.5-3.5',
  up: 'M4.5 9.5 8 6l3.5 3.5',
  more: 'M3.5 8h.01 M8 8h.01 M12.5 8h.01',
  check: 'M3.5 8.5l3 3 6-7',
  plus: 'M8 3.5v9 M3.5 8h9',
  cross: 'M4.5 4.5l7 7 M11.5 4.5l-7 7',
  trash: 'M3 4.5h10 M6.5 4.5V3h3v1.5 M4.5 4.5l.6 8.5h5.8l.6-8.5',
  note: 'M6.2 11.6V3.6l6.6-1.4v8 M6.2 11.6a1.9 1.9 0 1 1-3.8 0a1.9 1.9 0 1 1 3.8 0Z M12.8 10.2a1.9 1.9 0 1 1-3.8 0a1.9 1.9 0 1 1 3.8 0Z',
};
const svgIcon = (d, size = 16, cls = 'stroke') => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" class="${cls}"><path d="${d}"/></svg>`;

// Comparaison sans casse ni accents : « A finir » rejoint « à finir »
const foldKey = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const folderById = id => id ? folders.find(f => f.id === id) : undefined;
const folderName = id => folderById(id)?.name ?? 'Sans dossier';
const sortedFolders = () => [...folders].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
const newFolderId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const cleanName = s => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
const verseCount = text => text.split('\n').filter(l => rowType(l) === 'verse').length;

function createFolder(name) {
  const clean = cleanName(name);
  if (!clean) return null;
  if (folders.some(f => foldKey(f.name) === foldKey(clean))) { toast(`Le dossier « ${clean} » existe déjà`); return null; }
  const f = { id: newFolderId(), name: clean, pending: true };
  folders.push(f);
  saveFolders();
  prefs.libOpen[f.id] = true;
  savePrefs();
  requestSync();
  renderLib();
  renderMeta();
  return f;
}

// Le dossier de ce nom (casse et accents mis à part), créé au besoin : pour l'import
function ensureFolder(name) {
  const clean = cleanName(name);
  if (!clean) return null;
  return folders.find(f => foldKey(f.name) === foldKey(clean)) || createFolder(clean);
}

function renameFolder(id) {
  const f = folderById(id);
  if (!f) return;
  const name = cleanName(prompt('Nouveau nom du dossier', f.name));
  if (!name || name === f.name) return;
  if (folders.some(x => x !== f && foldKey(x.name) === foldKey(name))) { toast(`Le dossier « ${name} » existe déjà`); return; }
  Object.assign(f, { name, pending: true });
  saveFolders();
  requestSync();
  renderLib();
  renderMeta();
}

// Ses textes passent dans « Sans dossier » ; dans Drive, le dossier vidé part à la corbeille en fin de synchro
function deleteFolder(id) {
  const f = folderById(id);
  if (!f) return;
  const inside = docs.filter(d => d.folder === id);
  const n = inside.length;
  if (!confirm(`Supprimer le dossier « ${f.name} » ?${n ? ` ${n > 1 ? `Ses ${n} textes passent` : 'Son texte passe'} dans « Sans dossier ».` : ''}${f.drive ? ' Dans Google Drive, le dossier vide part à la corbeille.' : ''}`)) return;
  inside.forEach(d => { d.folder = null; d.metaPending = true; });
  if (doc.folder === id) doc.folder = null;
  folders = folders.filter(x => x !== f);
  if (f.drive) { drive.trashFolders.push(f.drive); saveDrive(); }
  saveFolders();
  store('rime-history', docs);
  persistDraft();
  requestSync();
  renderLib();
  renderMeta();
}

function moveDoc(id, folderId) {
  const d = docs.find(x => x.id === id);
  if (!d || (folderById(d.folder) ? d.folder : null) === folderId) return;
  d.folder = folderId;
  if (folderId) { prefs.libOpen[folderId] = true; savePrefs(); }
  metaChanged(d);
  toast(`« ${docTitle(d.text) || 'Sans titre'} » rangé dans ${folderName(folderId)}`);
}

// Tags : sans virgule (la description Drive les sépare par des virgules), 30 caractères au plus,
// et écrits comme le premier texte qui les porte
function allTags() {
  const seen = new Map();
  [...docs, doc].forEach(d => (d.tags || []).forEach(t => { if (!seen.has(foldKey(t))) seen.set(foldKey(t), t); }));
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'));
}

function cleanTag(raw) {
  const t = String(raw ?? '').replace(/,/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 30);
  return t && (allTags().find(x => foldKey(x) === foldKey(t)) ?? t);
}

function cleanTags(list) {
  const out = [];
  list.forEach(x => { const t = cleanTag(x); if (t && !out.some(o => foldKey(o) === foldKey(t))) out.push(t); });
  return out;
}

function renderLib() {
  // Un tag qui n'existe plus quitte le filtre
  const tags = allTags();
  [...libState.filter].forEach(t => { if (!tags.includes(t)) libState.filter.delete(t); });
  const filter = [...libState.filter];
  const match = d => filter.every(t => (d.tags || []).some(x => foldKey(x) === foldKey(t)));
  const title = d => docTitle(d.text) || 'Sans titre';
  const groups = [...sortedFolders().map(f => ({ id: f.id, key: f.id, name: f.name, icon: ICONS.folder })),
    { id: null, key: '', name: 'Sans dossier', icon: ICONS.none }];
  let shown = 0;
  const tree = groups.map(g => {
    const all = docs.filter(d => (folderById(d.folder) ? d.folder : null) === g.id);
    const list = all.filter(match).sort((a, b) => title(a).localeCompare(title(b), 'fr'));
    shown += list.length;
    if (filter.length && !list.length) return '';
    if (!g.id && !all.length) return '';
    const open = filter.length > 0 || prefs.libOpen[g.key] !== false;
    const menu = g.id && libState.menu === `f:${g.id}`;
    const head = `<div class="lf">
        <button class="lf-row" data-toggle="${escHtml(g.key)}" aria-expanded="${open}">${svgIcon(open ? ICONS.down : ICONS.right, 14, 'stroke chev')}${svgIcon(g.icon)}<span class="lf-name">${escHtml(g.name)}</span><span class="lf-count">${filter.length ? `${list.length}/${all.length}` : all.length}</span></button>
        ${g.id ? `<button class="more" data-fmenu="${escHtml(g.id)}" aria-expanded="${!!menu}" aria-label="Actions du dossier « ${escHtml(g.name)} »">${svgIcon(ICONS.more, 16, 'stroke dots')}</button>` : ''}
      </div>`
      + (menu ? `<div class="lib-menu"><button data-frename="${escHtml(g.id)}">Renommer…</button><button class="danger" data-fdelete="${escHtml(g.id)}">Supprimer le dossier…</button></div>` : '');
    if (!open) return head;
    return head + (list.map(docRow).join('') || `<p class="lib-empty">${g.id ? 'Vide. Range un texte ici avec « Déplacer vers ».' : ''}</p>`);
  }).join('');
  setHtml($('libTree'), tree || `<p class="lib-empty">${docs.length ? 'Aucun texte avec ces tags.' : 'Aucun texte sauvé pour l\'instant : Ctrl+S sauve le texte ouvert.'}</p>`);
  setHtml($('libTags'), tags.map(t => `<button class="tag-chip" data-ftag="${escHtml(t)}" aria-pressed="${libState.filter.has(t)}">${escHtml(t)}</button>`).join('')
    || '<span class="lib-none">Aucun tag pour l\'instant : ajoute-les dans « Ce texte ».</span>');
  $('libClear').hidden = !filter.length;
  $('libSummary').textContent = filter.length ? `${shown} sur ${docs.length} texte${docs.length > 1 ? 's' : ''} avec ${filter.join(' + ')}` : '';
}

function docRow(d) {
  const on = d.id === doc.id;
  const menu = libState.menu === `d:${d.id}`;
  const title = docTitle(d.text) || 'Sans titre';
  const n = verseCount(d.text);
  const tip = `${title} · ${n} vers · modifié le ${FMT.day.format(d.updated)}${d.tags?.length ? ` · ${d.tags.join(', ')}` : ''}`;
  const up = drive.on && (d.pending || d.metaPending || !d.drive);
  const here = folderById(d.folder) ? d.folder : null;
  const dests = [...sortedFolders(), { id: null, name: 'Sans dossier' }].map(f => {
    const cur = (f.id ?? null) === here;
    return `<button data-move="${d.id}" data-to="${escHtml(f.id ?? '')}"${cur ? ' disabled' : ''}>${svgIcon(f.id ? ICONS.folder : ICONS.none, 15)}<span>${escHtml(f.name)}</span>${cur ? '<span class="here">ici</span>' : ''}</button>`;
  }).join('');
  return `<div class="ld${on ? ' on' : ''}">
      <button class="ld-open" data-open="${d.id}" aria-current="${on}" data-tip="${escHtml(tip)}">${svgIcon(ICONS.doc, 14)}<span class="ld-name">${escHtml(title)}${d.conflict ? ' <span class="doc-conflict">(conflit)</span>' : ''}</span>${up ? `<span class="ld-up" aria-label="À envoyer vers Google Drive">${svgIcon(CLOUD_UP, 14)}</span>` : ''}<span class="ld-n">${n}</span></button>
      <button class="more" data-dmenu="${d.id}" aria-expanded="${menu}" aria-label="Actions de « ${escHtml(title)} »">${svgIcon(ICONS.more, 16, 'stroke dots')}</button>
    </div>`
    + (menu ? `<div class="lib-menu"><span class="lib-menu-label">Déplacer vers</span>${dests}<span class="lib-menu-sep"></span><button class="danger" data-ddelete="${d.id}">Supprimer le texte…</button></div>` : '');
}

$('lib').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !$('libTree').contains(b) && !$('libTags').contains(b)) return;
  const ds = b.dataset;
  if (ds.toggle !== undefined) {
    prefs.libOpen[ds.toggle] = prefs.libOpen[ds.toggle] === false;
    savePrefs();
    libState.menu = null;
  } else if (ds.open) {
    libState.menu = null;
    if (narrow()) { prefs.lib = false; prefsChanged(); }   // sur mobile, le texte ouvert prend la place du panneau
    openDoc(+ds.open);
  }
  else if (ds.fmenu) libState.menu = libState.menu === `f:${ds.fmenu}` ? null : `f:${ds.fmenu}`;
  else if (ds.dmenu) libState.menu = libState.menu === `d:${ds.dmenu}` ? null : `d:${ds.dmenu}`;
  else if (ds.move) { libState.menu = null; moveDoc(+ds.move, ds.to || null); }
  else if (ds.ddelete) { libState.menu = null; deleteDoc(+ds.ddelete); }
  else if (ds.frename) { libState.menu = null; renameFolder(ds.frename); }
  else if (ds.fdelete) { libState.menu = null; deleteFolder(ds.fdelete); }
  else if (ds.ftag) libState.filter.has(ds.ftag) ? libState.filter.delete(ds.ftag) : libState.filter.add(ds.ftag);
  else return;
  renderLib();
});
$('libClear').addEventListener('click', () => { libState.filter.clear(); renderLib(); });
$('libNewText').addEventListener('click', () => { if (narrow()) { prefs.lib = false; prefsChanged(); } newDoc(); });
$('libNewFolder').addEventListener('click', () => {
  $('libCreate').hidden = false;
  $('libFolderName').value = '';
  $('libFolderName').focus();
});
$('libCreate').addEventListener('submit', e => {
  e.preventDefault();
  if (createFolder($('libFolderName').value)) $('libCreate').hidden = true;
});
$('libCreateCancel').addEventListener('click', () => { $('libCreate').hidden = true; });
$('libFolderName').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); $('libCreate').hidden = true; } });

// ── « Ce texte » : dossier, tags et place dans Drive du texte ouvert ──
let folderPick = false;

function renderMeta() {
  const d = cur();
  const f = folderById(d.folder);
  $('metaFolderBtn').innerHTML = `${svgIcon(f ? ICONS.folder : ICONS.none)}<span>${escHtml(f ? f.name : 'Sans dossier')}</span>${svgIcon(folderPick ? ICONS.up : ICONS.down, 14)}`;
  $('metaFolderBtn').setAttribute('aria-expanded', folderPick);
  $('metaFolderPick').hidden = !folderPick;
  if (folderPick) {
    setHtml($('metaFolderPick'), [...sortedFolders(), { id: null, name: 'Sans dossier' }].map(o => {
      const on = (o.id ?? null) === (f ? f.id : null);
      return `<button data-pick-folder="${escHtml(o.id ?? '')}" aria-pressed="${on}">${svgIcon(o.id ? ICONS.folder : ICONS.none, 15)}<span>${escHtml(o.name)}</span>${on ? svgIcon(ICONS.check, 14) : ''}</button>`;
    }).join('') + `<button data-new-folder>${svgIcon(ICONS.plus, 15)}<span>Nouveau dossier…</span></button>`);
  }
  const tags = d.tags || [];
  setHtml($('metaTags'), tags.map(t => `<span class="tag">${escHtml(t)}<button data-untag="${escHtml(t)}" aria-label="Retirer le tag « ${escHtml(t)} »">${svgIcon(ICONS.cross, 10, 'stroke thick')}</button></span>`).join('')
    || '<span class="meta-none">Aucun tag pour l\'instant.</span>');
  // Suggestions : les tags des autres textes, filtrés pendant la frappe
  const raw = $('metaTagInput').value.trim(), q = foldKey(raw);
  const known = allTags();
  const sugg = known.filter(t => !tags.some(x => foldKey(x) === foldKey(t)) && (!q || foldKey(t).includes(q))).slice(0, 8);
  const create = q && !known.some(t => foldKey(t) === q) ? `<button class="tag-sugg" data-addtag="${escHtml(raw)}">${svgIcon(ICONS.plus, 11, 'stroke thick')}Créer « ${escHtml(raw.slice(0, 30))} »</button>` : '';
  setHtml($('metaTagSugg'), sugg.map(t => `<button class="tag-sugg" data-addtag="${escHtml(t)}">${svgIcon(ICONS.plus, 11, 'stroke thick')}${escHtml(t)}</button>`).join('') + create);
  const where = $('metaDrive');
  where.hidden = !drive.on;
  if (drive.on) {
    const up = !doc.id || d.pending || d.metaPending || !d.drive;
    setHtml(where, `${svgIcon(up ? CLOUD_UP : CLOUD_OK)}<span>Dans Drive : ${escHtml(drive.folderName || 'Rime')}${f ? ` › ${escHtml(f.name)}` : ''}${!doc.id ? ' · sauve le texte pour l\'envoyer' : up ? ' · à envoyer' : ''}</span>`);
  }
}

function setFolder(id) {
  const d = cur();
  if ((folderById(d.folder) ? d.folder : null) === id) return;
  d.folder = id;
  if (id) { prefs.libOpen[id] = true; savePrefs(); }
  metaChanged(d);
}

function addTag(raw) {
  const t = cleanTag(raw);
  $('metaTagInput').value = '';
  if (!t) { renderMeta(); return; }
  const d = cur();
  if (!(d.tags || []).some(x => foldKey(x) === foldKey(t))) d.tags = [...(d.tags || []), t];
  metaChanged(d);
}

$('metaFolderBtn').addEventListener('click', () => { folderPick = !folderPick; renderMeta(); });
$('metaFolderPick').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  folderPick = false;
  if (b.dataset.newFolder !== undefined) {
    const f = createFolder(prompt('Nom du nouveau dossier') || '');
    if (f) setFolder(f.id); else renderMeta();
  } else setFolder(b.dataset.pickFolder || null);
  renderMeta();
});
$('metaTags').addEventListener('click', e => {
  const b = e.target.closest('[data-untag]');
  if (!b) return;
  const d = cur();
  d.tags = (d.tags || []).filter(t => t !== b.dataset.untag);
  metaChanged(d);
});
$('metaTagSugg').addEventListener('click', e => { const b = e.target.closest('[data-addtag]'); if (b) addTag(b.dataset.addtag); });
$('metaTagInput').addEventListener('input', renderMeta);
$('metaTagInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addTag(e.target.value); }
  else if (e.key === 'Escape') { e.stopPropagation(); e.target.value = ''; renderMeta(); }
});

// ── Prods : liens YouTube et leur BPM, sur le texte ouvert ──
// Le lecteur est l'API IFrame de YouTube, chargée seulement quand une prod sert. Une vidéo YouTube ne se
// joue pas cachée : plier le lecteur, masquer le panneau ou passer en mode Versions met en pause.
const YT_ID = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/|v\/))([\w-]{11})/;
const youtubeId = url => String(url ?? '').match(YT_ID)?.[1] ?? null;
const validBpm = n => { n = Math.round(Number(n)); return n >= 40 && n <= 240 ? n : null; };
const mmss = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const prodTitle = p => p.t || 'Vidéo YouTube';
const prodName = p => prodTitle(p).split(' — ')[0];
const bpmLabel = p => p.bpm ? `${p.bpm} BPM` : 'BPM ?';
const activeProd = (d = cur()) => (d.prods || []).find(p => p.v === d.prod) || null;
const PLAY_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" class="fill"><path d="M5 3.2v9.6L12.8 8Z"/></svg>';
const PAUSE_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" class="stroke thick"><path d="M5.5 3.5v9 M10.5 3.5v9"/></svg>';

// ready : lecteur prêt ; video : la vidéo chargée ; why : ce qui a mis en pause (fold, rail, versions) ;
// taps : temps tapés ; removed : prod retirée, à annuler ; add : lien en cours d'ajout
const ps = { ready: false, video: null, playing: false, t: 0, dur: 0, folded: false, why: '', taps: [], removed: null, add: null, clock: null, tapTimer: null, lookTimer: null, lookSeq: 0 };
let ytLoading = null, ytPlayer = null;

function loadYt() {
  return ytLoading ||= new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytLoading = null; reject(new Error('YouTube injoignable')); };
    document.head.appendChild(s);
  });
}

// Le lecteur suit la prod active : créé à la première prod, puis rechargé (lancé si une lecture était en cours)
async function syncPlayer() {
  const p = activeProd();
  if (!p) {
    if (ps.video && ytPlayer && ps.ready) ytPlayer.stopVideo();
    Object.assign(ps, { video: null, playing: false, t: 0, dur: 0 });
    stopClock();
    return;
  }
  if (ps.video === p.v) return;
  ps.video = p.v;
  Object.assign(ps, { t: 0, dur: 0 });
  try { await loadYt(); } catch {
    ps.video = null;
    $('prodNote').textContent = 'Lecteur YouTube injoignable : vérifie la connexion.';
    return;
  }
  if (ps.video !== p.v) return;   // une autre prod a été choisie entre-temps
  if (!ytPlayer) {
    ytPlayer = new YT.Player('prodPlayer', {
      host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%', videoId: p.v,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => { ps.ready = true; if (ytPlayer.getVideoData?.()?.video_id !== ps.video) cueProd(); renderProdState(); },
        onStateChange: onPlayerState,
      },
    });
  } else if (ps.ready) cueProd();
}

function cueProd() {
  if (!ps.video) return;
  if (ps.playing) ytPlayer.loadVideoById(ps.video);
  else ytPlayer.cueVideoById(ps.video);
}

function onPlayerState(e) {
  const S = YT.PlayerState;
  if (e.data === S.ENDED && prefs.prodLoop !== false) { ytPlayer.seekTo(0, true); ytPlayer.playVideo(); return; }
  ps.playing = e.data === S.PLAYING || e.data === S.BUFFERING;
  ps.dur = ytPlayer.getDuration?.() || ps.dur;
  if (ps.playing) { ps.why = ''; startClock(); } else stopClock();
  // Titre absent (oEmbed refusé) : celui du lecteur
  const p = activeProd(), data = ytPlayer.getVideoData?.();
  if (p && !p.t && data?.title && data.video_id === p.v) { p.t = data.title; metaChanged(cur()); return; }
  renderProd();
}

function startClock() {
  if (ps.clock) return;
  ps.clock = setInterval(() => {
    ps.t = ytPlayer?.getCurrentTime?.() || 0;
    ps.dur = ytPlayer?.getDuration?.() || ps.dur;
    renderProdState();
  }, 250);
}

function stopClock() {
  clearInterval(ps.clock);
  ps.clock = null;
  if (ps.ready && ytPlayer?.getCurrentTime) ps.t = ytPlayer.getCurrentTime() || 0;
}

// Lecture et pause (Ctrl+Espace) : le lecteur doit être visible pour jouer
function togglePlay() {
  if (!activeProd() || !ytPlayer || !ps.ready) return;
  if (ps.playing) { ytPlayer.pauseVideo(); return; }
  if (!prefs.rail) { prefs.rail = true; prefsChanged(); }
  if (vstate.open) closeVersions();
  ps.folded = false;
  ps.why = '';
  renderProd();
  ytPlayer.playVideo();
}

function pauseProd(why) {
  if (ps.playing && ytPlayer && ps.ready) { ytPlayer.pauseVideo(); ps.why = why; }
  renderProdState();
}

// Changer de texte : la lecture s'arrête, le lien en cours d'ajout et l'annulation sont oubliés
function stopProd() {
  if (ps.playing && ytPlayer && ps.ready) ytPlayer.pauseVideo();
  Object.assign(ps, { playing: false, why: '', taps: [], removed: null, add: null });
  stopClock();
  $('prodUrl').value = '';
}

function renderProd() {
  const d = cur(), prods = d.prods || [], p = activeProd(d), has = prods.length > 0;
  $('prodDock').hidden = !has;
  $('prodListTitle').textContent = has ? 'Prods du texte' : 'Prod';
  $('prodCount').textContent = has ? `${prods.length} prod${prods.length > 1 ? 's' : ''}` : '';
  $('prodBpm').textContent = p ? bpmLabel(p) : '';
  $('prodOpen').hidden = ps.folded;
  $('prodFolded').hidden = !ps.folded;
  $('prodFold').setAttribute('aria-expanded', !ps.folded);
  $('prodFold').setAttribute('aria-label', ps.folded ? 'Déplier le lecteur' : 'Replier le lecteur (met la lecture en pause)');
  $('prodFold').dataset.tip = $('prodFold').getAttribute('aria-label');
  $('prodFold').innerHTML = svgIcon(ps.folded ? ICONS.down : ICONS.up, 14);
  $('prodFoldedTitle').textContent = p ? prodTitle(p) : '';
  $('prodFoldedNote').textContent = ps.why === 'fold' ? 'Lecteur replié : lecture mise en pause.' : 'Lecteur replié. Déplie-le pour écouter.';
  if (document.activeElement !== $('prodBpmInput')) $('prodBpmInput').value = p?.bpm ?? '';
  $('prodBpmInput').disabled = $('prodTap').disabled = !p;
  setHtml($('prodList'), prods.map(x => {
    const on = x.v === d.prod;
    return `<div class="pl${on ? ' on' : ''}">
        <button class="pl-pick" role="radio" aria-checked="${on}" data-prod="${escHtml(x.v)}"><span class="pl-dot"></span><span class="pl-text"><span class="pl-title">${escHtml(prodTitle(x))}</span><span class="pl-meta">${x.bpm ? `${x.bpm} BPM` : 'BPM à régler'}${on ? (ps.playing ? ' · en lecture' : ' · active') : ''}</span></span></button>
        <button class="more" data-unprod="${escHtml(x.v)}" aria-label="Retirer « ${escHtml(prodName(x))} » du texte" data-tip="Retirer du texte">${svgIcon(ICONS.trash, 15)}</button>
      </div>`;
  }).join(''));
  $('prodUndo').hidden = !ps.removed;
  if (ps.removed) $('prodUndoText').textContent = `« ${prodName(ps.removed.prod)} » retirée du texte.`;
  renderProdAdd();
  renderProdState();
  renderTapHint();
  syncPlayer();
}

function renderProdState() {
  const p = activeProd();
  const label = ps.playing ? 'Pause' : 'Lecture';
  [$('prodPlay'), $('prodUnfold')].forEach(b => {
    setHtml(b, ps.playing && b === $('prodPlay') ? PAUSE_ICON : PLAY_ICON);
    b.disabled = !p || !ps.ready;
  });
  $('prodPlay').setAttribute('aria-label', label);
  $('prodPlay').dataset.tip = `${label} (Ctrl+Espace)`;
  $('prodTime').textContent = `${mmss(ps.t)} / ${ps.dur ? mmss(ps.dur) : '–:––'}`;
  const pos = $('prodPos');
  pos.max = Math.floor(ps.dur) || 0;
  if (document.activeElement !== pos) pos.value = Math.floor(ps.t);
  pos.disabled = !p || !ps.ready;
  const loop = prefs.prodLoop !== false;
  $('prodLoop').setAttribute('aria-pressed', loop);
  $('prodLoop').dataset.tip = loop ? 'Boucle activée : la prod repart au début' : 'Boucle désactivée : la lecture s\'arrête à la fin';
  $('prodDock').classList.toggle('playing', ps.playing);
  // Pied : la prod active, son BPM, ce que fait le lecteur
  const foot = $('footProd');
  foot.hidden = !p;
  if (!p) return;
  const state = !prefs.rail ? (ps.why === 'rail' ? 'en pause : le lecteur est masqué avec le panneau' : 'lecteur masqué avec le panneau')
    : ps.folded ? 'en pause, lecteur replié' : vstate.open ? 'en pause pendant les versions' : ps.playing ? `en lecture · ${mmss(ps.t)}` : 'en pause';
  setHtml(foot, `${svgIcon(ICONS.note, 14)}<strong>${escHtml(prodName(p))} · ${bpmLabel(p)}</strong><span>${escHtml(state)}</span>${prefs.rail ? '' : '<button class="foot-btn" data-show-rail>Afficher le lecteur</button>'}`);
}

function renderProdAdd() {
  const a = ps.add;
  const notes = { loading: 'Lien collé. Recherche du titre…', invalid: 'Ce lien ne mène pas à une vidéo YouTube.', dup: 'Cette prod est déjà dans le texte.' };
  $('prodNote').textContent = a ? notes[a.state] ?? '' : (cur().prods || []).length ? '' : 'Colle le lien d\'une vidéo YouTube : son titre se remplit tout seul.';
  $('prodFound').hidden = a?.state !== 'found';
  if (a?.state === 'found') {
    $('prodFoundTitle').textContent = a.title || 'Vidéo YouTube';
    $('prodFoundUrl').textContent = `youtu.be/${a.v}`;
  }
}

// Tap : le BPM se calcule dès 4 temps, sur les 8 derniers ; une pause de 2 s recommence la série
function renderTapHint() {
  const p = activeProd(), n = ps.taps.length;
  const idle = !n || performance.now() - ps.taps[n - 1] > 2000;
  let hint = '';
  if (p && !n) hint = p.bpm ? 'Saisis le BPM, ou clique Tap sur chaque temps.' : 'BPM à régler : saisis-le, ou clique Tap sur chaque temps.';
  else if (p && n < 4) hint = idle ? 'Il faut 4 temps d\'affilée. Recommence.' : `Encore ${4 - n} temps…`;
  else if (p) hint = idle ? `Tempo pris : ${p.bpm} BPM sur ${n} temps.` : `${p.bpm} BPM d'après ${n} temps. Continue pour affiner.`;
  $('prodTapHint').textContent = hint;
  $('prodTap').classList.toggle('on', !idle);
}

function setBpm(value) {
  const d = cur(), p = activeProd(d);
  if (!p) return;
  const bpm = validBpm(value);
  if (bpm === p.bpm) { renderProd(); return; }
  p.bpm = bpm;
  metaChanged(d);
}

function tapTempo() {
  const now = performance.now(), n = ps.taps.length;
  ps.taps = !n || now - ps.taps[n - 1] > 2000 ? [now] : [...ps.taps, now].slice(-8);
  const k = ps.taps.length;
  if (k >= 4) setBpm(60000 * (k - 1) / (now - ps.taps[0]));
  renderTapHint();
  clearTimeout(ps.tapTimer);
  ps.tapTimer = setTimeout(renderTapHint, 2100);
}

// Lien collé : la vidéo, puis son titre par oEmbed (accepté depuis le navigateur)
async function lookUpProd(url) {
  const seq = ++ps.lookSeq, v = youtubeId(url);
  if (!url) ps.add = null;
  else if (!v) ps.add = { state: 'invalid' };
  else if ((cur().prods || []).some(p => p.v === v)) ps.add = { state: 'dup', v };
  else ps.add = { state: 'loading', v };
  renderProdAdd();
  if (ps.add?.state !== 'loading') return;
  let title = '';
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${v}`)}`);
    if (res.ok) title = String((await res.json()).title || '');
  } catch {}
  if (seq !== ps.lookSeq) return;
  ps.add = { state: 'found', v, title };   // sans titre, le lecteur le donnera
  renderProdAdd();
}

function addProd() {
  const a = ps.add;
  if (a?.state !== 'found') return;
  const d = cur();
  d.prods = [...(d.prods || []), { v: a.v, t: a.title, bpm: null }];
  d.prod = a.v;
  Object.assign(ps, { add: null, removed: null, folded: false, taps: [] });
  $('prodUrl').value = '';
  metaChanged(d);
}

function pickProd(v) {
  const d = cur();
  if (d.prod === v) return;
  d.prod = v;
  ps.taps = [];
  metaChanged(d);
}

function removeProd(v) {
  const d = cur(), prods = d.prods || [];
  const index = prods.findIndex(p => p.v === v);
  if (index < 0) return;
  const wasActive = d.prod === v;
  d.prods = prods.filter(p => p.v !== v);
  if (wasActive) d.prod = d.prods[Math.min(index, d.prods.length - 1)]?.v ?? null;
  ps.removed = { prod: prods[index], index, wasActive, docId: doc.id };
  metaChanged(d);
}

function undoRemoveProd() {
  const r = ps.removed, d = cur();
  if (!r || r.docId !== doc.id) return;
  const prods = [...(d.prods || [])];
  prods.splice(r.index, 0, r.prod);
  d.prods = prods;
  if (r.wasActive || !d.prod) d.prod = r.prod.v;
  ps.removed = null;
  metaChanged(d);
}

$('prodPlay').addEventListener('click', togglePlay);
$('prodUnfold').addEventListener('click', togglePlay);
$('prodFold').addEventListener('click', () => {
  ps.folded = !ps.folded;
  if (ps.folded && ps.playing) { ytPlayer.pauseVideo(); ps.why = 'fold'; } else ps.why = '';
  renderProd();
});
$('prodLoop').addEventListener('click', () => { prefs.prodLoop = prefs.prodLoop === false; savePrefs(); renderProdState(); });
$('prodPos').addEventListener('input', e => {
  ps.t = Number(e.target.value);
  if (ps.ready) ytPlayer.seekTo(ps.t, true);
  renderProdState();
});
$('prodBpmInput').addEventListener('change', e => setBpm(e.target.value));
$('prodBpmInput').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('prodTap').addEventListener('click', tapTempo);
$('prodList').addEventListener('click', e => {
  const pick = e.target.closest('[data-prod]'), un = e.target.closest('[data-unprod]');
  if (pick) pickProd(pick.dataset.prod);
  else if (un) removeProd(un.dataset.unprod);
});
$('prodUndoBtn').addEventListener('click', undoRemoveProd);
$('prodUrl').addEventListener('input', e => {
  clearTimeout(ps.lookTimer);
  ps.lookTimer = setTimeout(() => lookUpProd(e.target.value.trim()), 250);
});
$('prodUrl').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (ps.add?.state === 'found') addProd(); else lookUpProd(e.target.value.trim());
});
$('prodPaste').addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    $('prodUrl').value = text;
    lookUpProd(text);
  } catch {
    $('prodUrl').focus();
    toast('Colle le lien dans le champ (Ctrl+V)');
  }
});
$('prodAdd').addEventListener('click', addProd);
$('prodCancel').addEventListener('click', () => { ps.add = null; $('prodUrl').value = ''; renderProdAdd(); });
$('footProd').addEventListener('click', e => {
  if (!e.target.closest('[data-show-rail]')) return;
  prefs.rail = true;
  prefsChanged();
  renderProdState();
});

// ── Versions : une copie complète du texte à chaque « Sauver », dans IndexedDB ──
// { id, docId, at, text, source: save|drive|import, label, pinned, stats: { added, removed }, drive: { id } | null, meta }
// meta : épingle ou nom changés ici, à reporter sur Drive. Rien n'est supprimé automatiquement.
let versionsDb = null, lastVersionId = 0, persistAsked = false;

function openVersionsDb() {
  return versionsDb ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('rime', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('versions', { keyPath: 'id' }).createIndex('docId', 'docId');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { versionsDb = null; reject(req.error); };
  });
}

// Une transaction ; résout avec le résultat de la requête rendue par fn, une fois tout écrit
async function versionsTx(mode, fn) {
  const db = await openVersionsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('versions', mode);
    const req = fn(tx.objectStore('versions'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

const versionsOf = docId => versionsTx('readonly', s => s.index('docId').getAll(docId)).then(vs => vs.sort((a, b) => b.at - a.at));
const allVersions = () => versionsTx('readonly', s => s.getAll());
const putVersions = vs => versionsTx('readwrite', s => { vs.forEach(v => s.put(v)); });
const dropVersions = ids => versionsTx('readwrite', s => { ids.forEach(id => s.delete(id)); });

// Ids uniques d'un appareil à l'autre : l'heure en µs environ, plus un tirage
function versionId() {
  lastVersionId = Math.max(Date.now() * 1000 + Math.floor(Math.random() * 1000), lastVersionId + 1);
  return lastVersionId;
}

const lines = text => text ? text.split('\n') : [];

function lineStats(before, after) {
  const ops = lcsOps(lines(before), lines(after));
  return { added: ops.filter(o => o[0] === '+').length, removed: ops.filter(o => o[0] === '-').length };
}

const newVersion = (docId, text, before, source, at = Date.now()) =>
  ({ id: versionId(), docId, at, text, source, label: '', pinned: false, stats: lineStats(before, text), drive: null });

// Garde une version si le texte a changé depuis la dernière. before : le texte sauvé juste avant,
// pour un texte qui n'a pas encore d'historique (sauvé avant que les versions existent)
async function addVersion(docId, text, { source = 'save', at, before } = {}) {
  try {
    const vs = await versionsOf(docId);
    const fresh = [];
    if (!vs.length && before && before.text !== text) fresh.push(newVersion(docId, before.text, '', 'save', before.at));
    const last = fresh[0]?.text ?? vs[0]?.text;
    if (last === text) return;
    fresh.push(newVersion(docId, text, last ?? '', source, at));
    await putVersions(fresh);
    if (!persistAsked) { persistAsked = true; navigator.storage?.persist?.().catch(() => {}); }
    if (vstate.open && docId === doc.id) loadVersions();
    requestSync();
  } catch {
    toast('Historique des versions indisponible dans ce navigateur');
  }
}

// Supprime l'historique d'un texte, ici et (dossier de ses versions) dans Drive
async function dropDocVersions(docId) {
  const vs = await versionsOf(docId).catch(() => []);
  if (vs.length) await dropVersions(vs.map(v => v.id)).catch(() => {});
  if (drive.vfolders[docId]) drive.trash.push(drive.vfolders[docId]);
  else vs.forEach(v => { if (v.drive) drive.trash.push(v.drive.id); });
  delete drive.vfolders[docId];
  saveDrive();
}

// ── Diff : lignes (plus longue sous-suite commune), puis mots dans les lignes modifiées ──
function lcsOps(a, b) {
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

// Mots d'une ligne modifiée, espaces compris : [{ k: '=' | '-' | '+', t }]
function wordOps(a, b) {
  const segs = [];
  for (const [k, t] of lcsOps(a.split(/(\s+)/).filter(Boolean), b.split(/(\s+)/).filter(Boolean))) {
    const last = segs[segs.length - 1];
    if (last?.k === k) last.t += t;
    else segs.push({ k, t });
  }
  return segs;
}

// Chaque rangée porte ses deux rendus : côte à côte (left, right) et fusionné (segs)
function diffRows(oldLines, newLines) {
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
function foldRows(rows, unfolded) {
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

const segHtml = segs => segs.map(s => s.k === '-' ? `<del>${escHtml(s.t)}</del>` : s.k === '+' ? `<ins>${escHtml(s.t)}</ins>` : escHtml(s.t)).join('');

// Schéma de rimes d'un texte, par strophe : analysé à la demande, gardé en mémoire
const schemeCache = new Map();

async function schemeHtml(text) {
  if (schemeCache.has(text)) return schemeCache.get(text);
  let data = lastResult?.sent.join('\n') === text ? { info: lastResult.info, groups: lastResult.groups } : null;
  if (!data) {
    const raw = await fetchAnalysis(text.split('\n')).catch(() => null);
    if (!raw?.lines) return '';
    data = { info: raw.lines, groups: Object.fromEntries(raw.groups.map(g => [g.key, g])) };
  }
  const html = data.info.map((l, i) => {
    const g = data.groups[l.group];
    const gap = i && l.stanza !== data.info[i - 1].stanza ? '<span class="gap"></span>' : '';
    return gap + (g ? `<span class="${kc(g.ci)}">${escHtml(chipLabel(l, data.groups))}</span>` : '<span>·</span>');
  }).join('');
  if (schemeCache.size > 50) schemeCache.clear();
  schemeCache.set(text, html);
  return html;
}

// ── Mode Versions : la liste dans le panneau, la comparaison à la place de l'éditeur ──
const vstate = { open: false, list: [], sel: null, cmp: 'current', checked: new Set(), unfolded: new Set() };
prefs.vview ??= wide ? 'side' : 'inline';

// Formateurs créés une fois : la liste peut compter des centaines de versions
const FMT = {
  time: new Intl.DateTimeFormat('fr', { hour: '2-digit', minute: '2-digit' }),
  short: new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'short' }),
  day: new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'long' }),
  year: new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'long', year: 'numeric' }),
};
const hhmm = t => FMT.time.format(t);
const shortDate = t => FMT.short.format(t);

function dayLabel(t) {
  const d = new Date(t), today = new Date(), yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Aujourd\'hui';
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return (d.getFullYear() === today.getFullYear() ? FMT.day : FMT.year).format(d);
}

// Taille en UTF-8 sans encoder le texte
function utf8Bytes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3;
  }
  return n;
}

function formatBytes(n) {
  if (n < 1024) return `${n} o`;
  const [v, u] = n < 1048576 ? [n / 1024, 'Ko'] : [n / 1048576, 'Mo'];
  return `${v.toFixed(1).replace('.', ',')} ${u}`;
}

const versionName = v => `${v.label ? `« ${v.label} » · ` : ''}Version du ${shortDate(v.at)} à ${hhmm(v.at)}`;

async function openVersions() {
  if (!doc.id) { toast('Sauve le texte pour commencer son historique'); return; }
  closeMenus();
  hideTip();
  if (lockedPh) setLock(null);
  Object.assign(vstate, { open: true, sel: null, cmp: 'current' });
  pauseProd('versions');
  vstate.checked.clear();
  vstate.unfolded.clear();
  document.querySelector('.body').classList.add('versions');
  $('versionsBtn').setAttribute('aria-pressed', 'true');
  // Texte sauvé avant que les versions existent : il devient la première
  const saved = docs.find(d => d.id === doc.id);
  if (saved && !(await versionsOf(doc.id).catch(() => [])).length) await addVersion(doc.id, saved.text, { at: saved.updated });
  await loadVersions();
}

function closeVersions() {
  if (!vstate.open) return;
  vstate.open = false;
  document.querySelector('.body').classList.remove('versions');
  $('versionsBtn').setAttribute('aria-pressed', 'false');
  layoutStrip();
  ta.focus({ preventScroll: true });
}

const toggleVersions = () => vstate.open ? closeVersions() : openVersions();

async function loadVersions() {
  if (!vstate.open) return;
  const list = await versionsOf(doc.id).catch(() => []);
  // Versions venues de Drive : leurs « +n −n » se calculent ici, une fois
  const fixed = list.filter((v, i) => !v.stats && (v.stats = lineStats(list[i + 1]?.text ?? '', v.text)));
  if (fixed.length) putVersions(fixed).catch(() => {});
  vstate.list = list;
  vstate.bytes = list.reduce((a, v) => a + utf8Bytes(v.text), 0);
  if (!list.some(v => v.id === vstate.sel)) {
    // Par défaut : la plus récente qui diffère du texte de l'éditeur, pour voir le dernier changement
    vstate.sel = (list.find(v => v.text !== ta.value) || list[0])?.id ?? null;
    vstate.unfolded.clear();
  }
  [...vstate.checked].forEach(id => { if (!list.some(v => v.id === id && !v.pinned)) vstate.checked.delete(id); });
  renderVersions();
}

function renderVersions() {
  renderVersionList();
  renderCompare();
}

const CLOUD_OK = 'M4.5 12.5h7.2a2.8 2.8 0 0 0 .4-5.6A4 4 0 0 0 4.4 6.6a3 3 0 0 0 .1 5.9Z M6.3 9.4l1.3 1.3 2.3-2.4';
const CLOUD_UP = 'M4.5 12.5h7.2a2.8 2.8 0 0 0 .4-5.6A4 4 0 0 0 4.4 6.6a3 3 0 0 0 .1 5.9Z M8 11V7.6 M6.6 9 8 7.6 9.4 9';
const CLOUD_WARN = 'M4.5 12.5h7.2a2.8 2.8 0 0 0 .4-5.6A4 4 0 0 0 4.4 6.6a3 3 0 0 0 .1 5.9Z M8 7.6v1.6 M8 10.9v.1';
const STAR = '<svg width="17" height="17" viewBox="0 0 16 16" aria-hidden="true" class="star"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z"/></svg>';

function renderVersionList() {
  const { list, sel, checked } = vstate;
  const saved = docs.find(d => d.id === doc.id)?.text;
  const inDrive = list.filter(v => v.drive).length;
  $('vStorage').textContent = `${list.length} version${list.length > 1 ? 's' : ''} · ${formatBytes(vstate.bytes)}`
    + (drive.on ? ` · ${inDrive} sur ${list.length} dans Google Drive` : '');
  let day = '';
  $('vList').innerHTML = list.map(v => {
    const label = dayLabel(v.at);
    const head = label !== day ? `<div class="vr-day">${escHtml(day = label)}</div>` : '';
    const drv = drive.on
      ? `<span class="vi-drive" data-tip="${v.drive ? 'Sauvegardée dans Google Drive' : 'À envoyer vers Google Drive'}"><svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" class="stroke"><path d="${v.drive ? CLOUD_OK : CLOUD_UP}"/></svg></span>` : '';
    return `${head}<div class="vitem${v.id === sel ? ' on' : ''}">
      <input type="checkbox" data-check="${v.id}" aria-label="Sélectionner la version de ${hhmm(v.at)}"${v.pinned ? ' disabled data-tip="Version épinglée : protégée"' : ''}${checked.has(v.id) ? ' checked' : ''}>
      <button class="vi-main" data-pick="${v.id}" aria-current="${v.id === sel}">
        <span class="vi-time">${hhmm(v.at)}${v.text === saved ? '<span class="vi-cur">actuelle</span>' : ''}</span>
        <span class="vi-meta"><span class="add">+${v.stats?.added ?? 0}</span><span class="del">−${v.stats?.removed ?? 0}</span>${v.label ? `<span>· ${escHtml(v.label)}</span>` : ''}</span>
      </button>${drv}
      <button class="vi-pin" data-pin="${v.id}" aria-pressed="${v.pinned}" aria-label="${v.pinned ? 'Désépingler' : 'Épingler (protège de la suppression)'}">${STAR}</button>
    </div>`;
  }).join('') || '<p class="empty-note">Aucune version pour l\'instant : chaque « Sauver » en créera une.</p>';
  renderVersionFoot();
}

function renderVersionFoot() {
  const n = vstate.checked.size;
  $('vDelete').disabled = !n;
  $('vDeleteText').textContent = n ? `Supprimer ${n} version${n > 1 ? 's' : ''}` : 'Coche des versions pour les supprimer';
  const v = vstate.list.find(x => x.id === vstate.sel);
  $('vLabel').disabled = !v;
  if (document.activeElement !== $('vLabel')) $('vLabel').value = v?.label || '';
}

// Choisir une version ne change pas la liste : seule la sélection bouge
function selectVersion(id) {
  vstate.sel = id;
  vstate.unfolded.clear();
  $('vList').querySelectorAll('[data-pick]').forEach(b => {
    const on = +b.dataset.pick === id;
    b.setAttribute('aria-current', on);
    b.parentElement.classList.toggle('on', on);
  });
  renderVersionFoot();
  renderCompare();
}

function renderCompare() {
  const { list, cmp } = vstate;
  const v = list.find(x => x.id === vstate.sel);
  document.querySelectorAll('[data-cmp]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cmp === cmp));
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === prefs.vview));
  $('cmpPin').hidden = $('cmpRestore').hidden = !v;
  if (!v) {
    $('cmpHeading').textContent = 'Versions';
    $('cmpSub').textContent = '';
    $('cmpHeads').innerHTML = '';
    $('cmpRows').innerHTML = '<p class="cmp-empty">Aucune version à comparer.</p>';
    return;
  }
  const prev = list[list.indexOf(v) + 1];
  const dirty = isDirty();
  const [oldText, newText] = cmp === 'prev' ? [prev?.text ?? '', v.text] : [v.text, ta.value];
  const rows = diffRows(lines(oldText), lines(newText));
  const same = rows.every(r => r.kind === 'same');
  const added = rows.filter(r => r.kind === 'add' || r.kind === 'mod').length;
  const removed = rows.filter(r => r.kind === 'del' || r.kind === 'mod').length;
  $('cmpHeading').textContent = versionName(v);
  $('cmpSub').textContent = same
    ? (cmp === 'prev' ? (prev ? 'Identique à la version précédente' : 'Première version') : 'Identique au texte actuel')
    : `${cmp === 'prev' ? (prev ? `Changements depuis la version de ${hhmm(prev.at)}` : 'Première version') : 'Ce qui a changé depuis, jusqu\'au texte actuel'} · +${added} −${removed} ligne${added + removed > 1 ? 's' : ''}`;
  $('cmpPin').setAttribute('aria-pressed', v.pinned);
  $('cmpPin').dataset.tip = v.pinned ? 'Épinglée : protégée de la suppression. Clic pour désépingler.' : 'Épingler : protège de la suppression';
  $('cmpRestore').disabled = v.text === ta.value;
  $('cmpRestore').dataset.tip = v.text === ta.value ? 'C\'est déjà le texte de l\'éditeur' : 'Remettre cette version dans l\'éditeur (Ctrl+Z pour annuler)';

  const oldName = cmp === 'prev' ? (prev ? versionName(prev) : 'Rien avant') : versionName(v);
  const newName = cmp === 'prev' ? versionName(v) : `Texte actuel${dirty ? ' (non sauvé)' : ''}`;
  $('cmpHeads').innerHTML = prefs.vview === 'side'
    ? `<div class="cmp-head old"><span>${escHtml(oldName)}</span><span class="cmp-scheme" data-scheme="old"></span></div>`
      + `<div class="cmp-head new"><span>${escHtml(newName)}</span><span class="cmp-scheme" data-scheme="new"></span></div>`
    : `<div class="cmp-head both">Schéma<span class="cmp-scheme" data-scheme="old"></span><span class="cmp-arrow">→</span><span class="cmp-scheme" data-scheme="new"></span></div>`;
  fillScheme('old', oldText);
  fillScheme('new', newText);

  const shown = same ? rows : foldRows(rows, vstate.unfolded);
  $('cmpRows').innerHTML = shown.map(r => {
    if (r.kind === 'fold') return `<button class="dfold" data-unfold="${r.from}">⋯  ${r.n} lignes identiques</button>`;
    if (prefs.vview === 'side') {
      return `<div class="dr ${r.kind}"><div class="dc l"><span class="dn">${r.ln}</span><span class="dt">${segHtml(r.left)}</span></div>`
        + `<div class="dc r"><span class="dn">${r.rn}</span><span class="dt">${segHtml(r.right)}</span></div></div>`;
    }
    const mark = { same: '', mod: '~', add: '+', del: '−' }[r.kind];
    return `<div class="di ${r.kind}"><span class="dn">${r.rn}</span><span class="dm">${mark}</span><span class="dt">${segHtml(r.segs)}</span></div>`;
  }).join('') || '<p class="cmp-empty">Texte vide.</p>';
}

function fillScheme(side, text) {
  const el = document.querySelector(`[data-scheme="${side}"]`);
  if (!el) return;
  el.dataset.text = text;
  el.innerHTML = '<span>…</span>';
  if (!text.trim()) { el.innerHTML = ''; return; }
  schemeHtml(text).then(html => { if (el.isConnected && el.dataset.text === text) el.innerHTML = html; });
}

async function updateVersion(id, change) {
  const v = vstate.list.find(x => x.id === id);
  if (!v) return;
  Object.assign(v, change, { meta: true });
  if (v.pinned) vstate.checked.delete(id);
  await putVersions([v]).catch(() => toast('Historique des versions indisponible dans ce navigateur'));
  renderVersions();
  requestSync();
}

async function deleteCheckedVersions() {
  const ids = [...vstate.checked].filter(id => vstate.list.some(v => v.id === id && !v.pinned));
  if (!ids.length) return;
  if (!confirm(`Supprimer ${ids.length} version${ids.length > 1 ? 's' : ''} ?${drive.on ? ' Elles partiront aussi à la corbeille de Google Drive.' : ''}`)) return;
  vstate.list.filter(v => ids.includes(v.id) && v.drive).forEach(v => drive.trash.push(v.drive.id));
  saveDrive();
  await dropVersions(ids).catch(() => {});
  vstate.checked.clear();
  await loadVersions();
  requestSync();
}

// Restaurer : le texte revient dans l'éditeur par la pile d'annulation, Ctrl+Z l'enlève
function restoreVersion(id) {
  const v = vstate.list.find(x => x.id === id);
  if (!v) return;
  closeVersions();
  ta.select();
  insertText(v.text);
  ta.setSelectionRange(0, 0);
  toast(`Version de ${hhmm(v.at)} restaurée · Ctrl+Z pour annuler`);
}

$('versionsBtn').addEventListener('click', toggleVersions);
$('vList').addEventListener('click', e => {
  const pick = e.target.closest('[data-pick]'), pin = e.target.closest('[data-pin]');
  if (pick) selectVersion(+pick.dataset.pick);
  else if (pin) {
    const v = vstate.list.find(x => x.id === +pin.dataset.pin);
    if (v) updateVersion(v.id, { pinned: !v.pinned });
  }
});
$('vList').addEventListener('change', e => {
  const id = +e.target.dataset.check;
  if (!id) return;
  e.target.checked ? vstate.checked.add(id) : vstate.checked.delete(id);
  renderVersionFoot();
});
$('vLabel').addEventListener('change', e => { if (vstate.sel) updateVersion(vstate.sel, { label: e.target.value.trim().slice(0, 50) }); });
$('vLabel').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('vDelete').addEventListener('click', deleteCheckedVersions);
$('cmpPin').addEventListener('click', () => {
  const v = vstate.list.find(x => x.id === vstate.sel);
  if (v) updateVersion(v.id, { pinned: !v.pinned });
});
$('cmpRestore').addEventListener('click', () => restoreVersion(vstate.sel));
document.querySelectorAll('[data-cmp]').forEach(b => b.addEventListener('click', () => {
  vstate.cmp = b.dataset.cmp;
  vstate.unfolded.clear();
  renderCompare();
}));
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  prefs.vview = b.dataset.view;
  savePrefs();
  renderCompare();
}));
$('cmpRows').addEventListener('click', e => {
  const f = e.target.closest('[data-unfold]');
  if (!f) return;
  vstate.unfolded.add(+f.dataset.unfold);
  renderCompare();
});

// ── Google Drive : un .txt par texte sauvé, dans un dossier « Rime » ──
// Accès limité aux fichiers créés par Rime (drive.file). Sans serveur, Google ne donne qu'un jeton d'une heure,
// gardé dans ce navigateur pour survivre à un rechargement. Passé ce délai, la sauvegarde suivante rouvre la
// fenêtre Google, qui se referme seule si la session Google est ouverte.
const GOOGLE_CLIENT_ID = '380243851119-hod3g0vlnqsgnkquhglen3ppsqi015or.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

// on : synchro activée ; folder, folderName : le dossier des textes (choisi par l'utilisateur, « Rime » par défaut) ;
// wantedName : nom demandé, appliqué à la prochaine synchro ; trash : fichiers ou dossiers supprimés ici, à mettre à la corbeille ;
// vroot : le dossier « Versions » ; vfolders : { id du texte : dossier de ses versions } ;
// email : le compte Google, pour que la fenêtre Google le choisisse seule ;
// trashFolders : dossiers de textes supprimés ici, mis à la corbeille de Drive une fois vides
const drive = { on: false, folder: null, folderName: '', wantedName: '', trash: [], trashFolders: [], vroot: null, vfolders: {}, ...stored('rime-drive', {}) };
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const saveDrive = () => store('rime-drive', drive);
let driveToken = (() => {
  const t = stored('rime-drive-token', null);
  return t?.exp > Date.now() ? t : null;
})();
let driveStatus = { state: 'auth', at: null, error: '' };   // idle | sync | auth | error
let syncing = null, syncAgain = false, syncTimer = null, lastSync = 0, tokenClient = null, gisLoading = null;
let authDeclined = false;   // fenêtre Google fermée sans se connecter : la sauvegarde ne la rouvre plus d'elle-même

// Script Google chargé seulement si Drive sert
function loadGis() {
  return gisLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => { gisLoading = null; reject(new Error('Google injoignable')); };
    document.head.appendChild(s);
  });
}

// Ouvre la fenêtre Google « Autoriser » : à appeler dans un clic, sinon le navigateur la bloque
function connectDrive() {
  if (!drive.on) {
    drive.wantedName = $('driveFolderName').value.trim();
    saveDrive();
  }
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) {
    loadGis().then(() => toast('Google est prêt : clique à nouveau'), () => toast('Impossible de joindre Google'));
    return;
  }
  tokenClient ||= oauth.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: resp => {
      if (resp.error || !oauth.hasGrantedAllScopes(resp, DRIVE_SCOPE)) { toast('Accès à Google Drive refusé'); return; }
      driveToken = { value: resp.access_token, exp: Date.now() + (resp.expires_in - 60) * 1000 };
      store('rime-drive-token', driveToken);
      authDeclined = false;
      if (!drive.on) { drive.on = true; saveDrive(); }
      syncDrive();
    },
    error_callback: e => {
      if (e.type === 'popup_failed_to_open') toast('Fenêtre Google bloquée : autorise les popups pour ce site');
      else if (e.type === 'popup_closed') authDeclined = true;
      else toast('Connexion à Google impossible');
    },
  });
  tokenClient.requestAccessToken({ prompt: drive.on ? '' : 'consent', ...(drive.email && { login_hint: drive.email }) });
}

// Sauvegarde (clic ou Ctrl+S) avec un jeton expiré : on redemande l'accès dans ce geste même, sinon on synchronise
function saveToDrive() {
  if (drive.on && !hasToken() && !authDeclined && window.google?.accounts?.oauth2) connectDrive();
  else requestSync();
}

const hasToken = () => driveToken?.exp > Date.now();
const syncNow = () => hasToken() ? syncDrive() : connectDrive();

function disconnectDrive() {
  if (!confirm('Arrêter la synchro avec Google Drive ? Tes textes restent dans ton Drive et dans ce navigateur.')) return;
  if (driveToken) window.google?.accounts?.oauth2?.revoke(driveToken.value, () => {});
  dropDriveToken();
  Object.assign(drive, { on: false, folder: null, folderName: '', wantedName: '', trash: [], trashFolders: [], vroot: null, vfolders: {}, email: undefined });
  saveDrive();
  // Plus de lien : à la reconnexion, les fichiers et dossiers sont retrouvés par l'id qu'ils portent
  docs.forEach(d => { delete d.drive; });
  store('rime-history', docs);
  folders.forEach(f => { delete f.drive; });
  saveFolders();
  resetVersionLinks();
  renderDrive();
}

async function resetVersionLinks() {
  const linked = (await allVersions().catch(() => [])).filter(v => v.drive);
  linked.forEach(v => { v.drive = null; });
  if (linked.length) await putVersions(linked).catch(() => {});
}

function dropDriveToken() {
  driveToken = null;
  try { localStorage.removeItem('rime-drive-token'); } catch {}
}

const authError = () => Object.assign(new Error('Reconnexion à Google nécessaire'), { auth: true });

// Appel à l'API Drive ; null si le fichier n'existe pas
async function driveApi(path, { method = 'GET', json, upload, raw = false } = {}) {
  if (!hasToken()) throw authError();
  const init = { method, headers: { Authorization: `Bearer ${driveToken.value}` } };
  if (json) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  if (upload) {
    // Métadonnées et contenu en une requête
    const b = `rime-${Math.random().toString(36).slice(2)}`;
    init.headers['Content-Type'] = `multipart/related; boundary=${b}`;
    init.body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(upload.meta)}\r\n`
      + `--${b}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${upload.text}\r\n--${b}--`;
  }
  const res = await fetch(`https://www.googleapis.com/${upload ? 'upload/' : ''}drive/v3/${path}`, init);
  if (res.status === 401) { dropDriveToken(); throw authError(); }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Google Drive a répondu ${res.status}`);
  return raw ? res.text() : res.json();
}

// Le dossier des textes : celui de la dernière synchro, sinon celui que Rime a déjà créé, sinon un nouveau.
// Rime ne voit que les dossiers qu'il a créés : il retrouve le sien même déplacé ou renommé dans Drive.
async function driveFolder() {
  let f = drive.folder && await driveApi(`files/${drive.folder}?fields=id,name,trashed,appProperties`);
  if (!f || f.trashed) {
    // Dossier perdu (supprimé, autre compte) : les anciens liens ne valent plus, rien n'est effacé ici
    docs.forEach(d => { delete d.drive; });
    folders.forEach(f => { delete f.drive; });
    Object.assign(drive, { trash: [], trashFolders: [], vroot: null, vfolders: {} });
    await resetVersionLinks();
    // Le dossier principal porte la marque « root » ; un dossier d'avant les marques est le plus ancien sans marque
    const found = await driveFolders();
    f = found.find(x => x.appProperties?.rime === 'root') ?? found.find(x => !x.appProperties?.rime && !x.appProperties?.rimeVersionsOf)
      ?? await driveApi('files?fields=id,name,appProperties', { method: 'POST', json: { name: drive.wantedName || 'Rime', mimeType: FOLDER_TYPE, appProperties: { rime: 'root' } } });
  }
  if (f.appProperties?.rime !== 'root') await driveApi(`files/${f.id}?fields=id`, { method: 'PATCH', json: { appProperties: { rime: 'root' } } });
  if (drive.wantedName && f.name !== drive.wantedName) {
    f = await driveApi(`files/${f.id}?fields=id,name`, { method: 'PATCH', json: { name: drive.wantedName } }) ?? f;
  }
  Object.assign(drive, { folder: f.id, folderName: f.name, wantedName: '' });
  saveDrive();
  return f.id;
}

// Les dossiers créés par Rime, du plus ancien au plus récent : Rime ne voit pas les autres
async function driveFolders() {
  const q = encodeURIComponent(`mimeType = '${FOLDER_TYPE}' and trashed = false`);
  return (await driveApi(`files?q=${q}&orderBy=createdTime&pageSize=1000&fields=files(id,name,appProperties)`))?.files || [];
}

// Tous les fichiers de Rime, où qu'ils soient : sorti du dossier dans Drive, un texte reste synchronisé.
// Textes (rimeId) et versions (rimeVersion) arrivent ensemble.
async function driveList() {
  const q = encodeURIComponent("mimeType = 'text/plain' and trashed = false");
  const files = [];
  let page = '';
  do {
    const r = await driveApi(`files?q=${q}&pageSize=1000&fields=nextPageToken,files(id,name,version,modifiedTime,appProperties,parents,description)${page ? `&pageToken=${page}` : ''}`);
    files.push(...(r?.files || []));
    page = r?.nextPageToken || '';
  } while (page);
  return files.filter(f => f.appProperties?.rimeId);
}

async function renameDriveFolder() {
  const name = prompt('Nouveau nom du dossier dans ton Drive', drive.folderName || 'Rime')?.trim();
  if (!name || name === drive.folderName) return;
  drive.wantedName = name;   // appliqué par la synchro, même après une reconnexion
  saveDrive();
  syncNow();
}

const driveName = d => `${(docTitle(d.text) || 'Sans titre').slice(0, 80)}${d.conflict ? ' (conflit)' : ''}.txt`;
const remoteTime = f => Date.parse(f.modifiedTime) || Date.now();

// Tags et prods dans la description du fichier, lisible et modifiable dans Drive :
//   Tags : à finir, storytelling
//   Prod : Abyss — dark piano type beat · 92 BPM · https://youtu.be/xxxxxxxxxxx · active
// Les autres lignes de la description sont gardées telles quelles (driveNote).
function metaDescription(d) {
  const out = [];
  if (d.tags?.length) out.push(`Tags : ${d.tags.join(', ')}`);
  (d.prods || []).forEach(p => out.push(`Prod : ${[prodTitle(p), p.bpm ? `${p.bpm} BPM` : '', `https://youtu.be/${p.v}`, p.v === d.prod ? 'active' : ''].filter(Boolean).join(' · ')}`));
  if (d.driveNote) out.push(d.driveNote);
  return out.join('\n');
}

const BPM_PART = /^\d{2,3}\s*bpm$/i;
function parseDescription(text) {
  const tags = [], prods = [], note = [];
  let prod = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const tm = line.match(/^\s*tags?\s*:\s*(.*)$/i), pm = line.match(/^\s*prod\s*:\s*(.*)$/i);
    if (tm) {
      tm[1].split(',').forEach(raw => {
        const t = raw.trim().replace(/\s+/g, ' ').slice(0, 30);
        if (t && !tags.some(x => foldKey(x) === foldKey(t))) tags.push(t);
      });
    } else if (pm && youtubeId(pm[1])) {
      const v = youtubeId(pm[1]);
      if (prods.some(p => p.v === v)) continue;
      const parts = pm[1].split(' · ').map(x => x.trim());
      const title = parts.find(x => !youtubeId(x) && !BPM_PART.test(x) && !/^active$/i.test(x)) || '';
      prods.push({ v, t: title === 'Vidéo YouTube' ? '' : title, bpm: validBpm(parts.find(x => BPM_PART.test(x))?.match(/\d+/)[0]) });
      if (parts.some(x => /^active$/i.test(x))) prod = v;
    } else if (line.trim()) note.push(line);
  }
  return { tags, prods, prod: prod ?? prods[0]?.v ?? null, driveNote: note.join('\n') };
}

const metaSig = d => JSON.stringify([d.folder ?? null, d.tags || [], d.prods || [], d.prod ?? null]);

// Envoie un texte : son contenu s'il a changé (pending), sinon ses seules métadonnées (description, dossier).
// Sans fichier, ou s'il a disparu, un fichier est créé, qui porte l'id du texte. parent : le dossier Drive voulu ;
// le fichier n'est déplacé que si son dossier a changé ici (un fichier sorti du dossier de Rime y reste sinon).
async function drivePush(d, parent, f = null) {
  const { id, text, pending } = d;
  const sig = metaSig(d);
  const meta = { name: driveName(d), description: metaDescription(d) };
  const was = f?.parents || [];
  const move = d.metaPending && f && !was.includes(parent) ? `&addParents=${parent}${was.length ? `&removeParents=${was.join(',')}` : ''}` : '';
  let r = d.drive && (pending
    ? await driveApi(`files/${d.drive.id}?uploadType=multipart&fields=id,version${move}`, { method: 'PATCH', upload: { meta, text } })
    : await driveApi(`files/${d.drive.id}?fields=id,version${move}`, { method: 'PATCH', json: meta }));
  r ||= await driveApi('files?uploadType=multipart&fields=id,version', {
    method: 'POST',
    upload: { meta: { ...meta, mimeType: 'text/plain', parents: [parent], appProperties: { rimeId: String(id) } }, text },
  });
  // Le texte a pu être sauvé, rangé ou supprimé pendant l'envoi : on le retrouve par son id
  const now = docs.find(x => x.id === id);
  if (!now) { drive.trash.push(r.id); return; }
  now.drive = { id: r.id, rev: r.version };
  if (now.text === text) now.pending = false;
  if (metaSig(now) === sig) now.metaPending = false;
}

// Dossiers de textes : sous-dossiers du dossier de Rime, marqués rime: 'folder' et rimeFolder: <id>.
// Rend la correspondance dossier Drive → dossier d'ici.
async function syncFolders(root, all) {
  const remote = all.filter(f => f.appProperties?.rime === 'folder');
  const seen = new Set();
  for (const lf of [...folders]) {
    let f = remote.find(x => x.id === lf.drive) || remote.find(x => x.appProperties.rimeFolder === lf.id);
    if (!f && lf.drive && !lf.pending) {
      // Supprimé dans Drive (ses fichiers sont partis à la corbeille avec lui) : il disparaît ici aussi
      folders = folders.filter(x => x !== lf);
      docs.forEach(d => { if (d.folder === lf.id) d.folder = null; });
      continue;
    }
    if (!f) {
      f = await driveApi('files?fields=id,name,appProperties', { method: 'POST', json: { name: lf.name, mimeType: FOLDER_TYPE, parents: [root], appProperties: { rime: 'folder', rimeFolder: lf.id } } });
    } else if (f.name !== lf.name) {
      if (lf.pending) await driveApi(`files/${f.id}?fields=id`, { method: 'PATCH', json: { name: lf.name } });
      else lf.name = f.name;   // renommé dans Drive
    }
    Object.assign(lf, { drive: f.id, pending: false });
    seen.add(f.id);
  }
  // Dossiers créés sur un autre appareil
  for (const f of remote) {
    if (seen.has(f.id) || drive.trashFolders.includes(f.id)) continue;
    const id = f.appProperties.rimeFolder || newFolderId();
    if (!folders.some(x => x.id === id)) folders.push({ id, name: f.name, drive: f.id });
  }
  saveFolders();
  return new Map(folders.filter(f => f.drive).map(f => [f.drive, f.id]));
}

// Dossiers supprimés ici : à la corbeille de Drive, une fois vidés de leurs textes
async function trashEmptyFolders() {
  for (const id of [...drive.trashFolders]) {
    const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
    const inside = (await driveApi(`files?q=${q}&pageSize=1&fields=files(id)`))?.files || [];
    if (inside.length) continue;   // un texte y est encore (envoi en attente) : la prochaine synchro réessaiera
    await driveApi(`files/${id}?fields=id`, { method: 'PATCH', json: { trashed: true } });
    drive.trashFolders = drive.trashFolders.filter(x => x !== id);
    saveDrive();
  }
}

function addDoc(fields) {
  const ids = new Set(docs.map(d => d.id));
  let id = Number.isSafeInteger(fields.id) && !ids.has(fields.id) ? fields.id : Date.now();
  while (ids.has(id)) id++;
  const d = { ...fields, id };
  docs.unshift(d);
  return d;
}

async function runDriveSync() {
  const root = await driveFolder();
  // 1. Les textes supprimés dans Rime vont à la corbeille de Drive (récupérables 30 jours)
  for (const id of [...drive.trash]) {
    await driveApi(`files/${id}?fields=id`, { method: 'PATCH', json: { trashed: true } });
    drive.trash = drive.trash.filter(x => x !== id);
    saveDrive();
  }
  // 2. Les dossiers, avant les textes qu'ils contiennent
  const folderOf = await syncFolders(root, await driveFolders());
  const parentOf = d => folderById(d.folder)?.drive || root;
  // Dossier d'un fichier : la racine, un sous-dossier connu, sinon (parent hors de Rime) celui d'ici
  const remoteFolder = (f, fallback) => {
    const parents = f.parents || [];
    if (parents.includes(root)) return null;
    return parents.map(x => folderOf.get(x)).find(Boolean) ?? fallback;
  };
  // Dossier, tags et prods de Drive, sauf s'ils ont changé ici depuis
  const pullMeta = (d, f) => {
    if (!d.metaPending) Object.assign(d, parseDescription(f.description), { folder: remoteFolder(f, d.folder ?? null) });
  };
  const files = await driveList();
  const remote = files.filter(f => !f.appProperties.rimeVersion);
  const byId = new Map(remote.map(f => [f.id, f]));
  const byRime = new Map(remote.map(f => [f.appProperties?.rimeId, f]));
  const seen = new Set();
  // 3. Chaque texte sauvé face à son fichier
  for (const id of docs.map(d => d.id)) {
    let d = docs.find(x => x.id === id);
    if (!d) continue;
    const f = (d.drive && byId.get(d.drive.id)) || byRime.get(String(id));
    if (!f) {
      // Fichier supprimé dans Drive : le texte suit, avec son historique, sauf s'il a des modifications à envoyer
      if (d.drive && !d.pending && !d.metaPending) {
        docs = docs.filter(x => x !== d);
        if (doc.id === id) { doc.id = null; persistDraft(); closeVersions(); }
        await dropDocVersions(id);
        continue;
      }
      delete d.drive;
      await drivePush(d, parentOf(d));
      continue;
    }
    seen.add(f.id);
    if (d.drive?.id === f.id && d.drive.rev === f.version) {
      if (d.pending || d.metaPending) await drivePush(d, parentOf(d), f);
      continue;
    }
    // Modifié dans Drive (ou pas encore relié) : on compare les textes
    const text = (await driveApi(`files/${f.id}?alt=media`, { raw: true }) ?? '').replace(/\r\n?/g, '\n');
    d = docs.find(x => x.id === id);
    if (!d) continue;
    if (text === d.text) {
      d.drive = { id: f.id, rev: f.version };
      d.pending = false;
      pullMeta(d, f);
      if (d.metaPending) await drivePush(d, parentOf(d), f);
      continue;
    }
    // Avant tout remplacement, la version d'ici est gardée dans l'historique
    await addVersion(id, d.text, { source: 'drive', at: d.updated });
    d = docs.find(x => x.id === id);
    if (!d) continue;
    const editing = d.id === doc.id && isDirty();
    if (!d.pending && !editing) {
      Object.assign(d, { text, updated: remoteTime(f), drive: { id: f.id, rev: f.version } });
      pullMeta(d, f);
      if (d.metaPending) await drivePush(d, parentOf(d), f);
      if (d.id === doc.id) {
        setText(text, d.id);
        toast(`« ${docTitle(text) || 'Sans titre'} » mis à jour depuis Drive`);
      }
      continue;
    }
    if (!d.pending) { pullMeta(d, f); continue; }   // modifications non sauvées dans l'éditeur : on attend « Sauver »
    // Modifié des deux côtés : la version de Drive devient une copie « (conflit) », la nôtre part sur le fichier
    d.drive = { id: f.id, rev: f.version };
    const copy = addDoc({ text, updated: remoteTime(f), conflict: true, pending: true, ...parseDescription(f.description), folder: remoteFolder(f, d.folder ?? null) });
    await addVersion(copy.id, text, { source: 'drive', at: copy.updated });
    await drivePush(d, parentOf(d), f);
  }
  // 4. Les fichiers inconnus ici : textes sauvés depuis un autre appareil
  for (const f of remote) {
    if (seen.has(f.id) || drive.trash.includes(f.id) || docs.some(d => d.drive?.id === f.id)) continue;
    const text = (await driveApi(`files/${f.id}?alt=media`, { raw: true }) ?? '').replace(/\r\n?/g, '\n');
    if (docs.some(d => d.drive?.id === f.id)) continue;
    addDoc({ id: Number(f.appProperties?.rimeId), text, updated: remoteTime(f), drive: { id: f.id, rev: f.version }, ...parseDescription(f.description), folder: remoteFolder(f, null) });
  }
  // 5. Les copies « (conflit) » créées plus haut
  for (const d of docs.filter(x => !x.drive)) await drivePush(d, parentOf(d));
  // 6. Les dossiers supprimés ici, maintenant vidés
  await trashEmptyFolders();
  // 7. L'historique de chaque texte
  await syncVersions(root, files.filter(f => f.appProperties.rimeVersion));
}

// ── Versions dans Drive : <dossier>/Versions/<titre>/<date heure — nom>.txt, une version = un fichier ──
// Une version ne change jamais : la synchro fait l'union des deux côtés, plus les suppressions, l'épingle et le nom.
const pad = n => String(n).padStart(2, '0');
const versionFile = v => {
  const d = new Date(v.at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}h${pad(d.getMinutes())}${v.label ? ` — ${v.label}` : ''}.txt`;
};
// appProperties : clé + valeur ≤ 124 octets ; le nom est coupé en octets (accents, emojis)
function clipBytes(s, max) {
  const enc = new TextEncoder();
  let out = '';
  for (const ch of s) {
    if (enc.encode(out + ch).length > max) break;
    out += ch;
  }
  return out;
}
const versionProps = v => ({ rimeVersion: String(v.id), rimeId: String(v.docId), at: String(v.at), source: v.source, pinned: v.pinned ? '1' : '0', label: clipBytes(v.label, 110) });

async function syncVersions(root, remote) {
  const folders = await driveFolders();
  const valid = new Set(folders.map(f => f.id));
  if (!valid.has(drive.vroot)) drive.vroot = null;
  // Un dossier de versions supprimé dans Drive : ses versions repartent, rien n'est effacé ici
  const lost = new Set(Object.keys(drive.vfolders).filter(docId => !valid.has(drive.vfolders[docId])).map(Number));
  lost.forEach(docId => { delete drive.vfolders[docId]; });
  const local = await allVersions();
  const known = new Set(local.map(v => v.id));
  const byVersion = new Map(remote.map(f => [Number(f.appProperties.rimeVersion), f]));
  const put = [], drop = [];

  // Le dossier des versions d'un texte, créé au besoin (et renommé comme le texte)
  const folderOf = async docId => {
    const title = (docTitle(docs.find(d => d.id === docId)?.text || '') || 'Sans titre').slice(0, 80);
    let f = folders.find(x => x.id === drive.vfolders[docId]) ?? folders.find(x => x.appProperties?.rimeVersionsOf === String(docId));
    if (!f) {
      drive.vroot ??= folders.find(x => x.appProperties?.rime === 'versions')?.id
        ?? (await driveApi('files?fields=id', { method: 'POST', json: { name: 'Versions', mimeType: FOLDER_TYPE, parents: [root], appProperties: { rime: 'versions' } } })).id;
      f = await driveApi('files?fields=id,name,appProperties', { method: 'POST', json: { name: title, mimeType: FOLDER_TYPE, parents: [drive.vroot], appProperties: { rimeVersionsOf: String(docId) } } });
      folders.push(f);
    } else if (f.name !== title) {
      await driveApi(`files/${f.id}?fields=id`, { method: 'PATCH', json: { name: title } });
      f.name = title;
    }
    drive.vfolders[docId] = f.id;
    return f.id;
  };
  const upload = async v => {
    const f = await driveApi('files?uploadType=multipart&fields=id', {
      method: 'POST',
      upload: { meta: { name: versionFile(v), mimeType: 'text/plain', parents: [await folderOf(v.docId)], appProperties: versionProps(v) }, text: v.text },
    });
    v.drive = { id: f.id };
  };

  // 1. Les versions d'ici face à leurs fichiers
  for (const v of local) {
    if (!docs.some(d => d.id === v.docId)) continue;
    const f = byVersion.get(v.id);
    if (!f) {
      // Fichier supprimé dans Drive : la version suit, sauf si elle est épinglée (elle repart) ou si son dossier a disparu
      if (v.drive && !v.pinned && !lost.has(v.docId)) { drop.push(v.id); continue; }
      v.drive = null;
      v.meta = false;
      await upload(v);
      put.push(v);
      continue;
    }
    const relinked = v.drive?.id !== f.id;
    v.drive = { id: f.id };
    if (v.meta) {
      // Épingle ou nom changés ici : reportés sur le fichier (nom compris)
      const ok = await driveApi(`files/${f.id}?fields=id`, { method: 'PATCH', json: { name: versionFile(v), appProperties: versionProps(v) } });
      if (!ok) { v.drive = null; await upload(v); }
      v.meta = false;
      put.push(v);
    } else if ((f.appProperties.pinned === '1') !== v.pinned || (f.appProperties.label || '') !== v.label) {
      // Changés sur un autre appareil
      v.pinned = f.appProperties.pinned === '1';
      v.label = f.appProperties.label || '';
      put.push(v);
    } else if (relinked) put.push(v);
  }
  // 2. Les versions venues d'un autre appareil
  for (const f of remote) {
    const id = Number(f.appProperties.rimeVersion), docId = Number(f.appProperties.rimeId);
    if (known.has(id) || drive.trash.includes(f.id) || !docs.some(d => d.id === docId)) continue;
    const text = (await driveApi(`files/${f.id}?alt=media`, { raw: true }) ?? '').replace(/\r\n?/g, '\n');
    put.push({
      id, docId, at: Number(f.appProperties.at) || remoteTime(f), text, source: f.appProperties.source || 'save',
      label: f.appProperties.label || '', pinned: f.appProperties.pinned === '1', stats: null, drive: { id: f.id },
    });
  }
  // Pendant la synchro, une version a pu être épinglée, renommée ou supprimée ici : ces gestes l'emportent
  const now = new Map((await allVersions()).map(v => [v.id, v]));
  const keep = put.filter(v => now.has(v.id) || !known.has(v.id)).map(v => now.get(v.id)?.meta ? { ...now.get(v.id), drive: v.drive } : v);
  if (keep.length) await putVersions(keep);
  if (drop.length) await dropVersions(drop);
  saveDrive();
  if (vstate.open && (keep.length || drop.length)) loadVersions();
}

// Une seule synchro à la fois ; une demande pendant la synchro en relance une derrière
async function syncDrive() {
  if (!drive.on) return;
  if (syncing) { syncAgain = true; return syncing; }
  clearTimeout(syncTimer);
  syncing = syncOnce();
  try { await syncing; } finally { syncing = null; }
  if (syncAgain) { syncAgain = false; return syncDrive(); }
}

async function syncOnce() {
  setDriveStatus('sync');
  try {
    if (!hasToken()) throw authError();
    await runDriveSync();
    drive.email ??= (await driveApi('about?fields=user(emailAddress)').catch(() => null))?.user?.emailAddress || '';
    lastSync = Date.now();
    setDriveStatus('idle');
  } catch (e) {
    setDriveStatus(e.auth ? 'auth' : 'error', e.message);
  }
  docs.sort((a, b) => b.updated - a.updated);
  store('rime-history', docs);
  saveDrive();
  renderDocState();
  renderLib();
  renderMeta();
  renderProd();
}

function requestSync(delay = 1500) {
  if (!drive.on) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncDrive, delay);
}

function setDriveStatus(state, error = '') {
  driveStatus = { state, error, at: state === 'idle' ? new Date() : driveStatus.at };
  renderDrive();
}

function renderDrive() {
  const { state, at, error } = driveStatus;
  const time = at ? at.toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' }) : '';
  const synced = time ? `synchronisé à ${time}` : 'connecté';
  const note = {
    idle: drive.folderName ? `Dossier « ${drive.folderName} » · ${synced}` : `Google Drive ${synced}`,
    sync: 'Synchronisation avec Google Drive…',
    auth: 'L\'accès à Google Drive a expiré : reconnecte-toi pour synchroniser',
    error: `Synchro impossible : ${error}`,
  }[state];
  const btn = $('driveBtn');
  btn.hidden = !drive.on;
  const label = { idle: 'Drive à jour', sync: 'Synchro…', auth: 'Reconnecter Drive', error: 'Erreur Drive' }[state];
  const icon = { idle: CLOUD_OK, sync: CLOUD_UP }[state] || CLOUD_WARN;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" class="stroke"><path d="${icon}"/></svg><span class="lbl">${label}</span>`;
  btn.classList.toggle('warn', state === 'auth' || state === 'error');
  btn.dataset.tip = note;
  $('driveOff').hidden = drive.on;
  $('driveOn').hidden = !drive.on;
  $('driveNote').textContent = note;
}

$('driveBtn').addEventListener('click', syncNow);
$('driveFolderName').addEventListener('keydown', e => { if (e.key === 'Enter') { closeMenus(); connectDrive(); } });
// Retour sur l'onglet : on récupère ce qui a pu changer ailleurs
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && drive.on && hasToken() && Date.now() - lastSync > 30000) syncDrive();
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
  // Menus « … » du panneau Textes et liste des dossiers de « Ce texte » : un clic ailleurs les ferme
  if (libState.menu && !e.target.closest('.lib-menu, [data-dmenu], [data-fmenu]')) { libState.menu = null; renderLib(); }
  if (folderPick && !e.target.closest('#metaFolderPick, #metaFolderBtn')) { folderPick = false; renderMeta(); }
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
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); toggleVersions(); }
  else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveDoc(); }
  else if (mod && e.code === 'Space' && activeProd()) { e.preventDefault(); togglePlay(); }
  else if (e.key === 'Escape') {
    const menuOpen = document.querySelector('.menu:not([hidden])');
    closeMenus();
    hideTip();
    if (libState.menu || folderPick) { libState.menu = null; folderPick = false; renderLib(); renderMeta(); }
    else if (lockedPh) setLock(null);
    else if (!menuOpen && document.activeElement !== $('vLabel')) closeVersions();
  }
});

addEventListener('resize', () => layoutStrip());

// ── Démarrage : le dernier texte ouvert revient ──
(function init() {
  if (!docs.some(d => d.id === doc.id)) doc.id = null;
  ta.value = doc.text || '';
  applyPrefs();
  renderDocState();
  renderDrive();
  renderLib();
  renderMeta();
  renderProd();
  if (drive.on) {
    loadGis().catch(() => {});
    if (hasToken()) syncDrive();
  }
  setResult(null);
  if (ta.value.trim()) analyze();
  document.fonts?.ready.then(() => layoutStrip());
})();
