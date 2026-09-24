import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RoomMessage } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { Acteur, RoomsClientService } from "../rooms/rooms-client.service";
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
    acteur: Acteur,
    roomId: string,
    dto: CreateRoomMessageDto,
  ): Promise<RoomMessage> {
    const acces = await this.rooms.verifierAcces(roomId, acteur);
    this.exigerLecture(acces.peutLire, "y envoyer un message");
    // Salon lisible mais en écriture réservée (ex. #annonces).
    if (!acces.peutEcrire) {
      throw new ForbiddenException(
        "Seuls les modérateurs peuvent écrire dans ce salon",
      );
    }

    // 1) PostgreSQL is the source of truth.
    const message = await this.prisma.roomMessage.create({
      data: { roomId, authorId: acteur.id, content: dto.content },
    });

    // 2) Only after a successful DB write do we publish the event.
    await this.redis.publish("room-message.created", message);
    return message;
  }

  async history(
    acteur: Acteur,
    roomId: string,
    query: RoomHistoryQueryDto,
  ): Promise<RoomMessage[]> {
    await this.verifierLecture(acteur, roomId);

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
    acteur: Acteur,
    roomId: string,
    id: string,
  ): Promise<RoomMessage> {
    await this.verifierLecture(acteur, roomId);

    const message = await this.prisma.roomMessage.findUnique({
      where: { id },
    });
    if (!message || message.roomId !== roomId) {
      throw new NotFoundException("Message introuvable");
    }
    return message;
  }

  async update(
    acteur: Acteur,
    roomId: string,
    id: string,
    dto: UpdateRoomMessageDto,
  ): Promise<RoomMessage> {
    // Un membre expulsé (ou qui n'a plus accès) ne modifie plus ses messages.
    await this.verifierLecture(acteur, roomId);
    const existing = await this.prisma.roomMessage.findUnique({
      where: { id },
    });
    if (!existing || existing.roomId !== roomId) {
      throw new NotFoundException("Message introuvable");
    }
    if (existing.authorId !== acteur.id) {
      throw new ForbiddenException("Seul l'auteur peut modifier ce message");
    }

    const message = await this.prisma.roomMessage.update({
      where: { id },
      data: { content: dto.content },
    });

    await this.redis.publish("room-message.updated", message);
    return message;
  }

  async remove(acteur: Acteur, roomId: string, id: string): Promise<void> {
    await this.verifierLecture(acteur, roomId);
    const existing = await this.prisma.roomMessage.findUnique({
      where: { id },
    });
    if (!existing || existing.roomId !== roomId) {
      throw new NotFoundException("Message introuvable");
    }
    if (existing.authorId !== acteur.id) {
      throw new ForbiddenException("Seul l'auteur peut supprimer ce message");
    }

    await this.prisma.roomMessage.delete({ where: { id } });

    await this.redis.publish("room-message.deleted", {
      id: existing.id,
      roomId: existing.roomId,
      authorId: existing.authorId,
    });
  }

  private async verifierLecture(acteur: Acteur, roomId: string) {
    const acces = await this.rooms.verifierAcces(roomId, acteur);
    this.exigerLecture(acces.peutLire, "consulter ce contenu");
  }

  private exigerLecture(peutLire: boolean, verb: string): void {
    if (!peutLire) {
      throw new ForbiddenException(
        `Vous devez être membre du salon pour ${verb}`,
      );
    }
  }
}
