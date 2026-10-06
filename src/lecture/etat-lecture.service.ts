import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConversationKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { Acteur, RoomsClientService } from '../rooms/rooms-client.service';

/** Canal Redis (et événement Socket.IO) d'un état de lecture qui avance. */
export const CANAL_LECTURE = 'read-state.updated';

/** Lecteurs d'un salon renvoyés au plus (les plus récents d'abord). */
export const LIMITE_LECTEURS_SALON = 100;

/** Publié sur CANAL_LECTURE après chaque avancée enregistrée en base :
 * `userId` a lu la conversation `kind`/`targetId` jusqu'à `lastReadAt`. */
export type EvenementLecture = {
  kind: ConversationKind;
  targetId: string;
  userId: string;
  lastReadAt: string;
  lastReadMessageId?: string | null;
};

/** État de lecture d'un autre utilisateur (accusés de lecture). */
export type Lecteur = {
  userId: string;
  lastReadAt: Date | null;
  lastReadMessageId: string | null;
};

/** Identifiant d'une conversation, le même que celui du client mobile :
 * `dm:<interlocuteur>` ou `room:<salon>`. */
export const idConversation = (kind: ConversationKind, targetId: string) =>
  `${kind}:${targetId}`;

export type EtatLecture = {
  conversationId: string;
  /** Date du dernier message lu ; `null` si rien n'a encore été lu. */
  lastReadAt: Date | null;
  unreadCount: number;
};

type Message = { id: string; createdAt: Date };
type PositionLecture = { lastReadAt: Date; lastReadMessageId?: string | null };

/** Même ordre que l'historique. Une ancienne lecture sans id couvre sa date. */
const apresLecture = (etat: PositionLecture) =>
  etat.lastReadMessageId
    ? {
        OR: [
          { createdAt: { gt: etat.lastReadAt } },
          { createdAt: etat.lastReadAt, id: { gt: etat.lastReadMessageId } },
        ],
      }
    : { createdAt: { gt: etat.lastReadAt } };

/**
 * Messages non lus et état de lecture (contrôle 3). PostgreSQL fait foi :
 * l'état est une ligne `ConversationReadState` par utilisateur et
 * conversation, qui survit au redémarrage du service.
 *
 * Un message est non lu s'il a été écrit par quelqu'un d'autre APRÈS
 * `lastReadAt`. Sans état de lecture :
 * - DM : tous les messages reçus sont non lus ;
 * - salon : seulement ceux écrits depuis l'arrivée dans le serveur (date
 *   fournie par Room-Service), pour qu'un nouvel arrivant ne voie pas tout
 *   l'historique en non-lus ; aucun si cette date est inconnue (admin non
 *   membre, serveur par défaut pas encore rejoint).
 */
