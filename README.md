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

Un jeton validé est mémorisé `AUTH_CACHE_TTL_MS` millisecondes (10 000 par défaut, `0` pour interroger Auth à chaque requête) : une révocation ou un changement de rôle est pris en compte au plus tard à l'expiration de l'entrée. Les refus et les pannes ne sont jamais mémorisés. Ce client est le fichier partagé `src/partage/client-auth.ts`, identique dans Room-Service (voir « Fichiers partagés »).

`x-user-id` et `handshake.auth.userId` ne sont pas acceptés. L'identité ne peut donc pas être choisie directement par le client.

### Droits d'accès aux salons

Message-Service ne connaît ni les membres ni les permissions des salons :
ces données appartiennent à `A26_5A6_01-Room-Service` (serveurs, rôles,
salons réservés aux modérateurs, écriture réservée de `#annonces`). Avant
toute lecture, écriture, modification ou suppression d'un message de salon,
et avant de rejoindre la room Socket.IO d'un salon, `RoomsClientService`
appelle la route interne
`GET {ROOM_SERVICE_URL}/api/internal/channels/:roomId/access/:userId?role=<rôle global>`
avec l'en-tête `x-internal-token: {INTERNAL_SERVICE_TOKEN}`, et reçoit
`{ salonId, serveurId, estMembre, peutLire, peutEcrire }`.

- Lecture (historique, message, rejoindre la room) : `peutLire` requis (**403** sinon).
- Écriture : `peutEcrire` requis, **403** « Seuls les modérateurs peuvent écrire dans ce salon » pour un salon lisible en écriture réservée.
- Modification / suppression : `peutLire` requis (un membre expulsé ne touche plus à ses messages), puis être l'auteur.
- Salon introuvable : **404** ; Room-Service indisponible, en timeout, ou `INTERNAL_SERVICE_TOKEN` absent ou refusé : **503** ; réponse 2xx au format inattendu : **502**.

Le rôle global transmis (`admin` \| `moderateur` \| `utilisateur`) est celui qu'Auth-Service a renvoyé pour le JWT ; seul `admin` a des droits particuliers côté Room-Service.

Un accès obtenu est mémorisé `ROOM_ACCESS_CACHE_TTL_MS` millisecondes (10 000 par défaut, `0` pour interroger Room-Service à chaque fois), par salon, utilisateur et rôle. Chaque changement de serveur signalé par Room-Service (voir « Changements de serveur ») oublie aussitôt tous les accès à ce serveur, avant la revérification des sockets : une expulsion ou un salon rendu réservé est donc pris en compte immédiatement. Les erreurs ne sont jamais mémorisées.

### Message de bienvenue

La migration `20260924110000_message_bienvenue` insère, dans `#annonces` du
serveur par défaut « Chatvardage », un message expliquant l'app (auteur
`system`, affiché « Système »). Son identifiant et celui du salon sont figés
(voir Room-Service, `src/servers/default-server.ts`). Pour changer le texte
avant le premier déploiement, modifier cette migration ; après, créer une
nouvelle migration `UPDATE`.

Le Frontend n'affiche pas ce texte brut : il reconnaît le message à son
identifiant (`00000000-0000-4000-8000-000000000101`) et affiche sa version
traduite (`channels.welcomeMessage` dans `translations.json`, fr et en)
tant que le message n'a pas été modifié (`updatedAt` = `createdAt`). Tout
changement du texte doit donc aussi être reporté dans les deux traductions
du Frontend.

## API REST

### Messages privés (DM)

- `GET /api/health` — santé PostgreSQL/Redis (public)
- `POST /api/messages` — créer un DM (JWT requis)
- `GET /api/messages/history/:otherUserId?limit=50&cursor=<messageId>` — historique paginé (JWT requis, limite 1..100)
- `GET /api/messages/conversations` — lister les conversations DM de l'utilisateur authentifié, triées par activité la plus récente (JWT requis)
- `GET /api/messages/:id` — récupérer un DM auquel l'utilisateur participe
- `PATCH /api/messages/:id` — modifier son propre DM
- `DELETE /api/messages/:id` — supprimer son propre DM
- `POST /api/messages/admin` — créer un DM au nom d'un utilisateur existant (admin requis ; corps `{ "senderId": "uuid", "recipientId": "uuid", "content": "..." }`)
- `GET /api/messages/admin?limit=50&cursor=<messageId>&userId=<uuid>` — lister les DM du plus récent au plus ancien (admin requis ; limite 1..100, 50 par défaut ; `cursor` et `userId` facultatifs, `userId` filtre les messages envoyés ou reçus)
- `DELETE /api/messages/admin/:id` — supprimer un DM (admin requis)

