# Rime

Analyseur de schémas de rimes pour des paroles de rap en français. Il détecte les rimes de fin et leur richesse, les rimes internes, les assonances et les sons dominants, et propose des rimes. L'interface et les commentaires du code sont en français.

## Architecture

- `index.html`, `style.css`, `script.js` : front statique en JS vanilla, sans build ni dépendance. Un seul écran : l'éditeur, puis le panneau d'analyse (schéma, vers courant et rimes proposées, familles, sons).
  - L'éditeur est une `<textarea>` au texte transparent posée sur un miroir surligné (`#mirror`), dans une grille gouttière | texte | poignée | bande de flow | méta, une rangée de `--row` par ligne.
  - Le miroir doit rester identique au pixel près à la textarea : jamais de gras, de padding, de marge, d'italique ni de changement de police dans le miroir, seulement couleur, fond, soulignés et `box-shadow`.
  - `renderEditor()` reconstruit les rangées depuis `ta.value` à chaque frappe ; `patch()` ne remplace que les rangées changées. Une ligne reprend les surlignages de la ligne analysée de même texte (`matchVerses`).
  - Préférences (`rime-prefs`), texte ouvert (`rime-current`) et textes sauvés (`rime-history`, `{id, text, updated}`) dans `localStorage`, sans plafond.
  - Sauvegarde exportée : `{app: 'rime', version: 1, exported, texts: [...]}`. L'import accepte ce format et des `.txt`, et n'écrase jamais un texte sauvé.
  - Synchro Google Drive facultative, sans serveur : un `.txt` par texte sauvé, avec la permission `drive.file`. Le fichier porte l'id du texte dans `appProperties.rimeId`.
    - Le nom du dossier est choisi à la connexion (« Rime » par défaut) et renommable depuis Rime. Rime ne voit que ce qu'il a créé : il retrouve son dossier et ses fichiers même déplacés ou renommés dans Drive, et un fichier sorti du dossier reste synchronisé.
    - Le script Google Identity Services n'est chargé que si Drive sert. Son jeton d'accès dure une heure ; ensuite, un clic sur « Reconnecter Drive » rouvre la fenêtre Google.
    - Un texte modifié des deux côtés garde les deux versions : celle de Drive devient une copie « (conflit) ». Un texte supprimé dans Rime va à la corbeille Drive.
    - État dans `rime-drive` (`localStorage`) et jeton dans `rime-drive-token` (`sessionStorage`). Les textes sauvés gagnent `drive: {id, rev}` et `pending`.
    - Projet Google Cloud de Rime : ID client OAuth dans `GOOGLE_CLIENT_ID`, avec pour origines autorisées `https://rime.menace.cloud` et `http://localhost:8080`.
- `deploy/api/` : API Flask.
  - `app.py` : routes `POST /analyze`, `GET /query` (suggestions) et `GET /health`, limites de taille.
  - `analysis.py` : marqueurs et types de lignes, rimes de fin, assonances, rimes internes (`_internal`), sons, échos.
  - `phonetics.py` : notation Lexique, `loose()`, `rhyme_key()`, `voiced_key()`, `compare()`, et un g2p par règles pour les mots absents du lexique.
  - `lexicon.py` : Lexique 3.83 (`phonetize()`, suggestions classées par richesse) et listes lexicales (`FUNCTION_CATS`, `STOP_WORDS`, `STOP_LEMMAS`, `TONIC`, `ENCLITICS`, `DETERMINERS`).
- `lexique.tsv` est téléchargé au build de l'image API et n'est pas dans le dépôt. Tout code Python qui charge le lexique tourne donc dans le conteneur.

## Développement

- `docker compose -f deploy/docker-compose.dev.yml up --build` → http://localhost:8080. Caddy sert le front et proxie `/api/` vers Flask.
- Le front et les `.py` sont montés. Le front est servi tel quel (Ctrl+F5) et Flask recharge à chaque modification ; recharger Lexique prend quelques secondes.
- Piège : une modification enregistrée pendant un rechargement peut être ignorée, et le code en mémoire reste l'ancien. En cas de doute, `touch deploy/api/app.py`.
- Python avec le lexique, depuis Git Bash : `MSYS_NO_PATHCONV=1 docker exec -i -e PYTHONDONTWRITEBYTECODE=1 -w /app rime-dev-api-1 python - < script.py`.
  - `MSYS_NO_PATHCONV=1` empêche Git Bash de convertir `/app`.
  - Les heredocs de plus de ~8 Ko sont tronqués : passer par un fichier.
- Pas de suite de tests. On vérifie par des requêtes sur l'API (curl, ou `fetch` dans Node 22) et dans le navigateur. Edge est installé et se pilote en headless par le protocole DevTools.

## Déploiement

- `deploy/docker-compose.yml` (réseau externe `koda-network`) et `deploy/Caddyfile.snippet` à ajouter au Caddy de l'hôte (rime.menace.cloud).
- L'API tourne sous gunicorn avec 2 workers synchrones : toute boucle doit rester bornée (voir les limites ci-dessous).
- À chaque mise en production du front, incrémenter `?v=` sur `style.css` et `script.js` dans `index.html`, car Caddy n'envoie pas de `Cache-Control`.