@Injectable()
export class EtatLectureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsClientService,
    private readonly redis: RedisService,
  ) {}

  /** Marque un DM comme lu jusqu'à `messageId`, ou jusqu'au dernier message. */
  async marquerDmLu(
    userId: string,
    otherUserId: string,
    messageId?: string,
  ): Promise<EtatLecture> {
    const conversation = {
      OR: [
        { senderId: userId, recipientId: otherUserId },
        { senderId: otherUserId, recipientId: userId },
      ],
    };
    const message = await this.prisma.privateMessage.findFirst({
      where: messageId ? { id: messageId, ...conversation } : conversation,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, createdAt: true },
    });
    const lastReadAt = await this.avancer(
      userId,
      'dm',
      otherUserId,
      message,
      messageId,
    );
    const compteurs = await this.compteursDm(userId, otherUserId);
    return {
      conversationId: idConversation('dm', otherUserId),
      lastReadAt,
      unreadCount: compteurs.get(otherUserId) ?? 0,
    };
  }

  /** Marque un salon comme lu ; il faut pouvoir le lire (Room-Service). */
  async marquerSalonLu(
    acteur: Acteur,
    roomId: string,
    messageId?: string,
  ): Promise<EtatLecture> {
    const acces = await this.rooms.verifierAcces(roomId, acteur);
    if (!acces.peutLire) {
      throw new ForbiddenException(
        'Vous devez être membre du salon pour consulter ce contenu',
      );
    }
    const message = await this.prisma.roomMessage.findFirst({
      where: messageId ? { id: messageId, roomId } : { roomId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, createdAt: true },
    });
    const lastReadAt = await this.avancer(
      acteur.id,
      'room',
      roomId,
      message,
      messageId,
    );
    const salon = (await this.rooms.salonsLisibles(acteur)).find(
      (s) => s.salonId === roomId,
    );
    const compteurs = await this.compterSalons(acteur.id, [
      { salonId: roomId, depuis: salon?.depuis ?? null },
    ]);
    return {
      conversationId: idConversation('room', roomId),
      lastReadAt,
      unreadCount: compteurs.get(roomId) ?? 0,
    };
  }

  /** Non-lus de toutes les conversations (DM et salons lisibles), clés
   * `dm:<id>` / `room:<id>` ; seules les valeurs non nulles sont présentes. */
  async compteurs(acteur: Acteur): Promise<Record<string, number>> {
    const [dm, salons] = await Promise.all([
      this.compteursDm(acteur.id),
      this.rooms
        .salonsLisibles(acteur)
        .then((lisibles) => this.compterSalons(acteur.id, lisibles)),
    ]);
    const resultat: Record<string, number> = {};
    for (const [id, n] of dm) resultat[idConversation('dm', id)] = n;
    for (const [id, n] of salons) resultat[idConversation('room', id)] = n;
    return resultat;
  }

  /** Non-lus par interlocuteur (tous, ou seulement `seulement`). Une seule
   * requête groupée, quel que soit le nombre de conversations. */
  async compteursDm(
    userId: string,
    seulement?: string,
  ): Promise<Map<string, number>> {
    const etats = await this.prisma.conversationReadState.findMany({
      where: {
        userId,
        kind: 'dm',
        ...(seulement ? { targetId: seulement } : {}),
      },
      select: { targetId: true, lastReadAt: true, lastReadMessageId: true },
    });
    const lignes = await this.prisma.privateMessage.groupBy({
      by: ['senderId'],
      where: {
        recipientId: userId,
        ...(seulement ? { senderId: seulement } : {}),
        OR: [
          // Conversations lues : seulement les messages plus récents.
          ...etats.map((e) => ({
            senderId: e.targetId,
            ...apresLecture(e),
          })),
          // Jamais lues : tous les messages reçus.
          { senderId: { notIn: etats.map((e) => e.targetId) } },
        ],
      },
      _count: { _all: true },
    });
    return new Map(lignes.map((l) => [l.senderId, l._count._all]));
  }

  /**
   * Accusé de lecture d'un DM : jusqu'où l'interlocuteur a lu la
   * conversation (`null` : jamais). Ne révèle rien d'autre que ce que
   * l'interlocuteur a lu de messages échangés avec l'appelant.
   */
  async lecteurDm(userId: string, otherUserId: string): Promise<Lecteur> {
    const etat = await this.prisma.conversationReadState.findUnique({
      where: {
        userId_kind_targetId: {
          userId: otherUserId,
          kind: 'dm',
          targetId: userId,
        },
      },
      select: { lastReadAt: true, lastReadMessageId: true },
    });
    return {
      userId: otherUserId,
      lastReadAt: etat?.lastReadAt ?? null,
      lastReadMessageId: etat?.lastReadMessageId ?? null,
    };
  }

  /**
   * Lecteurs d'un salon (« Vu par »), sauf l'appelant, du plus récent au
   * plus ancien, LIMITE_LECTEURS_SALON au plus. Il faut pouvoir lire le
   * salon. Un ancien membre qui l'avait lu peut encore y figurer.
   */
  async lecteursSalon(acteur: Acteur, roomId: string): Promise<Lecteur[]> {
    const acces = await this.rooms.verifierAcces(roomId, acteur);
    if (!acces.peutLire) {
      throw new ForbiddenException(
        'Vous devez être membre du salon pour consulter ce contenu',
      );
    }
    return this.prisma.conversationReadState.findMany({
      where: { kind: 'room', targetId: roomId, userId: { not: acteur.id } },
      select: { userId: true, lastReadAt: true, lastReadMessageId: true },
      orderBy: [{ lastReadAt: 'desc' }, { userId: 'asc' }],
      take: LIMITE_LECTEURS_SALON,
    });
  }

  /** Compte supprimé (route interne) : ses états, et ceux des autres sur
   * leurs conversations privées avec lui (effacées elles aussi). */
  async supprimerUtilisateur(userId: string): Promise<void> {
    await this.prisma.conversationReadState.deleteMany({
      where: { OR: [{ userId }, { kind: 'dm', targetId: userId }] },
    });
  }

  /** Salons supprimés dans Room-Service (route interne). */
  async purgerSalons(salonIds: string[]): Promise<void> {
    await this.prisma.conversationReadState.deleteMany({
      where: { kind: 'room', targetId: { in: salonIds } },
    });
  }

  private async compterSalons(
    userId: string,
    salons: { salonId: string; depuis: Date | null }[],
  ): Promise<Map<string, number>> {
    if (salons.length === 0) return new Map();
    const etats = await this.prisma.conversationReadState.findMany({
      where: {
        userId,
        kind: 'room',
        targetId: { in: salons.map((s) => s.salonId) },
      },
      select: { targetId: true, lastReadAt: true, lastReadMessageId: true },
    });
    const lus = new Map(etats.map((e) => [e.targetId, e]));

    // Seuil par salon : le plus récent entre la lecture et l'arrivée.
    const conditions: Prisma.RoomMessageWhereInput[] = [];
    for (const { salonId, depuis } of salons) {
      const lu = lus.get(salonId);
      if (lu && (!depuis || lu.lastReadAt >= depuis)) {
        conditions.push({ roomId: salonId, ...apresLecture(lu) });
      } else if (depuis) {
        conditions.push({ roomId: salonId, createdAt: { gt: depuis } });
      }
    }
    if (conditions.length === 0) return new Map();

    const lignes = await this.prisma.roomMessage.groupBy({
      by: ['roomId'],
      where: { authorId: { not: userId }, OR: conditions },
      _count: { _all: true },
    });
    return new Map(lignes.map((l) => [l.roomId, l._count._all]));
  }

  /**
   * Avance l'état jusqu'à `message` sans jamais le faire reculer (deux
   * appareils peuvent marquer comme lu dans le désordre). Renvoie la date
   * enregistrée, ou `null` si la conversation n'a jamais été lue. Une
   * avancée réelle est ensuite publiée sur Redis (accusés de lecture en
   * temps réel), jamais avant l'écriture en base.
   */
  private async avancer(
    userId: string,
    kind: ConversationKind,
    targetId: string,
    message: Message | null,
    messageId: string | undefined,
  ): Promise<Date | null> {
    const clef = { userId_kind_targetId: { userId, kind, targetId } };
    if (!message) {
      if (messageId) {
        throw new BadRequestException(
          'Message introuvable dans cette conversation',
        );
      }
      // Conversation vide : rien à marquer.
      const etat = await this.prisma.conversationReadState.findUnique({
        where: clef,
        select: { lastReadAt: true, lastReadMessageId: true },
      });
      return etat?.lastReadAt ?? null;
    }

    // Création sans conflit (ON CONFLICT DO NOTHING), puis avance
    // conditionnelle : atomique même avec des appels simultanés.
    const cree = await this.prisma.conversationReadState.createMany({
      data: [
        {
          userId,
          kind,
          targetId,
          lastReadAt: message.createdAt,
          lastReadMessageId: message.id,
        },
      ],
      skipDuplicates: true,
    });
    const avance = await this.prisma.conversationReadState.updateMany({
      where: {
        userId,
        kind,
        targetId,
        OR: [
          { lastReadAt: { lt: message.createdAt } },
          {
            lastReadAt: message.createdAt,
            lastReadMessageId: { lt: message.id },
          },
        ],
      },
      data: { lastReadAt: message.createdAt, lastReadMessageId: message.id },
    });
    const etat = await this.prisma.conversationReadState.findUniqueOrThrow({
      where: clef,
      select: { lastReadAt: true, lastReadMessageId: true },
    });
    if (
      (cree.count > 0 || avance.count > 0) &&
      etat.lastReadAt.getTime() === message.createdAt.getTime()
    ) {
      const evenement: EvenementLecture = {
        kind,
        targetId,
        userId,
        lastReadAt: etat.lastReadAt.toISOString(),
        lastReadMessageId: etat.lastReadMessageId ?? null,
      };
      await this.redis.publish(CANAL_LECTURE, evenement);
    }
    return etat.lastReadAt;
  }
}
