# Temps réel Salons — Redis Pub/Sub + Socket.IO

Règle importante : **aucun événement Socket.IO n'est envoyé directement juste après l'appel de création du message.** Exactement le même principe que pour les DM (voir `docs/TEMPS_REEL_DM.md`).

Le chemin obligatoire est :

`DB -> Redis PUBLISH -> Redis SUBSCRIBE -> Socket.IO`

Cela garantit que les messages de salon envoyés par REST et ceux envoyés par WebSocket utilisent exactement le même mécanisme de diffusion temps réel.

## Droits d'accès au salon

Message-Service ne connaît ni les membres ni les règles d'un salon : Room-Service fait foi. Avant toute écriture ou lecture, `RoomsClientService.verifierAcces(roomId, acteur)` appelle la route interne `GET {ROOM_SERVICE_URL}/api/internal/channels/:roomId/access/:userId?role=<rôle global>` (en-tête `x-internal-token` = `INTERNAL_SERVICE_TOKEN`), qui renvoie :

```json
{ "salonId": "…", "serveurId": "…", "estMembre": true, "peutLire": true, "peutEcrire": false, "peutModerer": false }
```

- `peutLire` faux -> `ForbiddenException` (403) ; `peutEcrire` faux à l'envoi (ex. #annonces) -> 403 ;
- salon introuvable (404 de Room-Service) -> `NotFoundException` (404) ;
- Room-Service injoignable, en timeout ou en erreur -> `ServiceUnavailableException` (503) ;
- réponse au JSON invalide ou incomplet -> `BadGatewayException` (502). `peutModerer` absent (Room-Service plus ancien) vaut `false`.

Un accès obtenu est mémorisé `ROOM_ACCESS_CACHE_TTL_MS` (10 s par défaut) ; tout `serveur.change` vide les accès à ce serveur. Les erreurs ne sont jamais mémorisées.

## Création

`RoomMessagesService.create()` :
- applique la limite d'envoi (10 messages / 10 s par utilisateur, DM compris) ;
- demande l'accès à Room-Service et exige `peutLire` et `peutEcrire` ;
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

L'appelant doit toujours pouvoir lire le salon (`peutLire`) : un membre expulsé ne modifie ni ne supprime plus ses anciens messages.

- **Modifier** : réservé à l'auteur (vérifié en base).
- **Supprimer** : l'auteur, ou un **modérateur du serveur** (propriétaire, admin global compris), selon `peutModerer` renvoyé par Room-Service.

Pour une suppression, l'événement contient `{ id, roomId, authorId }` (pas de `content`), afin de savoir vers quelle room Socket.IO diffuser l'événement.

## Effacements en masse (routes internes) : sans temps réel

`POST /api/internal/salons-supprimes` (salons supprimés, appelée par Room-Service) et `DELETE /api/internal/users/:userId` (compte supprimé, appelée par Authentification) effacent les messages **sans publier d'événement Redis**, par choix :

- salon ou serveur supprimé : ses sockets ont déjà quitté `room:<roomId>` (`room-message.revoked`, voir « Perte d'accès ») et le client retire le salon à la réception de `serveur.change` ; il n'y a plus personne à prévenir ;
- compte supprimé : ses messages peuvent être des milliers ; publier un `room-message.deleted` par message inonderait Redis et les clients. Les clients déjà ouverts les voient disparaître au prochain chargement de l'historique.

## Événements trop fréquents

Chaque événement client coûteux a une limite par socket ; la réponse à un dépassement dépend de ce que le client attend :

| Événement | Limite | Au-delà |
| --- | --- | --- |
| `typing` | même état vers la même cible : 1 / s | ignoré (un changement d'état passe toujours) |
| `presence.update`, `profil.update` | 1 / s, 1 / 5 s | **différé** : le dernier état part à la fin de la fenêtre (jamais après la déconnexion pour la présence) — perdre la dernière valeur laisserait les autres clients sur un état faux |
| `presence.suivre` | 1 / s | **refusé** (`WsException`) : c'est une requête avec accusé de réception ; le client regroupe déjà ses demandes et renvoie la liste complète à la suivante, rien n'est perdu |
| envoi de message (REST ou Socket.IO) | 10 / 10 s par utilisateur | 429 |

## Erreurs sur Socket.IO

Une erreur d'un événement client (limite d'envoi 429, destinataire introuvable 404, salon en lecture seule 403, corps invalide 400…) est renvoyée au socket par l'événement `exception` `{ status: 'error', statusCode, message }`, avec le même code et le même message qu'en REST (`ExceptionsWsFilter`). Sans ce filtre, NestJS ne reconnaissait que `WsException` et envoyait « Internal server error ». Les refus propres au socket (non authentifié, trop de demandes de présence) gardent la forme `{ status: 'error', message }`.

## Indicateur de frappe (typing)

L'événement `typing` `{ scope: 'room' | 'dm', targetId, isTyping }` est **éphémère** : il n'est jamais persisté, ni publié dans Redis, ni écrit en base. Le serveur le relaie directement (`socket.to(...).emit(...)`), sans garantie de livraison :

- `scope: 'room'` -> relayé vers `room:<targetId>`, **seulement si le socket émetteur a rejoint cette room** (droits vérifiés au `room-message.join`) ; sinon l'événement est ignoré
- `scope: 'dm'` -> relayé vers `user:<targetId>`

Le payload réémis est `{ userId, scope, targetId, isTyping }`, où `userId` provient de l'identité authentifiée du socket émetteur (jamais du payload client).

## Authentification et origine WebSocket

Identique aux DM : voir `docs/TEMPS_REEL_DM.md`. La validation du JWT est déléguée à Auth-Service (`AUTH_SERVICE_TIMEOUT_MS`), et la vérification d'appartenance aux salons est déléguée à Room-Service (`ROOM_SERVICE_TIMEOUT_MS`). Les deux réponses sont mémorisées brièvement (`AUTH_CACHE_TTL_MS`, `ROOM_ACCESS_CACHE_TTL_MS`, voir le README) ; un changement de serveur vide aussitôt le cache des accès à ce serveur.
