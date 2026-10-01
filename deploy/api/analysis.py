"""Analyse d'un texte : schéma de rimes, richesse, rimes internes, assonances, sons dominants."""
import re
from collections import Counter, defaultdict

import phonetics as P
from lexicon import ENCLITICS, FUNCTION_CATS, SOUND_CLASSES, STOP_LEMMAS, STOP_WORDS, TONIC, VOWEL_SOUNDS

LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
FAM_LABELS = 'αβγδεζηθικλμνξοπρστυφχψω'
TAIL_WORDS = 4      # mots pris en compte pour les rimes multisyllabiques
ASSO_WINDOW = 4     # une assonance n'est perçue qu'entre vers proches
ECHO_WINDOW = 4
LEVEL_RANK = {'identique': 0, 'pauvre': 1, 'suffisante': 2, 'riche': 3, 'multi': 4}
MAX_VERSES = 400

# Rimes internes : écart maximal (en vers) d'une rime suffisante, et d'une rime riche sur 2 syllabes
NEAR, FAR = 2, 4
LINE_SPAN = 16      # dans un même vers, au-delà de 16 mots d'écart l'écho ne s'entend plus (prose collée)
PAIR_SPAN = 64      # comparaisons par mot et par son : borne les textes piégés (700 mots en /a/ sur une ligne)
# é/è, an et i terminent chacun plus de 6 % des mots pleins : une seule voyelle commune y est fortuite
COMMON_KEYS = frozenset('e@i')
PUNCT = tuple(',;:!?.…—–')

# Même découpage que `trim().split(/\s+/)` côté navigateur
_WS = re.compile('[\t\n\x0b\x0c\r \xa0  -     　﻿]+')
_REPEAT = re.compile(r'^(?:[x×][0-9]+|[0-9]+[x×])[.,;:!?…]*$', re.I)


