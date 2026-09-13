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
  return line.trim().split(/\s+/);
}

function cleanWord(token) {
  return (token || '').replace(/[^a-zàâäéèêëîïôöùûüÿçœæ'’-]/gi, '').replace(/^['’-]+|['’-]+$/g, '');
}

// ── Highlighting des mots dans une ligne ──
function highlightLine(line, info, groups) {
  const words = line.split(/(\s+)/);
  const internal = new Map(info.internal.map(it => [it.i, groups[it.group]]));
  const own = groups[info.group];
  let wordIdx = -1;
  let out = '';
  for (const tok of words) {
    if (/^\s+$/.test(tok)) { out += tok; continue; }
    wordIdx++;
    const escaped = escHtml(tok);
    const attrs = `data-word-index="${wordIdx}" data-token="${escHtml(tok)}"`;
    if (wordIdx === info.end && own) {
      const col = getCol(own.ci);
      const style = info.kind === 'asso'
        ? `color:${col};text-decoration-color:${col}`
        : `background:${col}22;color:${col}`;
      out += `<span class="rw${info.kind === 'asso' ? ' rw-asso' : ''}" ${attrs} style="${style}">${escaped}</span>`;
    } else if (internal.has(wordIdx)) {
      const col = getCol(internal.get(wordIdx).ci);
      out += `<span class="rw-int" ${attrs} style="color:${col};text-decoration-color:${col}">${escaped}</span>`;
    } else {
      out += `<span class="rw-plain" ${attrs}>${escaped}</span>`;
    }
  }
  return out;
}

// ── Analyse principale ──
let analyzeSeq = 0;

async function analyze() {
  const raw = document.getElementById('input').value.trim();
  if (!raw) return;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;

  const seq = ++analyzeSeq;
  let data;
  try {
    data = await fetchAnalysis(lines);
  } catch {
    if (seq === analyzeSeq) toast('Serveur d\'analyse injoignable');
    return;
  }
  if (seq !== analyzeSeq) return;

  const groups = Object.fromEntries(data.groups.map(g => [g.key, g]));
  lastResult = { ...data, lines, info: data.lines, groups, groupList: data.groups };
  renderAll();
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
    if (!info.exact) t += ' (approximative : é/è, o ouvert/fermé…)';
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
  const { lines, info, groups, groupList, sounds, echoes } = lastResult;

  ['emptyState','emptyStateAsso','emptyStateSchema'].forEach(id => document.getElementById(id).style.display = 'none');
  ['analysisContent','assoContent','schemaContent'].forEach(id => document.getElementById(id).style.display = 'block');

  const rhymed = info.filter(l => l.kind === 'rime').length;
  const rich = info.filter(l => l.level === 'riche' || l.level === 'multi').length;
  const avgSyl = Math.round(info.reduce((a, l) => a + l.syl, 0) / info.length);
  const internalCount = info.reduce((a, l) => a + l.internal.length, 0);

  // Stats
  document.getElementById('statsRow').innerHTML = `
    <div class="stat"><div class="stat-num">${lines.length}</div><div class="stat-lbl">Vers</div></div>
    <div class="stat"><div class="stat-num">${rhymed}</div><div class="stat-lbl">Rimés</div></div>
    <div class="stat"><div class="stat-num">${rich}</div><div class="stat-lbl">Riches</div></div>
    <div class="stat"><div class="stat-num">${avgSyl}</div><div class="stat-lbl">Syl. moy.</div></div>
    <div class="stat"><div class="stat-num">${internalCount}</div><div class="stat-lbl">Rimes int.</div></div>
  `;

  // Pattern chips
  document.getElementById('patternChips').innerHTML = info.map((l, i) => {
    const g = groups[l.group];
    if (!g) return `<span class="p-chip" title="${escHtml(levelTitle(l, i))}" style="color:var(--chip-neutral-txt);background:var(--chip-neutral-bg)">·</span>`;
    const col = getCol(g.ci);
    const cls = l.kind === 'asso' ? 'p-chip asso' : 'p-chip';
    return `<span class="${cls}" data-ph="${escHtml(g.key)}" title="${escHtml(levelTitle(l, i))}" style="background:${col}22;color:${col}">${chipLabel(l, groups)}</span>`;
  }).join('');

  // Legend
  document.getElementById('legendEl').innerHTML = groupList.map(g => {
    const col = getCol(g.ci);
    const count = g.lines.length + g.asso.length;
    const levels = Object.entries(g.levels)
      .sort((a, b) => b[1] - a[1])
      .map(([lvl, c]) => `${c} ${LEVEL_NAMES[lvl]}`).join(', ');
    const extra = [levels, g.type === 'rime' && g.asso.length ? `${g.asso.length} asso` : ''].filter(Boolean).join(' · ');
    const kind = g.type === 'rime' ? 'Rime' : 'Asso.';
    return `<span class="legend-item" data-ph="${escHtml(g.key)}"><span class="legend-dot${g.type === 'asso' ? ' asso' : ''}" style="background:${col};border-color:${col}"></span>${kind} ${g.type === 'rime' ? g.label : g.label.toLowerCase()} — <em style="color:${col}">${escHtml(g.display)}</em> (${count}×)${extra ? ` <span class="legend-extra">${extra}</span>` : ''}</span>`;
  }).join('') + (groupList.some(g => g.type === 'asso' || g.asso.length)
    ? '<span class="legend-item legend-note">pointillés = assonance</span>' : '');

  // Lines with highlighting
  document.getElementById('linesList').innerHTML = lines.map((line, i) => {
    const l = info[i];
    const g = groups[l.group];
    const highlighted = highlightLine(line, l, groups);
    let badge;
    if (g) {
      const col = getCol(g.ci);
      badge = `<span class="v-badge" title="${escHtml(levelTitle(l, i))}">
           <span class="v-rime${l.kind === 'asso' ? ' asso' : ''}" data-ph="${escHtml(g.key)}" style="background:${col}22;color:${col}">${escHtml(l.rime)}${l.guess ? '?' : ''}</span>
           ${levelTag(l)}
           <button class="btn-suggest" onclick="openSuggest(event,${i})">✦</button>
         </span>`;
    } else {
      badge = `<button class="btn-suggest" title="${escHtml(levelTitle(l, i))}" onclick="openSuggest(event,${i})">✦ rime ?</button>`;
    }
    return `<div class="verse-line" data-ph="${g ? escHtml(g.key) : ''}" data-line-index="${i}">
      <span class="v-num">${i+1}</span>
      <span class="v-text">${highlighted}</span>
      <span class="v-syl">${l.syl}syl</span>
      ${badge}
    </div>`;
  }).join('');

  renderSounds(lines, info, groups, groupList, sounds, echoes);

  // Schéma
  document.getElementById('schemeBadge').textContent = info.map(l => chipLabel(l, groups)).join('');
  document.getElementById('schemeDesc').innerHTML = info.map((l, i) => {
    const g = groups[l.group];
    const col = g ? getCol(g.ci) : 'var(--muted)';
    let desc = '<span style="color:var(--muted)">(non rimé)</span>';
    if (g && l.kind === 'rime') {
      desc = `→ rime <strong style="color:${col}">${g.label}</strong>${l.level ? ` ${LEVEL_NAMES[l.level]}` : ''}${l.partner !== null ? ` avec ${l.partner + 1}` : ''}`;
    } else if (g) {
      desc = `→ assonance <strong style="color:${col}">${g.label.toLowerCase()}</strong> avec ${l.partner + 1}`;
    }
    return `<span>Vers ${i+1} &mdash; <em style="color:${col}">${escHtml(l.phon || '—')}</em> ${desc} &mdash; ${l.syl} syllabes</span>`;
  }).join('<br>');
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
  const n = document.getElementById('input').value.split('\n').filter(l => l.trim()).length;
  document.getElementById('charCount').textContent = `${n} vers`;
}

// ── Export ──
function buildReport() {
  if (!lastResult) return '';
  const { lines, info, groups, groupList, sounds, echoes } = lastResult;
  let r = '=== RIME — Rapport d\'analyse ===\n\n';
  r += `Vers : ${lines.length} | Rimés : ${info.filter(l => l.kind === 'rime').length} | Groupes : ${groupList.length}\n`;
  r += `Schéma : ${info.map(l => chipLabel(l, groups)).join('')}  (minuscule = assonance)\n\n`;
  r += '--- Vers ---\n';
  lines.forEach((l, i) => {
    const it = info[i];
    const lvl = it.kind === 'asso' ? 'assonance' : (it.level ? LEVEL_NAMES[it.level] : '');
    r += `[${i+1}] [${chipLabel(it, groups)}] [${it.syl}syl] [${it.phon}${lvl ? ' · ' + lvl : ''}] ${l}\n`;
  });
  r += '\n--- Fins de vers ---\n';
  groupList.forEach(g => {
    const levels = Object.entries(g.levels).map(([lvl, c]) => `${c} ${LEVEL_NAMES[lvl]}`).join(', ');
    r += `${g.type === 'rime' ? 'Rime' : 'Assonance'} ${g.label} "${g.display}" × ${g.lines.length + g.asso.length}${levels ? ` (${levels})` : ''}\n`;
  });
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
  el.innerHTML = savedHistory.map(item => `
    <div class="history-item" onclick="loadHistory(${item.id})">
      <div class="history-preview">${escHtml(item.text.split('\n')[0])}</div>
      <div class="history-meta">${item.date} · ${item.text.split('\n').filter(Boolean).length} vers</div>
      <button class="history-del" onclick="deleteHistory(event,${item.id})">×</button>
    </div>
  `).join('');
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

function scheduleAnalyze() {
  clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(() => {
    if (document.getElementById('input').value.trim()) analyze();
  }, 600);
}

function immediateAnalyze() {
  clearTimeout(analyzeTimer);
  analyzeTimer = null;
  if (document.getElementById('input').value.trim()) analyze();
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
let popoverState = null; // { lineIndex, wordIndex, token }

function openSuggest(e, lineIndex) {
  e.stopPropagation();
  if (!lastResult) return;
  const info = lastResult.info[lineIndex];
  if (!info || info.end === null) return;
  const token = lineTokens(lastResult.lines[lineIndex])[info.end];
  const word = cleanWord(token);
  if (!word) return;
  popoverState = { lineIndex, wordIndex: info.end, token };
  openContextualPopover(e.currentTarget.getBoundingClientRect(), lineIndex, word);
}

function endWordOf(i) {
  const info = lastResult.info[i];
  return info.end === null ? '' : cleanWord(lineTokens(lastResult.lines[i])[info.end]);
}

async function openContextualPopover(rect, lineIndex, word) {
  if (!lastResult) return;
  const el = getOrCreatePopover();
  el.innerHTML = `<div class="suggest-header">Suggestions — vers ${lineIndex + 1}</div>
    <div class="suggest-body"><span class="suggest-empty">…</span></div>`;
  positionPopover(el, rect);
  el.classList.add('show');
  const state = popoverState;

  const { groupList, info } = lastResult;
  const ownGroup = popoverState.wordIndex === info[lineIndex].end ? info[lineIndex].group : null;

  // Le mot lui-même, puis les groupes de rimes les plus proches du vers
  const targets = [{ query: word, group: lastResult.groups[ownGroup], current: true }];
  groupList
    .filter(g => g.type === 'rime' && g.key !== ownGroup)
    .map(g => ({ g, near: g.lines.reduce((best, j) => Math.abs(j - lineIndex) < Math.abs(best - lineIndex) ? j : best) }))
    .sort((a, b) => Math.abs(a.near - lineIndex) - Math.abs(b.near - lineIndex))
    .slice(0, 3)
    .forEach(({ g, near }) => targets.push({ query: endWordOf(near), group: g, current: false }));

  const fetched = await Promise.all(targets.map(async t => ({ ...t, data: await fetchRhymes(t.query, { n: 12 }) })));

  if (!el.classList.contains('show') || popoverState !== state) return;
  const body = el.querySelector('.suggest-body');
  const sections = fetched
    .filter(({ data }) => data && (Object.values(data.levels).some(l => l.length) || data.asso.length))
    .map(({ group, current, data, query }) => {
      const col = group ? getCol(group.ci) : 'var(--text2)';
      const refWords = group
        ? [...group.lines].filter(idx => idx !== lineIndex).slice(0, 3).map(endWordOf).filter(Boolean)
        : [];
      return `<div class="suggest-section">
        <div class="suggest-section-title">
          ${group ? `<span style="color:${col}">Rime ${group.label}</span>` : ''}
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
      applyWordReplacement(popoverState.lineIndex, popoverState.wordIndex, popoverState.token, chip.dataset.word);
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

function applyWordReplacement(lineIndex, wordIndex, originalToken, newWord) {
  const m = originalToken.match(/^([^a-zàâäéèêëîïôùûüÿçœ]*)(.+?)([^a-zàâäéèêëîïôùûüÿçœ]*)$/i);
  const replacement = (m?.[1] || '') + newWord + (m?.[3] || '');
  const ta = document.getElementById('input');
  const allLines = ta.value.split('\n');
  let count = 0;
  for (let i = 0; i < allLines.length; i++) {
    if (!allLines[i].trim()) continue;
    if (count === lineIndex) {
      const lead = allLines[i].match(/^\s*/)[0];
      const parts = allLines[i].slice(lead.length).split(/(\s+)/);
      let wi = 0;
      for (let j = 0; j < parts.length; j++) {
        if (/^\s+$/.test(parts[j]) || !parts[j]) continue;
        if (wi === wordIndex) { parts[j] = replacement; break; }
        wi++;
      }
      allLines[i] = lead + parts.join('');
      break;
    }
    count++;
  }
  ta.value = allLines.join('\n');
  closePopover();
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

function applyHighlight(ph) {
  document.querySelectorAll('.verse-line[data-ph]').forEach(el => {
    const match = el.dataset.ph === ph;
    el.classList.toggle('ph-active', match);
    el.classList.toggle('ph-dim', !match);
  });
  document.querySelectorAll('.p-chip[data-ph], .legend-item[data-ph]').forEach(el => {
    const match = el.dataset.ph === ph;
    el.classList.toggle('ph-active', match);
    el.classList.toggle('ph-dim', !match);
  });
}

function clearHighlight() {
  document.querySelectorAll('.ph-active, .ph-dim, .ph-locked').forEach(el =>
    el.classList.remove('ph-active', 'ph-dim', 'ph-locked')
  );
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
  if (wordEl) {
    const token = wordEl.dataset.token || '';
    const word = cleanWord(token);
    const verseLine = wordEl.closest('[data-line-index]');
    const lineIndex = parseInt(verseLine?.dataset.lineIndex ?? '-1');
    if (word.length >= 3 && lineIndex >= 0) {
      popoverState = { lineIndex, wordIndex: parseInt(wordEl.dataset.wordIndex), token };
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
