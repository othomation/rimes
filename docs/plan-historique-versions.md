# Plan : historique des versions de chaque texte

## Contexte

Aujourd'hui, un texte sauvé n'a qu'un état : chaque « Sauver » écrase le précédent, ici comme dans Drive.

**Cible**, validée le 2026-10-03 : la planche « Historique D : A et B, la comparaison dans l'éditeur » du canvas de maquettes, https://claude.ai/artifact/UX6PFHtUgxKDsFYWT4Rnv9 (fichier `project/Historique-mix.dc.html`, interactive ; on peut relire sa source avec l'outil Artifact).

- Chaque « Sauver » garde une version du texte.
- Un mode « Versions » montre la liste des versions dans le panneau et compare la version choisie au texte actuel, ou à la précédente, dans la zone de l'éditeur.

**Décisions prises**

- Une version par « Sauver » (Ctrl+S) quand le texte a changé depuis la dernière version. Un Ctrl+S sans changement n'en crée pas.
- Rien n'est supprimé automatiquement : pas d'élagage, pas de plafond. On supprime à la main, une version ou plusieurs cochées.
- Une version peut être **épinglée** (étoile) : elle est alors protégée, on ne peut ni la cocher ni la supprimer. Elle peut aussi être **nommée** (« version studio »).
- La place prise est affichée : « 412 versions · 1,3 Mo · 410 sur 412 dans Google Drive ».
- Chaque version est stockée en entier ; le diff est recalculé à l'affichage. Une version reste lisible seule, dans Drive comme ici.
- Avec Drive, les versions sont aussi des fichiers de Drive : Drive sert de sauvegarde de tout l'historique.
- Interface : la direction D, mélange de A (on reste sur l'écran d'écriture, liste dans le panneau) et de B (comparaison côte à côte), avec une bascule « Côte à côte | Fusionné ».

## Stockage local : IndexedDB

`localStorage` plafonne à environ 5 Mo pour tout le site et garde déjà les textes : les versions vont dans IndexedDB, sans dépendance, asynchrone et bien plus large.

- Base `rime`, magasin `versions`, clé `id` (horodatage en ms, unique comme les ids de textes), index `docId`.
- Entrée : `{ id, docId, at, text, source, label, pinned, stats: { added, removed }, drive: { id } | null }`.
  - `source` : `save`, `drive` (version remplacée par une synchro), `import` ;
  - `stats` : lignes ajoutées et retirées par rapport à la version précédente, calculées à l'enregistrement pour afficher la liste sans recalculer de diff.
- Les textes sauvés (`rime-history`) restent dans `localStorage` : ils sont lus au démarrage, de façon synchrone.
- Au premier enregistrement d'une version : `navigator.storage.persist()`, pour que le navigateur ne vide pas la base de lui-même. Safari efface quand même les données d'un site non visité depuis 7 jours, sauf s'il est sur l'écran d'accueil : Drive est la vraie sauvegarde.
- Volume attendu : un texte de 3 Ko sauvé 500 fois fait 1,5 Mo.

**Quand une version est créée**

- `saveDoc()` : après l'écriture du texte, si son contenu diffère de la dernière version de ce texte.
- Synchro Drive : avant qu'une version venue de Drive remplace le texte local, la version locale est gardée (`source: 'drive'`). Aujourd'hui, elle serait perdue.
- Import d'un texte : sa première version (`source: 'import'`).
- Restaurer ne crée pas de version : le texte restauré revient dans l'éditeur (Ctrl+Z l'annule), et le prochain « Sauver » en fait une version.
- Une copie « (conflit) » commence son propre historique.

## Drive : une version = un fichier

Les versions ne changent jamais : deux appareils peuvent en ajouter sans conflit. Synchroniser revient à faire l'union des deux côtés, plus les suppressions.

- Rangement : `<dossier choisi>/Versions/<titre du texte>/2026-10-03 14h05 — version studio.txt`.
  - Le dossier « Versions » et un sous-dossier par texte sont créés par Rime. Le sous-dossier est renommé quand le titre change.
  - Le nom du fichier porte la date, l'heure et le nom de la version ; il est renommé quand la version est nommée.
- Marques privées (`appProperties`) :
  - dossiers : `rime: 'root' | 'versions'`, `rimeVersionsOf: <docId>` ;
  - fichiers : `rimeVersion: <id>`, `rimeId: <docId>`, `pinned: '1'` si épinglée, `label`.
- `driveList()` exclut désormais les fichiers qui portent `rimeVersion` : ce ne sont pas des textes.
- Le dossier principal se retrouve par sa marque `rime: 'root'` plutôt que par sa date de création. Le dossier existant, créé avant les marques, est marqué à la première synchro.
- Synchro des versions, après celle des textes :
  1. les versions supprimées ici vont à la corbeille de Drive (liste `trash`, comme pour les textes) ;
  2. les versions locales sans fichier sont envoyées ;
  3. les fichiers de versions inconnus ici sont téléchargés dans IndexedDB ;
  4. épingle et nom : le plus récent l'emporte (métadonnées seulement, jamais le contenu).