## Contrat de l'API

- `POST /api/analyze {"lines": [...]}` reçoit toutes les lignes du textarea, vides comprises. La réponse contient :
  - `rows[]` : une entrée par ligne reçue, `{type: verse|comment|section|adlib|blank, verse}` ;
  - `lines[]` : une entrée par vers (`row`, `stanza`, `end`, `muted`, `group`, `kind`, `level`, `exact`, `partner`, `internal[]`, `cells[]`…) ;
  - `cells[]` : la bande de flow, une case par syllabe prononcée, `{s, v, m, g, w}` : syllabe, voyelle, marque (`end`, `asso`, `int`, `fam` ou `''`), groupe, indice du mot ;
  - `groups[]` : rimes de fin et assonances ;
  - `families[]` : familles de rimes internes sans rime de fin (clés `*n`, labels α, β…) ;
  - `sounds`, `echoes`.
- Les indices de mots (`end`, `muted`, `internal[].i`, `with`, `cells[].w`) comptent les tokens de la ligne découpée sur les espaces : `trim().split(/\s+/)` en JS, `_WS` en Python. Les deux découpages doivent rester identiques.
- Limites : 20 000 caractères (réponse 413), 400 vers analysés au plus.

## Marqueurs dans les paroles

| Marqueur | Effet |
|---|---|
| `# …` en début de ligne | titre ou commentaire, ignoré |
| `#` isolé au milieu d'une ligne | rend muette la fin de la ligne |
| `[…]` | section (`[Couplet 2]`), ignorée ; coupe la strophe et la fenêtre des rimes internes |
| `(…)` | adlib, sur toute la ligne ou en ligne : `paradis (merde)` rime sur « paradis » |
| `x2`, `2x` | muets |
| ligne vide | nouvelle strophe |

- Décision produit : les adlibs ne sont pas détectés automatiquement, seules les parenthèses comptent. Un « Yah » sans parenthèses reste un mot qui peut rimer.
- `script.js` (`scanTokens`, `rowType`, `REPEAT_RE`) reproduit `_spoken`, `_row_type` et `_REPEAT` d'`analysis.py`, pour le compteur et le remplacement de mots. Garder les deux en phase ; le serveur reste la référence.

## Moteur de rimes

- **Notation Lexique** :
  - voyelles `a e(é) E(è) i o O(ɔ) u(ou) y(u) 2(eu) 9(œ) °(schwa) @(an) 5(in) 1(un) §(on)` ;
  - semi-voyelles `j w 8` ;
  - consonnes `S(ch) Z(j) N(gn) G(ng) R`.

  `loose()` confond é/è, o/ɔ, eu/œ/schwa et in/un.
- **Rimes de fin** : groupées par clé stricte, soit la dernière voyelle et les consonnes qui suivent.
  - Une fin sans partenaire strict se rattache en rime ≈ si sa coda ne diffère que par le voisement (`voiced_key` : rides ~ rites).
  - Qualité : pauvre (1 phonème commun), suffisante (2), riche (3 ou plus), multi (2 syllabes ou plus).
- **Rimes internes** (`_internal`) : les nœuds sont les mots accentués, un par lemme et par vers. Sont accentués la fin de vers, un mot suivi d'une ponctuation, un nom, et un mot plein hors des listes de `lexicon.py`.
  - Deux mots se lient s'ils ont la même clé, voisement toléré en coda. On mesure `k` (phonèmes communs, schwa ignoré), `v` (voyelles finales communes) et `d` (écart en vers) :
    1. `k ≥ 2` : `d ≤ 2`, ou bien `k ≥ 3` et `v ≥ 2` jusqu'à 4 vers ;
    2. même vers : série d'au moins 3 mots sur la clé (sauf é) ;
    3. mot deviné hors lexique : aucun autre lien ;
    4. `v ≥ 2` : seulement vers une fin de vers, `d ≤ 1` ;
    5. sinon : seulement vers une fin de vers, `d ≤ 1`, clé hors é/an/i.
  - Les familles se forment en unissant les liens du plus fort au plus faible, sans jamais fondre deux rimes de fin.
  - Constantes en tête d'`analysis.py` : `NEAR`, `FAR`, `LINE_SPAN`, `PAIR_SPAN`, `COMMON_KEYS`.
- **Cas de non-régression** à garder :
  - « Je préfère voir les choses du bon côté / Bien qu'on nous dise de pas s'accrocher kéké » : s'accrocher rime avec côté (règle 4).
  - « Lui dire que je fais le jeu des Dieux » : jeu ~ Dieux (règle 5).
  - « …le temps des rides genre blasphème des rites… » : rides ~ rites ≈.
  - « Je fixe le vide / J'oublie les rites / Je suis mon guide / Je pars bien vite » reste ABAB.

## Conventions

- Code concis, dans le style existant. Commentaires et textes d'interface en français.
- Couleurs uniquement par les variables de thème (`--col0..7`, `--text`, `--muted`…). Il n'y a qu'un thème, clair.
- Commits au format conventional commits, en anglais (`feat:`, `fix(style):`…).
