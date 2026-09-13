import os

from flask import Flask, jsonify, request

from analysis import analyze
from lexicon import Lexicon

app = Flask(__name__)

LEXIQUE_PATH = os.environ.get('LEXIQUE_PATH') or os.path.join(os.path.dirname(__file__), 'lexique.tsv')

print('Loading Lexique3…', flush=True)
lexicon = Lexicon(LEXIQUE_PATH)
print(f'Lexique3 loaded — {len(lexicon)} mots, {len(lexicon.entries)} entrées de rime', flush=True)

MAX_LINES = 400


@app.after_request
def cors(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response


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
    lines = (request.get_json(silent=True) or {}).get('lines')
    if not isinstance(lines, list) or not all(isinstance(l, str) for l in lines):
        return jsonify({'error': 'lines doit être une liste de chaînes'}), 400
    return jsonify(analyze(lines[:MAX_LINES], lexicon))


@app.route('/health')
def health():
    return jsonify({'ok': True, 'words': len(lexicon)})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
