import { Logger, UsePipes, ValidationPipe } from "@nestjs/common";
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
import { CreateMessageDto } from "./dto/create-message.dto";
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

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

@WebSocketGateway({
  namespace: "/messages",
  cors: {
    origin: corsOrigins,
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
  ) {}

  async afterInit(): Promise<void> {
    await this.redis.subscribe(
      [
        "private-message.created",
        "private-message.updated",
        "private-message.deleted",
      ],
      (channel, payload) => this.broadcastRedisEvent(channel, payload),
    );
  }

  handleConnection(client: AuthenticatedSocket): void {
    try {
      const token = this.readSocketToken(client);
      const claims = this.jwt.verifyToken(token);
      client.data.userId = claims.sub;
      void client.join(`user:${claims.sub}`);
    } catch {
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
  ): Promise<unknown> {
    const senderId = client.data.userId;
    if (!senderId) throw new WsException("Utilisateur non authentifié");
    return this.messages.create(senderId, dto);
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
    if (
      channel !== "private-message.created" &&
      channel !== "private-message.updated" &&
      channel !== "private-message.deleted"
    ) {
      this.logger.warn(`Canal Redis invalide ignoré: ${channel}`);
      return;
    }

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

  private isPrivateMessageEvent(value: unknown): value is PrivateMessageEvent {
    if (typeof value !== "object" || value === null) return false;
    const event = value as Record<string, unknown>;
    return (
      typeof event.id === "string" &&
      typeof event.senderId === "string" &&
      typeof event.recipientId === "string"
    );
  }
}
