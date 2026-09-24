-- Message de bienvenue dans #annonces du serveur par défaut « Chatvardage ».
-- Les identifiants du salon (roomId) sont figés par Room-Service (migration
-- 20260924100000_serveurs, src/servers/default-server.ts) : ne pas les
-- modifier. L'auteur « system » est affiché « Système » par le Frontend.
-- Idempotent (ON CONFLICT) : sans effet si le message existe déjà.
-- Seul l'emoji 👋 est utilisé : le Frontend le dessine lui-même (police
-- emoji souvent absente, notamment sous Linux/WSL).

INSERT INTO "RoomMessage" ("id", "roomId", "authorId", "content", "createdAt", "updatedAt")
VALUES (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000002',
  'system',
  'Bienvenue sur Chatvardage ! 👋

Chatvardage fonctionne un peu comme Discord :

• Serveurs : la colonne de gauche liste tes serveurs. Tu fais automatiquement partie de celui-ci. Avec le +, tu peux créer ton propre serveur (tu en deviens propriétaire) ou chercher des serveurs publics à rejoindre. Un serveur privé ne se rejoint que sur invitation.

• Salons : chaque serveur a ses salons. Ici, #annonces sert aux nouvelles de l''app (seuls les administrateurs y écrivent) et #général est ouvert à tout le monde.

• Messages privés : l''icône de bulle, en haut à gauche, mène à tes conversations privées. Le + permet d''écrire à quelqu''un en cherchant son pseudo.

• Ton profil : l''icône de personne, en bas à gauche, permet de changer ta photo, ton alias, ta présence, le thème, la langue et tes notifications.

Dans ton propre serveur, tu peux nommer des modérateurs et créer des salons réservés aux modérateurs.

Bon clavardage !',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
