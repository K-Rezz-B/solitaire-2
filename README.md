# Solitaire

Klondike en HTML/CSS/JS natif. Aucun build, aucun compte, aucune dépendance.

## Fonctionnalités
- Glisser-déposer souris **et** tactile (Pointer Events)
- Tap / clic sur une carte = déplacement automatique vers la meilleure destination
- Pioche 1 ou 3 cartes, annulation illimitée (Ctrl+Z), fin de partie automatique
- Sauvegarde auto de la partie et des stats dans `localStorage`
- PWA : installable sur l'écran d'accueil, jouable hors ligne
- **Paysage imposé sur mobile** : verrouillage natif sur Android (plein écran), rotation CSS de l'interface sur iPhone
- **Lisibilité** : disposition latérale en paysage (cartes ~70 % plus grandes), grands chiffres, option 4 couleurs

## Lancer en local
```bash
npx serve .        # ou : python3 -m http.server
```

## Déployer sur Vercel
1. Pousser le repo sur GitHub
2. Vercel → *Add New Project* → importer le repo
3. Framework preset : **Other**, pas de build command, output = racine
4. Deploy

Après une modif des assets : incrémenter `VERSION` dans `sw.js`.

## Structure
```
index.html            point d'entrée
css/style.css         styles
js/game.js            règles du jeu (pur, testable sans DOM)
js/app.js             rendu + interactions
js/storage.js         wrapper localStorage
sw.js                 cache hors ligne
manifest.webmanifest  PWA
vercel.json           en-tête no-cache pour sw.js
```
