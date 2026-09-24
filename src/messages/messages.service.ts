import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrivateMessage } from '@prisma/client';
import { LimiteEnvoiService } from '../limite-envoi.service';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { ConversationSummary } from './dto/conversation-summary.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { DestinatairesService } from './destinataires.service';
import { HistoryQueryDto } from './dto/history-query.dto';
import { UpdateMessageDto } from './dto/update-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly limiteEnvoi: LimiteEnvoiService,
    private readonly destinataires: DestinatairesService,
  ) {}

  /** `jeton` : celui de l'expéditeur, pour vérifier que le destinataire
   * existe (voir DestinatairesService). */
  async create(
    senderId: string,
    dto: CreateMessageDto,
    jeton: string,
  ): Promise<PrivateMessage> {
    // En premier, volontairement : une tentative refusée (à soi-même,
    // destinataire inconnu) compte aussi dans la limite, sinon un script
    // pourrait sonder Authentification sans limite via cette route.
    this.limiteEnvoi.verifier(senderId);
    if (dto.recipientId === senderId) {
      throw new BadRequestException(
        'Impossible de s’envoyer un message privé à soi-même',
      );
    }
    await this.destinataires.exigerExistant(dto.recipientId, jeton);

    // 1) PostgreSQL fait foi.
    const message = await this.prisma.privateMessage.create({
      data: { senderId, recipientId: dto.recipientId, content: dto.content },
    });

    // 2) L'événement n'est publié qu'après l'écriture réussie en base.
    await this.redis.publish('private-message.created', message);
    return message;
  }

  async history(
    userId: string,
    otherUserId: string,
    query: HistoryQueryDto,
  ): Promise<PrivateMessage[]> {
    if (query.cursor) {
      const cursorMessage = await this.prisma.privateMessage.findFirst({
        where: {
          id: query.cursor,
          OR: [
            { senderId: userId, recipientId: otherUserId },
            { senderId: otherUserId, recipientId: userId },
          ],
        },
        select: { id: true },
      });

      if (!cursorMessage) {
        throw new BadRequestException(
          'Curseur invalide pour cette conversation',
        );
      }
    }

    const messages = await this.prisma.privateMessage.findMany({
      where: {
        OR: [
          { senderId: userId, recipientId: otherUserId },
          { senderId: otherUserId, recipientId: userId },
        ],
      },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    // La requête récupère d'abord les messages les plus récents afin que
    // `take` sélectionne la bonne page, puis l'API les renvoie dans l'ordre
    // chronologique attendu par l'interface de clavardage. L'UUID sert ici
    // uniquement de bris d'égalité stable lorsque createdAt est identique.
    return messages.reverse();
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    // Ne charge PAS tout l'historique : coût proportionnel au nombre
    // d'interlocuteurs, pas au nombre de messages (index
    // senderId/recipientId/createdAt dans les deux sens).
    // 1) Date du dernier message échangé avec chaque interlocuteur.
    const [envoyes, recus] = await Promise.all([
      this.prisma.privateMessage.groupBy({
        by: ['recipientId'],
        where: { senderId: userId },
        _max: { createdAt: true },
      }),
      this.prisma.privateMessage.groupBy({
        by: ['senderId'],
        where: { recipientId: userId },
        _max: { createdAt: true },
      }),
    ]);
    const derniereDate = new Map<string, Date>();
    const retenir = (autreId: string, date: Date | null) => {
      const actuelle = derniereDate.get(autreId);
      if (date && (!actuelle || date > actuelle)) {
        derniereDate.set(autreId, date);
      }
    };
    for (const ligne of envoyes)
      retenir(ligne.recipientId, ligne._max.createdAt);
    for (const ligne of recus) retenir(ligne.senderId, ligne._max.createdAt);
    if (derniereDate.size === 0) return [];

    // 2) Uniquement ces derniers messages (plusieurs possibles à la même
    // milliseconde : départagés par id, comme dans history()).
    const derniers = await this.prisma.privateMessage.findMany({
      where: {
        OR: [...derniereDate].map(([autreId, createdAt]) => ({
          createdAt,
          OR: [
            { senderId: userId, recipientId: autreId },
            { senderId: autreId, recipientId: userId },
          ],
        })),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const seen = new Set<string>();
    const conversations: ConversationSummary[] = [];

    for (const message of derniers) {
      const otherUserId =
        message.senderId === userId ? message.recipientId : message.senderId;

      if (seen.has(otherUserId)) continue;
      seen.add(otherUserId);

      conversations.push({ otherUserId, lastMessage: message });
    }

    return conversations;
  }

  /**
   * Compte supprimé (route interne) : ses conversations privées, dans les
   * deux sens (son interlocuteur ne peut plus lui répondre, et les messages
   * reçus contiennent des données le concernant).
   */
  async supprimerUtilisateur(userId: string): Promise<number> {
    const { count } = await this.prisma.privateMessage.deleteMany({
      where: { OR: [{ senderId: userId }, { recipientId: userId }] },
    });
    return count;
  }

  async findOne(userId: string, id: string): Promise<PrivateMessage> {
    const message = await this.prisma.privateMessage.findUnique({
      where: { id },
    });
    if (!message) throw new NotFoundException('Message introuvable');
    if (message.senderId !== userId && message.recipientId !== userId) {
      throw new ForbiddenException('Accès refusé');
    }
    return message;
  }

  async update(
    senderId: string,
    id: string,
    dto: UpdateMessageDto,
  ): Promise<PrivateMessage> {
    const existing = await this.prisma.privateMessage.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Message introuvable');
    if (existing.senderId !== senderId) {
      throw new ForbiddenException(
        'Seul l’expéditeur peut modifier ce message',
      );
    }

    const message = await this.prisma.privateMessage.update({
      where: { id },
      data: { content: dto.content },
    });

    await this.redis.publish('private-message.updated', message);
    return message;
  }

  async remove(senderId: string, id: string): Promise<void> {
    const existing = await this.prisma.privateMessage.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Message introuvable');
    if (existing.senderId !== senderId) {
      throw new ForbiddenException(
        'Seul l’expéditeur peut supprimer ce message',
      );
    }

    await this.prisma.privateMessage.delete({ where: { id } });

    await this.redis.publish('private-message.deleted', {
      id: existing.id,
      senderId: existing.senderId,
      recipientId: existing.recipientId,
    });
  }
}
