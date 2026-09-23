import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JwtAuthService } from "../auth/jwt-auth.service";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { RoomsClientService } from "../rooms/rooms-client.service";
import { RoomMessagesController } from "./room-messages.controller";
import { RoomMessagesService } from "./room-messages.service";

@Module({
  controllers: [RoomMessagesController],
  providers: [
    RoomMessagesService,
    RoomsClientService,
    PrismaService,
    RedisService,
    JwtAuthService,
    JwtAuthGuard,
  ],
  exports: [RoomMessagesService, RoomsClientService],
})
export class RoomMessagesModule {}
