"""Tests du moteur de rimes : cas de non-régression, instantanés d'un corpus, temps bornés.

    python tests/run.py            vérifie tout
    python tests/run.py --update   réécrit les instantanés (tests/expected) après un changement voulu

Un instantané résume l'analyse de chaque texte de tests/corpus, sans et avec les rimes de strophe :
lettre et richesse de chaque vers, rimes internes, familles, reprises. Le diff montre ce qu'un réglage change.
"""
import difflib
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import analysis as A  # noqa: E402
from lexicon import Lexicon  # noqa: E402

LEX = Lexicon(os.environ.get('LEXIQUE_PATH') or HERE.parent / 'lexique.tsv')
UPDATE = '--update' in sys.argv
failures = []


def run(text, stanza=False):
    rows = text.split('\n')
    return rows, A.analyze(rows, LEX, whole_stanza=stanza)


def word(rows, res, v, w):
    tok = A._spoken(rows[res['lines'][v]['row']])[w]
    return re.sub(r"^[^\w']+|[^\w']+$", '', tok)


def where(v, pv):
    return '' if pv == v else f'(v{pv + 1})'


def summary(rows, res):
    groups = {g['key']: g for g in res['groups'] + res['families']}
    out, stanza = [], None
    for v, l in enumerate(res['lines']):
        if l['stanza'] != stanza:
            if stanza is not None:
                out.append('')
            stanza = l['stanza']
        g = groups.get(l['group'])
        label = (g['label'].lower() if l['kind'] == 'asso' else g['label']) if g else '·'
        level = (l['level'] or l['kind'] or '') + (' ≈' if l['kind'] and not l['exact'] else '')
        end = word(rows, res, v, l['end']) if l['end'] is not None else ''
        ints = ' '.join(f"{word(rows, res, v, it['i'])}~{word(rows, res, *it['with'])}{where(v, it['with'][0])}"
                        f"[{groups[it['group']]['label']}]{'' if it['exact'] else '≈'}{' strophe' if it.get('echo') else ''}"
                        for it in l['internal'])
        out.append(f'{v + 1:>3} {label:<3} {level:<14} {end:<14} {ints}'.rstrip())
    for f in res['families']:
        out.append(f"famille {f['label']} « {f['display']} » : " + ' ~ '.join(word(rows, res, v, w) for v, w in f['members']))
    for r in res.get('repeats', []):
        out.append(f"reprise « {r['word']} » : " + ' '.join(f'v{v + 1}' for v, _ in r['members']))
    return '\n'.join(out) + '\n'


def check(name, cond, detail=''):
    if not cond:
        failures.append(f'{name}{f" : {detail}" if detail else ""}')


def linked(rows, res, a, b):
    """Le lien interne entre les mots a et b, dans un sens ou dans l'autre."""
    for v, l in enumerate(res['lines']):
        for it in l['internal']:
            if {word(rows, res, v, it['i']), word(rows, res, *it['with'])} == {a, b}:
                return it
    return None


# ── Cas de non-régression (CLAUDE.md) ──
rows, res = run("Je préfère voir les choses du bon côté\nBien qu'on nous dise de pas s'accrocher kéké")
check("s'accrocher ~ côté (règle 4)", linked(rows, res, "s'accrocher", 'côté'))

rows, res = run('Lui dire que je fais le jeu des Dieux')
check('jeu ~ Dieux (règle 5)', linked(rows, res, 'jeu', 'Dieux'))

rows, res = run('On a le temps des rides genre blasphème des rites')
it = linked(rows, res, 'rides', 'rites')
check('rides ~ rites ≈', it and not it['exact'], str(it))

rows, res = run('Je fixe le vide\nJ\'oublie les rites\nJe suis mon guide\nJe pars bien vite')
letters = [l['group'] for l in res['lines']]
check('vide/rites/guide/vite reste ABAB',
      letters[0] and letters[1] and letters[0] == letters[2] and letters[1] == letters[3] and letters[0] != letters[1],
      str(letters))

# ── Instantanés du corpus ──
for path in sorted((HERE / 'corpus').glob('*.txt')):
    text = path.read_text(encoding='utf-8')
    for stanza in (False, True):
        rows, res = run(text, stanza)
        got = summary(rows, res)
        exp_path = HERE / 'expected' / f"{path.stem}{'.strophe' if stanza else ''}.txt"
        if UPDATE:
            exp_path.write_text(got, encoding='utf-8')
            continue
        want = exp_path.read_text(encoding='utf-8') if exp_path.exists() else ''
        if got != want:
            diff = ''.join(difflib.unified_diff(want.splitlines(True), got.splitlines(True), 'attendu', 'obtenu'))
            failures.append(f'instantané {exp_path.name}\n{diff}')

# ── Instantané des suggestions de rimes ──
lines = []
for q, kw in [('liberté', {}), ('têtes', {}), ('je pars bien vite', {}), ('lumière', {'syl': 2}),
              ('monde', {'cat': 'NOM'}), ('zorblax', {})]:
    s = LEX.suggest(q, n=6, **kw)
    lines.append(f"{q} {kw or ''} → {s['display']} · rime {s['rime']}{' · devinée' if s['guess'] else ''}".replace(' {}', '').replace("' ", "' "))
    lines += [f"  {lvl:<11} {' '.join(it['w'] for it in items)}" for lvl, items in s['levels'].items() if items]
    lines.append(f"  {'assonance':<11} {' '.join(it['w'] for it in s['asso'])}")
got = '\n'.join(lines) + '\n'
exp_path = HERE / 'expected' / 'suggestions.txt'
if UPDATE:
    exp_path.write_text(got, encoding='utf-8')
elif got != (exp_path.read_text(encoding='utf-8') if exp_path.exists() else ''):
    want = exp_path.read_text(encoding='utf-8') if exp_path.exists() else ''
    failures.append('instantané suggestions.txt\n' + ''.join(difflib.unified_diff(want.splitlines(True), got.splitlines(True), 'attendu', 'obtenu')))

# ── Temps bornés : gunicorn n'a que 2 workers synchrones ──
WORDS = ['été', 'côté', 'liberté', 'pensé', 'fumée', 'soirée', 'réalité', 'cité', 'donné', 'passé', 'vérité', 'fierté']
TRAPS = {
    '400 vers tout en é': [' '.join(WORDS[(i + k) % 12] for k in range(4)) for i in range(400)],
    '1 ligne de 20 000 caractères': ['la ' * 6600],
    '400 vers de mots inconnus': [f'zorblax{i} kwintruc{i} flomp{i}' for i in range(400)],
}
for name, lines in TRAPS.items():
    for stanza in (False, True):
        t = time.perf_counter()
        A.analyze(lines, LEX, whole_stanza=stanza)
        ms = (time.perf_counter() - t) * 1000
        check(f'temps : {name}{" (strophe)" if stanza else ""}', ms < 3000, f'{ms:.0f} ms')

if UPDATE:
    print('Instantanés réécrits dans tests/expected')
if failures:
    print(f'{len(failures)} échec(s) :\n')
    print('\n\n'.join(failures))
    sys.exit(1)
print('Moteur : tout passe')
