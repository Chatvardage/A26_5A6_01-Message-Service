# Chatvardage — Messages et temps réel

Microservice NestJS/Prisma : messages privés et de salon, historique, Redis Pub/Sub et Socket.IO. Il écrit dans PostgreSQL avant de publier chaque création, modification ou suppression individuelle.

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
npx prisma generate
npm run lint
npm run test:cov -- --runInBand
npm run build
```

Les migrations appartiennent à ce dépôt (`prisma/` lorsqu’applicable); Infra crée uniquement les bases et les comptes SQL. Consulter [AGENTS.md](AGENTS.md) pour les règles et vérifications supplémentaires.

## Documentation

- [Architecture complète](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/architecture.md)
- [API et événements](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/api/README.md)
- [Scénario de validation](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/validation.md)
- [Versions et publication](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/versions.md)
