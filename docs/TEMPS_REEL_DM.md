# Temps réel DM — Redis Pub/Sub + Socket.IO

Règle importante : **aucun événement Socket.IO n'est envoyé directement juste après l'appel de création du message.**

Le chemin obligatoire est :

`DB -> Redis PUBLISH -> Redis SUBSCRIBE -> Socket.IO`

Cela garantit que les messages envoyés par REST et ceux envoyés par WebSocket utilisent exactement le même mécanisme de diffusion temps réel.

## Création

`MessagesService.create()` :
- écrit dans `PrivateMessage`;
- attend la réussite de Prisma;
- publie `private-message.created`.

`MessagesGateway.afterInit()` :
- subscribe aux événements Redis.

À la réception :
- parse le payload;
- récupère `senderId` et `recipientId`;
- émet vers `user:<senderId>`;
- émet vers `user:<recipientId>`.

## Modification / suppression

Même principe avec :
- `private-message.updated`
- `private-message.deleted`

Pour une suppression, l'événement contient encore `senderId` et `recipientId`, même si la ligne vient d'être supprimée, afin de savoir quels clients doivent recevoir l'événement.

## Authentification C2

Les connexions REST utilisent `Authorization: Bearer <JWT>` et Socket.IO utilise `auth.token`. Le `userId` est dérivé du claim signé `sub`; il n'est jamais accepté directement depuis le client.
