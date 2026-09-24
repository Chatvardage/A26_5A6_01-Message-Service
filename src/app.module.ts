import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MessagesModule } from './messages/messages.module';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { RoomMessagesModule } from './room-messages/room-messages.module';

@Module({
  imports: [MessagesModule, RoomMessagesModule],
  controllers: [HealthController],
  providers: [PrismaService, RedisService],
})
export class AppModule {}
