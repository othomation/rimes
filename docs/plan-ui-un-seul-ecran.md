# Plan : Rime en un seul écran (éditeur + flow)

## Contexte

Aujourd'hui, l'appli a deux panneaux : on écrit dans une textarea à gauche, et l'analyse est une copie du texte, répartie dans cinq onglets à droite (Analyse, Assonances, Schéma, Historique, Atelier).

**Cible**, validée le 2026-10-02 : la planche « Atelier + Grille : l'éditeur avec le flow » du canvas de maquettes, https://claude.ai/artifact/UX6PFHtUgxKDsFYWT4Rnv9 (fichier `project/Hybride.dc.html`, interactive ; on peut relire sa source avec l'outil Artifact).

- On écrit directement dans le texte surligné.
- Chaque vers a sa **bande de flow** : une case par syllabe, alignée sur la fin du vers, pour que les rimes multisyllabiques s'empilent.
- Un panneau à droite donne le schéma, le vers courant, les rimes proposées, les familles et les sons.

**Décisions prises sur les maquettes**

- Directions : Atelier et Grille sont retenues et fusionnées ; le Cahier (double page) est écarté.
- Un vers ne passe **jamais** sur deux lignes.
- Bande de flow :
  - redimensionnable par une poignée : glisser, flèches ±20 px (Maj ±60), double-clic ou Origine pour revenir à la largeur auto ;
  - largeur auto = le vers le plus long tient en entier ;
  - les cases grandissent avec la largeur : rythme seul sous 15 px, voyelle des rimes de 15 à 25 px, syllabe des rimes à partir de 26 px, toutes les syllabes à partir de 34 px.
- Bascules dans l'en-tête :
  - surlignage « Tout | Fins de vers | Texte seul » (« Texte seul » replie aussi la bande) ;
  - « Flow » masque la bande ;
  - « Voyelles » colore toute la bande par voyelle ; il est désactivé quand la bande est masquée ;
  - le panneau d'analyse est masquable.
- Desktop d'abord ; le mobile doit seulement rester utilisable.

## L'éditeur : une textarea transparente sur un miroir surligné

C'est le point délicat. Le reste en découle.

- **Une seule zone qui défile** (`.editor`), en grille de colonnes : gouttière (numéro, lettre) | texte | poignée | bande | méta (syllabes, ↺).
  - Chaque ligne du texte occupe une rangée de hauteur fixe (`--row: 32px`) dans toutes les colonnes.
  - L'alignement est garanti parce que rien ne passe à la ligne (`white-space: pre`).
- **Colonne texte** : le miroir (`aria-hidden`, texte coloré) et, par-dessus, la `<textarea>` à texte transparent (`color: transparent; caret-color: …`).
  - Les deux couches ont la même police, la même taille, le même interlignage, les mêmes marges et la même `tab-size`.
  - La textarea grandit à la hauteur du contenu et ne défile pas elle-même.
  - Les vers trop longs défilent horizontalement, miroir et textarea ensemble, dans la colonne texte.
- **Le miroir est redessiné à chaque frappe** à partir du texte courant.
  - Une ligne reprend les surlignages de la dernière analyse si son texte est identique à la ligne analysée : même index, sinon même contenu.
  - Sinon elle s'affiche sans surlignage jusqu'à la prochaine analyse (600 ms).
- **Styles du miroir sans effet sur la largeur du texte** : couleur, fond, soulignés et contour (`box-shadow`) seulement.
  - Jamais de gras, de padding, de marge, d'italique ni de changement de police, sinon le texte coloré se décale par rapport au curseur. Les maquettes utilisent du gras : à ne pas reprendre.
  - Les labels de famille (α, β…) sont posés en absolu, sans prendre de place.
  - Crénage et ligatures coupés sur les deux couches (`font-kerning: none; font-variant-ligatures: none`).
  - Les commentaires, sections et adlibs gardent la police du texte et ne changent que de couleur.
