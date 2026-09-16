import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { RedisService } from "../redis.service";
import { MessagesService } from "./messages.service";

type RoutedEvent = {
  senderId: string;
  recipientId: string;
  [key: string]: unknown;
};

@WebSocketGateway({
  namespace: "/messages",
  cors: { origin: true, credentials: true },
})
export class MessagesGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(MessagesGateway.name);

  constructor(
    private readonly messages: MessagesService,
    private readonly redis: RedisService,
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

  handleConnection(client: Socket): void {
    const userId = String(client.handshake.auth?.userId ?? "");
    if (!userId) {
      client.disconnect();
      return;
    }

    void client.join(`user:${userId}`);
  }

  @SubscribeMessage("private-message.send")
  async send(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { recipientId: string; content: string },
  ): Promise<void> {
    const senderId = String(client.handshake.auth?.userId ?? "");
    if (!senderId) return;

    // No direct Socket.IO emit here.
    // create() saves to PostgreSQL and then publishes to Redis.
    // The Redis subscriber below performs the WebSocket broadcast.
    await this.messages.create(senderId, body);
  }

  private broadcastRedisEvent(channel: string, payload: string): void {
    try {
      const event = JSON.parse(payload) as RoutedEvent;

      if (!event.senderId || !event.recipientId) {
        this.logger.warn(`Événement Redis invalide ignoré: ${channel}`);
        return;
      }

      this.server.to(`user:${event.senderId}`).emit(channel, event);

      // Avoid a duplicate emit if sender == recipient.
      if (event.recipientId !== event.senderId) {
        this.server.to(`user:${event.recipientId}`).emit(channel, event);
      }
    } catch {
      this.logger.warn(`Payload Redis invalide ignoré: ${channel}`);
    }
  }
}
