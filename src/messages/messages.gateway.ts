import { Logger, UsePipes, ValidationPipe } from "@nestjs/common";
import { PrivateMessage, RoomMessage } from "@prisma/client";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { JwtAuthService } from "../auth/jwt-auth.service";
import { RedisService } from "../redis.service";
import { RoomMessagesService } from "../room-messages/room-messages.service";
import { RoomIdDto } from "../room-messages/dto/room-id.dto";
import { SendRoomMessageDto } from "../room-messages/dto/send-room-message.dto";
import { RoomsClientService } from "../rooms/rooms-client.service";
import { CreateMessageDto } from "./dto/create-message.dto";
import { TypingDto } from "./dto/typing.dto";
import { MessagesService } from "./messages.service";

interface SocketData {
  userId?: string;
}

type AuthenticatedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  SocketData
>;

interface PrivateMessageEvent {
  id: string;
  senderId: string;
  recipientId: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface RoomMessageEvent {
  id: string;
  roomId: string;
  authorId: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
}

const PRIVATE_MESSAGE_CHANNELS = [
  "private-message.created",
  "private-message.updated",
  "private-message.deleted",
];

const ROOM_MESSAGE_CHANNELS = [
  "room-message.created",
  "room-message.updated",
  "room-message.deleted",
];

export function isAllowedOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
): void {
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  // Les clients non-navigateurs (ex. Electron/CLI) peuvent ne pas envoyer Origin.
  callback(null, origin === undefined || allowedOrigins.includes(origin));
}

@WebSocketGateway({
  namespace: "/messages",
  cors: {
    // Évalue CORS_ORIGINS au moment de la connexion plutôt qu'à l'import.
    origin: isAllowedOrigin,
    credentials: false,
  },
})
export class MessagesGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(MessagesGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly messages: MessagesService,
    private readonly redis: RedisService,
    private readonly jwt: JwtAuthService,
    private readonly roomMessages: RoomMessagesService,
    private readonly rooms: RoomsClientService,
  ) {}

  async afterInit(): Promise<void> {
    await this.redis.subscribe(
      [...PRIVATE_MESSAGE_CHANNELS, ...ROOM_MESSAGE_CHANNELS],
      (channel, payload) => this.broadcastRedisEvent(channel, payload),
    );
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = this.readSocketToken(client);
      const user = await this.jwt.verifyToken(token);

      client.data.userId = user.id;
      await client.join(`user:${user.id}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "erreur inconnue";

      this.logger.warn(`Connexion refusée [${client.id}]: ${message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.debug(`Client déconnecté: ${client.id}`);
  }

  @SubscribeMessage("private-message.send")
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async send(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: CreateMessageDto,
  ): Promise<PrivateMessage> {
    const senderId = this.requireUserId(client);

    return this.messages.create(senderId, dto);
  }

  @SubscribeMessage("room-message.join")
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async joinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: RoomIdDto,
  ): Promise<{ joined: true }> {
    const userId = this.requireUserId(client);

    const room = await this.rooms.getRoom(dto.roomId);
    if (!room.membreIds.includes(userId)) {
      throw new WsException(
        "Vous devez être membre du salon pour rejoindre ce salon",
      );
    }

    await client.join(`room:${dto.roomId}`);
    return { joined: true };
  }

  @SubscribeMessage("room-message.leave")
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async leaveRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: RoomIdDto,
  ): Promise<{ left: true }> {
    await client.leave(`room:${dto.roomId}`);
    return { left: true };
  }

  @SubscribeMessage("room-message.send")
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async sendRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: SendRoomMessageDto,
  ): Promise<RoomMessage> {
    const authorId = this.requireUserId(client);

    return this.roomMessages.create(authorId, dto.roomId, {
      content: dto.content,
    });
  }

  @SubscribeMessage("typing")
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  typing(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: TypingDto,
  ): void {
    const userId = this.requireUserId(client);

    // Événement purement éphémère : ni persisté, ni routé par Redis/Postgres.
    const room =
      dto.scope === "room" ? `room:${dto.targetId}` : `user:${dto.targetId}`;

    client.to(room).emit("typing", {
      userId,
      scope: dto.scope,
      targetId: dto.targetId,
      isTyping: dto.isTyping,
    });
  }

  private requireUserId(client: AuthenticatedSocket): string {
    const userId = client.data.userId;

    // Socket.IO peut recevoir un événement pendant que handleConnection()
    // termine la validation distante du JWT. On refuse alors explicitement
    // l'action : aucune écriture n'est possible avant l'authentification.
    if (!userId) {
      throw new WsException("Utilisateur non authentifié");
    }

    return userId;
  }

  private readSocketToken(client: AuthenticatedSocket): string {
    const auth: unknown = client.handshake.auth;

    if (typeof auth !== "object" || auth === null || !("token" in auth)) {
      throw new WsException("Token JWT manquant");
    }

    const token = (auth as { token?: unknown }).token;

    if (typeof token !== "string" || token.length === 0) {
      throw new WsException("Token JWT manquant");
    }

    return token;
  }

  private broadcastRedisEvent(channel: string, payload: string): void {
    if (PRIVATE_MESSAGE_CHANNELS.includes(channel)) {
      this.broadcastPrivateMessageEvent(channel, payload);
      return;
    }

    if (ROOM_MESSAGE_CHANNELS.includes(channel)) {
      this.broadcastRoomMessageEvent(channel, payload);
      return;
    }

    this.logger.warn(`Canal Redis invalide ignoré: ${channel}`);
  }

  private broadcastPrivateMessageEvent(channel: string, payload: string): void {
    let message: PrivateMessageEvent;

    try {
      const parsed: unknown = JSON.parse(payload);

      if (!this.isPrivateMessageEvent(parsed)) {
        this.logger.warn(`Payload Redis invalide ignoré: ${payload}`);
        return;
      }

      message = parsed;
    } catch {
      this.logger.warn(`Événement Redis invalide ignoré: ${payload}`);
      return;
    }

    this.server.to(`user:${message.senderId}`).emit(channel, message);

    if (message.recipientId !== message.senderId) {
      this.server.to(`user:${message.recipientId}`).emit(channel, message);
    }
  }

  private broadcastRoomMessageEvent(channel: string, payload: string): void {
    let message: RoomMessageEvent;

    try {
      const parsed: unknown = JSON.parse(payload);

      if (!this.isRoomMessageEvent(parsed)) {
        this.logger.warn(`Payload Redis invalide ignoré: ${payload}`);
        return;
      }

      message = parsed;
    } catch {
      this.logger.warn(`Événement Redis invalide ignoré: ${payload}`);
      return;
    }

    this.server.to(`room:${message.roomId}`).emit(channel, message);
  }

  private isPrivateMessageEvent(value: unknown): value is PrivateMessageEvent {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const event = value as Record<string, unknown>;

    return (
      typeof event.id === "string" &&
      typeof event.senderId === "string" &&
      typeof event.recipientId === "string"
    );
  }

  private isRoomMessageEvent(value: unknown): value is RoomMessageEvent {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const event = value as Record<string, unknown>;

    return (
      typeof event.id === "string" &&
      typeof event.roomId === "string" &&
      typeof event.authorId === "string"
    );
  }
}
