# Plan : bibliothèque (dossiers et tags), prods YouTube, rimes de strophe

## Contexte

Retours du 2026-10-06, après la mise en production de l'éditeur, de Drive et de l'historique. Maquettes sur le canvas https://claude.ai/artifact/UX6PFHtUgxKDsFYWT4Rnv9, trois rangées ajoutées le même jour.

**Cibles validées le 2026-10-06**

- Bibliothèque : **B, le panneau Textes** (`project/Biblio-panneau.dc.html`).
- Prods : **A, la prod dans le panneau** (`project/Prod-panneau.dc.html`).
- Rimes de strophe : **A, le bouton dans l'en-tête** (`project/Strophe-entete.dc.html`).

**Décisions prises**

- Un texte est dans un seul dossier (un album, un projet) ou dans aucun, et porte autant de tags libres qu'on veut.
- Avec Drive, un dossier est un vrai sous-dossier du dossier de Rime. Déplacer un fichier dans Drive change son dossier ici, et inversement.
- Prods : liens YouTube seulement, pas de MP3. Plusieurs prods par texte, chacune avec son BPM, une seule active.
- Drive reste sans serveur : jeton d'une heure, renouvelé à la sauvegarde.
- Rimes de strophe : un bouton à activer, éteint par défaut.

**Choix par défaut, à confirmer**

- Les tags et les prods vont dans la **description** du fichier Drive, lisible et modifiable depuis Drive : `Tags : à finir, storytelling` et `Prod : Abyss — dark piano type beat · 92 BPM · https://youtu.be/… · active`. Les autres lignes de la description sont gardées telles quelles.
- Les « [Album 00] » écrits dans les titres ne sont **pas** convertis automatiquement en dossiers : on range à la main.
- Tags : comparés sans tenir compte de la casse ni des accents (« A finir » rejoint « à finir »), virgules retirées, 30 caractères au plus.
- Dans le panneau, les textes d'un dossier sont triés par titre ; les dossiers aussi.

## Rimes de strophe

- API : `POST /api/analyze {"lines": [...], "stanza": true}`. Un mot accentué se lie à toute fin de vers de sa strophe ou section, à n'importe quelle distance, sauf mot deviné (`_echo` dans `analysis.py`). Option éteinte : sortie identique à avant.
- Un lien qui n'existe que grâce à l'option porte `echo: true` dans `internal[]`. Ces liens passent après tous les autres quand les familles se forment.
- Interface : bascule « Strophe » à côté de Voyelles, dans `rime-prefs` (`stanza`). Elle relance l'analyse. Les échos se dessinent comme les rimes internes. Dans le panneau, ils portent une étiquette « strophe », et le pied affiche « 12 rimes internes, dont 3 de strophe ».

## Prods YouTube

- Données sur le texte : `prods: [{ v: id de la vidéo, t: titre, bpm }]` et `prod` (id de la prod active). Un texte pas encore sauvé les garde dans `rime-current`, et les transmet à la sauvegarde.
- Ajouter : coller un lien (`youtu.be/…`, `watch?v=`, `shorts/`, `embed/`, `live/`, `music.youtube.com`). Le titre vient d'oEmbed (`youtube.com/oembed`, qui accepte l'origine du site), sinon du lecteur.
- Lecteur : API IFrame de YouTube, chargée seulement quand une prod sert. Domaine `youtube-nocookie.com`, zone de 286 × 200 px en tête du panneau. Une vidéo YouTube ne se lit pas cachée : plier le lecteur, masquer le panneau ou passer en mode Versions met en pause.
- Commandes : lecture et pause (aussi Ctrl+Espace), position, boucle, BPM au clavier (40 à 240) ou au Tap (4 tapes au moins, 8 retenues, une pause de 2 s recommence). Retirer une prod s'annule.
- Pendant la lecture, le bloc du lecteur reste collé en haut du panneau. Le pied affiche « Abyss · 92 BPM ».
- Changer de texte arrête la lecture et charge la prod active du nouveau texte, sans la lancer.

## Bibliothèque

- Dossiers dans `rime-folders` (`localStorage`) : `{ id, name, drive?, pending? }`. Sur un texte : `folder` (id ou `null`), `tags: []`.
- Panneau Textes à gauche, plié ou déplié par un bouton en tête de l'en-tête (`rime-prefs` : `lib`, et les dossiers dépliés).
  - Arbre des dossiers puis « Sans dossier ». Le texte ouvert est surligné ; un nuage marque les textes à envoyer vers Drive.
  - Menu « … » d'un texte : déplacer vers un dossier, supprimer. Menu « … » d'un dossier : renommer, supprimer (ses textes passent dans « Sans dossier »).
  - En bas, le filtre par tags : un texte doit les porter tous. Les dossiers sans résultat disparaissent pendant le filtre.
  - Sur mobile, le panneau passe par-dessus l'éditeur, comme le panneau d'analyse.
- Section « Ce texte » dans le panneau d'analyse : dossier, tags (champ, suggestions), chemin dans Drive.
- Dossier et tags s'appliquent tout de suite, sans « Sauver » : ce sont des métadonnées. Sur un texte sauvé, ils sont marqués `metaPending` pour Drive.
- Le menu du titre garde Sauver, Nouveau texte, l'export, l'import et Drive ; la liste des textes passe dans le panneau.
- Export (format 3) : `folders`, et par texte `folder`, `tags`, `prods`, `prod`. L'import recrée les dossiers manquants par leur nom.

## Drive

- Sous-dossiers du dossier de Rime, marqués `rime: 'folder'` et `rimeFolder: <id>`. La synchro des dossiers passe avant celle des textes :
  - un dossier d'ici sans dossier Drive est créé ;
  - un dossier renommé ici est renommé là-bas ;
  - un dossier renommé dans Drive est renommé ici ;
  - un dossier inconnu ici est ajouté.
- Le dossier d'un fichier vient de son parent : la racine donne « Sans dossier », un sous-dossier connu donne son dossier. Un parent hors de Rime laisse le dossier tel quel : un fichier sorti du dossier reste synchronisé.
- Envoi d'un texte : description (tags, prods), et parent déplacé si le dossier a changé ici. Une modification de métadonnées seule (`metaPending`) ne renvoie pas le contenu.
- Réception : pour un texte sans métadonnées en attente ici, le dossier, les tags et les prods de Drive l'emportent.
- Supprimer un dossier ici : ses textes repartent à la racine, puis le dossier vide va à la corbeille de Drive, à la fin de la synchro.

## Correctif au passage

`rime-history` était relu en ne gardant que `id`, `text` et `updated` : `drive`, `pending` et `conflict` disparaissaient à chaque rechargement. Un texte sauvé hors connexion pouvait alors être remplacé par l'ancienne version de Drive (gardée dans l'historique). Tous les champs sont désormais conservés.

## Vérification

- Moteur : les cas de non-régression de CLAUDE.md, option éteinte identique à l'ancien code, échos attendus sur la strophe des retours.
- Edge headless avec un faux Drive en mémoire (interception des requêtes `googleapis.com`) :
  - création, renommage et suppression de dossiers ;
  - déplacement dans Drive et ici ;
  - tags et prods aller-retour, second appareil, conflit.
- En-tête : pas de débordement de 390 à 1 920 px avec la bascule Strophe et le bouton du panneau Textes.
