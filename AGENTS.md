# AGENTS.md — Chatvardage Message-Service

Ce fichier contient les règles de travail pour tout agent IA ou développeur qui modifie ce dépôt. Le détail du fonctionnement est dans le `README.md` et `docs/`.

## Contexte du projet

Ce dépôt est le **Message-Service** de Chatvardage.

Architecture d'équipe :

- `Frontend` : Electron.
- `Serveur-API` : API Gateway / point d'entrée unique (relaie aussi Socket.IO).
- `Authentification` : utilisateurs, authentification et rôles globaux.
- `Room-Service` : serveurs, membres, rôles et salons — seule source de vérité des droits d'accès aux salons.
- `Message-Service` : messages privés et de salon, historique et temps réel.
- `User-Config-Service` : alias, thème, préférences et présence choisie.
- `Dashboard` : panneau d'administration.
- `Infra` : Docker Compose, PostgreSQL, Redis et orchestration globale.

## Stack

- Node.js 22, NestJS 11, TypeScript
- Prisma 6 (version exacte, la même dans tous les services), PostgreSQL 17
- Redis 7 (Pub/Sub) et Socket.IO (namespace `/messages`)
- Jest, ESLint + Prettier (même configuration que les autres services Node)
- Swagger / OpenAPI (`@nestjs/swagger` 11, exposé sous `/docs`)
- Docker

## Responsabilités

- persister les messages privés et de salon dans PostgreSQL (source de vérité) ;
- persister l'état de lecture de chaque conversation (`ConversationReadState`), calculer les messages non lus et rechercher dans les seules conversations accessibles (salons lisibles fournis par Room-Service, `GET /api/internal/users/:userId/channels`) ;
- publier chaque changement sur Redis **après** l'écriture en base, puis le diffuser par Socket.IO ;
- relayer la présence, le profil, l'indicateur de saisie et les changements de serveur signalés par Room-Service (`/api/internal`, jeton interne) ;
- limiter la fréquence des envois (`LimiteEnvoiService`) et des événements Socket.IO bavards.

Ne pas recoder ici une règle de droits sur les salons : toujours demander l'accès à Room-Service (`RoomsClientService`). Ne pas stocker de préférences utilisateur (User-Config-Service).

## Authentification

- REST : `Authorization: Bearer <JWT>` ; Socket.IO : `handshake.auth.token`.
- Le jeton est validé par Authentification (`GET /api/auth/me`) via `src/partage/client-auth.ts`, jamais localement. Ne jamais accepter une identité fournie par le client (`x-user-id`, `handshake.auth.userId`).
- Un socket ouvert est revalidé régulièrement (voir `MessagesGateway`) : un jeton révoqué ou expiré le déconnecte.
- Aucun événement d'un client n'est traité avant `connexion.prete` (authentification terminée).

## Fichiers partagés (`src/partage/`)

`client-auth.ts` et `secrets-production.ts` (et leurs specs) sont **identiques à l'octet près** dans d'autres dépôts. Ne pas les modifier dans un seul dépôt : reporter le même changement partout, puis lancer `A26_5A6_01-Infra/scripts/verifier-fichiers-partages.sh`.

## Swagger

Toutes les routes REST sont sous `/api`; Swagger est exposé sous `/docs`. Une nouvelle route ou un nouveau DTO REST reçoit ses décorateurs `@ApiOperation` / `@ApiProperty`, comme dans Room-Service. Les événements Socket.IO ne sont pas dans Swagger : les documenter dans Infra (`docs/api/temps-reel-*.md`).

`@nestjs/swagger` 11 embarque `js-yaml` 5.3.0 (vulnérabilité modérée). L'`overrides` limité à `@nestjs/swagger` force `js-yaml` ^5.4.2 sans toucher aux autres paquets (la v12 exige NestJS 12). Le retirer quand Swagger 11 corrigera sa dépendance ou lors du passage à NestJS 12.

## Limites connues (acceptées)

Une seule instance : sans adaptateur Redis de Socket.IO, la présence, les limites de fréquence et le retrait des salons ne voient que les clients de l'instance courante. Ne pas lancer plusieurs instances sans traiter ce point.

## Commandes obligatoires avant de terminer une modification

```bash
npm audit --audit-level=high
npm run lint
npm run build
npm run test:cov
```

**Audit des dépendances** : le CI lance `npm audit --audit-level=high` (dépendances de dev comprises). Si un avis `high` ou `critical` sans correctif compatible le bloque, forcer une version corrigée par un `overrides` ciblé dans `package.json` si elle existe ; sinon consigner l'exception dans la section « Limites connues (acceptées) » ci-dessus (paquet, avis, raison, condition de retrait). Ne pas retirer ni affaiblir l'étape.

Après un changement des requêtes de non-lus, d'état de lecture ou de recherche, lancer aussi `npm run test:integration` contre une base jetable (voir le README) : les tests unitaires simulent Prisma et ne prouvent pas le SQL réel (par exemple, Prisma n'échappe pas `%` et `_` dans `contains`).

La couverture est exigée à **100 %** (voir `coverageThreshold` dans `package.json`) : toute nouvelle branche atteignable doit être testée. Les tests unitaires simulent Prisma, Redis et les autres services.

