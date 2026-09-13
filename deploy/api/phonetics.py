"""Phonétique du français pour l'analyse de rimes.

Notation : celle de Lexique3 (colonne `phon`).
  voyelles  a e(é) E(è) i o O(ɔ) u(ou) y(u) 2(eu) 9(œ) °(schwa) @(an) 5(in) 1(un) §(on)
  semi-voy. j(y) w(oi) 8(ui)
  consonnes p b t d k g f v s z S(ch) Z(j) m n N(gn) G(ng) l R x
"""
import re

VOWELS = frozenset('aeEioOuy29°@51§')

# Oppositions que la plupart des locuteurs (et des rappeurs) ne font plus :
# é/è, o ouvert/fermé, eu ouvert/fermé/schwa, in/un.
_LOOSE = str.maketrans({'E': 'e', 'O': 'o', '9': '2', '°': '2', '1': '5'})

_DISPLAY = {
    'a': 'a', 'e': 'é', 'E': 'è', 'i': 'i', 'o': 'o', 'O': 'o', 'u': 'ou', 'y': 'u',
    '2': 'eu', '9': 'eu', '°': 'e', '@': 'an', '5': 'in', '1': 'un', '§': 'on',
    'j': 'y', 'w': 'w', '8': 'u', 'S': 'ch', 'Z': 'j', 'N': 'gn', 'G': 'ng', 'R': 'r',
}


def loose(phon):
    return phon.translate(_LOOSE)


def display(phon):
    """Transcription lisible : `S°m5` → `chemin`, `ORt` → `ort`."""
    return ''.join(_DISPLAY.get(c, c) for c in phon)


def last_vowel_index(phon):
    for i in range(len(phon) - 1, -1, -1):
        if phon[i] in VOWELS:
            return i
    return -1


def rhyme_key(phon):
    """Dernière voyelle + consonnes qui suivent, en notation tolérante."""
    i = last_vowel_index(phon)
    return loose(phon[i:]) if i >= 0 else None


def vowel_key(phon):
    i = last_vowel_index(phon)
    return loose(phon[i]) if i >= 0 else None


def vowels(phon):
    return [c for c in loose(phon) if c in VOWELS]


def syllables(phon):
    return sum(1 for c in phon if c in VOWELS)


def common_suffix(a, b):
    n = 0
    for x, y in zip(reversed(a), reversed(b)):
        if x != y:
            break
        n += 1
    return n


def common_vowel_suffix(a, b):
    return common_suffix(vowels(a), vowels(b))


def rhyme_level(k, syl):
    """Richesse d'une rime selon le nombre de phonèmes (k) et de syllabes communs."""
    if syl >= 2:
        return 'multi'
    if k >= 3:
        return 'riche'
    if k == 2:
        return 'suffisante'
    return 'pauvre'


def compare(a, b):
    """Compare deux fins de vers phonétiques.

    Renvoie None si ni rime ni assonance, sinon un dict :
      kind  'rime' | 'asso'
      k     phonèmes communs depuis la fin (tolérant)
      syl   syllabes communes
      exact les phonèmes communs sont identiques sans tolérance
      level richesse (rimes) ou None
    """
    ka, kb = rhyme_key(a), rhyme_key(b)
    if not ka or not kb:
        return None
    la, lb = loose(a), loose(b)
    if ka == kb:
        k = common_suffix(la, lb)
        syl = syllables(la[len(la) - k:])
        return {
            'kind': 'rime', 'k': k, 'syl': syl,
            'exact': a[len(a) - k:] == b[len(b) - k:],
            'level': rhyme_level(k, syl),
        }
    if vowel_key(a) == vowel_key(b):
        return {'kind': 'asso', 'k': 0, 'syl': common_vowel_suffix(a, b),
                'exact': False, 'level': None}
    return None


# ── Phonétisation par règles (mots absents du dictionnaire) ──

_V = 'aeiouyàâäéèêëîïôöùûü'
_C = 'bcçdfghjklmnpqrstvwxz'