Les créations et suppressions admin consignent l'identifiant de l'admin et du message dans les journaux applicatifs, sans son contenu. Une création admin exige que l'expéditeur et le destinataire existent auprès d'Authentification. La limite d'envoi reste appliquée à l'expéditeur désigné, pas à l'admin.

Le destinataire d'un DM (REST ou `private-message.send`) doit exister : Message-Service le vérifie auprès d'Authentification (`GET /api/users/lookup`, avec le jeton de l'expéditeur) et répond **404 « Destinataire introuvable »** sinon ; 503 si Authentification ne répond pas (échec fermé). Un destinataire trouvé est mémorisé 10 minutes (un seul appel par conversation active) ; un compte supprimé est oublié dès que la route interne `DELETE /api/internal/users/:userId` est appelée.

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
- `POST /api/messages/rooms/:roomId/admin` — créer un message au nom d'un utilisateur (admin requis ; corps `{ "authorId": "uuid", "content": "..." }`). L'admin doit pouvoir écrire dans le salon ; l'auteur doit exister, en être membre et pouvoir y écrire. La création est journalisée avec l'ID admin, l'ID du message, le salon et l'auteur, sans contenu.
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

`content` est obligatoire et limité à 4000 caractères, en REST comme en WebSocket. Contrairement aux DM, la lecture (`GET`) n'est pas limitée à l'auteur : tout membre du salon peut consulter tous les messages du salon. Seul l'auteur peut modifier son message ; il peut le supprimer, tout comme un **modérateur du serveur** (ou son propriétaire, un admin) — droit calculé par Room-Service (`peutModerer` de la route d'accès).

### Limite d'envoi

Un utilisateur peut envoyer au plus **10 messages par fenêtre glissante de 10 secondes**, messages privés et de salon confondus (`LimiteEnvoiService`), en REST comme en WebSocket. Au-delà, l'envoi est refusé avec une **429**, avant tout appel à Room-Service. Le compteur est en mémoire : il ne vaut que pour une seule instance du service (voir la note sur la présence plus bas). La modification et la suppression ne sont pas limitées.

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
- `room-message.revoked` `{ roomId }` (serveur → client) — le socket a été retiré de `room:<roomId>` après une perte d'accès (expulsion, rôle retiré, salon réservé ou supprimé, serveur supprimé) ; voir `docs/TEMPS_REEL_SALONS.md`
- `room-message.send` `{ roomId, content }` — crée le message (même vérification d'appartenance que la création REST)

Événements serveur :

- `room-message.created`
- `room-message.updated`
- `room-message.deleted`

### Indicateur de frappe (typing)

Événement client `typing` `{ scope: 'room' | 'dm', targetId, isTyping }` : relayé directement, **sans persistance ni passage par Redis/PostgreSQL** (best-effort, éphémère). La cible est `room:<targetId>` pour `scope: 'room'` (ignoré si le socket n'a pas rejoint cette room) ou `user:<targetId>` pour `scope: 'dm'`. Le serveur réémet `typing` avec `{ userId, scope, targetId, isTyping }` à tous les clients de cette room, sauf l'émetteur. **Limite par socket et par cible** (`DELAI_MIN_SAISIE_MS`, 1 s) : un changement d'état (commence / arrête d'écrire) est toujours relayé, mais le même état répété (un envoi par frappe côté client) au plus une fois par seconde — un message privé pouvant viser n'importe qui, un client ne peut pas inonder un autre utilisateur.

Le chemin de diffusion pour les messages persistés (DM et salon) est :

`PostgreSQL -> Redis PUBLISH -> Redis SUBSCRIBE -> Socket.IO`

Pour un DM, l'émetteur et le destinataire reçoivent l'événement temps réel correspondant. Pour un message de salon, tous les sockets ayant rejoint `room:<roomId>` (via `room-message.join`) le reçoivent.

### Présence (en ligne / hors ligne)

La présence choisie est enregistrée par le client dans User-Config-Service
(`PUT /api/config-utilisateur/presence`) ; Message-Service ne fait que la
**diffuser en temps réel** (canal Redis `presence.changed`) :

- serveur → client : `connexion.prete` (sans données), une fois le socket
  **authentifié** (jeton validé auprès d'Auth-Service, room `user:<id>`
  rejointe). L'événement `connect` de Socket.IO arrive
  AVANT, dès la poignée de main : un événement émis à ce moment-là
  (`presence.update`, `room-message.join`…) est refusé (« Utilisateur non
  authentifié »). Les clients attendent donc `connexion.prete` pour annoncer
  leur présence et rejoindre leurs salons — sinon, après une coupure
  réseau, un client restait « hors ligne » pour les autres ;
- serveur → client : `session.revoquee` (sans données), juste avant de
  déconnecter un socket dont le jeton est refusé par Auth-Service — à la
  connexion, ou lors de la **revalidation** faite toutes les 60 s
  (`INTERVALLE_REVALIDATION_MS`) : un jeton révoqué (mot de passe changé,
  compte supprimé) ou expiré ne reçoit donc plus rien au bout d'au plus
  ~70 s (revalidation + cache `AUTH_CACHE_TTL_MS`). Le client vérifie alors
  sa session au lieu de se reconnecter en boucle. Si Auth-Service est
  indisponible, les sockets sont gardés. La revalidation met aussi à jour le
  rôle global du socket ; une passe plus longue que l'intervalle n'est pas
  doublée par la suivante ;
- client → serveur : `presence.update` `{ statut: 'en-ligne' | 'hors-ligne' }`,
  émis juste après l'enregistrement et à chaque `connexion.prete`.
  L'utilisateur est celui du socket : on ne peut annoncer que sa propre
  présence. **Au plus un envoi par socket et par seconde**
  (`DELAI_MIN_PRESENCE_MS`) : une demande plus rapprochée n'est pas perdue,
  l'état le plus récent du socket part à la fin de la fenêtre (jamais après
  sa déconnexion) ;
