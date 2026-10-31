# Rime

Analyseur de schémas de rimes pour des paroles de rap en français. Il détecte les rimes de fin et leur richesse, les rimes internes, les assonances, les reprises et les sons dominants, et propose des rimes. L'interface et les commentaires du code sont en français.

## Architecture

- Front statique en JS vanilla, sans build ni dépendance, en modules ES natifs : `index.html`, `style.css`, `script.js` (chargé en `type="module"`), plus deux modules purs, sans DOM, que Node peut importer :
  - `markers.js` : les marqueurs des paroles (`scanTokens`, `rowType`, `REPEAT_RE`, `docTitle`…), miroir d'`analysis.py` ;
  - `diff.js` : le diff des versions (`lcsOps`, `diffRows`, `foldRows`, `lineStats`).
  - Aucun `onclick` dans le HTML (la CSP l'interdirait) : les menus portent `data-action`, relié à `MENU_ACTIONS`.
- Un seul écran : le panneau Textes à gauche, l'éditeur, puis le panneau d'analyse.
  - L'éditeur est une `<textarea>` au texte transparent posée sur un miroir surligné (`#mirror`), dans une grille gouttière | texte | poignée | bande de flow | méta, une rangée de `--row` par ligne.
  - Le miroir doit rester identique au pixel près à la textarea : jamais de gras, de padding, de marge, d'italique ni de changement de police dans le miroir, seulement couleur, fond, soulignés, surlignés et `box-shadow`.
  - `renderEditor()` reconstruit les rangées depuis `ta.value` à chaque frappe ; `patch()` ne remplace que les rangées changées. Une ligne reprend les surlignages de la ligne analysée de même texte (`matchVerses`).
  - Panneau d'analyse, de haut en bas : le lecteur de la prod (s'il y en a une), le vers courant avec ses rimes proposées et « Chercher une rime », Schéma, Familles, Sons, puis « Ce texte » (dossier, tags) et « Prods du texte », repliables (`fold` dans `rime-prefs`).
  - Assonance : la lettre est en minuscule, mais Bebas Neue n'a que des capitales ; elle est donc dessinée en creux (`-webkit-text-stroke`) et soulignée en tirets.
