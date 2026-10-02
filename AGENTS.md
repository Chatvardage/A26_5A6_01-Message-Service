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
npm run lint
npm run build
npm run test:cov
```

La couverture est exigée à **100 %** (voir `coverageThreshold` dans `package.json`) : toute nouvelle branche atteignable doit être testée. Les tests unitaires simulent Prisma, Redis et les autres services.

## Docker

Le conteneur tourne sous l'utilisateur `node` et exécute `prisma migrate deploy` avant de démarrer. Pour lancer le service seul : `docker compose -f compose.local.yml up --build` (Authentification et Room-Service attendus sur l'hôte). La stack complète est dans `A26_5A6_01-Infra`.

## Documentation

Mettre à jour le `README.md` et `docs/TEMPS_REEL_*.md` à chaque changement de route, d'événement Socket.IO ou de variable d'environnement, ainsi que `docs/API.md` de Serveur-API si le contrat vu par le Frontend change.

## Documentation centrale

Infra est la référence du démarrage complet, des architectures, contrats et scénarios de validation. Le README local décrit le dépôt et ses commandes; les guides détaillés sont dans `A26_5A6_01-Infra/docs/`. Toute modification de contrat doit mettre à jour la référence centrale et ses liens.
