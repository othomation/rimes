"""Dictionnaire phonétique (Lexique3) et recherche de rimes par richesse."""
import csv
import heapq
import re
from bisect import bisect_left
from collections import Counter, defaultdict

import phonetics as P

LEVELS = ('homophone', 'multi', 'riche', 'suffisante', 'pauvre')
FUNCTION_CATS = ('ART', 'PRO', 'PRE', 'CON', 'AUX', 'LIA', 'ADJ:pos', 'ADJ:dem', 'ADJ:ind', 'ADJ:int')
# Mots pleins pour Lexique mais sans accent dans le vers
STOP_WORDS = frozenset(['pas', 'plus', 'ne', 'bien', 'très', 'trop', 'tout', 'tous', 'toute', 'toutes', 'si', 'là',
                        'y', 'en', 'oui', 'non', 'ouais', 'comme', 'puis', 'donc', 'ça', 'cela', 'ceci', 'jamais',
                        'est-ce'])
# Auxiliaires et verbes « légers » (je fais le jeu, j'peux pas)
STOP_LEMMAS = frozenset(['être', 'avoir', 'faire', 'aller', 'pouvoir', 'vouloir', 'devoir', 'falloir'])
# Pronoms toujours accentués
TONIC = frozenset(['moi', 'toi', 'soi', 'eux', 'rien', 'personne', "quelqu'un", 'chacun', 'chacune'])
# Pronoms accrochés au verbe : dis-moi, laisse-les
ENCLITICS = frozenset(['moi', 'toi', 'soi', 'lui', 'leur', 'nous', 'vous', 'le', 'la', 'les', 'y', 'en'])
DETERMINERS = frozenset(['le', 'la', 'les', 'un', 'une', 'du', 'des', 'ce', 'cet', 'cette', 'ces', 'mon', 'ton', 'son',
                         'ma', 'ta', 'sa', 'mes', 'tes', 'ses', 'notre', 'votre', 'leur', 'nos', 'vos', 'leurs',
                         'au', 'aux'])

# Regroupements pour compter les sons (assonances / allitérations)
SOUND_CLASSES = {
    'a': 'a', 'e': 'é', 'E': 'è', 'i': 'i', 'o': 'o', 'O': 'o', 'u': 'ou', 'y': 'u',
    '2': 'eu', '9': 'eu', '@': 'an', '5': 'in', '1': 'in', '§': 'on',
    'p': 'p', 'b': 'b', 't': 't', 'd': 'd', 'k': 'k', 'g': 'g', 'f': 'f', 'v': 'v',
    's': 's', 'z': 'z', 'S': 'ch', 'Z': 'j', 'm': 'm', 'n': 'n', 'N': 'gn', 'G': 'ng',
    'l': 'l', 'R': 'r', 'j': 'y',
}
VOWEL_SOUNDS = frozenset(SOUND_CLASSES[c] for c in P.VOWELS if c in SOUND_CLASSES)

# Élisions, avec la consonne qui reste prononcée (l'heure = l9R)
_ELISIONS = {'l': 'l', 'j': 'Z', 't': 't', 'm': 'm', 's': 's', 'n': 'n', 'd': 'd', 'c': 's',
             'qu': 'k', 'jusqu': 'Zysk', 'lorsqu': 'lORsk', 'puisqu': 'p8isk'}
_PLURAL_SUBJECTS = frozenset(['ils', 'elles', "qu'ils", "qu'elles"])
_STRETCHED = re.compile(r'(.)\1{2,}')   # ouaaais, flowww


def _prefix_range(keys, prefix):
    return bisect_left(keys, prefix), bisect_left(keys, prefix + '\uffff')