- quand le **dernier** socket d'un utilisateur se ferme (app quittée,
  plantage, réseau coupé), `hors-ligne` est diffusé aussitôt ;
- client → serveur : `presence.suivre` `{ ids: string[] }` (500 au plus,
  une demande par seconde au plus), avec accusé de réception : les
  utilisateurs dont le client veut la présence (ceux qu'il affiche). Remplace
  la liste précédente ; le socket rejoint les rooms `presence:<id>`.
  Réponse : `{ enLigne: string[] }`, ceux dont au moins un socket a annoncé
  `en-ligne`. Envoyé après chaque `connexion.prete`, puis quand les
  personnes affichées changent ;
- serveur → clients qui **suivent** l'utilisateur (et ses autres sockets) :
  `presence.changed` `{ userId, statut }`. Avant, chaque changement était
  envoyé à tous les clients connectés (N envois par changement). La présence
  reste publique pour tout utilisateur authentifié
  (`GET /api/config-utilisateur/publiques`).

Le Frontend continue de sonder User-Config-Service toutes les 20 s pour
réconcilier. Tant que son socket est connecté, la présence temps réel
(réponse à `presence.suivre` + `presence.changed`) décide qui est « en ligne » ; sans socket,
un `hors-ligne` reçu en temps réel prime ~100 s, le temps que
User-Config-Service constate lui-même l'absence de signe de vie.

> La réponse à `presence.suivre` repose sur `fetchSockets()`, qui ne voit que les clients de
> l'instance courante. Pour plusieurs instances de Message-Service, ajouter
> l'adaptateur Redis de Socket.IO (`@socket.io/redis-adapter`).

### Profils (alias, avatar, pseudo)

- client → serveur : `profil.update` (sans données), émis après avoir
  enregistré son alias, son avatar ou son pseudo. **Limité à un envoi par
  socket toutes les 5 s** (`DELAI_MIN_PROFIL_MS`) : chaque diffusion fait
  recharger ce profil à tous les clients, un socket ne doit pas pouvoir
  provoquer une avalanche de requêtes. Les demandes rapprochées ne sont pas
  perdues : une seule est diffusée à la fin de la fenêtre ;
- serveur → **tous** les clients : `profil.changed` `{ userId }`. Chaque
  client recharge ce profil public (User-Config-Service, Authentification) :
  aucune donnée de profil ne transite par Message-Service.

### Changements de serveur (Room-Service)

Room-Service n'a ni Redis ni Socket.IO : après chaque changement (serveur,
membres, invitations, salons), il appelle la route interne

```http
POST /api/internal/events
x-internal-token: {INTERNAL_SERVICE_TOKEN}

{ "serveurId": "…", "raison": "expulse", "cibleId": "…", "utilisateurIds": ["…"] }
```

(`raison` : `modifie`, `supprime`, `membres`, `expulse`, `invitation`,
`salons`). Message-Service publie sur Redis (`serveur.change`) et chaque
instance émet `serveur.change` `{ serveurId, raison, cibleId }` dans la room
`user:<id>` de chaque destinataire. Serveur-API ne relaie pas `/api/internal`.

Pour le **serveur par défaut** (dont tout le monde est membre), Room-Service
envoie `"tous": true` sans liste : la liste de tous les comptes dépasserait
vite la taille maximale d'une requête (100 Ko, soit ~2 500 identifiants).
L'événement est alors émis à **tous** les clients connectés ; pour `salons`
et `supprime`, les accès de tous les sockets à ce serveur sont revérifiés
(pour `membres` / `expulse`, seulement la personne visée).

### Effacement de données (Room-Service, Authentification)

Deux routes internes (même `x-internal-token`), idempotentes, effacent les
messages dont le contexte n'existe plus :

