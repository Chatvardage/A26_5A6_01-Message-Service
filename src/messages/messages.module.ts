import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JwtAuthService } from "../auth/jwt-auth.service";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { InternalEventsController } from "../internal/internal-events.controller";
import { InternalTokenGuard } from "../internal/internal-token.guard";
import { RoomMessagesModule } from "../room-messages/room-messages.module";
import { MessagesController } from "./messages.controller";
import { MessagesGateway } from "./messages.gateway";
import { MessagesService } from "./messages.service";

@Module({
  imports: [RoomMessagesModule],
  controllers: [MessagesController, InternalEventsController],
  providers: [
    MessagesService,
    MessagesGateway,
    PrismaService,
    RedisService,
    JwtAuthService,
    JwtAuthGuard,
    InternalTokenGuard,
  ],
})
export class MessagesModule {}
