// ── Color palette (CSS var names) ──
const COL_VARS = ['--col0','--col1','--col2','--col3','--col4','--col5','--col6','--col7'];
function getCol(i) { return getComputedStyle(document.documentElement).getPropertyValue(COL_VARS[i % COL_VARS.length]).trim(); }

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let lastResult = null;

// ── API ──
const API_BASE = '/api';
const rhymeCache = new Map();

async function fetchRhymes(word) {
  const key = word.toLowerCase();
  if (rhymeCache.has(key)) return rhymeCache.get(key);
  try {
    const res = await fetch(`${API_BASE}/query?query=${encodeURIComponent(key)}&n=80`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    rhymeCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}
let savedHistory = JSON.parse(localStorage.getItem('rime-history') || '[]');

// ── Phonème fin de mot ──
function getEndPhoneme(word) {
  word = (word||'').toLowerCase().replace(/[^a-zàâäéèêëîïôùûüÿç]/g,'');
  if (!word) return null;
  const p = [
    [/tion$|sion$/, 'syon'], [/eur$|eurs$/, 'eur'],
    [/oir$|oirs$/, 'war'], [/ain$|ein$|im$|in$|ins$|un$/, 'ain'],
    [/ong$|on$|ons$/, 'on'], [/ent$|ants$|and$|ands$/, 'an'],
    [/eau$|eaux$|aut$|aux$|au$/, 'o'],
    [/nuit$/, 'ui'], [/vie$/, 'vi'], [/pie$|rie$|lie$|mie$|nie$/, 'i'],
    [/ie$/, 'i'], [/is$|it$|ix$/, 'i'],
    [/ue$|us$|ut$/, 'u'], [/out$|oût$/, 'u'],
    [/ive$|ives$/, 'iv'], [/age$|ages$/, 'aj'],
    [/ette$|ettes$/, 'et'], [/eur$|eurs$/, 'eur'],
    [/our$|ours$/, 'our'], [/oir$/, 'war'],
    [/oi$|ois$|oit$/, 'wa'],
    [/é$|ée$|ez$|er$|ées$|ers$/, 'e'],
    [/aille$|ailles$/, 'ay'], [/eil$|eille$/, 'ey'],
    [/eur$/, 'eur'],
  ];
  for (const [re,ph] of p) if (re.test(word)) return ph;
  if (word.length >= 3) return word.slice(-3);
  return word.slice(-2);
}

function getLastWord(line) {
  const w = line.trim().split(/\s+/);
  return (w[w.length-1]||'').replace(/[^a-zàâäéèêëîïôùûüÿç]/gi,'');
}

function getLastToken(line) {
  const w = line.trim().split(/\s+/);
  return w[w.length-1] || '';
}

// ── Comptage syllabes (approximatif français) ──
function countSyllables(line) {
  let s = line.toLowerCase()
    .replace(/[^a-zàâäéèêëîïôùûüÿç\s]/g,'')
    .replace(/\s+/g,' ').trim();
  let count = 0;
  const words = s.split(' ');
  for (const w of words) {
    if (!w) continue;
    let wc = (w.match(/[aeiouyàâäéèêëîïôùûüÿ]+/g)||[]).length;
    if (/[^aeiouyàâäéèêëîïôùûüÿ]e$/.test(w)) wc = Math.max(1, wc - 1);
    count += Math.max(1, wc);
  }
  return count;
}

// ── Détection rimes internes ──
function findInternalRhymes(line, allEndPhonemes) {
  const words = line.trim().split(/\s+/);
  const result = [];
  for (let wi = 0; wi < words.length - 1; wi++) {
    const w = words[wi].replace(/[^a-zàâäéèêëîïôùûüÿç]/gi,'');
    const ph = getEndPhoneme(w);
    if (!ph) continue;
    if (allEndPhonemes.includes(ph)) result.push(wi);
  }
  return result;
}

// ── Highlighting des mots dans une ligne ──
function highlightLine(line, endPh, inRhyme, col, internalWordIndices) {
  const words = line.split(/(\s+)/);
  let wordIdx = -1;
  const wordCount = words.filter(t => !/^\s+$/.test(t)).length;
  let out = '';
  for (const tok of words) {
    if (/^\s+$/.test(tok)) { out += tok; continue; }
    wordIdx++;
    const isLast = wordIdx === wordCount - 1;
    const isInternal = internalWordIndices.includes(wordIdx);
    const escaped = escHtml(tok);
    const attrs = `data-word-index="${wordIdx}" data-token="${escHtml(tok)}"`;
    if (isLast && inRhyme) {
      out += `<span class="rw" ${attrs} style="background:${col}22;color:${col}">${escaped}</span>`;
    } else if (isInternal) {
      out += `<span class="rw-int" ${attrs} style="color:${col};text-decoration-color:${col}">${escaped}</span>`;
    } else {
      out += `<span class="rw-plain" ${attrs}>${escaped}</span>`;
    }
  }
  return out;
}

// ── Analyse principale ──
function analyze() {
  const raw = document.getElementById('input').value.trim();
  if (!raw) return;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;

  const phonemes = lines.map(l => getEndPhoneme(getLastWord(l)));
  const syllables = lines.map(l => countSyllables(l));

  const groups = {};
  let ci = 0;
  phonemes.forEach(ph => {
    if (!ph) return;
    if (!groups[ph]) groups[ph] = { ci: ci++ % COL_VARS.length, lines: [] };
  });
  phonemes.forEach((ph,i) => { if (ph && groups[ph]) groups[ph].lines.push(i); });

  const rhymeGroups = Object.fromEntries(Object.entries(groups).filter(([,v]) => v.lines.length > 1));
  const rhymeLines = new Set(Object.values(rhymeGroups).flatMap(v => v.lines));

  const phToLabel = {};
  let li = 0;
  phonemes.forEach(ph => {
    if (ph && rhymeGroups[ph] && !phToLabel[ph]) phToLabel[ph] = LABELS[li++ % 26];
  });

  const rhymePhonemes = Object.keys(rhymeGroups);

  lastResult = { lines, phonemes, syllables, groups, rhymeGroups, rhymeLines, phToLabel, rhymePhonemes };
  renderAll();
}

function renderAll() {
  const { lines, phonemes, syllables, groups, rhymeGroups, rhymeLines, phToLabel, rhymePhonemes } = lastResult;

  ['emptyState','emptyStateAsso','emptyStateSchema'].forEach(id => document.getElementById(id).style.display = 'none');
  ['analysisContent','assoContent','schemaContent'].forEach(id => document.getElementById(id).style.display = 'block');

  const density = Math.round((rhymeLines.size / lines.length) * 100);
  const avgSyl = Math.round(syllables.reduce((a,b) => a+b, 0) / syllables.length);
  const internalCount = lines.reduce((acc, line, i) => {
    const internal = findInternalRhymes(line, rhymePhonemes);
    return acc + internal.length;
  }, 0);

  // Stats
  document.getElementById('statsRow').innerHTML = `
    <div class="stat"><div class="stat-num">${lines.length}</div><div class="stat-lbl">Vers</div></div>
    <div class="stat"><div class="stat-num">${rhymeLines.size}</div><div class="stat-lbl">Rimés</div></div>
    <div class="stat"><div class="stat-num">${density}%</div><div class="stat-lbl">Densité</div></div>
    <div class="stat"><div class="stat-num">${avgSyl}</div><div class="stat-lbl">Syl. moy.</div></div>
    <div class="stat"><div class="stat-num">${internalCount}</div><div class="stat-lbl">Rimes int.</div></div>
  `;

  // Pattern chips
  document.getElementById('patternChips').innerHTML = phonemes.map(ph => {
    const lbl = phToLabel[ph] || '·';
    if (lbl === '·') return `<span class="p-chip" style="color:var(--chip-neutral-txt);background:var(--chip-neutral-bg)">·</span>`;
    const col = getCol(groups[ph].ci);
    return `<span class="p-chip" data-ph="${ph}" style="background:${col}22;color:${col}">${lbl}</span>`;
  }).join('');

  // Legend
  document.getElementById('legendEl').innerHTML = Object.entries(phToLabel).map(([ph,lbl]) => {
    const col = getCol(groups[ph].ci);
    return `<span class="legend-item" data-ph="${ph}"><span class="legend-dot" style="background:${col}"></span>Rime ${lbl} — <em style="color:${col}">${ph}</em> (${groups[ph].lines.length}×)</span>`;
  }).join('');

  // Lines with highlighting
  document.getElementById('linesList').innerHTML = lines.map((line, i) => {
    const ph = phonemes[i];
    const inRhyme = !!(ph && rhymeGroups[ph]);
    const col = inRhyme ? getCol(groups[ph].ci) : '#888';
    const lbl = phToLabel[ph] || null;
    const internalIdxs = findInternalRhymes(line, rhymePhonemes);
    const highlighted = highlightLine(line, ph, inRhyme, col, internalIdxs);
    const badge = lbl
      ? `<span style="display:flex;align-items:center;gap:4px">
           <span class="v-rime" data-ph="${ph}" style="background:${col}22;color:${col}">${ph}</span>
           <button class="btn-suggest" onclick="openSuggest(event,${i})">✦</button>
         </span>`
      : `<button class="btn-suggest" onclick="openSuggest(event,${i})">✦ rime ?</button>`;
    return `<div class="verse-line" data-ph="${inRhyme ? ph : ''}" data-line-index="${i}">
      <span class="v-num">${i+1}</span>
      <span class="v-text">${highlighted}</span>
      <span class="v-syl">${syllables[i]}syl</span>
      ${badge}
    </div>`;
  }).join('');

  // Assonances
  const sorted = Object.entries(groups).filter(([,v]) => v.lines.length > 1).sort((a,b) => b[1].lines.length - a[1].lines.length);
  const maxC = sorted[0]?.[1].lines.length || 1;
  document.getElementById('assoGrid').innerHTML = sorted.slice(0,8).map(([ph,v]) => {
    const col = getCol(v.ci);
    const pct = Math.round(v.lines.length / maxC * 100);
    const sample = v.lines.slice(0,2).map(i => lines[i]).join(' / ');
    return `<div class="asso-card">
      <div class="asso-sound" style="color:${col}">${ph}</div>
      <div class="asso-bar-wrap"><div class="asso-bar" style="width:${pct}%;background:${col}"></div></div>
      <div class="asso-count">${v.lines.length}×</div>
      <div class="asso-verses">${escHtml(sample.slice(0,70))}${sample.length>70?'…':''}</div>
    </div>`;
  }).join('') || '<p style="font-family:\'Space Mono\',monospace;font-size:11px;color:var(--muted)">Aucune assonance trouvée</p>';

  // Schéma
  const patStr = phonemes.map(ph => phToLabel[ph]||'·').join('');
  document.getElementById('schemeBadge').textContent = patStr;
  document.getElementById('schemeDesc').innerHTML = lines.map((line, i) => {
    const ph = phonemes[i];
    const inRhyme = ph && rhymeGroups[ph];
    const col = inRhyme ? getCol(groups[ph].ci) : 'var(--muted)';
    const lbl = phToLabel[ph] ? `→ rime <strong style="color:${col}">${phToLabel[ph]}</strong>` : '<span style="color:var(--muted)">(non rimé)</span>';
    return `<span>Vers ${i+1} &mdash; <em style="color:${col}">${ph||'—'}</em> ${lbl} &mdash; ${syllables[i]} syllabes</span>`;
  }).join('<br>');
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
  const { lines, phonemes, syllables, phToLabel, rhymeGroups, groups } = lastResult;
  let r = '=== RIME — Rapport d\'analyse ===\n\n';
  r += `Vers : ${lines.length} | Rimés : ${lastResult.rhymeLines.size} | Groupes : ${Object.keys(rhymeGroups).length}\n\n`;
  r += '--- Vers ---\n';
  lines.forEach((l, i) => {
    const lbl = phToLabel[phonemes[i]] || '·';
    r += `[${i+1}] [${lbl}] [${syllables[i]}syl] ${l}\n`;
  });
  r += '\n--- Assonances ---\n';
  Object.entries(groups).filter(([,v])=>v.lines.length>1).sort((a,b)=>b[1].lines.length-a[1].lines.length).forEach(([ph,v])=>{
    r += `"${ph}" × ${v.lines.length}\n`;
  });
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
  lastResult = null;
  lockedPh = null; activePh = null; clearHighlight();
  ['analysisContent','assoContent','schemaContent'].forEach(id => document.getElementById(id).style.display = 'none');
  ['emptyState','emptyStateAsso','emptyStateSchema'].forEach(id => document.getElementById(id).style.display = 'flex');
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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

// ── Suggest popover ──
let popoverState = null; // { lineIndex, wordIndex: null|number, token: null|string }

async function openSuggest(e, lineIndex) {
  e.stopPropagation();
  if (!lastResult) return;
  const word = getLastWord(lastResult.lines[lineIndex] || '');
  if (!word) return;
  popoverState = { lineIndex, wordIndex: null, token: null };
  openContextualPopover(e.currentTarget.getBoundingClientRect(), lineIndex, word);
}

async function openContextualPopover(rect, lineIndex, word) {
  if (!lastResult) return;
  const el = getOrCreatePopover();
  el.innerHTML = `<div class="suggest-header">Suggestions — vers ${lineIndex + 1}</div>
    <div class="suggest-body"><span class="suggest-empty">…</span></div>`;
  positionPopover(el, rect);
  el.classList.add('show');

  const { groups, rhymeGroups, phToLabel } = lastResult;
  const currentPh = getEndPhoneme(word);
  const phonemes = [...new Set([...Object.keys(rhymeGroups), ...(currentPh ? [currentPh] : [])])];

  const fetched = await Promise.all(phonemes.map(async ph => {
    const repIdx = groups[ph]?.lines[0];
    const repWord = repIdx !== undefined ? getLastWord(lastResult.lines[repIdx]) : ph;
    const data = await fetchRhymes(repWord);
    return { ph, data };
  }));

  if (!el.classList.contains('show')) return;
  const body = el.querySelector('.suggest-body');
  const sections = fetched
    .filter(({ data }) => data?.words?.length)
    .map(({ ph, data }) => {
      const label = phToLabel[ph];
      const col = getCol(groups[ph]?.ci ?? 0);
      const isCurrent = ph === currentPh;
      const refWords = (groups[ph]?.lines || [])
        .filter(idx => idx !== lineIndex)
        .slice(0, 3)
        .map(idx => getLastToken(lastResult.lines[idx]))
        .filter(Boolean);
      const chips = data.words.filter(w => w !== word).slice(0, 25)
        .map(w => `<button class="suggest-chip" data-word="${escHtml(w)}">${escHtml(w)}</button>`)
        .join('');
      return `<div class="suggest-section">
        <div class="suggest-section-title">
          ${label ? `<span style="color:${col}">Rime ${label}</span>` : ''}
          ${refWords.length ? `<span class="suggest-refs">${escHtml(refWords.join(', '))}</span>` : ''}
          <em style="color:${col}">${ph}</em>
          ${isCurrent ? '<span class="suggest-current">actuel</span>' : ''}
        </div>
        <div class="suggest-chips">${chips}</div>
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
      if (popoverState.wordIndex === null) {
        applySuggestion(popoverState.lineIndex, chip.dataset.word);
      } else {
        applyWordReplacement(popoverState.lineIndex, popoverState.wordIndex, popoverState.token, chip.dataset.word);
      }
    });
  }
  return el;
}

function positionPopover(el, rect) {
  let left = rect.left;
  if (left + 350 > window.innerWidth) left = Math.max(10, window.innerWidth - 360);
  el.style.left = `${left}px`;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 320 && rect.top > spaceBelow) {
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

function applySuggestion(lineIndex, newWord) {
  const ta = document.getElementById('input');
  const allLines = ta.value.split('\n');
  let count = 0;
  for (let i = 0; i < allLines.length; i++) {
    if (!allLines[i].trim()) continue;
    if (count === lineIndex) {
      const parts = allLines[i].split(/(\s+)/);
      const wordParts = parts.filter(p => !/^\s+$/.test(p));
      const lastToken = wordParts[wordParts.length - 1];
      const m = lastToken.match(/^([^a-zàâäéèêëîïôùûüÿça-zA-Z]*)(.+?)([^a-zàâäéèêëîïôùûüÿça-zA-Z]*)$/i);
      const replacement = (m?.[1] || '') + newWord + (m?.[3] || '');
      let wi = 0;
      for (let j = 0; j < parts.length; j++) {
        if (/^\s+$/.test(parts[j])) continue;
        if (wi === wordParts.length - 1) { parts[j] = replacement; break; }
        wi++;
      }
      allLines[i] = parts.join('');
      break;
    }
    count++;
  }
  ta.value = allLines.join('\n');
  closePopover();
  analyze();
}

function applyWordReplacement(lineIndex, wordIndex, originalToken, newWord) {
  const m = originalToken.match(/^([^a-zàâäéèêëîïôùûüÿça-zA-Z]*)(.+?)([^a-zàâäéèêëîïôùûüÿça-zA-Z]*)$/i);
  const replacement = (m?.[1] || '') + newWord + (m?.[3] || '');
  const ta = document.getElementById('input');
  const allLines = ta.value.split('\n');
  let count = 0;
  for (let i = 0; i < allLines.length; i++) {
    if (!allLines[i].trim()) continue;
    if (count === lineIndex) {
      const parts = allLines[i].split(/(\s+)/);
      let wi = 0;
      for (let j = 0; j < parts.length; j++) {
        if (/^\s+$/.test(parts[j])) continue;
        if (wi === wordIndex) { parts[j] = replacement; break; }
        wi++;
      }
      allLines[i] = parts.join('');
      break;
    }
    count++;
  }
  ta.value = allLines.join('\n');
  closePopover();
  analyze();
}

// ── Atelier ──
async function atelierSearch() {
  const word = document.getElementById('atelierInput').value.trim();
  if (!word) return;
  const el = document.getElementById('atelierResults');
  el.innerHTML = '<div class="atelier-empty">Recherche…</div>';
  const data = await fetchRhymes(word);
  if (!data?.words?.length) {
    el.innerHTML = '<div class="atelier-empty">Aucune rime trouvée</div>';
    return;
  }
  el.innerHTML = `
    <div class="atelier-section">
      <div class="section-title">Rimes en <em style="color:var(--accent);font-style:normal">${escHtml(data.phoneme)}</em>
        <span style="color:var(--muted);font-size:9px;margin-left:6px">— clic pour insérer au curseur</span>
      </div>
      <div class="atelier-chips">${
        data.words.slice(0, 80).map(w =>
          `<button class="atelier-chip" data-word="${escHtml(w)}">${escHtml(w)}</button>`
        ).join('')
      }</div>
    </div>`;
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
    const word = token.replace(/[^a-zàâäéèêëîïôùûüÿç]/gi, '');
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