- **Survol** : la textarea capte la souris. `document.elementsFromPoint()` retrouve le mot du miroir sous le pointeur (premier `[data-ph]`). On allume sa famille et on affiche une infobulle maison.
- **Vers courant** : la ligne du curseur (`selectionStart`, événement `selectionchange`) reçoit un fond dans toutes les colonnes et alimente le panneau « Vers N ».
- **Alternatives écartées** :
  - `contenteditable` : le curseur et la saisie avec IME deviennent fragiles quand on redessine ;
  - CodeMirror : une dépendance et un build, contraires au front sans dépendance.

## Backend (`deploy/api/`)

Il suffit d'ajouter à chaque vers de `/analyze` les cases de la bande : `cells: [{s, v, m, g}]`.

- `s` : syllabe phonétique lisible ;
- `v` : sa voyelle ;
- `m` : la marque `end`, `asso`, `int`, `fam`, ou `''` ;
- `g` : le groupe ou la famille.

`end`, `muted`, `internal`, `row` et `stanza` suffisent déjà au miroir.

Découpe, dans `phonetics.py` (testée sur le prototype) :

```python
_ONSET2 = {'pR', 'bR', 'tR', 'dR', 'kR', 'gR', 'fR', 'vR', 'pl', 'bl', 'kl', 'gl', 'fl'}

def syllabify(phon):
    """Syllabes phonétiques, attaque maximale : consonne + liquide, consonne + semi-voyelle."""
    idx = [i for i, c in enumerate(phon) if c in VOWELS]
    if not idx:
        return []
    cuts = [0]
    for a, b in zip(idx, idx[1:]):
        cluster = phon[a + 1:b]
        if len(cluster) <= 1:
            cuts.append(a + 1)
        elif cluster[-2:] in _ONSET2 or cluster[-1] in 'jw8':
            cuts.append(b - 2)
        else:
            cuts.append(b - 1)
    cuts.append(len(phon))
    return [phon[s:e] for s, e in zip(cuts, cuts[1:]) if phon[s:e]]
```

- **Voyelle d'une syllabe** : `display()` de sa première voyelle passée par `loose()`, soit a, é, i, o, ou, u, eu, an, in ou on.
- **Marques** :
  - fin de vers : les `syl_match` dernières syllabes du vers en partant de la fin, à travers les mots ; une seule pour une assonance ;
  - rime interne : les `max(1, v)` dernières syllabes du mot ;
  - un token muet n'a pas de case.
- **Attendu sur le vers 18** du texte de référence : `byin kon nou diz de pa sa [kro] [ché] ké [ké]`, avec kro et ché en interne C, et le dernier ké en fin C.

## Front (`index.html`, `style.css`, `script.js`)

**Mise en page**

