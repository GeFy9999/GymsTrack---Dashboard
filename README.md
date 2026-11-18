# GymTrack · Stats

Dashboard perso (Next.js + TypeScript) qui combine :

| Source | Ce que ça donne |
|---|---|
| **Base GymTrack** (SQLite du backend, lecture seule) | inscriptions, DAU/WAU/MAU, rétention J1→J90, cohortes, qui reste / qui part, activation, séances, volume, heatmap jour×heure, groupes musculaires, adoption des fonctionnalités, Pro & conversion |
| **Play Console** (rapports Cloud Storage) | installations / désinstallations, appareils actifs, pays, appareils, version Android, version de l'app, langue, visiteurs de la fiche, conversion, canaux, rétention des installeurs J1/J7/J15/J30, notes, crashs, avis |
| **Play Developer Reporting API** | taux de crash et d'ANR perçus (vs seuils Google), utilisateurs Android distincts / jour |
| **Stripe** (clé restreinte, lecture seule) | MRR / ARR, encaissé net par jour, remboursements, abonnés payants et en essai, nouveaux / annulés, churn, paiements échoués, achats à vie, solde |
| **RevenueCat** (clé secrète V2, lecture seule) | MRR, revenus 28 j, abonnements actifs, essais, nouveaux clients et utilisateurs actifs Android |

Sans configuration Play, la partie Play Store affiche des **données de démo** (badge « ○ démo » en haut).

## Lancer

```bash
npm install
npm run dev -- -p 3999
```

Puis ouvre http://localhost:3999. Le dashboard reste sur ta machine, il n'y a pas de login : ne le déploie pas tel quel sur internet.

## Brancher la Play Console (une seule fois, ~10 min)

1. **Google Cloud** (console.cloud.google.com) → crée un projet → *IAM et admin › Comptes de service* → crée un compte de service → onglet *Clés* → *Ajouter une clé › JSON*. Range le fichier hors du projet, ex. `C:/Users/zacha/secrets/play-dashboard-sa.json`.
2. Dans ce projet Cloud, active l'API **Google Play Developer Reporting API** (pour crashs/ANR).
3. **Play Console** → *Utilisateurs et autorisations* → *Inviter un utilisateur* → colle l'e-mail du compte de service → droits au niveau du compte : **Afficher les données de l'application** et **Afficher les informations financières** → invite.
4. **Play Console** → *Télécharger les rapports › Statistiques* → *Copier l'URI Cloud Storage* : `gs://pubsite_prod_rev_XXXX/...` → garde `pubsite_prod_rev_XXXX`.
5. Dans `.env.local`, décommente et remplis :
   ```
   PLAY_PACKAGE_NAME=com.gymstrack.app
   PLAY_REPORTS_BUCKET=pubsite_prod_rev_XXXX
   GOOGLE_SERVICE_ACCOUNT_FILE=C:/Users/zacha/secrets/play-dashboard-sa.json
   ```
6. Redémarre `npm run dev`. Le badge passe à « ● en direct ».

Les nouvelles autorisations peuvent mettre **jusqu'à 24 h** à s'appliquer. Google publie les rapports une fois par jour (avec ~2 jours de retard), et le dashboard les garde en cache 30 min. Le bouton ↻ force le rechargement.

## Brancher Stripe et RevenueCat

Dans `.env.local` (jamais dans git, jamais collé ailleurs) :

```
STRIPE_READONLY_KEY=rk_live_...
REVENUECAT_API_KEY=sk_...
REVENUECAT_PROJECT_ID=xxxxxxxx
```

- **Stripe** : Développeurs → Clés API → Créer une clé secrète → *Autorisations personnalisées* → **Lecture** sur Charges and Refunds, Customers, Subscriptions, Invoices, Balance, Products, Prices ; rien d'autre. Jamais la clé `sk_live_` du backend.
- **RevenueCat** : Project settings → API keys → New secret API key, **V2**, **Read only** sur Charts metrics et Customer information. L'ID du projet est dans l'URL (`/projects/<id>/`).

## Utiliser la base de prod

Par défaut, le dashboard lit `../gym-track-v1/backend/dev.db`. Pour tes vrais utilisateurs, copie le `.db` du serveur (par défaut dans le conteneur : `/app/data/dev.db`, ex. `docker cp <conteneur>:/app/data/dev.db ./prod.db`) puis mets `GYMTRACK_DB_PATH=C:/chemin/vers/prod.db`. La base est ouverte en **lecture seule**.

## Définitions

- **Actif** = au moins une séance ou une pesée dans les 7 derniers jours. **À risque** = 8 à 21 jours sans activité. **Parti** = plus de 21 jours. Les seuils sont dans `src/lib/app-db.ts`.
- **Rétention JN** = part des inscrits depuis au moins N jours qui ont eu une activité N jours ou plus après leur inscription.
- **Cohortes** = part de chaque cohorte (semaine d'inscription) active pendant la semaine S0, S1, S2…
- **Installeurs gardés JN** = chiffre Google : part des installeurs qui ont toujours l'app N jours plus tard.

## Structure

```
src/lib/app-db.ts     stats calculées depuis la base GymTrack
src/lib/play.ts       lecture des rapports Play Console + API vitals
src/lib/play-demo.ts  données de démo
src/components/       graphiques (Recharts) et composants UI
src/app/page.tsx      le dashboard
```