## Docker

Le conteneur tourne sous l'utilisateur `node` et exécute `prisma migrate deploy` avant de démarrer. Pour lancer le service seul : `docker compose -f compose.local.yml up --build` (Authentification et Room-Service attendus sur l'hôte). La stack complète est dans `A26_5A6_01-Infra`.

## Documentation

Mettre à jour le `README.md` et `docs/TEMPS_REEL_*.md` à chaque changement de route, d'événement Socket.IO ou de variable d'environnement, ainsi que `docs/API.md` de Serveur-API si le contrat vu par le Frontend change.

## Documentation centrale

Infra est la référence du démarrage complet, des architectures, contrats et scénarios de validation. Le README local décrit le dépôt et ses commandes; les guides détaillés sont dans `A26_5A6_01-Infra/docs/`. Toute modification de contrat doit mettre à jour la référence centrale et ses liens.

## Revue PR #9 — décisions du 6 octobre 2026

- Publication concurrente : correction retenue; publier seulement si la lecture relue correspond encore à la date avancée par cet appel. L'état en base reste monotone et la réponse renvoie l'état courant. Une transaction supplémentaire n'est pas nécessaire pour ce correctif.
- Date Redis invalide : correction retenue; la gateway rejette une date non interprétable avant de la transmettre aux clients.
- Promise.all avec trois opérations et deux résultats : conservé; la troisième opération retourne void, son résultat est volontairement ignoré et son échec se propage. La séparer rendrait le nettoyage séquentiel sans améliorer sa fiabilité.
- OR des compteurs DM : conservé; supprimer la clause des conversations jamais lues quand la liste des états est vide supprimerait précisément les non-lus à compter. Une optimisation SQL demande une mesure de charge, pas cette simplification.
- Fusion de recherche : conservée; charger au plus deux fois limit + 1 lignes permet de déterminer la page globale et son curseur correctement. La limite maximale borne ce coût.
- Curseur non signé : conservé; il ne donne aucun droit, la portée est recalculée depuis l'identité authentifiée. Naviguer dans ses propres résultats ne constitue pas une faille.
- Alias LECTURE_CHANNEL : conservé; renommage stylistique sans correction de comportement.
- Invalidation de toutes les listes après changement de serveur : conservée; elle privilégie les droits actuels au risque d'un cache périmé. Une indexation plus fine demande des mesures et une gestion supplémentaire des dépendances.
- Recherche sans limite de fréquence spécifique : limite connue, reportée en l'absence de saturation mesurée. Augmenter le minimum à trois caractères sans index trigramme ne supprime pas les scans. Avant une ouverture à une forte charge, mesurer les requêtes et ajouter une limite adaptée ou un index dans ce service.

Validation : audit high, lint, build, 346 tests unitaires (couverture 100 %) et 10 tests d'intégration sur chatvardage_messages_test passent. Aucun avis high/critical; les avis modérés existants restent.

### Nouvelle revue PR #9
- Messages de même milliseconde : position (lastReadAt, lastReadMessageId), alignée sur l'ordre de l'historique, pour les DM et salons. Nouvelle migration additive; les états existants sans id conservent leur sémantique historique (toute cette date est lue).
- Ordre de publication Redis : pas de verrou distribué ajouté. Les événements sont des avancées idempotentes; chaque consommateur doit conserver max(date locale, date reçue), jamais affecter aveuglément le dernier événement reçu. Le frontend applique déjà Math.max dans traiterLectureDm et traiterLectureSalon; ses propres lectures déclenchent une relecture des compteurs en base. Ce contrat est explicité dans README. Cela résout le recul sans coupler les écritures SQL au transport Redis.
Validation : audit high, lint, build, 347 tests unitaires (couverture 100 %) et 11 tests PostgreSQL passent. Migration appliquée uniquement sur chatvardage_messages_test; reconstruction du service requise au déploiement pour appliquer la migration sur sa base réelle.


### Suite de la revue PR #9 — position et synchronisation des lectures

Accusés : lastReadMessageId transmis par les réponses HTTP des lecteurs et les événements Redis/Socket.IO, avec null pour l’ancien contrat. Le consommateur compare la position complète; la date seule ne distingue pas deux messages de même milliseconde. Tests unitaires et tests PostgreSQL adaptés au contrat additif.

Validation locale sous Node 24 : audit high, types (Frontend), lint, tests avec couverture et build. La validation manuelle Electron n’a pas été effectuée. Tests PostgreSQL non exécutés : aucune DATABASE_URL de test disponible et démarrage de la base jetable empêché par les permissions de l’environnement. La validation d’intégration reste requise avant fusion.


### Revue suivante PR #9 — invalidation des réponses en cours

La génération des droits est capturée avant chaque requête Room-Service. Une invalidation pendant la réponse impose une nouvelle requête; une seconde invalidation répond 503 sans utiliser ni mémoriser les anciens droits. Le contrôle couvre salonsLisibles et verifierAcces. Quatre tests simulent une réponse retardée et des invalidations répétées, pour les listes et les accès individuels.

Validation de cette correction : audit high, lint, build et 353 tests unitaires avec couverture 100 % passent sous Node 24. Aucun changement de requête PostgreSQL dans ce correctif de cache.
