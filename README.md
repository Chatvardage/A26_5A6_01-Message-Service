# Chatvardage — Messages et temps réel

Microservice NestJS/Prisma : messages privés et de salon, historique, messages non lus, recherche, Redis Pub/Sub et Socket.IO. Il écrit dans PostgreSQL avant de publier chaque création, modification ou suppression individuelle.

### Résumé de recherche

`GET /api/messages/search/summary?q=<texte>` renvoie les comptes complets par interlocuteur et par serveur, avec les comptes de ses salons lisibles. Le texte a les mêmes contraintes que la recherche paginée (2–100 caractères, casse ignorée, jokers littéraux). Les groupes sans résultat sont absents; les DM entrants et sortants sont additionnés par interlocuteur. Les agrégations ne chargent aucun contenu de message et utilisent uniquement les droits Room-Service de l'acteur authentifié. La réponse contient `directMessages: [{ conversationId, count }]` et `servers: [{ serverId, count, channels: [{ conversationId, count }] }]`, triés par compte décroissant puis identifiant. La route est additive; reconstruire le service avant d'utiliser la nouvelle recherche mobile. Référence : [résumé de recherche dans Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/api/recherche-resume.md).

## Lancer le service complet

Le [README Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/README.md) est le point de départ : clonage des huit dépôts, secrets, Docker Compose, administration et client desktop.

Depuis le dépôt Infra :

```bash
docker compose up --build -d
./scripts/healthcheck.sh
```

Préparer auparavant `.env` selon Infra. Le healthcheck vérifie PostgreSQL, les quatre bases, Redis, les six services dont Dashboard, puis les dépendances du Gateway. `--infra` limite le diagnostic à PostgreSQL et Redis.

## Développer ce dépôt seul

Prérequis : Docker Compose v2; hors Docker, Node 22, PostgreSQL, Redis; Authentification et Room-Service accessibles.

```bash
git clone https://github.com/Chatvardage/A26_5A6_01-Message-Service.git
cd A26_5A6_01-Message-Service
cp .env.example .env
docker compose -f compose.local.yml up --build
```

Le Compose individuel attend Authentification sur l’hôte; Message-Service attend aussi Room-Service. Pour une installation autonome complète, utiliser Infra.

Service local : `http://localhost:3004`. Santé : `GET /api/health`. Swagger (routes REST) : `http://localhost:3004/docs`. Les Compose individuels utilisent des ports communs à Infra : choisir un seul environnement à la fois.

La configuration complète, les routes, les exemples et les procédures Node/Rust sont dans le [guide du service dans Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/services/Message-Service.md). Les valeurs de `.env.example` sont réservées au développement.

## Vérifications

```bash
npm ci
npm audit --audit-level=high
npx prisma generate
npm run lint
npm run test:cov -- --runInBand
npm run build
```

### Tests d'intégration (PostgreSQL réel)

`npm run test:integration` exécute les vraies requêtes Prisma des non-lus, de l'état de lecture (y compris après un redémarrage, simulé par un nouveau client Prisma) et de la recherche. Les tests unitaires, eux, simulent Prisma. Ils exigent une base **jetable** dont le nom finit par `_test`, car chaque test vide les tables. Avec le PostgreSQL d'Infra démarré :

```bash
# Une seule fois : rôle et base de test (superutilisateur d'Infra)
docker exec chatvardage-postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE ROLE ms_test LOGIN PASSWORD '"'"'ms_test'"'"';" -c "CREATE DATABASE chatvardage_messages_test OWNER ms_test;"'

export DATABASE_URL="postgresql://ms_test:ms_test@localhost:5432/chatvardage_messages_test?schema=public"
npx prisma migrate deploy
npm run test:integration
```

Ils ne sont pas lancés par le CI, qui n'a pas de PostgreSQL.

Les migrations appartiennent à ce dépôt (`prisma/` lorsqu’applicable); Infra crée uniquement les bases et les comptes SQL. Consulter [AGENTS.md](AGENTS.md) pour les règles et vérifications supplémentaires.

## Documentation

- [Architecture complète](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/architecture.md)
- [API et événements](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/api/README.md)
- [Scénario de validation](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/validation.md)
- [Versions et publication](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/versions.md)

## Position et événements de lecture
La position persistée utilise (lastReadAt, lastReadMessageId), dans le même ordre que l'historique. Deux messages de même milliseconde restent distincts. La migration 20261006194000_position_lecture ajoute une colonne nullable; les anciennes lectures sans identifiant couvrent toute leur date, comme avant.
Les événements read-state.updated peuvent arriver dans le désordre avec des appels concurrents. Chaque consommateur doit appliquer lastReadAt de façon monotone : conserver la position maximale `(lastReadAt, lastReadMessageId)` entre son état et l'événement reçu. Une notification de sa propre lecture peut déclencher une relecture de l'état serveur. Les réponses HTTP des lecteurs et les événements Socket.IO exposent aussi `lastReadMessageId` (nullable). À dates égales, comparer les identifiants dans l'ordre de l'historique; une ancienne lecture sans identifiant couvre toute cette date. Le champ est additif et les consommateurs doivent le conserver pour distinguer les coches des messages de même milliseconde.


