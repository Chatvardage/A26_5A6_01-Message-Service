import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MessagesModule } from './messages/messages.module';
import { RoomMessagesModule } from './room-messages/room-messages.module';
import { ServicesCommunsModule } from './services-communs.module';

@Module({
  imports: [ServicesCommunsModule, MessagesModule, RoomMessagesModule],
  controllers: [HealthController],
})
export class AppModule {}
