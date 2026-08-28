# Site vitrine — Fournisseur d'emballages alimentaires

Site vitrine professionnel en français, pensé pour un objectif unique :
**que les visiteurs vous appellent ou vous écrivent.**

> ℹ️ Ce site se trouve dans le sous-dossier `site-emballage/` du dépôt.
> Il est totalement indépendant du site présent à la racine, et ne le modifie pas.

---

## Sommaire

1. [Ce que contient le site](#1-ce-que-contient-le-site)
2. [Installer Node.js (à faire une seule fois)](#2-installer-nodejs-à-faire-une-seule-fois)
3. [Lancer le site sur votre ordinateur](#3-lancer-le-site-sur-votre-ordinateur)
4. [Modifier vos coordonnées](#4-modifier-vos-coordonnées)
5. [Ajouter ou modifier un produit](#5-ajouter-ou-modifier-un-produit)
6. [Remplacer les images et le logo](#6-remplacer-les-images-et-le-logo)
7. [Modifier les textes des pages](#7-modifier-les-textes-des-pages)
8. [Mettre le site en ligne gratuitement](#8-mettre-le-site-en-ligne-gratuitement)
9. [Recevoir les messages du formulaire](#9-recevoir-les-messages-du-formulaire)
10. [En cas de problème](#10-en-cas-de-problème)

---

## 1. Ce que contient le site

| Page | Adresse | Contenu |
|------|---------|---------|
| Accueil | `/` | Présentation courte, 3 produits phares, bloc de contact |
| Nos produits | `/produits/` | Catalogue complet avec filtre par catégorie |
| Fiche produit | `/produits/nom-du-produit/` | Une page par produit, créée automatiquement |
| À propos | `/a-propos/` | Présentation de l'entreprise |
| Contact | `/contact/` | Téléphone, email, formulaire, adresse, horaires |

Un bouton **« Contactez-nous »** est présent dans le menu de **toutes** les pages,
et un bloc d'appel avec le téléphone cliquable est répété en bas de chaque page.

### Les fichiers importants

```
site-emballage/
│
├── README.md                       ← ce mode d'emploi
│
└── src/
    ├── _data/
    │   ├── site.js       ⭐ VOS COORDONNÉES (tél, email, adresse, horaires, logo)
    │   └── produits.js   ⭐ TOUS VOS PRODUITS
    │
    ├── index.njk          → texte de la page d'accueil
    ├── a-propos.njk       → texte de la page À propos
    ├── contact.njk        → page Contact
    ├── produits.njk       → page catalogue
    ├── fiche-produit.njk  → générateur des fiches (à ne pas toucher)
    │
    ├── _includes/         → morceaux réutilisés (en-tête, pied de page, cartes)
    └── assets/
        ├── css/style.css  → toutes les couleurs et la mise en page
        ├── js/            → menu mobile et filtre des catégories
        └── images/        → logo et images des produits
```

**En pratique, 90 % de vos modifications se feront dans deux fichiers seulement :
`src/_data/site.js` et `src/_data/produits.js`.**

---

## 2. Installer Node.js (à faire une seule fois)

Node.js est le programme qui fabrique le site à partir de vos fichiers.
C'est gratuit, officiel, et ça s'installe en 3 minutes.

### Sur Windows

1. Allez sur **https://nodejs.org**
2. Cliquez sur le gros bouton **« LTS »** (version recommandée, la plus stable).
3. Ouvrez le fichier téléchargé (`node-v22...msi`) et cliquez sur *Suivant*
   jusqu'à *Installer*. Ne changez aucune option.
4. Une fois terminé, ouvrez **PowerShell** :
   touche `Windows`, tapez `powershell`, appuyez sur `Entrée`.
5. Tapez la commande suivante puis `Entrée` :

   ```
   node --version
   ```

   Si un numéro s'affiche (par exemple `v22.11.0`), c'est installé. ✅

### Sur Mac

1. Allez sur **https://nodejs.org**
2. Cliquez sur le bouton **« LTS »**.
3. Ouvrez le fichier `.pkg` téléchargé et suivez l'installation.
4. Ouvrez l'application **Terminal**
   (touches `Cmd + Espace`, tapez `terminal`, `Entrée`).
5. Tapez :

   ```
   node --version
   ```

   Un numéro s'affiche ? C'est bon. ✅

---

## 3. Lancer le site sur votre ordinateur

> **Le principe :** vous tapez une commande, le site s'ouvre dans votre navigateur,
> et **chaque fois que vous enregistrez un fichier, la page se met à jour toute seule.**

### Première fois seulement

Ouvrez le Terminal (Mac) ou PowerShell (Windows), puis :

1. **Placez-vous dans le dossier du site.** Le plus simple : tapez `cd ` (avec un
   espace après `cd`), puis faites glisser le dossier `site-emballage` depuis
   l'explorateur de fichiers directement dans la fenêtre du terminal. Appuyez sur `Entrée`.

2. **Installez les outils du site** (à faire une seule fois) :

   ```
   npm install
   ```

   Cela crée un dossier `node_modules`. C'est normal, ne le supprimez pas
   et ne cherchez pas à l'ouvrir.

### À chaque fois que vous travaillez sur le site

```
npm start
```

Le terminal affiche alors une adresse du type :

```
[11ty] Server at http://localhost:8080/
```

Ouvrez **http://localhost:8080/** dans votre navigateur : votre site est là.

Modifiez un fichier, enregistrez : la page se rafraîchit automatiquement.

**Pour arrêter le site :** cliquez dans le terminal et appuyez sur `Ctrl + C`.

### Fabriquer le site final (pour l'envoyer à un hébergeur à la main)

```
npm run build
```

Le site complet est créé dans le dossier `_site`. Ce dossier est régénéré à
chaque fois : **ne modifiez jamais son contenu directement**, vos changements
seraient effacés.

---

## 4. Modifier vos coordonnées

👉 Ouvrez le fichier **`src/_data/site.js`** avec un éditeur de texte
(Bloc-notes, TextEdit, ou mieux : [Visual Studio Code](https://code.visualstudio.com), gratuit).

Remplacez simplement le texte entre guillemets :

```js
nom: "Embalpro",                        // le nom de votre entreprise
telephone: "01 23 45 67 89",            // tel qu'il s'affiche
telephoneLien: "+33123456789",          // le même, pour le clic sur mobile
email: "contact@embalpro-exemple.fr",   // votre email
```

### ⚠️ Le champ `telephoneLien`

Il sert à lancer l'appel quand un visiteur clique sur votre numéro depuis son
téléphone. Il faut le format international, **sans espace** :

| Votre numéro affiché | À écrire dans `telephoneLien` |
|----------------------|-------------------------------|
| `01 23 45 67 89`     | `+33123456789`                |
| `06 12 34 56 78`     | `+33612345678`                |

👉 On remplace le `0` du début par `+33` et on supprime tous les espaces.

### Les horaires

```js
horaires: [
  { jours: "Lundi – Jeudi",       heures: "8 h 00 – 17 h 30" },
  { jours: "Vendredi",            heures: "8 h 00 – 16 h 00" },
  { jours: "Samedi – Dimanche",   heures: "Fermé" }
],
```

Vous pouvez ajouter ou supprimer des lignes. Chaque ligne se termine par une
virgule, **sauf éventuellement la dernière**.

Ces informations apparaissent automatiquement dans le pied de page, sur la page
Contact et dans la fiche d'entreprise lue par Google.

---

## 5. Ajouter ou modifier un produit

👉 Tout se passe dans le seul fichier **`src/_data/produits.js`**.

### Modifier un produit existant

Trouvez son bloc, changez le texte, enregistrez. C'est tout.

### Ajouter un nouveau produit

Copiez ce modèle et collez-le dans la liste, **juste avant le crochet fermant `];`**
tout en bas du fichier. N'oubliez pas la virgule après l'accolade `}` du produit précédent.

```js
  {
    id: "mon-nouveau-produit",
    nom: "Nom du produit",
    categorie: "Barquettes",
    descriptionCourte: "Une phrase de présentation, affichée sur le catalogue.",
    description: "Un paragraphe plus détaillé, affiché sur la fiche produit.",
    caracteristiques: [
      "Première caractéristique",
      "Deuxième caractéristique",
      "Troisième caractéristique"
    ],
    image: "/assets/images/produits/mon-nouveau-produit.jpg",
    imageAlt: "Description de la photo en quelques mots",
    miseEnAvant: false
  }
```

### À quoi sert chaque champ

| Champ | Rôle |
|-------|------|
| `id` | Devient l'adresse de la page : `id: "gobelet-carton"` → `votresite.fr/produits/gobelet-carton/`.<br>**Uniquement des minuscules, chiffres et tirets.** Pas d'espace, pas d'accent, pas de majuscule. Deux produits ne peuvent pas avoir le même `id`. |
| `nom` | Le nom affiché. Accents et majuscules autorisés. |
| `categorie` | Sert au filtre du catalogue. **Réutilisez l'orthographe exacte** d'une catégorie existante pour regrouper les produits. Une orthographe nouvelle crée automatiquement un nouveau bouton de filtre. |
| `descriptionCourte` | 1 à 2 phrases. Affichée sur la carte du catalogue **et** utilisée par Google comme description de la page. |
| `description` | Le texte long de la fiche produit. |
| `caracteristiques` | La liste à puces. Chaque ligne entre guillemets, séparée par une virgule. |
| `image` | Le chemin de l'image (voir le chapitre suivant). |
| `imageAlt` | Description de l'image, importante pour Google et les personnes malvoyantes. |
| `miseEnAvant` | `true` = affiché sur la page d'accueil, `false` = seulement dans le catalogue. Sans guillemets. **Conseil : 3 ou 6 produits en avant** pour remplir des lignes complètes. |

### Supprimer un produit

Effacez tout son bloc, de l'accolade ouvrante `{` à l'accolade fermante `}`,
ainsi que la virgule qui suit. La page correspondante disparaît toute seule.

### ⚠️ Les trois erreurs classiques

1. **Un guillemet oublié.** Chaque texte doit être encadré : `nom: "Ma barquette"`.
2. **Une virgule oubliée** entre deux produits, ou une virgule en trop après le
   dernier champ d'un bloc.
3. **Un apostrophe dans un texte** ne pose aucun problème avec les guillemets
   doubles : `"L'emballage idéal"` fonctionne parfaitement.

Si le site refuse de démarrer après une modification, c'est presque toujours l'une
de ces trois causes. Le terminal indique le **numéro de ligne** du problème.

---

## 6. Remplacer les images et le logo

Les images fournies sont des **placeholders gris** volontairement neutres.

### Remplacer la photo d'un produit

1. Déposez votre photo dans le dossier `src/assets/images/produits/`
2. Dans `src/_data/produits.js`, indiquez son nom de fichier :

   ```js
   image: "/assets/images/produits/ma-photo.jpg",
   ```

   ⚠️ Le chemin commence toujours par `/assets/` et **l'extension doit correspondre**
   (`.jpg`, `.png`, `.webp`…).

**Conseils pour les photos :** format horizontal, idéalement **1200 × 900 pixels**,
et un poids inférieur à 300 Ko pour que le site reste rapide.
Pour alléger vos images gratuitement : [squoosh.app](https://squoosh.app).

### Remplacer le logo

1. Déposez votre logo dans `src/assets/images/` (formats conseillés : `.svg` ou
   `.png` à fond transparent).
2. Dans `src/_data/site.js` :

   ```js
   logo: "/assets/images/mon-logo.png",
   ```

Le logo apparaît alors dans l'en-tête, dans le pied de page et comme petite icône
dans l'onglet du navigateur.

> Si votre logo est sombre et devient illisible sur le pied de page foncé, ouvrez
> `src/assets/css/style.css`, cherchez `.logo--pied` et suivez le commentaire :
> il suffit de retirer les `/*` et `*/` autour d'une ligne pour ajouter un fond blanc.

### Remplacer l'image de la page d'accueil

Déposez votre photo dans `src/assets/images/` puis, dans `src/index.njk`,
modifiez la ligne `<img src="/assets/images/illustration-entrepot.svg" …>`.

---

## 7. Modifier les textes des pages

| Pour changer… | Ouvrez… |
|---------------|---------|
| Le grand titre et les textes de l'accueil | `src/index.njk` |
| La présentation de l'entreprise | `src/a-propos.njk` |
| Les textes de la page Contact | `src/contact.njk` |
| L'introduction du catalogue | `src/produits.njk` |
| Le bloc « Contactez-nous » du bas de page | `src/_includes/partials/bloc-contact.njk` |

Dans ces fichiers, modifiez uniquement le texte **entre** les balises.
Par exemple, dans :

```html
<h1 class="hero__titre">Vos emballages alimentaires, livrés en 48 heures</h1>
```

vous ne changez que la partie centrale, sans toucher à `<h1 …>` ni à `</h1>`.

Les blocs commençant par `{#` et finissant par `#}` sont des **commentaires** :
ils ne s'affichent pas sur le site, ils sont là pour vous expliquer le code.

### Changer les couleurs du site

Ouvrez `src/assets/css/style.css`. Tout en haut, la section « VARIABLES » :

```css
--couleur-principale: #1c4f7c;   /* bleu marine : boutons, liens, accents */
```

Changez ce code couleur, il se met à jour **partout** sur le site.

---

## 8. Mettre le site en ligne gratuitement

Les deux hébergeurs ci-dessous sont gratuits pour un site vitrine et fournissent
le **HTTPS** (le petit cadenas) automatiquement.

> ⚠️ **Important** : ce site vit dans le sous-dossier `site-emballage/` du dépôt.
> Vous devez donc l'indiquer à l'hébergeur (étape 3 ci-dessous), sinon il ne
> trouvera pas le site.

### Option A — Netlify (recommandé : le formulaire de contact y fonctionne)

**Aucun réglage à saisir** : le fichier `netlify.toml`, à la racine du dépôt,
contient déjà toute la configuration. Netlify le lit automatiquement.

1. Créez un compte gratuit sur **https://netlify.com** (bouton *Sign up*,
   choisissez « GitHub »).
2. Cliquez sur **Add new site → Import an existing project → GitHub**,
   puis sélectionnez votre dépôt.
3. Netlify affiche les réglages détectés — **laissez-les tels quels** — et
   cliquez sur **Deploy**.
4. Après une minute, votre site est en ligne à une adresse du type
   `https://nom-au-hasard.netlify.app`.
5. Pour la renommer : *Site configuration → Change site name*.

> Si Netlify vous demande malgré tout de remplir les champs à la main :
> Build command = `cd site-emballage && npm install && npm run build`,
> Publish directory = `site-emballage/_site`, et laissez « Base directory » vide.

**Mise à jour du site :** modifiez vos fichiers, envoyez-les sur GitHub
(`git add`, `git commit`, `git push`), Netlify reconstruit le site tout seul en
une minute.

### Option B — Vercel

1. Créez un compte sur **https://vercel.com** (connexion avec GitHub).
2. **Add New → Project**, choisissez votre dépôt.
3. Dans **Root Directory**, cliquez sur *Edit* et sélectionnez le dossier
   `site-emballage`. **Cette étape est indispensable.**
4. Framework Preset : *Other*. Build Command : `npm run build`.
   Output Directory : `_site`.
5. **Deploy**.

⚠️ Sur Vercel, le formulaire de contact ne fonctionnera pas tel quel
(voir le chapitre suivant). Le téléphone et l'email restent, eux, pleinement
opérationnels.

### Brancher votre propre nom de domaine

Une fois le site en ligne, dans Netlify : *Domain management → Add a domain*.
Netlify affiche les réglages exacts à recopier chez votre fournisseur de domaine
(OVH, Gandi, IONOS…). Le HTTPS est ajouté automatiquement.

### Dernière étape avant la mise en ligne

Dans `src/_data/site.js`, remplacez l'adresse d'exemple par votre vraie adresse :

```js
url: "https://votre-vrai-site.fr",   // sans barre oblique à la fin
```

C'est cette adresse qui est utilisée par Google (liens canoniques et plan du site).

---

## 9. Recevoir les messages du formulaire

### Sur Netlify : rien à faire

Le formulaire est déjà configuré (attribut `data-netlify="true"`).
Dès la première mise en ligne, Netlify le détecte automatiquement.

- Les messages reçus s'affichent dans votre tableau de bord :
  **Forms → contact**.
- Pour être **prévenu par email** à chaque message :
  *Site configuration → Notifications → Add notification → Email notification*.
  Indiquez votre adresse email : vous recevrez chaque demande directement.
- L'offre gratuite couvre 100 messages par mois, largement suffisant pour un
  site vitrine.

Après envoi, le visiteur est redirigé vers la page de remerciement `/merci/`.

### Sur Vercel ou un autre hébergeur

Vercel ne propose pas cette fonction. Deux solutions simples :

- **La plus simple :** supprimez le formulaire de `src/contact.njk` et laissez le
  téléphone et l'email, qui sont de toute façon les canaux les plus utilisés en B2B.
- **Ou :** créez un compte gratuit sur [Formspree](https://formspree.io) et
  remplacez dans `src/contact.njk` la ligne `action="/merci/"` par l'adresse
  fournie par Formspree.

---

## 10. En cas de problème

| Symptôme | Solution |
|----------|----------|
| `npm : terme non reconnu` (Windows) | Node.js n'est pas installé, ou le terminal a été ouvert avant l'installation. Fermez-le, rouvrez-en un nouveau. |
| `Cannot find module '@11ty/eleventy'` | Vous avez oublié `npm install`. Lancez-le dans le dossier `site-emballage`. |
| Le site ne se lance plus après une modification | Une virgule ou un guillemet manque dans `produits.js` ou `site.js`. Le terminal affiche le numéro de ligne fautif. |
| Une image ne s'affiche pas | Vérifiez que le chemin commence par `/assets/` et que **l'extension du fichier correspond** (`.jpg` ≠ `.png`). |
| Mes modifications n'apparaissent pas | Enregistrez le fichier (`Ctrl + S` / `Cmd + S`), puis rechargez la page en forçant : `Ctrl + Shift + R` (`Cmd + Shift + R` sur Mac). |
| J'ai tout cassé | Si vous utilisez Git : `git checkout src/` annule toutes vos modifications non enregistrées. |

### Bon réflexe

Avant une grosse modification, faites une copie du dossier `src`.
En cas d'erreur, vous n'avez qu'à restaurer la copie.

---

## Notes techniques

- **Générateur :** [Eleventy](https://www.11ty.dev) v3 — génère du HTML statique pur.
- **Aucune base de données**, aucun serveur à administrer, aucun abonnement.
- **Aucun mouchard ni service externe** : le site ne charge aucune police ni
  script distant, ce qui le rend rapide et conforme au RGPD sans bandeau cookies.
- **SEO :** chaque page possède son propre titre et sa meta description ; le plan
  du site (`/sitemap.xml`) et le `robots.txt` sont générés automatiquement à
  partir de vos produits.
- **Accessibilité :** structure de titres correcte, textes alternatifs sur les
  images, navigation au clavier, contrastes conformes.