def _label(i):
    return LABELS[i % 26] + (str(i // 26) if i >= 26 else '')


def _fam_label(i):
    return FAM_LABELS[i % 24] + (str(i // 24 + 1) if i >= 24 else '')


# ── Marqueurs : # commentaire, [section], (adlib) ──

def _tokens(row):
    return [t for t in _WS.split(row) if t]


def _spoken(row):
    """Texte prononcé de chaque token, '' s'il est muet : (adlib), [didascalie], x2, et ce qui suit un # isolé."""
    out = []
    depth = 0
    cut = False
    for i, tok in enumerate(_tokens(row)):
        cut = cut or (tok == '#' and i > 0)
        kept = []
        for c in '' if cut else tok:
            if c in '([':
                depth += 1
            elif c in ')]':
                depth = max(0, depth - 1)
            elif not depth:
                kept.append(c)
        s = ''.join(kept)
        out.append('' if _REPEAT.match(s) else s)
    return out


def _row_type(row, spoken):
    tokens = _tokens(row)
    if not tokens:
        return 'blank'
    if tokens[0].startswith('#'):
        return 'comment'
    if any(c.isalpha() for s in spoken for c in s):
        return 'verse'
    if tokens[0].startswith('['):
        return 'section'
    if '(' in row or '[' in row or any(_REPEAT.match(t) for t in tokens):
        return 'adlib'
    return 'blank'


def _parse_line(spoken, lex):
    words = []
    prev = None
    for s in spoken:
        info = lex.phonetize(s, prev) if s else None
        words.append(info)
        if info:
            prev = info['word']
    # La rime porte sur le dernier mot qui a une voyelle (« … en ville skrr » → ville)
    vocal = [i for i, w in enumerate(words) if w and P.last_vowel_index(w['phon']) >= 0]
    end = vocal[-1] if vocal else None
    said = [i for i, w in enumerate(words) if w and end is not None and i <= end]
    return {
        'words': words,
        'end': end,
        'end_phon': words[end]['phon'] if end is not None else '',
        'tail': ''.join(words[i]['phon'] for i in said[-TAIL_WORDS:]),
        'syl': sum(P.syllables(w['phon']) for w in words if w),
    }


def _best_partner(i, members, parsed):
    # Une rime exacte garde un partenaire exact ; seule une fin rattachée ≈ se compare au voisement près
    key = P.rhyme_key(parsed[i]['end_phon'])
    strict = [j for j in members if j != i and P.rhyme_key(parsed[j]['end_phon']) == key]
    best = None
    for j in strict or members:
        if j == i:
            continue
        cmp = P.compare(parsed[i]['tail'], parsed[j]['tail'])
        if not cmp or cmp['kind'] != 'rime':
            continue
        same_word = parsed[i]['words'][parsed[i]['end']]['word'] == parsed[j]['words'][parsed[j]['end']]['word']
        level = 'identique' if same_word else cmp['level']
        score = (LEVEL_RANK[level], cmp['k'], -abs(i - j))
        if best is None or score > best[0]:
            best = (score, j, level, cmp)
    return best


def analyze(rows, lex):
    # ── Lignes : vers, strophes (lignes vides) et blocs ([sections]) ──
    out_rows, verses = [], []
    stanza = block = 0
    gap = False
    for r, text in enumerate(rows):
        spoken = _spoken(text)
        kind = _row_type(text, spoken)
        if kind == 'verse':
            if len(verses) == MAX_VERSES:
                break
            if gap:
                stanza += 1
                gap = False
            verses.append({'row': r, 'stanza': stanza, 'block': block, 'spoken': spoken})
        elif kind in ('blank', 'section'):
            gap = bool(verses)
            if kind == 'section':
                block += 1
        out_rows.append({'type': kind, 'verse': len(verses) - 1 if kind == 'verse' else None})

    parsed = [_parse_line(v['spoken'], lex) for v in verses]
    n = len(parsed)

    # ── Rimes : même voyelle finale + mêmes consonnes qui suivent ──
    by_key = defaultdict(list)
    for i, p in enumerate(parsed):
        key = P.rhyme_key(p['end_phon'])
        if key:
            by_key[key].append(i)
    groups = []
    line_group = [None] * n
    lonely = defaultdict(list)
    for key, members in by_key.items():
        if len(members) > 1:
            g = {'key': key, 'type': 'rime', 'lines': members, 'asso': []}
            groups.append(g)
            for i in members:
                line_group[i] = g
        else:
            lonely[P.voiced_key(key)].append(members[0])

    # ── Rimes approximatives : une fin restée seule rime ≈ si sa coda ne diffère que par le voisement (rides ~ rites) ──
    by_voiced = {}
    for g in groups:
        by_voiced.setdefault(P.voiced_key(g['key']), g)
    for vkey, members in lonely.items():
        g = by_voiced.get(vkey)
        if g is None and len(members) > 1:
            g = {'key': '≈' + vkey, 'type': 'rime', 'lines': [], 'asso': []}
            groups.append(g)
        if g is not None:
            g['lines'] = sorted(g['lines'] + members)
            for i in members:
                line_group[i] = g

    # ── Assonances : même voyelle finale, consonnes différentes, vers proches ──
    unrhymed = [i for i in range(n) if line_group[i] is None and parsed[i]['end'] is not None]
    for i in unrhymed:
        v = P.vowel_key(parsed[i]['end_phon'])
        near = [(abs(i - j), line_group[j]) for g in groups for j in g['lines']
                if abs(i - j) <= ASSO_WINDOW and P.vowel_key(parsed[j]['end_phon']) == v]
        if near:
            g = min(near, key=lambda x: x[0])[1]
            g['asso'].append(i)
            line_group[i] = g

    parent = {}
    def find(x):
        while parent.get(x, x) != x:
            x = parent[x]
        return x
    loose_lines = [i for i in unrhymed if line_group[i] is None]
    for a_idx, i in enumerate(loose_lines):
        for j in loose_lines[a_idx + 1:]:
            if j - i > ASSO_WINDOW:
                break
            if P.vowel_key(parsed[i]['end_phon']) == P.vowel_key(parsed[j]['end_phon']):
                parent[find(j)] = find(i)
    components = defaultdict(list)
    for i in loose_lines:
        components[find(i)].append(i)
    for members in components.values():
        if len(members) > 1:
            v = P.vowel_key(parsed[members[0]]['end_phon'])
            g = {'key': f'~{v}{members[0]}', 'type': 'asso', 'lines': [], 'asso': members}
            groups.append(g)
            for i in members:
                line_group[i] = g

    groups.sort(key=lambda g: min(g['lines'] + g['asso']))
    for idx, g in enumerate(groups):
        g['label'] = _label(idx)
        g['ci'] = idx
        # Affichage pris sur la première fin qui rime exactement (ni assonance, ni rime ≈ rattachée)
        first = parsed[next((j for j in g['lines'] if P.rhyme_key(parsed[j]['end_phon']) == g['key']),
                            min(g['lines'] or g['asso']))]['end_phon']
        if g['type'] == 'rime':
            g['display'] = P.display(first[P.last_vowel_index(first):])
        else:
            g['display'] = P.display(first[P.last_vowel_index(first)])
        g['levels'] = Counter()

    # ── Détail par vers ──
    out_lines = []
    for i, p in enumerate(parsed):
        g = line_group[i]
        line = {
            'row': verses[i]['row'],
            'stanza': verses[i]['stanza'],
            'syl': p['syl'],
            'end': p['end'],
            'muted': [t for t, s in enumerate(verses[i]['spoken']) if not s],
            'guess': bool(p['end'] is not None and p['words'][p['end']]['guess']),
            'phon': P.display(p['end_phon']),
            'rime': P.display(p['end_phon'][P.last_vowel_index(p['end_phon']):]) if p['end_phon'] else '',
            'group': g['key'] if g else None,
            'kind': None, 'level': None, 'k': 0, 'syl_match': 0, 'partner': None, 'exact': True,
            'internal': [],
        }
        if g and i in g['lines']:
            best = _best_partner(i, g['lines'], parsed)
            line['kind'] = 'rime'
            if best:
                _, j, level, cmp = best
                line.update(level=level, k=cmp['k'], syl_match=cmp['syl'], partner=j, exact=cmp['exact'])
                g['levels'][level] += 1
        elif g:
            members = [j for j in g['lines'] + g['asso'] if j != i]
            j = min(members, key=lambda j: abs(i - j))
            line.update(kind='asso', partner=j, exact=False,
                        syl_match=P.common_vowel_suffix(p['tail'], parsed[j]['tail']))
        out_lines.append(line)

    for g in groups:
        g['levels'] = dict(g['levels'])

    return {
        'rows': out_rows,
        'lines': out_lines,
        'groups': groups,
        'families': _internal(verses, parsed, out_lines),
        'sounds': _sounds(parsed, lex.baseline),
        'echoes': _echoes(parsed, line_group),
    }


# ── Rimes internes ──

def _accented(words, spoken, i):
    """Un mot (hors fin de vers) porte-t-il l'accent, donc une rime possible ?"""
    w = words[i]
    after = next((s for s in spoken[i + 1:] if s), '')
    if spoken[i].rstrip('»"”').endswith(PUNCT) or after.startswith(PUNCT):
        return True     # fin de groupe : « Lui, il fuit », « j'veux tout, »
    word, cat = w['word'], w['cat']
    if word in TONIC or cat.startswith('PRO:pos') or ('-' in word and word.rsplit('-', 1)[1] in ENCLITICS):
        return True
    if cat.startswith(FUNCTION_CATS) or word in STOP_WORDS:
        return False
    return cat == 'NOM' or not (w['lemmes'] & STOP_LEMMAS)


def _linked(a, b, d, k, v):
    """La rime interne s'entend-elle ? k phonèmes et v voyelles en commun, d vers d'écart."""
    if k >= 2:
        return d <= NEAR or (k >= 3 and v >= 2)
    if d == 0 and a['series'] and a['key'] != 'e':
        return True     # trois mots du vers ou plus sur le même son
    if a['guess'] or b['guess'] or not (a['end'] or b['end']) or d > 1:
        return False
    return v >= 2 or a['key'] not in COMMON_KEYS    # s'accrocher ~ côté, jeu ~ Dieux


def _internal(verses, parsed, lines):
    """Familles de mots qui riment à l'intérieur des vers ; remplit lines[…]['internal']."""
    nodes = []
    for li, (v, p) in enumerate(zip(verses, parsed)):
        words, end = p['words'], p['end']
        # Un mot par lemme et par vers, la fin de vers d'abord
        seen, kept = set(), []
        for i in ([end] if end is not None else []) + [i for i in range(len(words)) if i != end]:
            w = words[i]
            if not w or P.last_vowel_index(w['phon']) < 0 or (i != end and not _accented(words, v['spoken'], i)):
                continue
            if w['word'] in seen or w['lemmes'] & seen:
                continue
            seen |= {w['word']} | w['lemmes']
            kept.append(i)
        for i in sorted(kept):
            w = words[i]
            vi = P.last_vowel_index(w['phon'])
            nodes.append({
                'li': li, 'i': i, 'end': i == end, 'block': v['block'],
                'word': w['word'], 'lemmes': w['lemmes'], 'guess': w['guess'], 'rime': w['phon'][vi:],
                'key': P.voiced_key(w['phon']), 'strict': P.rhyme_key(w['phon']),
                'onset': P.loose(w['phon'][:vi].replace('°', '')), 'vowels': P.vowels(w['phon'].replace('°', '')),
                'group': lines[li]['group'] if i == end and lines[li]['kind'] == 'rime' else None,
            })
    per_line = Counter((nd['li'], nd['key']) for nd in nodes)
    for nd in nodes:
        nd['series'] = per_line[nd['li'], nd['key']] >= 3

    # Paires par (bloc, son), vers après vers
    buckets = defaultdict(list)
    for x, nd in enumerate(nodes):
        buckets[nd['block'], nd['key']].append(x)
    edges = []
    for ids in buckets.values():
        for j, a in enumerate(ids):
            A = nodes[a]
            for b in ids[j + 1:j + 1 + PAIR_SPAN]:
                B = nodes[b]
                d = B['li'] - A['li']
                if d > FAR:
                    break
                if d == 0 and B['i'] - A['i'] > LINE_SPAN:
                    continue
                if (A['end'] and B['end']) or A['word'] == B['word'] or A['lemmes'] & B['lemmes']:
                    continue
                k = len(A['key']) + P.common_suffix(A['onset'], B['onset'])
                v = P.common_suffix(A['vowels'], B['vowels'])
                if _linked(A, B, d, k, v):
                    edges.append((A['strict'] == B['strict'], k, v, d, a, b))

    # Du lien le plus fort au plus faible, sans jamais fondre deux rimes de fin
    edges.sort(key=lambda e: (not e[0], -e[1], -e[2], e[3]))
    parent = list(range(len(nodes)))
    owner = [nd['group'] for nd in nodes]

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for *_, a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb and not (owner[ra] and owner[rb] and owner[ra] != owner[rb]):
            parent[rb] = ra
            owner[ra] = owner[ra] or owner[rb]

    partner = {}    # lien le plus fort de chaque mot vers sa famille
    for exact, k, v, d, a, b in edges:
        if find(a) == find(b):
            partner.setdefault(a, (b, k, v, exact))
            partner.setdefault(b, (a, k, v, exact))

    members = defaultdict(list)
    for x in range(len(nodes)):
        members[find(x)].append(x)
    families = []
    for root, xs in members.items():
        if len(xs) < 2:
            continue
        key = owner[root]
        if key is None:
            key = f'*{len(families)}'
            families.append({'key': key, 'label': _fam_label(len(families)),
                             'display': P.display(nodes[xs[0]]['rime']),
                             'members': [[nodes[x]['li'], nodes[x]['i']] for x in xs]})
        for x in xs:
            nd = nodes[x]
            if nd['end'] and lines[nd['li']]['group']:
                continue
            y, k, v, exact = partner[x]
            lines[nd['li']]['internal'].append({'i': nd['i'], 'group': key, 'with': [nodes[y]['li'], nodes[y]['i']],
                                                'k': k, 'v': v, 'exact': exact})
    for line in lines:
        line['internal'].sort(key=lambda it: it['i'])
    return families


def _sounds(parsed, baseline):
    """Fréquence de chaque son dans le texte, comparée au français courant."""
    counts = Counter()
    examples = defaultdict(list)
    for p in parsed:
        for w in p['words']:
            if not w:
                continue
            example = w.get('text', w['word'])     # « j'ai » plutôt que « ai » pour le son j
            for sound in {SOUND_CLASSES[c] for c in w['phon'] if c in SOUND_CLASSES}:
                if example not in examples[sound] and len(examples[sound]) < 6:
                    examples[sound].append(example)
            for c in w['phon']:
                if c in SOUND_CLASSES:
                    counts[SOUND_CLASSES[c]] += 1

    def ranked(is_vowel):
        items = {s: c for s, c in counts.items() if (s in VOWEL_SOUNDS) == is_vowel}
        total = sum(items.values()) or 1
        base_total = sum(v for s, v in baseline.items() if (s in VOWEL_SOUNDS) == is_vowel) or 1
        rows = []
        for s, c in items.items():
            expected = baseline.get(s, 0) / base_total
            rows.append({'sound': s, 'count': c, 'share': c / total,
                         'ratio': round((c / total) / expected, 2) if expected else None,
                         'words': examples[s]})
        return sorted(rows, key=lambda r: -r['count'])

    return {'vowels': ranked(True), 'consonants': ranked(False)}


def _echoes(parsed, line_group):
    """Paires de vers proches dont les dernières voyelles se répètent sur 2 syllabes ou plus."""
    echoes = []
    for i, a in enumerate(parsed):
        for j in range(i + 1, min(len(parsed), i + ECHO_WINDOW + 1)):
            b = parsed[j]
            if not a['tail'] or not b['tail'] or a['tail'] == b['tail']:
                continue
            m = P.common_vowel_suffix(a['tail'], b['tail'])
            if m < 2:
                continue
            vs = P.vowels(a['tail'])[-m:]
            g = line_group[i]
            echoes.append({
                'lines': [i, j], 'syl': m,
                'rime': bool(g) and g is line_group[j] and i in g['lines'] and j in g['lines'],
                'display': '-'.join(P.display(v) for v in vs),
            })
    echoes.sort(key=lambda e: (-e['syl'], e['lines']))
    return echoes[:12]
