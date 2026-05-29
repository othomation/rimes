import csv
import re
import os
from collections import defaultdict
from flask import Flask, jsonify, request

app = Flask(__name__)

# ── Phonème fin de mot (même logique que le frontend JS) ──
PATTERNS = [
    (r'tion$|sion$', 'syon'), (r'oir$|oirs$', 'war'),
    (r'ain$|ein$|im$|in$|ins$|un$', 'ain'), (r'ong$|on$|ons$', 'on'),
    (r'ent$|ants$|and$|ands$', 'an'), (r'eau$|eaux$|aut$|aux$|au$', 'o'),
    (r'nuit$', 'ui'), (r'vie$', 'vi'), (r'pie$|rie$|lie$|mie$|nie$', 'i'),
    (r'ie$', 'i'), (r'is$|it$|ix$', 'i'), (r'ue$|us$|ut$', 'u'),
    (r'out$|oût$', 'u'), (r'ive$|ives$', 'iv'), (r'age$|ages$', 'aj'),
    (r'ette$|ettes$', 'et'), (r'eur$|eurs$', 'eur'), (r'our$|ours$', 'our'),
    (r'oi$|ois$|oit$', 'wa'), (r'é$|ée$|ez$|er$|ées$|ers$', 'e'),
    (r'aille$|ailles$', 'ay'), (r'eil$|eille$', 'ey'),
]

def get_end_phoneme(word):
    word = re.sub(r'[^a-zàâäéèêëîïôùûüÿç]', '', word.lower())
    if not word:
        return None
    for pattern, phoneme in PATTERNS:
        if re.search(pattern, word):
            return phoneme
    return word[-3:] if len(word) >= 3 else word[-2:]

# ── Chargement Lexique3 au démarrage ──
phoneme_to_words: dict[str, list[tuple[str, float]]] = defaultdict(list)
seen: set[str] = set()

LEXIQUE_PATH = os.path.join(os.path.dirname(__file__), 'lexique.tsv')

print('Loading Lexique3…', flush=True)
with open(LEXIQUE_PATH, encoding='utf-8-sig') as f:  # utf-8-sig strips BOM
    reader = csv.DictReader(f, delimiter='\t')
    cols = reader.fieldnames or []
    print(f'Columns (first 5): {cols[:5]}', flush=True)
    # robustesse : accepte les deux variantes de noms de colonnes
    ortho_col = '1_ortho' if '1_ortho' in cols else 'ortho'
    freq_col  = '10_freqfilms2' if '10_freqfilms2' in cols else 'freqfilms2'
    for row in reader:
        word = row.get(ortho_col, '').strip()
        if not word or word in seen:
            continue
        if word[0].isupper() or len(word) < 3:
            continue
        try:
            freq = float(row.get(freq_col, 0) or 0)
        except ValueError:
            freq = 0.0
        ph = get_end_phoneme(word)
        if ph:
            phoneme_to_words[ph].append((word, freq))
            seen.add(word)

# Trier chaque groupe par fréquence décroissante
for ph in phoneme_to_words:
    phoneme_to_words[ph].sort(key=lambda x: -x[1])

print(f'Lexique3 loaded — {len(seen)} mots, {len(phoneme_to_words)} phonèmes', flush=True)

# ── API ──
@app.after_request
def cors(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

@app.route('/query')
def query():
    word = request.args.get('query', '').strip().lower()
    if not word:
        return jsonify([])
    ph = get_end_phoneme(word)
    if not ph:
        return jsonify([])
    limit = min(int(request.args.get('n', 80)), 200)
    results = [w for w, _ in phoneme_to_words.get(ph, []) if w != word]
    return jsonify({'phoneme': ph, 'words': results[:limit]})

@app.route('/health')
def health():
    return jsonify({'ok': True, 'words': len(seen)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
