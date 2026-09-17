import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrivateMessage } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
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

    return messages.reverse();
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