- Stockage dans `localStorage`, sans plafond : préférences (`rime-prefs`), texte ouvert (`rime-current`, propre à l'onglet), textes sauvés (`rime-history`), dossiers (`rime-folders`, `{id, name, drive, pending}`), état Drive (`rime-drive`) et jeton (`rime-drive-token`).
  - Textes, dossiers et état Drive sont partagés par les onglets. Toute écriture passe par `mutate(fn)` (ou `withDoc(id, fn)`) : elle repart du dernier état stocké, puis l'enregistre avec un nouveau `rime-rev`. Un onglet qui voit `rime-rev` changer (événement `storage`) recharge tout, et reprend un texte sauvé ailleurs s'il n'avait rien modifié. Ne jamais modifier `docs`, `folders` ou `drive` hors de `mutate`, et toujours enregistrer avant un `await`.
  - Un texte sauvé : `{id, text, updated, folder, tags, prods, prod}`, plus `drive: {id, rev, sum}`, `pending`, `metaPending`, `conflict` et `stale` avec Drive. Tous les champs sont gardés au chargement.
  - Dossier, tags et prods s'appliquent sans « Sauver » (`changeMeta`) : sur un texte sauvé, `metaPending` les envoie seuls vers Drive. Un brouillon (pas encore sauvé) les porte dans `rime-current` et les transmet à la sauvegarde.
  - « Sauver » sans changement ne crée ni version ni envoi : il lance seulement la synchro.
- Panneau Textes (`#lib`, bouton à gauche de l'en-tête, largeur réglable par sa tranche droite : `libW` dans `rime-prefs` ; ouvert d'office à partir de 1440 px) : arbre des dossiers puis « Sans dossier », menus « … » (déplacer, renommer, supprimer), filtre par tags (un texte doit tous les porter). Tags comparés sans casse ni accents (`foldKey`), sans virgule, 30 caractères au plus.
- Prods : liens YouTube seulement, `prods: [{v, t, bpm}]` et `prod` (la prod active). Titre par oEmbed, sinon par le lecteur. BPM au clavier ou au Tap (4 à 8 temps).
  - Lecteur : API IFrame de YouTube (`youtube-nocookie.com`), chargée à la première prod. Une vidéo ne se joue pas cachée : plier le lecteur, masquer le panneau ou passer en mode Versions met en pause. Pendant la lecture, le lecteur reste collé en haut du panneau. Ctrl+Espace : lecture et pause.
- Bascules de l'en-tête Flow, Voyelles, Strophe, Reprises (dans un menu « Affichage » sur mobile) :
  - « Strophe » : `stanza` dans `rime-prefs` et dans la requête d'analyse ;
  - « Reprises » : `repeats` dans `rime-prefs` ; l'API donne toujours les reprises, seul l'affichage change (un cadre gris fin autour du mot, `.rp`).
- Confirmations et noms passent par la boîte de dialogue `ask()` (un `<dialog>`), jamais par `confirm()` ni `prompt()`. Les infobulles sont des `data-tip`, montrées au survol et au focus clavier (`aria-describedby`).
- Sauvegarde exportée : `{app: 'rime', version: 3, exported, folders, texts: [...], versions?}`, les textes avec leurs dossier, tags et prods. L'import accepte les versions 1 à 3 et des `.txt`, retrouve les dossiers par leur nom, et n'écrase jamais un texte sauvé.
- Historique des versions : une copie complète du texte à chaque « Sauver » qui le change, dans IndexedDB (base `rime`, magasin `versions`, index `docId`).
  - Le diff est calculé à l'affichage (`diff.js`) : plus longue sous-suite commune sur les lignes, puis sur les mots.
  - Mode Versions (bouton ou Ctrl+Maj+H) : la comparaison remplace l'éditeur, masqué mais pas détruit pour garder sa pile d'annulation, et la liste remplace le panneau.
  - Rien n'est supprimé automatiquement ; une version épinglée ne se supprime pas. Supprimer un texte supprime son historique.
  - Avant qu'une synchro Drive remplace un texte, la version locale est gardée.
- Synchro Google Drive facultative, sans serveur : un `.txt` par texte sauvé, avec la permission `drive.file`. Le fichier porte l'id du texte dans `appProperties.rimeId`.
  - Le nom du dossier est choisi à la connexion (« Rime » par défaut) et renommable depuis Rime. Rime ne voit que ce qu'il a créé : il retrouve son dossier et ses fichiers même déplacés ou renommés dans Drive, et un fichier sorti du dossier reste synchronisé.
  - Le script Google Identity Services n'est chargé que si Drive sert. Son jeton d'accès dure une heure, survit au rechargement et passe aux autres onglets. Ensuite, la sauvegarde suivante (ou « Reconnecter Drive ») rouvre la fenêtre Google, avec le compte en `login_hint` : elle se referme seule si la session Google est ouverte. Fermée sans connexion, elle ne se rouvre plus d'elle-même jusqu'au rechargement.
  - Jeton expiré au chargement : un bandeau (`#driveBanner`) propose de se reconnecter avant d'écrire, pour ne pas écrire sur une version dépassée.
  - Une seule synchro à la fois, tous onglets confondus (`navigator.locks`, verrou `rime-drive-sync`). Elle part après chaque sauvegarde, au retour sur l'onglet ou la fenêtre, et toutes les deux minutes.
  - Qui a changé : `drive.sum` est l'empreinte (`textSum`, cyrb53) du texte identique des deux côtés à la dernière synchro. Un numéro de version Drive qui change ne suffit pas, c'est le texte qui compte.
    - Seul Drive a changé : le texte d'ici est remplacé, sauf si l'éditeur a des modifications non sauvées. Dans ce cas la version de Drive va dans l'historique et l'en-tête prévient (`stale`).
    - Seul ce texte a changé : il part sur le fichier.
    - Les deux ont changé : celle de Drive devient une copie « (conflit) », la nôtre garde le fichier.
    - Sans empreinte (texte d'avant), `pending` dit si le texte d'ici a changé.
  - Un texte supprimé dans Rime va à la corbeille Drive.
  - Dossiers de textes : sous-dossiers du dossier de Rime, synchronisés avant les textes (création, renommage dans les deux sens). Le parent d'un fichier donne son dossier ; un parent hors de Rime laisse le dossier tel quel. Un dossier supprimé ici part à la corbeille une fois vidé (`trashFolders`).
  - Tags et prods dans la description du fichier, lisible et modifiable dans Drive : `Tags : a, b` et `Prod : <titre> · 92 BPM · https://youtu.be/<id> · active`. Les autres lignes sont gardées (`driveNote`). Sans `metaPending`, ce que dit Drive l'emporte.
  - Versions : `<dossier>/Versions/<titre>/<AAAA-MM-JJ HHhMM — nom>.txt`, un fichier par version, qui ne change jamais. La synchro fait l'union des deux côtés, plus les suppressions, l'épingle et le nom.
  - Marques privées : fichiers de versions `rimeVersion`, `rimeId`, `at`, `pinned`, `label` ; dossiers `rime: 'root' | 'versions' | 'folder'`, `rimeFolder` et `rimeVersionsOf`. Un dossier perdu fait repartir ce qu'il contenait, sans rien effacer ici.
  - Projet Google Cloud de Rime : ID client OAuth dans `GOOGLE_CLIENT_ID`, avec pour origines autorisées `https://rime.menace.cloud` et `http://localhost:8080`.
- `deploy/api/` : API Flask.
  - `app.py` : routes `POST /analyze`, `GET /query` (suggestions) et `GET /health`, limites de taille. Pas d'en-têtes CORS : Caddy sert front et API sur le même domaine.
  - `analysis.py` : marqueurs et types de lignes, rimes de fin, assonances, rimes internes (`_internal`), reprises (`_repeats`), sons, échos.
  - `phonetics.py` : notation Lexique, `loose()`, `rhyme_key()`, `voiced_key()`, `compare()`, et un g2p par règles pour les mots absents du lexique.
  - `lexicon.py` : Lexique 3.83 (`phonetize()`, suggestions classées par richesse) et listes lexicales (`FUNCTION_CATS`, `STOP_WORDS`, `STOP_LEMMAS`, `TONIC`, `ENCLITICS`, `DETERMINERS`).
- `lexique.tsv` est téléchargé au build de l'image API (https, empreinte sha256 vérifiée) et n'est pas dans le dépôt. Tout code Python qui charge le lexique tourne donc dans le conteneur.

## Développement

- `docker compose -f deploy/docker-compose.dev.yml up --build` → http://localhost:8080. Caddy sert le front (avec les mêmes en-têtes qu'en production, CSP comprise) et proxie `/api/` vers Flask.
- Le front, les `.py` et `deploy/api/tests` sont montés. Un nouveau fichier du front doit être ajouté aux montages de `docker-compose.dev.yml` et au `COPY` de `deploy/Dockerfile`.
- Flask recharge à chaque modification ; recharger Lexique prend quelques secondes. Une modification enregistrée pendant un rechargement peut être ignorée : le hook `tools/api-reload.mjs` (PostToolUse, `.claude/settings.json`) attend le rechargement après chaque modification de `deploy/api/*.py`, le force au besoin, et signale s'il n'a pas eu lieu. `/health` donne l'heure de lecture du code (`started`).
- Python avec le lexique, depuis Git Bash : `MSYS_NO_PATHCONV=1 docker exec -i -e PYTHONDONTWRITEBYTECODE=1 -w /app rime-dev-api-1 python - < script.py`.
  - `MSYS_NO_PATHCONV=1` empêche Git Bash de convertir `/app`.
  - Les heredocs de plus de ~8 Ko sont tronqués : passer par un fichier.
- Vérifications : `bash tools/check.sh` (ou `npm run check`), ou une étape : `engine`, `parity`, `sync`, `screens`. La skill `/check` dit comment lire les résultats.
  - Moteur : `deploy/api/tests/run.py`, dans le conteneur. Cas de non-régression, instantanés du corpus `tests/corpus/*.txt` (sans et avec rimes de strophe) et des suggestions dans `tests/expected/`, temps bornés sur des textes piégés. Après un changement voulu, `python tests/run.py --update` et relire le diff.
  - Parité : `tools/parity.mjs` compare `markers.js` à l'API sur des lignes piégées (type de ligne, mots muets).
  - Synchro : `tools/sync-test.mjs`, contre un faux Drive (`tools/fake-drive.mjs`). Chaque appareil est un contexte Edge isolé ; Google Identity Services est remplacé par un bouchon.
  - Captures : `tools/screens.mjs` (1440, 1280, mobile…) dans `tools/screens/`, en échec si la page lève une erreur ou si la CSP bloque quelque chose.
  - `tools/cdp.mjs` pilote Edge sans écran par le protocole DevTools. Piège : l'app réécrit `rime-current` au `pagehide`, donc on prépare le stockage depuis une page neutre du même domaine (`page.seed()`).

## Déploiement

- `deploy/docker-compose.yml` (réseau externe `koda-network`) et `deploy/Caddyfile.snippet` à ajouter au Caddy de l'hôte (rime.menace.cloud).
- L'API tourne sous gunicorn avec 2 workers synchrones et `--preload` (Lexique chargé une fois) : toute boucle doit rester bornée (voir les limites ci-dessous).
- Le Caddy du front envoie `Cache-Control: no-cache` : le navigateur revalide chaque fichier, une mise en production se voit sans changer `?v=`. Il envoie aussi la CSP (`deploy/Caddyfile`, à garder identique à `Caddyfile.dev`) : une nouvelle origine externe (script, iframe, requête) doit y être ajoutée.

## Contrat de l'API

- `POST /api/analyze {"lines": [...], "stanza": true}` reçoit toutes les lignes du textarea, vides comprises ; `stanza` (facultatif) active les rimes de strophe. La réponse contient :
  - `rows[]` : une entrée par ligne reçue, `{type: verse|comment|section|adlib|blank, verse}` ;
  - `lines[]` : une entrée par vers (`row`, `stanza`, `end`, `muted`, `group`, `kind`, `level`, `exact`, `partner`, `internal[]`, `cells[]`…). Une rime interne qui n'existe que grâce aux rimes de strophe porte `echo: true` ;
  - `cells[]` : la bande de flow, une case par syllabe prononcée, `{s, v, m, g, w}` : syllabe, voyelle, marque (`end`, `asso`, `int`, `fam` ou `''`), groupe, indice du mot ;
  - `groups[]` : rimes de fin et assonances ;
  - `families[]` : familles de rimes internes sans rime de fin (clés `*n`, labels α, β…) ;
  - `repeats[]` : mots accentués repris dans une strophe, `{key: 'rN', word, members: [[vers, mot], …]}` ;
  - `sounds`, `echoes`.
- Les indices de mots (`end`, `muted`, `internal[].i`, `with`, `cells[].w`, `members`) comptent les tokens de la ligne découpée sur les espaces : `trim().split(/\s+/)` en JS, `_WS` en Python. Les deux découpages doivent rester identiques (`tools/parity.mjs`).
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
- `markers.js` (`scanTokens`, `rowType`, `REPEAT_RE`) reproduit `_spoken`, `_row_type` et `_REPEAT` d'`analysis.py`, pour le compteur et le remplacement de mots. Garder les deux en phase ; le serveur reste la référence.

## Moteur de rimes

- **Notation Lexique** :
  - voyelles `a e(é) E(è) i o O(ɔ) u(ou) y(u) 2(eu) 9(œ) °(schwa) @(an) 5(in) 1(un) §(on)` ;
  - semi-voyelles `j w 8` ;
  - consonnes `S(ch) Z(j) N(gn) G(ng) R`.

  `loose()` confond é/è, o/ɔ, eu/œ/schwa et in/un.
- **Rimes de fin** : groupées par clé stricte, soit la dernière voyelle et les consonnes qui suivent.
  - Une fin sans partenaire strict se rattache en rime ≈ si sa coda ne diffère que par le voisement (`voiced_key` : rides ~ rites).
  - Qualité : pauvre (1 phonème commun), suffisante (2), riche (3 ou plus), multi (2 syllabes ou plus).
  - Assonances : seulement entre fins de vers proches (`ASSO_WINDOW`). À l'intérieur des vers, une voyelle commune seule serait trop fréquente ; le mode Voyelles de la bande les montre.
- **Rimes internes** (`_internal`) : les nœuds sont les mots accentués, un par lemme et par vers. Sont accentués la fin de vers, un mot suivi d'une ponctuation, un nom, et un mot plein hors des listes de `lexicon.py`.
  - Deux mots se lient s'ils ont la même clé, voisement toléré en coda. On mesure `k` (phonèmes communs, schwa ignoré), `v` (voyelles finales communes) et `d` (écart en vers) :
    1. `k ≥ 2` : `d ≤ 2`, ou bien `k ≥ 3` et `v ≥ 2` jusqu'à 4 vers ;
    2. même vers : série d'au moins 3 mots sur la clé (sauf é) ;
    3. mot deviné hors lexique : aucun autre lien ;
    4. `v ≥ 2` : seulement vers une fin de vers, `d ≤ 1` ;
    5. sinon : seulement vers une fin de vers, `d ≤ 1`, clé hors é/an/i.
    6. rimes de strophe (option `stanza`) : en plus, un mot se lie à toute fin de vers de sa strophe, à n'importe quelle distance, sauf mot deviné (`_echo`).
  - Un mot ne rime jamais avec lui-même ni avec un mot du même lemme : c'est une reprise.
  - Les familles se forment en unissant les liens du plus fort au plus faible, sans jamais fondre deux rimes de fin.
  - Constantes en tête d'`analysis.py` : `NEAR`, `FAR`, `LINE_SPAN`, `PAIR_SPAN`, `COMMON_KEYS`.
- **Reprises** (`_repeats`) : mots accentués de la même strophe, même mot, ou même lemme hors verbes (têtes ~ tête, mais pas dise ~ dire).
- **Cas de non-régression** (vérifiés par `deploy/api/tests/run.py`) :
  - « Je préfère voir les choses du bon côté / Bien qu'on nous dise de pas s'accrocher kéké » : s'accrocher rime avec côté (règle 4).
  - « Lui dire que je fais le jeu des Dieux » : jeu ~ Dieux (règle 5).
  - « …le temps des rides genre blasphème des rites… » : rides ~ rites ≈.
  - « Je fixe le vide / J'oublie les rites / Je suis mon guide / Je pars bien vite » reste ABAB.

## Conventions

- Code concis, dans le style existant. Commentaires et textes d'interface en français.
- Couleurs uniquement par les variables de thème (`--col0..7`, `--text`, `--muted`…). Il n'y a qu'un thème, clair. Champs de saisie : classe `.field` ; menus et listes flottantes : `.pop`.
- Commits au format conventional commits, en anglais (`feat:`, `fix(style):`…).
