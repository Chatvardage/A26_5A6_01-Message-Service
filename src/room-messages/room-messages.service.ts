import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RoomMessage } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { Room, RoomsClientService } from "../rooms/rooms-client.service";
import { CreateRoomMessageDto } from "./dto/create-room-message.dto";
import { RoomHistoryQueryDto } from "./dto/room-history-query.dto";
import { UpdateRoomMessageDto } from "./dto/update-room-message.dto";

@Injectable()
export class RoomMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rooms: RoomsClientService,
  ) {}

  async create(
    authorId: string,
    roomId: string,
    dto: CreateRoomMessageDto,
  ): Promise<RoomMessage> {
    const room = await this.rooms.getRoom(roomId);
    this.assertMembership(room, authorId, "y envoyer un message");

    // 1) PostgreSQL is the source of truth.
    const message = await this.prisma.roomMessage.create({
      data: { roomId, authorId, content: dto.content },
    });

    // 2) Only after a successful DB write do we publish the event.
    await this.redis.publish("room-message.created", message);
    return message;
  }

  async history(
    userId: string,
    roomId: string,
    query: RoomHistoryQueryDto,
  ): Promise<RoomMessage[]> {
    const room = await this.rooms.getRoom(roomId);
    this.assertMembership(room, userId, "consulter ce contenu");

    if (query.cursor) {
      const cursorMessage = await this.prisma.roomMessage.findFirst({
        where: { id: query.cursor, roomId },
        select: { id: true },
      });

      if (!cursorMessage) {
        throw new BadRequestException("Curseur invalide pour ce salon");
      }
    }

    const messages = await this.prisma.roomMessage.findMany({
      where: { roomId },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    // Même convention que MessagesService.history() : on récupère d'abord les
    // messages les plus récents pour que `take` sélectionne la bonne page,
    // puis on renvoie l'ordre chronologique attendu par l'interface.
    return messages.reverse();
  }

  async findOne(
    userId: string,
    roomId: string,
    id: string,
  ): Promise<RoomMessage> {
    const room = await this.rooms.getRoom(roomId);
    this.assertMembership(room, userId, "consulter ce contenu");

    const message = await this.prisma.roomMessage.findUnique({
      where: { id },
    });
    if (!message || message.roomId !== roomId) {
      throw new NotFoundException("Message introuvable");
    }
    return message;
  }

  async update(
    authorId: string,
    roomId: string,
    id: string,
    dto: UpdateRoomMessageDto,
  ): Promise<RoomMessage> {
    const existing = await this.prisma.roomMessage.findUnique({
      where: { id },
    });
    if (!existing || existing.roomId !== roomId) {
      throw new NotFoundException("Message introuvable");
    }
    if (existing.authorId !== authorId) {
      throw new ForbiddenException("Seul l'auteur peut modifier ce message");
    }

    const message = await this.prisma.roomMessage.update({
      where: { id },
      data: { content: dto.content },
    });

    await this.redis.publish("room-message.updated", message);
    return message;
  }

  async remove(authorId: string, roomId: string, id: string): Promise<void> {
    const existing = await this.prisma.roomMessage.findUnique({
      where: { id },
    });
    if (!existing || existing.roomId !== roomId) {
      throw new NotFoundException("Message introuvable");
    }
    if (existing.authorId !== authorId) {
      throw new ForbiddenException("Seul l'auteur peut supprimer ce message");
    }

    await this.prisma.roomMessage.delete({ where: { id } });

    await this.redis.publish("room-message.deleted", {
      id: existing.id,
      roomId: existing.roomId,
      authorId: existing.authorId,
    });
  }

  private assertMembership(room: Room, userId: string, verb: string): void {
    if (!room.membreIds.includes(userId)) {
      throw new ForbiddenException(
        `Vous devez être membre du salon pour ${verb}`,
      );
    }
  }
}
