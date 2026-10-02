import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoomsClientService } from '../rooms/rooms-client.service';
import { ServicesCommunsModule } from '../services-communs.module';
import { RoomMessagesController } from './room-messages.controller';
import { RoomMessagesService } from './room-messages.service';

@Module({
  imports: [ServicesCommunsModule],
  controllers: [RoomMessagesController],
  providers: [RoomMessagesService, RoomsClientService, JwtAuthGuard],
  // MessagesModule : routes internes (purge) et gateway (cache des accès).
  exports: [RoomMessagesService, RoomsClientService],
})
export class RoomMessagesModule {}
