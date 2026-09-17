# A26_5A6_01-Message-Service

Microservice des messages privés de Chatvardage — Contrôle 2.

## Responsabilité

PostgreSQL est la source de vérité. Après une écriture réussie, Message-Service publie l'événement dans Redis Pub/Sub; le subscriber Redis le rediffuse ensuite aux clients concernés via Socket.IO.

`PostgreSQL -> Redis PUBLISH -> Redis SUBSCRIBE -> Socket.IO`

Redis ne remplace jamais la persistance. Après une reconnexion, le client recharge l'historique par l'API REST.

## Authentification

Le service utilise les JWT émis par `A26_5A6_01-Authentification`.

REST : `Authorization: Bearer <JWT>`.

Socket.IO :

```js
const socket = io('http://localhost:3004/messages', {
  auth: { token: jwt },
});
```

Message-Service ne valide pas localement la signature du JWT. Il transmet le jeton à `GET /api/auth/me` du service Auth à l'aide de `AUTH_SERVICE_URL`.

Auth-Service valide le jeton, vérifie sa révocation avec `version_auth` et confirme l'existence du compte dans PostgreSQL. Message-Service utilise ensuite l'utilisateur retourné par Auth-Service comme identité authentifiée.

`x-user-id` et `handshake.auth.userId` ne sont pas acceptés. L'identité ne peut donc pas être choisie directement par le client.

## API REST

- `GET /api/health` — santé PostgreSQL/Redis (public)
- `POST /api/messages` — créer un DM (JWT requis)
- `GET /api/messages/history/:otherUserId?limit=50&cursor=<messageId>` — historique paginé (JWT requis, limite 1..100)
- `GET /api/messages/:id` — récupérer un DM auquel l'utilisateur participe
- `PATCH /api/messages/:id` — modifier son propre DM
- `DELETE /api/messages/:id` — supprimer son propre DM

Création :

```json
{
  "recipientId": "uuid-destinataire",
  "content": "Salut!"
}
```

`content` est obligatoire et limité à 4000 caractères, en REST comme en WebSocket.

## Temps réel

Namespace Socket.IO : `/messages`.

Émission client : `private-message.send` avec le même schéma que la création REST.

Événements serveur :

- `private-message.created`
- `private-message.updated`
- `private-message.deleted`

Après validation du JWT par Auth-Service, le client est placé dans la room `user:<id>` correspondant à l'utilisateur authentifié. Il ne choisit donc pas son identité.

Le chemin de diffusion est :

`PostgreSQL -> Redis PUBLISH -> Redis SUBSCRIBE -> Socket.IO`

L'émetteur et le destinataire reçoivent l'événement temps réel correspondant.

## Variables d'environnement

```env
PORT=3004
DATABASE_URL="postgresql://message_service:message_service_dev@localhost:5432/chatvardage_messages?schema=public"
REDIS_URL="redis://:chatvardage_redis_dev@localhost:6379"
CORS_ORIGINS="http://localhost:5173"
AUTH_SERVICE_URL=http://localhost:3001
```

Dans Docker Compose, utiliser `postgres` et `redis` comme hostnames.

En Docker global, le service Auth est accessible avec :

```env
AUTH_SERVICE_URL=http://auth-service:3001
```

`CORS_ORIGINS` est une liste séparée par des virgules. Il n'y a plus de CORS réfléchi (`origin: true`).

## Docker

Le build génère Prisma et compile NestJS. L'image finale réutilise les dépendances déjà installées dans le stage de build : aucun téléchargement de Prisma n'est effectué au démarrage.

Le conteneur exécute `prisma migrate deploy`, puis `node dist/main`.

L'orchestration complète appartient au dépôt `A26_5A6_01-Infra`.

## Vérification

Après le lancement via Infra :

```powershell
Invoke-RestMethod http://localhost:3004/api/health
```

Le résultat attendu lorsque tout fonctionne est :

- `status=ok`
- `database=ok`
- `redis=ok`

En cas de panne partielle, l'endpoint retourne `status=degraded` et indique séparément l'état de PostgreSQL et Redis.

Avant une PR, exécuter :

```powershell
npm run lint
npm run test:cov
npm run build
npm audit
```

Les tests couvrent notamment l'authentification, les opérations REST, la persistance des messages, Redis Pub/Sub et la diffusion Socket.IO.