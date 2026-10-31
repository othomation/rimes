import os
import time

# /health : heure de lecture du code, avant les imports du moteur. En dev, tools/api-reload.mjs y voit si Flask a
# rechargé une modification (une modification enregistrée pendant un rechargement peut être ignorée).
STARTED = time.time()

from flask import Flask, jsonify, request  # noqa: E402

from analysis import analyze  # noqa: E402
from lexicon import Lexicon  # noqa: E402

# Front et API sont servis par Caddy sur le même domaine : pas d'en-têtes CORS
app = Flask(__name__)

LEXIQUE_PATH = os.environ.get('LEXIQUE_PATH') or os.path.join(os.path.dirname(__file__), 'lexique.tsv')

print('Loading Lexique3…', flush=True)
lexicon = Lexicon(LEXIQUE_PATH)
print(f'Lexique3 loaded — {len(lexicon)} mots, {len(lexicon.entries)} entrées de rime', flush=True)

MAX_CHARS = 20000   # ~5 morceaux ; l'analyse s'arrête de toute façon à 400 vers


@app.route('/query')
def query():
    q = request.args.get('query', '').strip()
    if not q:
        return jsonify({'error': 'query manquant'}), 400
    n = min(max(request.args.get('n', 30, type=int), 1), 100)
    syl = request.args.get('syl', type=int)
    cat = request.args.get('cat', '').upper() or None
    result = lexicon.suggest(q, n=n, syl=syl, cat=cat)
    if result is None:
        return jsonify({'error': 'mot non reconnu'}), 404
    return jsonify(result)


@app.route('/analyze', methods=['POST'])
def analyze_route():
    body = request.get_json(silent=True)
    lines = body.get('lines') if isinstance(body, dict) else None
    if not isinstance(lines, list) or not all(isinstance(l, str) for l in lines):
        return jsonify({'error': 'lines doit être une liste de chaînes'}), 400
    if len(lines) + sum(map(len, lines)) > MAX_CHARS:   # retours à la ligne compris
        return jsonify({'error': 'texte trop long'}), 413
    return jsonify(analyze(lines, lexicon, whole_stanza=body.get('stanza') is True))


@app.route('/health')
def health():
    return jsonify({'ok': True, 'words': len(lexicon), 'started': STARTED})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