# (graphème, contexte gauche, contexte droit, phonèmes). Premier qui correspond gagne.
# '$' = fin de mot, '^' = début de mot.
_RULES_SRC = [
    # Terminaisons
    ('ent', r'm', r'$', '@'),
    ('aient', '', r'$', 'E'),
    ('oient', '', r'$', 'wa'),
    ('ient', r'v', r'$', 'j5'),
    ('ient', r'[' + _C + ']', r'$', 'j@'),
    ('ent', r'nn', r'$', ''),
    ('ent', r'[' + _V + _C + ']{2}', r'$', '@'),
    ('ez', '', r'$', 'e'),
    ('ier', '', r's?$', 'je'),
    ('er', r'.{2}', r's?$', 'e'),
    ('et', r'.', r's?$', 'E'),
    ('es', r'^.', r'$', 'e'),
    ('e', r'^(?:[' + _C + ']|qu|ch)', r'$', '°'),
    ('ées', '', r'$', 'e'),
    ('ée', '', r'$', 'e'),
    ('ai', '', r'[st]?$', 'E'),
    ('ais', '', r'$', 'E'),
    ('ait', '', r'$', 'E'),
    ('ing', '', r's?$', 'iG'),
    ('um', r'.', r'$', 'Om'),
    ('en', r'[iéy]', r's?$', '5'),
    ('ien', '', r'[st]?s?$', 'j5'),
    ('e', r'[' + _V + _C + ']', r's?$', ''),
    ('ail', '', r's?$', 'aj'),
    ('eil', '', r's?$', 'Ej'),
    ('euil', '', r's?$', '9j'),
    ('ueil', '', r's?$', '9j'),
    ('ouil', '', r's?$', 'uj'),
    ('x', r'(?:eu|au|ou)', r'$', ''),
    ('ps', '', r'$', ''),
    ('ds', '', r'$', ''),
    ('t', r'[aiu]c', r's?$', 't'),
    ('t', r'.s', r's?$', 't'),
    ('p', r'o', r's?$', 'p'),
    ('ow', '', r's?$', 'o'),
    ('ew', '', r's?$', 'u'),
    ('s', r'i', r'mes?$', 'z'),
    ('ts', '', r'$', ''),
    ('c', r'[aeo]n', r's?$', ''),
    ('g', r'[aeo]n', r's?$', ''),
    ('s', r'.', r'$', ''),
    ('t', r'.', r'$', ''),
    ('d', r'.', r'$', ''),
    ('p', r'.', r'$', ''),
    ('z', r'.', r'$', ''),
    ('x', r'.', r'$', ''),
    # Voyelles composées
    ('eaux', '', r'$', 'o'),
    ('eau', '', '', 'o'),
    ('au', '', '', 'o'),
    ('aim', '', r'(?![' + _V + 'mn])', '5'),
    ('ain', '', r'(?![' + _V + 'n])', '5'),
    ('ein', '', r'(?![' + _V + 'n])', '5'),
    ('oin', '', r'(?![' + _V + 'n])', 'w5'),
    ('ey', '', r's?$', 'E'),
    ('ay', '', r'[' + _V + ']', 'Ej'),
    ('ey', '', r'[' + _V + ']', 'Ej'),
    ('oy', '', r'[' + _V + ']', 'waj'),
    ('aill', '', '', 'aj'),
    ('eill', '', '', 'Ej'),
    ('euill', '', '', '9j'),
    ('ueill', '', '', '9j'),
    ('ouill', '', '', 'uj'),
    ('ai', '', '', 'E'),
    ('aî', '', '', 'E'),
    ('ei', '', '', 'E'),
    ('oi', '', '', 'wa'),
    ('oî', '', '', 'wa'),
    ('oo', '', '', 'u'),
    ('ee', '', '', 'i'),
    ('ou', '', r'[aiéèêo]|e(?!s?$)', 'w'),
    ('ou', '', '', 'u'),
    ('où', '', '', 'u'),
    ('oû', '', '', 'u'),
    ('eu', '', r'(?:r|f|l|v|bl|pl|gl|n|ill)', '9'),
    ('eu', '', '', '2'),
    ('eû', '', '', '2'),
    ('oeu', '', r'(?:r|f|l|v)', '9'),
    ('oeu', '', '', '2'),
    ('tion', r'[sx]', '', 'tj§'),
    ('tion', '', '', 'sj§'),
    ('ion', '', r'(?![' + _V + 'n])', 'j§'),
    ('ien', '', r'(?![' + _V + 'n])', 'j@'),
    # Nasales
    ('emm', r'^', '', '@m'),
    ('enn', '', '', 'En'),
    ('an', '', r'(?![' + _V + 'n])', '@'),
    ('am', '', r'(?![' + _V + 'mn])', '@'),
    ('en', '', r'(?![' + _V + 'n])', '@'),
    ('em', '', r'(?![' + _V + 'mn])', '@'),
    ('on', '', r'(?![' + _V + 'n])', '§'),
    ('om', '', r'(?![' + _V + 'mn])', '§'),
    ('un', '', r'(?![' + _V + 'n])', '1'),
    ('um', '', r'(?![' + _V + 'mn])', '1'),
    ('in', '', r'(?![' + _V + 'n])', '5'),
    ('im', '', r'(?![' + _V + 'mn])', '5'),
    ('yn', '', r'(?![' + _V + 'n])', '5'),
    ('ym', '', r'(?![' + _V + 'mn])', '5'),
    # i / u / y devant voyelle
    ('ill', r'[' + _C + ']', '', 'ij'),
    ('i', r'[' + _C + '][lr]', r'[' + _V + '](?!s?$)', 'ij'),
    ('i', r'.', r'[aeoéèêuô](?!s?$)', 'j'),
    ('ï', '', '', 'i'),
    ('u', r'[' + _C + ']', r'[aeiéèêo](?!s?$)', '8'),
    ('y', r'[' + _V + ']', r'[' + _V + ']', 'j'),
    ('y', r'^', r'[' + _V + ']', 'j'),
    ('y', '', '', 'i'),
    # e
    ('é', '', '', 'e'),
    ('è', '', '', 'E'),
    ('ê', '', '', 'E'),
    ('ë', '', '', 'E'),
    ('ex', r'^', r'[' + _V + 'h]', 'Egz'),
    ('e', '', r'(?:x|([' + _C + r'])\1|s[' + _C + r']|[' + _C + r'](?:$|s$)|[' + _C + r'](?![' + _V + r'lr]))', 'E'),
    ('e', '', '', '°'),
    # Consonnes
    ('sch', '', '', 'S'),
    ('ch', '', '', 'S'),
    ('sh', '', '', 'S'),
    ('ph', '', '', 'f'),
    ('th', '', '', 't'),
    ('gn', '', '', 'N'),
    ('qu', '', '', 'k'),
    ('gu', '', r'[eiyéèê]', 'g'),
    ('ge', '', r'[aoâôu]', 'Z'),
    ('g', '', r'[eiyéèê]', 'Z'),
    ('cc', '', r'[eiyéèê]', 'ks'),
    ('c', '', r'[eiyéèê]', 's'),
    ('ck', '', '', 'k'),
    ('ç', '', '', 's'),
    ('c', '', '', 'k'),
    ('q', '', '', 'k'),
    ('ss', '', '', 's'),
    ('s', r'[' + _V + ']', r'[' + _V + ']', 'z'),
    ('x', '', '', 'ks'),
    ('j', '', '', 'Z'),
    ('h', '', '', ''),
    ('w', '', '', 'w'),
    ('rr', '', '', 'R'),
    ('r', '', '', 'R'),
    ('ll', '', '', 'l'),
    ('mm', '', '', 'm'),
    ('nn', '', '', 'n'),
    ('pp', '', '', 'p'),
    ('tt', '', '', 't'),
    ('ff', '', '', 'f'),
    ('bb', '', '', 'b'),
    ('dd', '', '', 'd'),
    ('zz', '', '', 'z'),
    # Voyelles simples
    ('à', '', '', 'a'),
    ('â', '', '', 'a'),
    ('ä', '', '', 'a'),
    ('î', '', '', 'i'),
    ('ô', '', '', 'o'),
    ('ö', '', '', 'o'),
    ('ù', '', '', 'y'),
    ('û', '', '', 'y'),
    ('ü', '', '', 'y'),
    ('u', '', '', 'y'),
]

_RULES = {}
for _g, _l, _r, _p in _RULES_SRC:
    _RULES.setdefault(_g[0], []).append((
        _g,
        re.compile('(?:' + _l + ')$') if _l else None,
        re.compile(_r) if _r else None,
        _p,
    ))


def normalize_word(word):
    w = word.lower().replace('œ', 'oe').replace('æ', 'ae').replace('’', "'")
    return re.sub(r"[^a-zàâäçéèêëîïôöùûüÿ'\-]", '', w).replace('ÿ', 'y')


def g2p(word):
    """Phonétisation approximative d'un mot hors dictionnaire."""
    w = re.sub(r"[^a-zàâäçéèêëîïôöùûü]", '', normalize_word(word))
    out = []
    i = 0
    while i < len(w):
        for g, left, right, p in _RULES.get(w[i], ()):
            if not w.startswith(g, i):
                continue
            if left and not left.search(w[:i]):
                continue
            if right and not right.match(w[i + len(g):]):
                continue
            out.append(p)
            i += len(g)
            break
        else:
            if w[i] in 'aiobdfgklmnpstvz':
                out.append(w[i])
            i += 1
    return ''.join(out)
