"""Analyse d'un texte : schéma de rimes, richesse, assonances, sons dominants."""
from collections import Counter, defaultdict

import phonetics as P
from lexicon import FUNCTION_CATS, SOUND_CLASSES, VOWEL_SOUNDS

LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
TAIL_WORDS = 4      # mots pris en compte pour les rimes multisyllabiques
ASSO_WINDOW = 4     # une assonance n'est perçue qu'entre vers proches
ECHO_WINDOW = 4
LEVEL_RANK = {'identique': 0, 'pauvre': 1, 'suffisante': 2, 'riche': 3, 'multi': 4}


def _label(i):
    return LABELS[i % 26] + (str(i // 26) if i >= 26 else '')


def _parse_line(text, lex):
    words = []
    prev = None
    for tok in text.split():
        info = lex.phonetize(tok, prev)
        words.append(info)
        if info:
            prev = info['word']
    spoken = [i for i, w in enumerate(words) if w]
    end = spoken[-1] if spoken else None
    tail = ''.join(words[i]['phon'] for i in spoken[-TAIL_WORDS:])
    return {
        'words': words,
        'end': end,
        'end_phon': words[end]['phon'] if end is not None else '',
        'tail': tail,
        'syl': sum(P.syllables(w['phon']) for w in words if w),
    }


def _best_partner(i, members, parsed):
    best = None
    for j in members:
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


def analyze(lines, lex):
    parsed = [_parse_line(t, lex) for t in lines]
    n = len(parsed)

    # ── Rimes : même voyelle finale + mêmes consonnes qui suivent ──
    by_key = defaultdict(list)
    for i, p in enumerate(parsed):
        key = P.rhyme_key(p['end_phon'])
        if key:
            by_key[key].append(i)
    groups = []
    line_group = [None] * n
    for key, members in by_key.items():
        if len(members) > 1:
            g = {'key': key, 'type': 'rime', 'lines': members, 'asso': []}
            groups.append(g)
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
        first = parsed[min(g['lines'] + g['asso'])]['end_phon']
        if g['type'] == 'rime':
            g['display'] = P.display(first[P.last_vowel_index(first):])
        else:
            g['display'] = P.display(first[P.last_vowel_index(first)])
        g['levels'] = Counter()

    # ── Détail par vers ──
    group_ends = defaultdict(list)
    for g in groups:
        if g['type'] == 'rime':
            group_ends[g['key']] = [P.loose(parsed[j]['end_phon']) for j in g['lines']]
    out_lines = []
    for i, p in enumerate(parsed):
        g = line_group[i]
        line = {
            'syl': p['syl'],
            'end': p['end'],
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

        for wi, w in enumerate(p['words']):
            if wi == p['end'] or not w or w['cat'].startswith(FUNCTION_CATS):
                continue
            key = P.rhyme_key(w['phon'])
            # Une seule voyelle commune (« sont » / « raison ») ne s'entend pas comme une rime interne
            lw = P.loose(w['phon'])
            if key in group_ends and max(P.common_suffix(lw, e) for e in group_ends[key]) >= 2:
                line['internal'].append({'i': wi, 'group': key})
        out_lines.append(line)

    for g in groups:
        g['levels'] = dict(g['levels'])

    return {
        'lines': out_lines,
        'groups': groups,
        'sounds': _sounds(parsed, lex.baseline),
        'echoes': _echoes(parsed),
    }


def _sounds(parsed, baseline):
    """Fréquence de chaque son dans le texte, comparée au français courant."""
    counts = Counter()
    examples = defaultdict(list)
    for p in parsed:
        for w in p['words']:
            if not w:
                continue
            for sound in {SOUND_CLASSES[c] for c in w['phon'] if c in SOUND_CLASSES}:
                if w['word'] not in examples[sound] and len(examples[sound]) < 6:
                    examples[sound].append(w['word'])
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


def _echoes(parsed):
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
            echoes.append({
                'lines': [i, j], 'syl': m,
                'rime': P.rhyme_key(a['tail']) == P.rhyme_key(b['tail']),
                'display': '-'.join(P.display(v) for v in vs),
            })
    echoes.sort(key=lambda e: (-e['syl'], e['lines']))
    return echoes[:12]
