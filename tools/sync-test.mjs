// Synchro Google Drive et onglets multiples, contre un faux Drive : node --no-warnings tools/sync-test.mjs [filtre]
// Chaque appareil est un contexte Edge isolé (son propre localStorage, son propre IndexedDB).
import { BASE, launch, sleep, waitFor } from './cdp.mjs';
import { GOOGLE_BLOCKED, expiredToken, fakeGoogle, startFakeDrive, validToken } from './fake-drive.mjs';

const only = process.argv[2] || '';
const browser = await launch();
const results = [];

// ── Gestes dans l'app, par l'interface ──
const typeText = (page, text) => page.eval(`(() => { const ta = document.getElementById('input'); ta.focus(); ta.value = ${JSON.stringify(text)}; ta.dispatchEvent(new Event('input')); })()`);
const save = page => page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))`);
const docs = async page => JSON.parse(await page.eval(`localStorage.getItem('rime-history') || '[]'`));
const editor = page => page.eval(`document.getElementById('input').value`);
const click = (page, sel) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('absent : ' + ${JSON.stringify(sel)}); el.click(); })()`);
const openDoc = (page, id) => click(page, `[data-open="${id}"]`);
const setToken = (page, token) => page.eval(`localStorage.setItem('rime-drive-token', ${JSON.stringify(JSON.stringify(token))})`);
// Valider la boîte de dialogue de Rime, une fois ouverte
async function confirmDialog(page) {
  await waitFor('boîte de dialogue', () => page.eval(`!!document.querySelector('dialog[open]')`), 3000);
  await click(page, 'dialog[open] [data-ok]');
}

