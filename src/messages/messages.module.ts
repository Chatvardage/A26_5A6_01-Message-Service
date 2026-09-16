import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { MessagesController } from "./messages.controller";
import { MessagesGateway } from "./messages.gateway";
import { MessagesService } from "./messages.service";

@Module({
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway, PrismaService, RedisService],
})
export class MessagesModule {}