class Lexicon:
    def __init__(self, path):
        # ortho → [{phon, cat, lemme, freq, v3p}], le plus fréquent d'abord
        self.pron = {}
        # ortho → lecture nom la plus fréquente (« le son », « l'été »)
        self.nouns = {}
        # entrées de suggestion, une par (lemme, prononciation)
        self.entries = []
        self.baseline = Counter()
        self._load(path)
        self._index()

    def _load(self, path):
        variants = defaultdict(dict)
        nouns = defaultdict(dict)
        best_form = {}
        with open(path, encoding='utf-8-sig') as f:
            reader = csv.DictReader(f, delimiter='\t')
            cols = reader.fieldnames or []
            col = lambda name: next((c for c in cols if c == name or c.endswith('_' + name)), name)
            c_ortho, c_phon, c_lemme, c_cgram = col('ortho'), col('phon'), col('lemme'), col('cgram')
            c_films, c_livres, c_infover = col('freqfilms2'), col('freqlivres'), col('infover')
            for row in reader:
                word = (row.get(c_ortho) or '').strip()
                phon = (row.get(c_phon) or '').strip()
                if not word or not phon or word[0].isupper():
                    continue
                try:
                    films = float(row.get(c_films) or 0)
                    freq = films + float(row.get(c_livres) or 0)
                except ValueError:
                    films = freq = 0.0
                cat = row.get(c_cgram) or ''
                lemme = row.get(c_lemme) or word
                v = variants[word].setdefault(phon, {'phon': phon, 'cat': cat, 'lemmes': set(),
                                                     'freq': 0.0, 'v3p': False})
                if freq > v['freq']:
                    v['cat'] = cat
                v['freq'] += freq
                v['lemmes'].add(lemme)
                v['v3p'] = v['v3p'] or '3p' in (row.get(c_infover) or '')
                if cat == 'NOM':
                    nv = nouns[word].setdefault(phon, {'phon': phon, 'cat': cat, 'lemmes': set(), 'freq': 0.0})
                    nv['freq'] += freq
                    nv['lemmes'].add(lemme)

                for ch in phon:
                    sound = SOUND_CLASSES.get(ch)
                    if sound:
                        self.baseline[sound] += films

                if ' ' in word or len(word) < 2 or cat.startswith(FUNCTION_CATS):
                    continue
                key = (lemme, phon)
                if key not in best_form or freq > best_form[key][3]:
                    best_form[key] = (word, phon, cat, freq, lemme)

        for word, vs in variants.items():
            self.pron[word] = sorted(vs.values(), key=lambda v: -v['freq'])
        self.nouns = {word: max(vs.values(), key=lambda v: v['freq']) for word, vs in nouns.items()}
        # Une même graphie peut venir de deux lemmes (« suis » : être / suivre)
        by_form = {}
        for e in best_form.values():
            if (e[0], e[1]) not in by_form or e[3] > by_form[(e[0], e[1])][3]:
                by_form[(e[0], e[1])] = e
        self.entries = list(by_form.values())
        total = sum(self.baseline.values()) or 1
        self.baseline = {s: n / total for s, n in self.baseline.items()}

    def _index(self):
        by_phon = sorted(range(len(self.entries)), key=lambda i: P.loose(self.entries[i][1])[::-1])
        self._rhyme_ids = by_phon
        self._rhyme_keys = [P.loose(self.entries[i][1])[::-1] for i in by_phon]
        by_vow = sorted(range(len(self.entries)), key=lambda i: ''.join(P.vowels(self.entries[i][1]))[::-1])
        self._vowel_ids = by_vow
        self._vowel_keys = [''.join(P.vowels(self.entries[i][1]))[::-1] for i in by_vow]

    def __len__(self):
        return len(self.pron)

    # ── Prononciation ──

    def phonetize(self, token, prev=None):
        """Prononciation d'un mot tel qu'écrit dans un texte.

        Renvoie {phon, guess, cat, lemmes, word} ou None si le token n'est pas un mot.
        `prev` (mot précédent) sert à trancher « ils président » / « le président » / « le son ».
        """
        w = P.normalize_word(token).strip("'-")
        if not w or len(w) > 48:     # pas un mot (et pas de récursion ni de g2p sans fin)
            return None
        if w not in self.pron and _STRETCHED.search(w):
            one, two = _STRETCHED.sub(r'\1', w), _STRETCHED.sub(r'\1\1', w)
            w = two if two in self.pron and one not in self.pron else one
        if w in self.pron:
            vs = self.pron[w]
            chosen = vs[0]
            if prev in _PLURAL_SUBJECTS:
                chosen = next((v for v in vs if v['v3p']), chosen)
            noun = self.nouns.get(w)
            # « le son », « l'été » : même prononciation, mais un nom, donc un mot accentué
            # (jamais de changement de prononciation : « je le vis » reste /vi/)
            if (prev in DETERMINERS and noun and noun['phon'] == chosen['phon'] and noun['freq'] >= 10
                    and chosen['cat'] != 'NOM' and not chosen['cat'].startswith('AUX')
                    and not chosen['lemmes'] <= {'être', 'avoir'} and w not in STOP_WORDS):
                chosen = noun
            return {'word': w, 'phon': chosen['phon'], 'guess': False,
                    'cat': chosen['cat'], 'lemmes': chosen['lemmes']}
        if "'" in w:
            head, _, tail = w.partition("'")
            if head in _ELISIONS and tail:
                # l' se lit comme « le » (l'été est un nom) ; la consonne élidée reste prononcée
                info = self.phonetize(tail, 'le' if head == 'l' else prev)
                return info and {**info, 'phon': _ELISIONS[head] + info['phon'], 'text': w}
            head, _, tail = w.rpartition("'")
            if not tail:
                return self.phonetize(head, prev)
            parts = [self.phonetize(p) for p in (head, tail)]
            return self._join(w, parts)
        if '-' in w:
            parts = [self.phonetize(p) for p in w.split('-')]
            info = self._join(w, parts)
            # dis-moi, laisse-moi : le pronom accroché ne change pas le verbe
            if info and parts[0] and w.rsplit('-', 1)[1] in ENCLITICS:
                info['lemmes'] = parts[0]['lemmes']
            return info
        phon = P.g2p(w)
        if not phon:
            return None
        return {'word': w, 'phon': phon, 'guess': True, 'cat': '', 'lemmes': {w}}

    def _join(self, w, parts):
        parts = [p for p in parts if p]
        if not parts:
            return None
        return {'word': w, 'phon': ''.join(p['phon'] for p in parts),
                'guess': any(p['guess'] for p in parts),
                'cat': parts[-1]['cat'], 'lemmes': parts[-1]['lemmes']}

    # ── Suggestions ──

    def suggest(self, query, n=30, syl=None, cat=None):
        infos = []
        prev = None
        for tok in query.split():
            info = self.phonetize(tok, prev)
            if info:
                infos.append(info)
                prev = info['word']
        if not infos:
            return None
        phon = ''.join(i['phon'] for i in infos)
        key = P.rhyme_key(phon)
        if not key:
            return None
        last = infos[-1]
        ctx = {'phon': phon, 'last': last['word'], 'lemmes': last['lemmes'],
               'syl': syl, 'cat': cat}

        levels = {lvl: [] for lvl in LEVELS}
        for lvl, item in self._rhyme_bands(ctx, len(key), n):
            levels[lvl].append(item)
        for lvl in LEVELS:
            levels[lvl].sort(key=lambda it: (-it['k'], it['approx'], it['derived'], -it['freq']))
            levels[lvl] = levels[lvl][:n]

        return {
            'query': query, 'phon': phon, 'display': P.display(phon),
            'rime': P.display(phon[P.last_vowel_index(phon):]),
            'guess': any(i['guess'] for i in infos),
            'levels': levels,
            'asso': self._assonances(ctx, key, n),
        }

    def _accept(self, entry, ctx):
        word, phon, cat, _, lemme = entry
        if word == ctx['last'] or lemme in ctx['lemmes']:
            return False
        if ctx['cat'] and not cat.startswith(ctx['cat']):
            return False
        if ctx['syl'] and P.syllables(phon) != ctx['syl'] and not (ctx['syl'] >= 4 and P.syllables(phon) >= 4):
            return False
        return True

    def _item(self, entry, ctx, k, matched_syl):
        word, phon, cat, freq, _ = entry
        q = ctx['phon']
        last = ctx['last']
        derived = abs(len(word) - len(last)) >= 2 and (word.endswith(last) or last.endswith(word))
        return {'w': word, 'k': k, 'syl': matched_syl, 'n': P.syllables(phon), 'cat': cat,
                'approx': phon[-k:] != q[-k:], 'derived': derived, 'freq': round(freq, 2)}

    def _rhyme_bands(self, ctx, min_k, n):
        """Parcourt les mots par nombre décroissant de phonèmes communs avec la requête."""
        q = P.loose(ctx['phon'])[::-1]
        keys, ids = self._rhyme_keys, self._rhyme_ids
        inner = None
        for k in range(len(q), min_k - 1, -1):
            lo, hi = _prefix_range(keys, q[:k])
            matched_syl = P.syllables(q[:k])
            spans = [(lo, hi)] if inner is None else [(lo, inner[0]), (inner[1], hi)]
            inner = (lo, hi)
            full = k == len(q)
            candidates = (ids[j] for a, b in spans for j in range(a, b))
            accepted = (i for i in candidates if self._accept(self.entries[i], ctx))
            best = heapq.nlargest(n * 3, accepted, key=lambda i: self.entries[i][3])
            for i in best:
                e = self.entries[i]
                if full and len(P.loose(e[1])) == len(q):
                    lvl = 'homophone'
                else:
                    lvl = P.rhyme_level(k, matched_syl)
                yield lvl, self._item(e, ctx, k, matched_syl)

    def _assonances(self, ctx, key, n):
        """Même voyelle finale mais consonnes différentes, en privilégiant les suites de voyelles longues."""
        vq = ''.join(P.vowels(ctx['phon']))[::-1]
        keys, ids = self._vowel_keys, self._vowel_ids
        out = []
        inner = None
        for k in range(len(vq), 0, -1):
            lo, hi = _prefix_range(keys, vq[:k])
            spans = [(lo, hi)] if inner is None else [(lo, inner[0]), (inner[1], hi)]
            inner = (lo, hi)
            candidates = (ids[j] for a, b in spans for j in range(a, b))
            accepted = (i for i in candidates
                        if P.rhyme_key(self.entries[i][1]) != key and self._accept(self.entries[i], ctx))
            for i in heapq.nlargest(n - len(out), accepted, key=lambda i: self.entries[i][3]):
                item = self._item(self.entries[i], ctx, 0, k)
                item['approx'] = False
                out.append(item)
            if len(out) >= n:
                break
        return out
