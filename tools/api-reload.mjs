// Hook Claude Code (PostToolUse, Edit|Write) : après une modification de deploy/api/*.py, attend que Flask ait
// rechargé le code en dev. Une modification enregistrée pendant un rechargement peut être ignorée : on touche alors
// app.py pour en forcer un autre. Silencieux si tout va bien ou si la pile de dev ne tourne pas ;
// sortie 2 (message lu par Claude) si le code chargé reste plus ancien que la modification.
import { statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEALTH = `${process.env.RIME_URL || 'http://localhost:8080'}/api/health`;
const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'api', 'app.py');

let input = '';
for await (const chunk of process.stdin) input += chunk;
const file = (() => { try { const j = JSON.parse(input); return j.tool_input?.file_path || j.tool_response?.filePath || ''; } catch { return ''; } })();
if (!/[\\/]deploy[\\/]api[\\/][^\\/]+\.py$/.test(file)) process.exit(0);

const started = async () => { try { return (await (await fetch(HEALTH)).json()).started ?? null; } catch { return null; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Le code chargé est-il au moins aussi récent que la modification ? (started : lecture du code par Flask)
async function waitLoaded(edited, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const s = await started();
    if (s !== null && s >= edited) return true;
    await sleep(500);
  }
  return false;
}

async function waitUp(timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await started() !== null) return true;
    await sleep(500);
  }
  return false;
}

const edited = statSync(file).mtimeMs / 1000;
// Pile de dev arrêtée : rien à attendre (pendant un rechargement, /health revient en quelques secondes)
if (await started() === null && !await waitUp(20000)) process.exit(0);
if (await waitLoaded(edited, 45000)) process.exit(0);
const now = new Date();
utimesSync(APP, now, now);
if (await waitLoaded(edited, 45000)) process.exit(0);
process.stderr.write(`L'API de dev n'a pas rechargé ${file} : le code en mémoire est l'ancien. Vérifier les logs (docker logs rime-dev-api-1).\n`);
process.exit(2);