- Une version supprimée dans Drive (fichier à la corbeille) disparaît ici à la synchro suivante, sauf si elle est épinglée : elle est alors renvoyée.

## Diff

Calculé à l'affichage, sans dépendance, comme dans la maquette :

- lignes : plus longue sous-suite commune (programmation dynamique ; 400 × 400 lignes = 160 000 cases, instantané) ;
- dans une ligne modifiée (une ligne retirée appariée à une ligne ajoutée) : la même chose sur les mots, espaces compris ;
- les lignes identiques à plus d'une ligne d'un changement sont repliées : « ⋯ 12 lignes identiques » ;
- une rangée porte les deux rendus : côte à côte (`left`, `right`) et fusionné (`segs`), pour basculer sans recalcul.

Schéma de rimes comparé : l'ancienne version est analysée par `/api/analyze` à sa sélection (résultat gardé en mémoire par id de version) ; le texte actuel reprend `lastResult`.

## Interface (direction D)

- **Entrée** : bouton « Versions » dans l'en-tête, entre « Voyelles » et « Exporter », et Ctrl+H. Échap ou un nouveau clic referme. Le bouton est désactivé tant que le texte n'a jamais été sauvé.
- **Zone de l'éditeur**, en lecture seule le temps du mode Versions (la textarea est masquée, pas détruite : la pile d'annulation est conservée) :
  - barre du haut : nom et date de la version, « +1 −1 lignes », « Comparer à : Texte actuel | Version précédente », « Côte à côte | Fusionné », étoile, « Restaurer » ;
  - côte à côte : version à gauche, texte actuel (ou version) à droite, schéma de rimes en tête de colonne ;
  - fusionné : une colonne, marques `~` `+` `−`, mots retirés barrés en rouge, ajoutés en vert.
- **Panneau** : il remplace schéma, vers courant, familles et sons le temps du mode Versions.
  - place prise et part dans Drive ;
  - liste par jour (« Aujourd'hui », « Hier », date) : heure, « actuelle », « +1 −1 », nom, état Drive, étoile, case à cocher ;
  - nom de la version sélectionnée ; « Supprimer N versions » (avec confirmation) ; rappel « Rien n'est supprimé sans toi ».
- **Restaurer** : sort du mode Versions et remplace le texte de l'éditeur par `execCommand('insertText')` sur tout le texte, pour que Ctrl+Z annule. L'état passe à « Modifié ».
- Couleurs : celles de la maquette passent en variables de thème (`--add`, `--add-bg`, `--del`, `--del-bg`, `--mod`).
- Mobile : « Fusionné » par défaut, la liste s'ouvre en surimpression comme le panneau.

## Fichiers touchés

- `script.js` : sections « Versions (IndexedDB) », « Diff », « Mode Versions » ; `saveDoc`, `deleteDoc`, `importFiles`, `exportAll` et la synchro Drive.
- `index.html` : bouton « Versions », conteneurs de la comparaison et de la liste.
- `style.css` : comparaison, liste, couleurs de diff.
- `CLAUDE.md` : stockage des versions, rangement dans Drive.
- Pas de changement côté API.

## Étapes

Chacune se vérifie avant de passer à la suivante.

1. IndexedDB : création des versions à chaque « Sauver », dédoublonnage, `persist()`, suppression d'un texte.
2. Diff et mode Versions : liste, côte à côte, fusionné, repli, comparer à, restaurer.
3. Épingler, nommer, sélectionner et supprimer à la main ; place prise.
4. Drive : dossiers marqués, envoi, téléchargement, suppressions, épingle et nom.
5. Export et import avec l'historique, schéma de rimes comparé, mobile.
6. Vérification complète, `?v=`, commit.

## Vérification

- Edge headless, faux Drive en mémoire (celui de la synchro des textes, étendu aux dossiers et aux versions) :
  - 3 « Sauver » dont un sans changement → 2 versions ;
  - diff mot à mot du vers 18 de référence après une modification ;
  - épinglée : ni cochable ni supprimable ; suppression de 2 versions ici → 2 fichiers à la corbeille de Drive ;
  - deuxième appareil : il récupère toutes les versions, sans doublon ;
  - synchro qui remplace un texte : l'ancienne version locale est gardée ;
  - restaurer puis Ctrl+Z ;
  - 400 versions d'un texte de 400 vers : liste et diff fluides.
- À la main : le vrai Drive (rangement et noms de fichiers lisibles), Safari si possible.

## Points tranchés (2026-10-03)

- Supprimer un texte supprime aussi son historique. La confirmation donne le nombre de versions, et dans Drive tout part à la corbeille.
- « Exporter tous les textes » propose une case « avec l'historique », cochée par défaut. La sauvegarde passe au format `version: 2`, avec `versions: [...]` ; l'import accepte les formats 1 et 2.
- Raccourci : Ctrl+Maj+H, qui ne remplace aucun raccourci du navigateur. Partout ailleurs dans ce plan, lire Ctrl+Maj+H à la place de Ctrl+H.
