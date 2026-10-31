// Captures de l'app avec un texte d'exemple : node --no-warnings tools/screens.mjs [dossier]
// Trois largeurs, plus les Reprises et le menu mobile. Échoue si la page lève une erreur ou si la CSP bloque quelque chose.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const out = process.argv[2] || 'tools/screens';
mkdirSync(out, { recursive: true });

const TEXT = `# Coûts irrécupérables
[Couplet 1]
Je préfère voir les choses du bon côté
Bien qu'on nous dise de pas s'accrocher kéké
J'ai grandi dans la ville où les rêves sont cotés
Où les grands parlent de fric et les petits de sauter (yah)
Lui dire que je fais le jeu des Dieux
Le temps des rides genre blasphème des rites
Je fixe le vide, j'oublie les rites
Je suis mon guide, je pars bien vite x2

[Refrain]
Mes amis sont super
Des têtes
Des sale têtes qu'on connait grave
# fin`;

const STORAGE = {
  'rime-current': { id: null, text: TEXT, folder: 'f1', tags: ['storytelling'], prods: [], prod: null },
  'rime-folders': [{ id: 'f1', name: 'Album 01' }],
  'rime-history': [{ id: 1, text: '# Premier son\nUn vers\nDeux vers', updated: 1, folder: 'f1', tags: ['à finir'] }],
};

const SHOTS = [
  ['1440', 1440, 900, {}],
  ['1280', 1280, 760, {}],
  ['1440-reprises-voyelles', 1440, 900, { repeats: true, vow: true, lib: false }],
  ['mobile', 390, 844, {}],
  ['mobile-affichage', 390, 844, {}, `document.getElementById('viewBtn').click()`],
  ['mobile-panneau', 390, 844, { rail: true, lib: false, flow: true }],
];

const browser = await launch();
let errors = 0;
for (const [name, w, h, prefs, after] of SHOTS) {
  const page = await browser.page();
  await page.size(w, h);
  await page.seed({ ...STORAGE, ...(Object.keys(prefs).length && { 'rime-prefs': prefs }) });
  await sleep(1800);
  // Curseur sur le vers 3 : le panneau montre ses rimes
  await page.eval(`(() => { const ta = document.getElementById('input'); ta.focus(); ta.setSelectionRange(150, 150); document.dispatchEvent(new Event('selectionchange')); })()`);
  if (after) await page.eval(after);
  await sleep(900);
  await page.screenshot(join(out, `${name}.png`));
  for (const e of page.errors) { console.log(`ERREUR ${name} : ${e}`); errors++; }
  console.log(`${name}.png`);
}
await browser.close();
process.exit(errors ? 1 : 0);