| Méthode | Route | Appelée par | Effet |
|---|---|---|---|
| POST | `/api/internal/salons-supprimes` `{ salonIds }` (500 au plus) | Room-Service, après la suppression d'un salon ou d'un serveur | Messages de ces salons. Réponse `{ messagesSalons }` |
| DELETE | `/api/internal/users/:userId` | Authentification, après la suppression d'un compte | Ses conversations privées (dans les deux sens) et les messages de salon qu'il a écrits. Réponse `{ messagesPrives, messagesSalons }` |

Aucun événement temps réel n'est émis : les clients ouverts voient les
messages effacés disparaître au prochain chargement.

## Variables d'environnement

```env
PORT=3004
DATABASE_URL="postgresql://message_service:message_service_dev@localhost:5432/chatvardage_messages?schema=public"
REDIS_URL="redis://:chatvardage_redis_dev@localhost:6379"
CORS_ORIGINS="http://localhost:5173"
AUTH_SERVICE_URL=http://localhost:3001
AUTH_SERVICE_TIMEOUT_MS=3000
# Durées de mémorisation (ms) ; 0 = pas de cache.
AUTH_CACHE_TTL_MS=10000
ROOM_ACCESS_CACHE_TTL_MS=10000
ROOM_SERVICE_URL=http://localhost:3003
ROOM_SERVICE_TIMEOUT_MS=3000
# Même valeur que dans Room-Service (route /api/internal/*).
INTERNAL_SERVICE_TOKEN=changez-moi
```

Dans Docker Compose, utiliser `postgres` et `redis` comme hostnames.

En Docker global, les services Auth et Room sont accessibles avec :

```env
AUTH_SERVICE_URL=http://auth-service:3001
ROOM_SERVICE_URL=http://room-service:3003
```

`A26_5A6_01-Infra` (docker-compose.yml) injecte `ROOM_SERVICE_URL` et
`INTERNAL_SERVICE_TOKEN` dans le conteneur `message-service`.

`ROOM_SERVICE_URL` et `ROOM_SERVICE_TIMEOUT_MS` sont vérifiées **au démarrage** : une URL qui n'est pas une origine HTTP(S) seule (chemin, paramètres) ou un délai qui n'est pas un entier ≥ 1 empêchent le service de démarrer, au lieu d'un 503 générique au premier message de salon. Contrairement à `AUTH_SERVICE_URL`, `ROOM_SERVICE_URL` n'exige **pas** HTTPS en production : l'appel reste sur le réseau interne des services et n'est jamais relayé par Serveur-API.

`CORS_ORIGINS` est une liste séparée par des virgules. Il n'y a plus de CORS réfléchi (`origin: true`). Les connexions WebSocket sans en-tête `Origin` restent acceptées volontairement afin de supporter les clients non-navigateurs (par exemple Electron/Socket.IO).

### En production (`NODE_ENV=production`)

Le service **refuse de démarrer** si `INTERNAL_SERVICE_TOKEN` fait moins de 32 caractères (la valeur de développement `chatvardage_internal_dev` en fait 24), ou si le mot de passe de `DATABASE_URL` / `REDIS_URL` est l'un des mots de passe de développement de l'Infra (`message_service_dev`, `chatvardage_redis_dev`, `postgres`…) — voir `src/partage/secrets-production.ts`. `AUTH_SERVICE_URL` doit aussi utiliser HTTPS. Le message d'erreur liste tous les problèmes d'un coup ; en développement, les valeurs par défaut de l'Infra restent acceptées. Générer de vraies valeurs, par ex. `openssl rand -hex 32`.

## Fichiers partagés (`src/partage/`)

`src/partage/` contient des fichiers **identiques à l'octet près** dans plusieurs dépôts :

- `client-auth.ts` (+ spec) : validation du JWT auprès d'Authentification, avec cache — identique dans Room-Service ;
- `secrets-production.ts` (+ spec) : refus de démarrer en production avec les secrets de développement — identique dans Room-Service et User-Config-Service.

Ne pas les modifier dans un seul dépôt : reporter le même changement partout, puis lancer `A26_5A6_01-Infra/scripts/verifier-fichiers-partages.sh`. Ce qui est propre au service (par exemple les secrets exigés) se passe en paramètre depuis `main.ts` ou `auth/jwt-auth.service.ts`.

## Docker

Le build génère Prisma et compile NestJS. L'image finale réutilise les dépendances déjà installées dans le stage de build : aucun téléchargement de Prisma n'est effectué au démarrage.

Le conteneur tourne sous l'utilisateur non root `node` de l'image, et exécute `prisma migrate deploy`, puis `node dist/main`.

Pour lancer le service seul, avec son PostgreSQL et son Redis (Authentification et Room-Service attendus sur l'hôte) :

```bash
docker compose -f compose.local.yml up --build
```

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
