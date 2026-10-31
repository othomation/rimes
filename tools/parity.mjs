// Parité des marqueurs : markers.js (navigateur) face à analysis.py (serveur, la référence).
// node tools/parity.mjs — compare le type de chaque ligne et les mots muets de chaque vers.
import { rowType, scanTokens } from '../markers.js';

const API = `${process.env.RIME_URL || 'http://localhost:8080'}/api/analyze`;

const LINES = [
  '', '   ', '\t', '# titre', '  # titre indenté', '#', '# # #', 'mot # fin muette', 'mot #', 'a#b et c',
  '[Couplet 1]', '[Couplet 1] (yeah)', '[didascalie] et texte', 'texte [didascalie] suite',
  '(adlib)', '(yeah) (skrr)', 'paradis(merde) on y croit', 'mot (adlib en fin)', '(début) mot',
  'mot ((double)) fin', 'mot ) fermante seule', 'mot ( ouverte jamais fermée', '((', '))',
  'x2', '2x', 'X3!', '×4', 'ça va x2 ça va', 'x2 au début', '12', 'chiffres 123 456', '—', '...', '-',
  'l’apostrophe courbe', 'nbsp entre', 'em espace', 'zéro​largeur', 'idéo　graphique',
  '﻿bom en tête', 'émoji 🎤 micro', 'Yah', 'ÉCRIT EN CAPITALES', 'tab\tau milieu', '  espaces  doubles  ',
];

const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: LINES }) });
if (!res.ok) { console.error(`API : HTTP ${res.status}`); process.exit(1); }
const data = await res.json();
const failures = [];
LINES.forEach((line, r) => {
  const want = data.rows[r];
  const got = rowType(line);
  if (got !== want.type) failures.push(`type de ${JSON.stringify(line)} : navigateur ${got}, serveur ${want.type}`);
  if (want.type !== 'verse') return;
  const muted = scanTokens(line).flatMap((t, i) => t.spoken ? [] : [i]);
  const server = data.lines[want.verse].muted;
  if (muted.join() !== server.join()) failures.push(`mots muets de ${JSON.stringify(line)} : navigateur [${muted}], serveur [${server}]`);
});
if (failures.length) {
  console.log(`Parité : ${failures.length} écart(s)\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`Parité des marqueurs : ${LINES.length} lignes identiques`);