async function scenario(name, fn) {
  if (only && !name.includes(only)) return;
  const drive = await startFakeDrive();
  const pages = [];
  const ctx = {
    drive,
    async device(storage = {}, { token = validToken(), context } = {}) {
      context ??= await browser.context();
      const page = await browser.page({ context, init: fakeGoogle(drive.url), blocked: GOOGLE_BLOCKED, bypassCsp: true });
      await page.send('Page.setBypassCSP', { enabled: true });
      pages.push(page);
      if (storage) await page.seed({ 'rime-prefs': { lib: true }, 'rime-drive': { on: true, folderName: 'Rime' }, 'rime-drive-token': token, ...storage });
      else await page.goto(BASE);
      page.context = context;
      return page;
    },
    async tab(other) {
      const page = await browser.page({ context: other.context, init: fakeGoogle(drive.url), blocked: GOOGLE_BLOCKED, bypassCsp: true });
      pages.push(page);
      await page.goto(BASE);
      page.context = other.context;
      return page;
    },
  };
  const t = Date.now();
  try {
    await fn(ctx);
    const errors = pages.flatMap(p => p.errors);
    if (errors.length) throw new Error(`erreurs dans la page :\n  ${errors.join('\n  ')}`);
    results.push([name, null]);
    console.log(`ok    ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  } catch (e) {
    results.push([name, e]);
    console.log(`ÉCHEC ${name}\n      ${e.message.replace(/\n/g, '\n      ')}`);
  } finally {
    drive.close();
  }
}

function expect(cond, msg) { if (!cond) throw new Error(msg); }

const V1 = '# Chanson\nPremier vers sur la ville';
const V2 = `${V1}\nDeuxième vers, écrit sur B`;
const V3 = `${V2}\nTroisième vers, encore sur B`;

// Un texte sauvé sur A, repris et modifié sur B ; A revient plus tard, jeton expiré
async function twoDevices({ drive, device }) {
  const A = await device();
  await drive.idle();
  await typeText(A, V1);
  await save(A);
  await drive.idle();
  expect(drive.texts().length === 1, `Drive devrait avoir 1 texte, il en a ${drive.texts().length}`);
  const B = await device();
  await drive.idle();
  const [d] = await docs(B);
  expect(d?.text === V1, `B n'a pas reçu le texte de A : ${JSON.stringify(d?.text)}`);
  await openDoc(B, d.id);
  await typeText(B, V2);
  await save(B);
  await drive.idle();
  expect(drive.texts()[0].content === V2, 'Drive n\'a pas reçu la version de B');
  await setToken(A, expiredToken());
  await A.goto(BASE);
  return { A, B, id: d.id };
}

await scenario('Ctrl+S sans modification sur un appareil resté en arrière : pas de conflit', async ctx => {
  const { A } = await twoDevices(ctx);
  await save(A);   // le réflexe Ctrl+S, sans rien avoir changé
  await ctx.drive.idle();
  const list = await docs(A);
  expect(!list.some(d => d.conflict), `copie « (conflit) » créée : ${list.map(d => JSON.stringify(d.text.split('\n').at(-1))).join(', ')}`);
  expect(list.length === 1 && list[0].text === V2, `A devrait avoir la version de B, il a ${JSON.stringify(list[0]?.text)}`);
  expect(await editor(A) === V2, 'l\'éditeur de A montre encore l\'ancienne version');
  expect(ctx.drive.texts().length === 1 && ctx.drive.texts()[0].content === V2, 'Drive n\'a plus la version de B');
});

await scenario('Au chargement, jeton expiré : un bandeau propose de se reconnecter, puis tout se met à jour', async ctx => {
  const { A } = await twoDevices(ctx);
  await waitFor('bandeau de reconnexion', () => A.eval(`!document.getElementById('driveBanner')?.hidden`), 5000);
  await click(A, '#driveBanner [data-reconnect]');
  await ctx.drive.idle();
  expect(await editor(A) === V2, 'l\'éditeur de A ne montre pas la version de B après reconnexion');
  expect(await A.eval(`document.getElementById('driveBanner').hidden`), 'le bandeau reste affiché');
});

await scenario('Modifié des deux côtés : les deux versions sont gardées', async ctx => {
  const { A } = await twoDevices(ctx);
  const mine = `${V1}\nAutre deuxième vers, écrit sur A`;
  await typeText(A, mine);
  await save(A);
  await ctx.drive.idle();
  const list = await docs(A);
  const copy = list.find(d => d.conflict), main = list.find(d => !d.conflict);
  expect(copy?.text === V2, `la copie « (conflit) » devrait garder la version de B : ${JSON.stringify(copy?.text)}`);
  expect(main?.text === mine, `le texte devrait garder la version de A : ${JSON.stringify(main?.text)}`);
  expect(ctx.drive.texts().length === 2, `Drive devrait avoir 2 textes, il en a ${ctx.drive.texts().length}`);
});

await scenario('Drive change le numéro de version sans toucher au texte : pas de conflit', async ({ drive, device }) => {
  const A = await device();
  await drive.idle();
  await typeText(A, V1);
  await save(A);
  await drive.idle();
  await typeText(A, V2);
  await save(A);
  drive.bump(drive.texts()[0].id);   // avant que la synchro (différée de 1,5 s) parte
  await drive.idle();
  const list = await docs(A);
  expect(!list.some(d => d.conflict), 'copie « (conflit) » créée pour un simple changement de version');
  expect(drive.texts().length === 1 && drive.texts()[0].content === V2, `Drive devrait avoir la nouvelle version : ${JSON.stringify(drive.texts().map(f => f.content))}`);
});

await scenario('Tags modifiés dans Drive : repris sans conflit', async ({ drive, device }) => {
  const A = await device();
  await drive.idle();
  await typeText(A, V1);
  await save(A);
  await drive.idle();
  drive.edit(drive.texts()[0].id, { description: 'Tags : depuis drive' });
  await A.goto(BASE);
  await drive.idle();
  const list = await docs(A);
  expect(list.length === 1 && list[0].tags?.includes('depuis drive'), `tags non repris : ${JSON.stringify(list.map(d => d.tags))}`);
});

await scenario('Modifié ailleurs pendant qu\'on écrit : l\'éditeur n\'est pas écrasé, l\'en-tête prévient', async ctx => {
  const { drive, device } = ctx;
  const A = await device();
  await drive.idle();
  await typeText(A, V1);
  await save(A);
  await drive.idle();
  const B = await device();
  await drive.idle();
  const [d] = await docs(B);
  await openDoc(B, d.id);
  const draft = `${V1}\nEn cours d'écriture sur A`;
  await typeText(A, draft);   // pas sauvé
  await typeText(B, V2);
  await save(B);
  await drive.idle();
  await A.eval(`window.dispatchEvent(new Event('focus'))`);   // retour sur la fenêtre de A
  await A.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(200);
  // Le retour sur la fenêtre ne synchronise qu'après 30 s : on la déclenche par le menu
  await click(A, '[data-action="drive-sync"]');
  await drive.idle();
  expect(await editor(A) === draft, 'l\'éditeur de A a été écrasé');
  expect(/autre appareil/.test(await A.eval(`document.getElementById('docState').textContent`)), 'l\'en-tête ne prévient pas');
  const versions = await A.eval(`new Promise(r => { const q = indexedDB.open('rime'); q.onsuccess = () => { const g = q.result.transaction('versions').objectStore('versions').getAll(); g.onsuccess = () => r(g.result.map(v => v.text)); }; })`);
  expect(versions.includes(V2), 'la version de B n\'est pas dans l\'historique de A');
  await save(A);
  await drive.idle();
  const list = await docs(A);
  expect(list.find(x => x.conflict)?.text === V2 && list.find(x => !x.conflict)?.text === draft, `les deux versions devraient être gardées : ${JSON.stringify(list.map(x => [x.conflict, x.text.split('\n').at(-1)]))}`);
});

await scenario('Dossier, tags et historique passent d\'un appareil à l\'autre', async ({ drive, device }) => {
  const A = await device();
  await drive.idle();
  await typeText(A, V1);
  await save(A);
  await typeText(A, V2);
  await save(A);
  await drive.idle();
  const [d] = await docs(A);
  // Dossier créé, texte rangé, tag et prod ajoutés, par l'interface
  await click(A, '#metaFolderBtn');
  await click(A, '[data-new-folder]');
  await waitFor('boîte de dialogue', () => A.eval(`!!document.querySelector('dialog[open]')`), 3000);
  await A.eval(`document.getElementById('askInput').value = 'Album 01'`);
  await click(A, 'dialog[open] [data-ok]');
  await A.eval(`(() => { const i = document.getElementById('metaTagInput'); i.value = 'storytelling'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
  await drive.idle();
  const B = await device();
  await drive.idle();
  const [db] = await docs(B);
  const folders = JSON.parse(await B.eval(`localStorage.getItem('rime-folders')`));
  expect(folders.some(f => f.name === 'Album 01' && f.id === db.folder), `dossier non repris : ${JSON.stringify({ folders, folder: db.folder })}`);
  expect(db.tags?.includes('storytelling'), `tag non repris : ${JSON.stringify(db.tags)}`);
  expect(db.text === V2 && db.id === d.id, 'texte non repris');
  const versions = await B.eval(`new Promise(r => { const q = indexedDB.open('rime'); q.onsuccess = () => { const g = q.result.transaction('versions').objectStore('versions').getAll(); g.onsuccess = () => r(g.result.map(v => v.text)); }; })`);
  expect(versions.includes(V1) && versions.includes(V2), `historique non repris : ${versions.length} versions`);
});

await scenario('Deux onglets, sans Drive : chaque sauvegarde garde celles de l\'autre', async ({ device, tab }) => {
  const T1 = await device({ 'rime-drive': { on: false } });
  const T2 = await tab(T1);
  await typeText(T1, '# Un\nTexte de l\'onglet un');
  await save(T1);
  await typeText(T2, '# Deux\nTexte de l\'onglet deux');
  await save(T2);
  await sleep(300);
  const titles = (await docs(T1)).map(d => d.text.split('\n')[0]).sort();
  expect(titles.join() === '# Deux,# Un', `textes sauvés : ${titles.join(', ')}`);
  await waitFor('l\'onglet un voit le texte de l\'onglet deux', () => T1.eval(`document.querySelectorAll('[data-open]').length === 2`), 3000);
});

await scenario('Deux onglets avec Drive : un texte supprimé dans l\'un ne revient pas', async ({ drive, device, tab }) => {
  const T1 = await device();
  await drive.idle();
  await typeText(T1, V1);
  await save(T1);
  await drive.idle();
  const T2 = await tab(T1);
  await drive.idle();
  const [d] = await docs(T2);
  await click(T2, `[data-dmenu="${d.id}"]`);
  await click(T2, `[data-ddelete="${d.id}"]`);
  await confirmDialog(T2);
  await sleep(300);
  // L'onglet un synchronise ensuite (un autre texte sauvé)
  await click(T1, '#libNewText');
  await typeText(T1, '# Autre\nUn autre texte');
  await save(T1);
  await drive.idle();
  const titles = (await docs(T1)).map(x => x.text.split('\n')[0]);
  expect(!titles.includes('# Chanson'), `le texte supprimé est revenu : ${titles.join(', ')}`);
  expect(!drive.texts().some(f => f.content === V1), 'le fichier du texte supprimé n\'est pas à la corbeille de Drive');
});

await browser.close();
const failed = results.filter(([, e]) => e);
console.log(`\n${results.length - failed.length}/${results.length} scénarios passent`);
process.exit(failed.length ? 1 : 0);
