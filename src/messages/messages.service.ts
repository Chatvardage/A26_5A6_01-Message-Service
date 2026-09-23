import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrivateMessage } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { ConversationSummary } from "./dto/conversation-summary.dto";
import { CreateMessageDto } from "./dto/create-message.dto";
import { HistoryQueryDto } from "./dto/history-query.dto";
import { UpdateMessageDto } from "./dto/update-message.dto";

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async create(
    senderId: string,
    dto: CreateMessageDto,
  ): Promise<PrivateMessage> {
    if (dto.recipientId === senderId) {
      throw new BadRequestException(
        "Impossible de s’envoyer un message privé à soi-même",
      );
    }

    // 1) PostgreSQL is the source of truth.
    const message = await this.prisma.privateMessage.create({
      data: { senderId, recipientId: dto.recipientId, content: dto.content },
    });

    // 2) Only after a successful DB write do we publish the event.
    await this.redis.publish("private-message.created", message);
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
          "Curseur invalide pour cette conversation",
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
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    // La requête récupère d'abord les messages les plus récents afin que
    // `take` sélectionne la bonne page, puis l'API les renvoie dans l'ordre
    // chronologique attendu par l'interface de clavardage. L'UUID sert ici
    // uniquement de bris d'égalité stable lorsque createdAt est identique.
    return messages.reverse();
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    // On récupère tous les messages où l'utilisateur participe, du plus
    // récent au plus ancien, puis on ne garde que la première occurrence
    // (donc la plus récente) par interlocuteur. Comme la liste source est
    // déjà triée par activité décroissante, la liste de conversations
    // obtenue l'est également, sans requête de regroupement supplémentaire.
    const messages = await this.prisma.privateMessage.findMany({
      where: { OR: [{ senderId: userId }, { recipientId: userId }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const seen = new Set<string>();
    const conversations: ConversationSummary[] = [];

    for (const message of messages) {
      const otherUserId =
        message.senderId === userId ? message.recipientId : message.senderId;

      if (seen.has(otherUserId)) continue;
      seen.add(otherUserId);

      conversations.push({ otherUserId, lastMessage: message });
    }

    return conversations;
  }

  async findOne(userId: string, id: string): Promise<PrivateMessage> {
    const message = await this.prisma.privateMessage.findUnique({
      where: { id },
    });
    if (!message) throw new NotFoundException("Message introuvable");
    if (message.senderId !== userId && message.recipientId !== userId) {
      throw new ForbiddenException("Accès refusé");
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
    if (!existing) throw new NotFoundException("Message introuvable");
    if (existing.senderId !== senderId) {
      throw new ForbiddenException(
        "Seul l’expéditeur peut modifier ce message",
      );
    }

    const message = await this.prisma.privateMessage.update({
      where: { id },
      data: { content: dto.content },
    });

    await this.redis.publish("private-message.updated", message);
    return message;
  }

  async remove(senderId: string, id: string): Promise<void> {
    const existing = await this.prisma.privateMessage.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException("Message introuvable");
    if (existing.senderId !== senderId) {
      throw new ForbiddenException(
        "Seul l’expéditeur peut supprimer ce message",
      );
    }

    await this.prisma.privateMessage.delete({ where: { id } });

    await this.redis.publish("private-message.deleted", {
      id: existing.id,
      senderId: existing.senderId,
      recipientId: existing.recipientId,
    });
  }
}
