# A26_5A6_01-Message-Service

Microservice des messages de Chatvardage — Contrôle 2. Gère à la fois les
messages privés (DM) entre deux utilisateurs et les messages de salon
(channels), en réutilisant exactement la même architecture pour les deux.

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

### Appartenance aux salons

Message-Service ne connaît pas localement les membres d'un salon : cette
donnée appartient à `A26_5A6_01-Room-Service`. Avant toute écriture ou
lecture d'un message de salon, `RoomsClientService` appelle
`GET {ROOM_SERVICE_URL}/api/rooms/:roomId` et vérifie que l'utilisateur
authentifié figure dans `membreIds`. Un salon introuvable renvoie **404**,
Room-Service indisponible/en timeout renvoie **503**, et une réponse 2xx au
format inattendu renvoie **502**.

## API REST

### Messages privés (DM)

- `GET /api/health` — santé PostgreSQL/Redis (public)
- `POST /api/messages` — créer un DM (JWT requis)
- `GET /api/messages/history/:otherUserId?limit=50&cursor=<messageId>` — historique paginé (JWT requis, limite 1..100)
- `GET /api/messages/conversations` — lister les conversations DM de l'utilisateur authentifié, triées par activité la plus récente (JWT requis)
- `GET /api/messages/:id` — récupérer un DM auquel l'utilisateur participe
- `PATCH /api/messages/:id` — modifier son propre DM
- `DELETE /api/messages/:id` — supprimer son propre DM

`GET /api/messages/conversations` renvoie, pour chaque interlocuteur distinct avec qui l'utilisateur authentifié a échangé, le dernier message de la conversation :

```json
[
  {
    "otherUserId": "uuid-interlocuteur",
    "lastMessage": {
      "id": "uuid-message",
      "senderId": "uuid-expediteur",
      "recipientId": "uuid-destinataire",
      "content": "Salut!",
      "createdAt": "2026-09-23T00:00:00.000Z",
      "updatedAt": "2026-09-23T00:00:00.000Z"
    }
  }
]
```

Une conversation n'apparaît qu'une seule fois, même après de nombreux échanges dans les deux sens : seul le message le plus récent de chaque interlocuteur est retenu, et la liste est triée de la conversation la plus récemment active à la plus ancienne.

Création :

```json
{
  "recipientId": "uuid-destinataire",
  "content": "Salut!"
}
```

`recipientId` doit être un UUID valide et doit être différent de l’identifiant de l’expéditeur. L’existence du destinataire demeure gérée par le domaine Auth/Utilisateurs; Message-Service ne duplique pas cette source de vérité.

`content` est obligatoire et limité à 4000 caractères, en REST comme en WebSocket.

### Messages de salon (channels)

- `POST /api/messages/rooms/:roomId` — créer un message de salon (JWT requis, membre du salon requis)
- `GET /api/messages/rooms/:roomId/history?limit=50&cursor=<messageId>` — historique paginé (JWT requis, membre du salon requis, limite 1..100)
- `GET /api/messages/rooms/:roomId/:id` — récupérer un message du salon (n'importe quel membre du salon, pas seulement l'auteur)
- `PATCH /api/messages/rooms/:roomId/:id` — modifier son propre message de salon
- `DELETE /api/messages/rooms/:roomId/:id` — supprimer son propre message de salon

Création :

```json
{
  "content": "Salut le salon!"
}
```

`content` est obligatoire et limité à 4000 caractères, en REST comme en WebSocket. Contrairement aux DM, la lecture (`GET`) n'est pas limitée à l'auteur : tout membre du salon peut consulter tous les messages du salon. Seul l'auteur peut modifier ou supprimer son propre message.

## Temps réel

Namespace Socket.IO : `/messages`.

### Messages privés (DM)

Émission client : `private-message.send` avec le même schéma que la création REST.

Événements serveur :

- `private-message.created`
- `private-message.updated`
- `private-message.deleted`

Après validation du JWT par Auth-Service, le client est placé dans la room `user:<id>` correspondant à l'utilisateur authentifié. Il ne choisit donc pas son identité.

### Messages de salon (channels)

Émissions client :

- `room-message.join` `{ roomId }` — vérifie l'appartenance au salon via Room-Service puis place le socket dans la room Socket.IO `room:<roomId>`
- `room-message.leave` `{ roomId }` — retire le socket de `room:<roomId>` (aucune vérification requise)
- `room-message.send` `{ roomId, content }` — crée le message (même vérification d'appartenance que la création REST)

Événements serveur :

- `room-message.created`
- `room-message.updated`
- `room-message.deleted`

### Indicateur de frappe (typing)

Événement client `typing` `{ scope: 'room' | 'dm', targetId, isTyping }` : relayé directement, **sans persistance ni passage par Redis/PostgreSQL** (best-effort, éphémère). La cible est `room:<targetId>` pour `scope: 'room'` ou `user:<targetId>` pour `scope: 'dm'`. Le serveur réémet `typing` avec `{ userId, scope, targetId, isTyping }` à tous les clients de cette room, sauf l'émetteur.

Le chemin de diffusion pour les messages persistés (DM et salon) est :

`PostgreSQL -> Redis PUBLISH -> Redis SUBSCRIBE -> Socket.IO`

Pour un DM, l'émetteur et le destinataire reçoivent l'événement temps réel correspondant. Pour un message de salon, tous les sockets ayant rejoint `room:<roomId>` (via `room-message.join`) le reçoivent.

## Variables d'environnement

```env
PORT=3004
DATABASE_URL="postgresql://message_service:message_service_dev@localhost:5432/chatvardage_messages?schema=public"
REDIS_URL="redis://:chatvardage_redis_dev@localhost:6379"
CORS_ORIGINS="http://localhost:5173"
AUTH_SERVICE_URL=http://localhost:3001
AUTH_SERVICE_TIMEOUT_MS=3000
ROOM_SERVICE_URL=http://localhost:3003
ROOM_SERVICE_TIMEOUT_MS=3000
```

Dans Docker Compose, utiliser `postgres` et `redis` comme hostnames.

En Docker global, les services Auth et Room sont accessibles avec :

```env
AUTH_SERVICE_URL=http://auth-service:3001
ROOM_SERVICE_URL=http://room-service:3003
```

> Note : `A26_5A6_01-Infra` (docker-compose.yml) doit encore être mis à jour
> séparément, dans ce dépôt-là, pour injecter `ROOM_SERVICE_URL` dans le
> conteneur `message-service`. Ce dépôt (`Message-Service`) ne peut pas le
> faire lui-même.

`CORS_ORIGINS` est une liste séparée par des virgules. Il n'y a plus de CORS réfléchi (`origin: true`). Les connexions WebSocket sans en-tête `Origin` restent acceptées volontairement afin de supporter les clients non-navigateurs (par exemple Electron/Socket.IO).

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

En cas de panne partielle, l'endpoint retourne **HTTP 503** avec `status=degraded` et indique séparément l'état de PostgreSQL et Redis.

Avant une PR, exécuter :

```powershell
npm run lint
npm run test:cov
npm run build
npm audit
```

Les tests couvrent notamment l'authentification, les opérations REST, la persistance des messages, Redis Pub/Sub et la diffusion Socket.IO.