- **En-tête** :
  - RIME, puis le menu du titre : textes sauvés (l'ancien Historique), « Nouveau texte », « Sauver » ;
  - l'état « Enregistré » ou « Modifié » ;
  - les bascules listées plus haut ;
  - un menu « Exporter » : copier le rapport, télécharger le .txt.
- **Corps** : l'éditeur (1fr), puis le panneau de 330 px, masquable.
- **Panneau**, de haut en bas :
  - Schéma : lettres en Bebas Neue, groupées par strophe ;
  - Vers N : pastille de rime, richesse, « ce qui rime » (partenaires de fin et rimes internes du vers), rimes proposées pour le mot sous le curseur ou à défaut la fin du vers, champ « Chercher une rime » (l'ancien Atelier) ;
  - Familles : pastilles cliquables qui isolent une famille dans le texte et dans la bande ;
  - Sons qui reviennent.
- **Pied** : nombre de vers, lignes ignorées, syllabes moyennes, rimes internes.
- **Les onglets disparaissent** :
  - Analyse → l'éditeur ;
  - Schéma → le panneau ;
  - Assonances → la section Sons du panneau ;
  - Historique → le menu du titre ;
  - Atelier → la recherche du panneau.

**`script.js`**

- **`renderEditor()`** construit gouttière, miroir, bande et méta à partir de `ta.value` et `lastResult`. Elle tourne à chaque `input` pour le miroir et la gouttière, et entièrement après chaque analyse.
- **`mirrorLine(raw, info)`** : comme `highlightLine`, mais le texte brut est conservé à l'identique (espaces de tête, espaces doubles, tabulations) et seuls des styles sans effet sur la largeur sont produits.
- **Bande** :
  - largeur dans `--strip` ;
  - largeur d'une case = `floor((bande − espaces) / maxSyllabes)` ;
  - le niveau de zoom découle des seuils plus haut ;
  - la largeur auto se mesure sur le miroir (`scrollWidth` de la ligne la plus longue) plutôt que d'être estimée.
- **Poignée** : pointer events avec capture du pointeur, plus le clavier (voir Décisions). Reprendre le code de la maquette.
- **Préférences par navigateur** dans `localStorage`, avec try/catch : surlignage, flow, voyelles, panneau, largeur de bande.
- **À réutiliser** :
  - `fetchAnalysis`, `scanTokens` et `rowType`, `colorFamilies` ;
  - `applyWordReplacement`, qui garde son garde-fou par instantané ;
  - `fetchRhymes` et `suggestionChips` ;
  - l'historique et `buildReport` ;
  - le focus et le verrou (`applyHighlight` sur les spans du miroir et sur les cases).
- **Remplacement d'un mot** : passer par `execCommand('insertText')` après avoir sélectionné le mot, pour que Ctrl+Z fonctionne. Aujourd'hui, la valeur est réécrite et on ne peut pas annuler.
- **À supprimer** : les onglets (`showTab`), `renderRows` et `verseRow`, le popover ouvert au clic sur un mot. Le panneau le remplace ; un raccourci comme Ctrl+Espace pourra le rouvrir plus tard.

**`style.css` et `index.html`**

- Palettes de rimes :
  - rimes `#6B7C00 #C03A00 #007A53 #7C3AAD #B05200 #0369A1 #BE185D #3A7D00` ;
  - voyelles a `#FF8A65`, é `#FFE066`, i `#5EE0A8`, o `#6EC6FF`, ou `#8C9EFF`, u `#D69CFF`, eu `#FF7DB0`, an `#FFB347`, in `#B8E986`, on `#7FE7E7`.
- Cases en Martian Mono condensée : nouvelle police Google Fonts, `wdth` 75.
- Variables de mise en page : `--row`, `--strip`, et les largeurs de colonnes (numéro 44, lettre 30, poignée 12, méta 64).
- Incrémenter `?v=` sur `style.css` et `script.js`.

## Étapes

Chacune se vérifie avant de passer à la suivante.

1. Backend : `cells` et tests API.
2. Page unique et éditeur à miroir, sans la bande : alignement exact, frappe, sélection, accents (IME), défilement.
3. Panneau, menu du titre, export, suppression des onglets.
4. Bande de flow : cases, zoom, poignée, Flow, Voyelles, Texte seul.
5. Préférences, survol et infobulles.
6. Vérification complète, puis commit.

## Vérification

- **API** : rejouer les cas de non-régression de `CLAUDE.md` et vérifier les `cells` du vers 18 décrites plus haut.
- **Navigateur**, Edge headless piloté par le protocole DevTools (comme pour les maquettes) :
  - pour chaque ligne, texte du miroir = ligne de la textarea ;
  - curseur placé au bout de « s'accrocher » → même position que le span du miroir, à 1 px près ;
  - surlignages intacts après une frappe ;
  - poignée, bascules ;
  - 400 vers : une frappe redessine en moins de 16 ms ;
  - aucune erreur JS.
- **À la main** : écrire, coller, annuler (Ctrl+Z, y compris après une suggestion), sélectionner, défiler, accents, suggestion appliquée sur la bonne ligne.

## Points tranchés (2026-10-03)

- Clic sur un mot surligné : il place seulement le curseur, et le panneau suit.
- Échos multisyllabiques : retirés du panneau, gardés dans le rapport exporté.
- Thème sombre : supprimé. Un seul thème, le clair actuel.
- Sauvegarde : un texte = une entrée. « Sauver » met à jour le texte ouvert, « Nouveau texte » en commence un autre, et le dernier texte ouvert revient au rechargement. « Enregistré » ou « Modifié » compare le texte à sa dernière sauvegarde.