### Suite de la revue PR #9 — position et synchronisation des lectures

Accusés : lastReadMessageId transmis par les réponses HTTP des lecteurs et les événements Redis/Socket.IO, avec null pour l’ancien contrat. Le consommateur compare la position complète; la date seule ne distingue pas deux messages de même milliseconde. Tests unitaires et tests PostgreSQL adaptés au contrat additif.

Validation locale sous Node 24 : audit high, types (Frontend), lint, tests avec couverture et build. La validation manuelle Electron n’a pas été effectuée. Tests PostgreSQL non exécutés : aucune DATABASE_URL de test disponible et démarrage de la base jetable empêché par les permissions de l’environnement. La validation d’intégration reste requise avant fusion.


### Revue suivante PR #9 — invalidation des réponses en cours

La génération des droits est capturée avant chaque requête Room-Service. Une invalidation pendant la réponse impose une nouvelle requête; une seconde invalidation répond 503 sans utiliser ni mémoriser les anciens droits. Le contrôle couvre salonsLisibles et verifierAcces. Quatre tests simulent une réponse retardée et des invalidations répétées, pour les listes et les accès individuels.

Validation de cette correction : audit high, lint, build et 353 tests unitaires avec couverture 100 % passent sous Node 24. Aucun changement de requête PostgreSQL dans ce correctif de cache.


### Suite de revue du 6 octobre — concurrence et contrat PUT

Les deux PUT de lecture renvoient maintenant la position persistée complète `{ lastReadAt, lastReadMessageId }`, y compris si un autre appareil l’a avancée au message suivant de même milliseconde. Conversation vide : position existante conservée ou deux champs null. Contrat additif, sans nouvelle migration ni requête SQL. Validation : audit high, lint, build et 355 tests à couverture 100 % passent sous Node 24. Assertions PostgreSQL mises à jour mais non exécutées faute de base de test.

### Vérification de la chaîne de migrations

L’observation signalant l’absence des tables de messages est infirmée par la chaîne complète : `20260916163000_init` crée `PrivateMessage` avec ses deux index, puis `20260923130000_add_room_message` crée `RoomMessage` et son index. `20261006175849_etat_lecture` et `20261006194000_position_lecture` ajoutent ensuite l’état de lecture. Une base neuve exécutant `prisma migrate deploy` parcourt ces migrations dans cet ordre; aucune migration corrective ni inscription manuelle sur les bases existantes n’est requise.
\n\n

### Recherche : pagination directe depuis un message

Les historiques DM (`GET /api/messages/history/:otherUserId`) et salons (`GET /api/messages/rooms/:roomId/history`) acceptent `around=<messageId>` : une page de 50 messages par défaut commence au message inclus, vers les messages plus anciens. Les pages intermédiaires ne sont pas chargées. `cursor=<messageId>&direction=after` charge ensuite les messages plus récents; `cursor` seul garde la pagination ancienne. Les réponses restent des tableaux chronologiques, avec un ordre stable `(createdAt, id)`. La limite reste bornée de 1 à 100.

`around` et `cursor` sont exclusifs. `direction=after` exige `cursor` et exclut `around`. Le message de départ est recherché dans la conversation autorisée : une cible absente ou étrangère répond 400; l’accès aux salons reste validé par Room-Service. Le Gateway transmet les paramètres sans changer le contrat.

Les clients affichent un indicateur de chargement puis positionnent le message instantanément. Une nouvelle recherche ou une navigation invalide les réponses précédentes. L’historique repart de cette page; les messages plus anciens et plus récents sont chargés à la demande.

## Renforcement sécurité — 9 octobre 2026

Une vérification Auth explicitement fraîche invalide aussi la requête en cours. Une réponse antérieure ne peut ni remplir à nouveau le cache ni effacer la nouvelle requête. Cette logique et ses tests sont identiques à Room-Service.

La confirmation de livraison est atomique entre appareils : un seul appel publie `private-message.delivered`, les autres relisent la confirmation existante. Elle préserve la date de modification du texte, y compris lors d'une édition concurrente. Si Auth est indisponible lors d'une invalidation ciblée, les sockets conservés sans vérification sont signalés par un avertissement agrégé.

Les dépendances compatibles sont mises à jour; l'override YAML concerne seulement `@istanbuljs/load-nyc-config`. npm/npx sont retirés de l'image finale : la migration utilise le CLI Prisma déjà installé (`node node_modules/prisma/build/index.js migrate deploy`). Voir le rapport global dans `../A26_5A6_01-Infra/docs/audit-securite-2026-10-09.md`.
