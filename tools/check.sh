#!/usr/bin/env bash
# Toutes les vérifications de Rime, contre la pile de dev (docker compose -f deploy/docker-compose.dev.yml up -d).
#   bash tools/check.sh                tout
#   bash tools/check.sh engine         une seule étape : engine, parity, sync ou screens
# Le moteur se teste dans le conteneur de l'API (le lexique n'est que là) ; le reste avec Node 22 et Edge sans écran.
set -u
cd "$(dirname "$0")/.."
only="${1:-all}"
fail=0
step() { [[ $only == all || $only == "$1" ]] && { echo; echo "── $2"; }; }

if ! curl -sf http://localhost:8080/api/health >/dev/null; then
  echo "L'API ne répond pas sur http://localhost:8080 : docker compose -f deploy/docker-compose.dev.yml up -d"
  exit 1
fi

if step engine 'Moteur : non-régression, instantanés, temps bornés'; then
  MSYS_NO_PATHCONV=1 docker exec -e PYTHONDONTWRITEBYTECODE=1 -w /app rime-dev-api-1 python tests/run.py || fail=1
fi
if step parity 'Parité des marqueurs : markers.js face à analysis.py'; then
  node tools/parity.mjs || fail=1
fi
if step sync 'Synchro Google Drive et onglets, contre un faux Drive'; then
  node --no-warnings tools/sync-test.mjs || fail=1
fi
if step screens 'Captures (tools/screens), sans erreur ni blocage CSP'; then
  node --no-warnings tools/screens.mjs tools/screens || fail=1
fi

echo
[[ $fail == 0 ]] && echo 'Tout passe.' || echo 'Des vérifications échouent.'
exit $fail
