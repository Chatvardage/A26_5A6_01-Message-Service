import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtAuthService } from '../auth/jwt-auth.service';
import { LimiteEnvoiService } from '../limite-envoi.service';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { RoomsClientService } from '../rooms/rooms-client.service';
import { RoomMessagesController } from './room-messages.controller';
import { RoomMessagesService } from './room-messages.service';

@Module({
  controllers: [RoomMessagesController],
  providers: [
    RoomMessagesService,
    RoomsClientService,
    // Instance unique, partagée avec MessagesModule (messages privés) : la
    // limite porte sur tous les envois d'un utilisateur.
    LimiteEnvoiService,
    PrismaService,
    RedisService,
    JwtAuthService,
    JwtAuthGuard,
  ],
  exports: [
    RoomMessagesService,
    RoomsClientService,
    LimiteEnvoiService,
    // Instance unique : son cache de jetons sert aussi à MessagesModule.
    JwtAuthService,
  ],
})
export class RoomMessagesModule {}
