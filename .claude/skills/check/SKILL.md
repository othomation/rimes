---
name: check
description: Vérifie Rime de bout en bout — moteur de rimes (non-régression, instantanés du corpus, temps bornés), parité des marqueurs entre markers.js et analysis.py, synchro Google Drive et onglets multiples contre un faux Drive, captures d'écran sans erreur JS ni blocage CSP. À lancer après une modification du moteur, de markers.js, de la synchro, du stockage ou de l'interface, et avant de proposer un commit.
---

# Vérifier Rime

Tout passe par `tools/check.sh`, contre la pile de dev.

1. La pile doit tourner : `curl -sf http://localhost:8080/api/health`. Sinon :
   `docker compose -f deploy/docker-compose.dev.yml up -d` (Docker Desktop doit être lancé), puis attendre que `/api/health` réponde (Lexique met quelques secondes à charger).
2. Lancer ce qui correspond à la modification, ou tout :
   - `bash tools/check.sh` : tout (environ 2 minutes, surtout la synchro) ;
   - `bash tools/check.sh engine` : moteur seulement (`deploy/api/tests/run.py`, dans le conteneur) ;
   - `bash tools/check.sh parity` : `markers.js` face à l'API ;
   - `bash tools/check.sh sync` : scénarios de `tools/sync-test.mjs` (un filtre : `node --no-warnings tools/sync-test.mjs onglets`) ;
   - `bash tools/check.sh screens` : captures dans `tools/screens/`.
3. Lire les résultats :
   - **Instantané du moteur différent** : le diff montre ce qu'un réglage change dans le corpus (lettres, richesses, rimes internes, familles, reprises). Si le changement est voulu, régénérer avec `MSYS_NO_PATHCONV=1 docker exec -e PYTHONDONTWRITEBYTECODE=1 -w /app rime-dev-api-1 python tests/run.py --update`, et le dire à l'utilisateur en citant les lignes changées. Sinon, corriger le code.
   - **Écart de parité** : `markers.js` et `_spoken` / `_row_type` d'`analysis.py` doivent rester identiques ; le serveur est la référence.
   - **Scénario de synchro en échec** : le message nomme ce qui manque (texte, copie « (conflit) », fichier Drive). Les erreurs de la page (JS, CSP) sont listées aussi.
   - **Captures** : ouvrir les PNG de `tools/screens/` avec Read pour juger un changement d'interface (1440, 1280, mobile, menu Affichage, Reprises et Voyelles).
4. Rendre compte : ce qui passe, ce qui échoue avec la sortie, et ce qui n'a pas été lancé.

Après une modification de `deploy/api/*.py`, le hook `tools/api-reload.mjs` attend déjà que Flask ait rechargé le code (et le force au besoin) : inutile de `touch deploy/api/app.py` à la main.
