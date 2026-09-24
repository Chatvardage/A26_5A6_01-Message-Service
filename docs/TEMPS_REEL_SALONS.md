# Temps réel Salons — Redis Pub/Sub + Socket.IO

Règle importante : **aucun événement Socket.IO n'est envoyé directement juste après l'appel de création du message.** Exactement le même principe que pour les DM (voir `docs/TEMPS_REEL_DM.md`).

Le chemin obligatoire est :

`DB -> Redis PUBLISH -> Redis SUBSCRIBE -> Socket.IO`

Cela garantit que les messages de salon envoyés par REST et ceux envoyés par WebSocket utilisent exactement le même mécanisme de diffusion temps réel.

## Appartenance au salon

Message-Service ne connaît pas les membres d'un salon : cette information appartient à `A26_5A6_01-Room-Service`. Avant toute écriture ou lecture, `RoomsClientService.getRoom(roomId)` appelle `GET {ROOM_SERVICE_URL}/api/rooms/:roomId` et le résultat contenant `membreIds` sert à valider l'appartenance :

- salon introuvable (404 de Room-Service) -> `NotFoundException` (404)
- appelant absent de `membreIds` -> `ForbiddenException` (403)
- Room-Service injoignable, en timeout, ou 5xx -> `ServiceUnavailableException` (503)
- réponse 2xx au JSON invalide/inattendu -> `BadGatewayException` (502)

## Création

`RoomMessagesService.create()` :
- appelle Room-Service et vérifie l'appartenance de l'auteur au salon;
- écrit dans `RoomMessage`;
- attend la réussite de Prisma;
- publie `room-message.created`.

`MessagesGateway.afterInit()` :
- subscribe aux événements Redis des DM **et** des salons (`room-message.created`, `room-message.updated`, `room-message.deleted`), dans le même abonnement que les DM.

À la réception d'un événement `room-message.*` :
- parse le payload;
- récupère `roomId`;
- émet vers la room Socket.IO `room:<roomId>`.

## Rejoindre / quitter un salon

Pour recevoir les événements temps réel d'un salon, le client doit explicitement rejoindre la room Socket.IO correspondante :

- `room-message.join` `{ roomId }` : revérifie l'appartenance via Room-Service (`ForbiddenException`/`WsException` si le salon n'existe pas ou que l'appelant n'en est pas membre), puis `client.join('room:' + roomId)`.
- `room-message.leave` `{ roomId }` : `client.leave('room:' + roomId)`, sans revérification (quitter une room ne nécessite aucune autorisation).

Contrairement à la room `user:<id>` (rejointe automatiquement à la connexion), les rooms `room:<roomId>` sont rejointes à la demande : un socket connecté qui n'a jamais émis `room-message.join` pour un salon donné ne recevra pas ses événements temps réel, même s'il est membre du salon côté Room-Service.


### Perte d'accès : retrait automatique des rooms

Les droits ne sont vérifiés qu'au `room-message.join`. Pour qu'un socket ne continue pas de recevoir les messages d'un salon dont il a perdu l'accès, chaque événement `serveur.change` venu de Room-Service déclenche une revérification (`revoquerAccesPerdus`), limitée aux salons **de ce serveur** déjà rejoints (mémorisés dans `socket.data.salons`) :

| Raison | Sockets revérifiés |
| --- | --- |
| `expulse`, `membres` (départ, rôle modifié, arrivée) | ceux de l'utilisateur visé (`cibleId`) |
| `salons` (salon rendu réservé aux modérateurs, supprimé) | ceux de tous les destinataires |
| `supprime` (serveur supprimé) | ceux de tous les destinataires, retirés sans appel à Room-Service |
| `modifie`, `invitation` | aucun |

Si Room-Service refuse la lecture, répond 404 ou est indisponible, le socket quitte `room:<roomId>` et reçoit `room-message.revoked` `{ roomId }`. Le client oublie alors cette room et la rejoint de nouveau s'il la retrouve dans ses salons accessibles.

## Envoi via WebSocket

`room-message.send` `{ roomId, content }` délègue directement à `RoomMessagesService.create()`, exactement comme `private-message.send` délègue à `MessagesService.create()`. L'appartenance au salon est donc revalidée à chaque envoi, indépendamment du fait que le socket ait ou non rejoint `room:<roomId>` au préalable.

## Modification / suppression

Même principe que pour les DM, avec :
- `room-message.updated`
- `room-message.deleted`

Seul l'auteur original du message peut le modifier ou le supprimer (vérifié en base, pas via Room-Service — un membre ayant quitté le salon depuis reste l'auteur de ses messages passés). Pour une suppression, l'événement contient `{ id, roomId, authorId }` (pas de `content`), afin de savoir vers quelle room Socket.IO diffuser l'événement.

## Indicateur de frappe (typing)

L'événement `typing` `{ scope: 'room' | 'dm', targetId, isTyping }` est **éphémère** : il n'est jamais persisté, ni publié dans Redis, ni écrit en base. Le serveur le relaie directement (`socket.to(...).emit(...)`), sans garantie de livraison :

- `scope: 'room'` -> relayé vers `room:<targetId>`, **seulement si le socket émetteur a rejoint cette room** (droits vérifiés au `room-message.join`) ; sinon l'événement est ignoré
- `scope: 'dm'` -> relayé vers `user:<targetId>`

Le payload réémis est `{ userId, scope, targetId, isTyping }`, où `userId` provient de l'identité authentifiée du socket émetteur (jamais du payload client).

## Authentification et origine WebSocket

Identique aux DM : voir `docs/TEMPS_REEL_DM.md`. La validation du JWT est déléguée à Auth-Service (`AUTH_SERVICE_TIMEOUT_MS`), et la vérification d'appartenance aux salons est déléguée à Room-Service (`ROOM_SERVICE_TIMEOUT_MS`). Les deux réponses sont mémorisées brièvement (`AUTH_CACHE_TTL_MS`, `ROOM_ACCESS_CACHE_TTL_MS`, voir le README) ; un changement de serveur vide aussitôt le cache des accès à ce serveur.
