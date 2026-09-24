import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { InternalDonneesController } from '../internal/internal-donnees.controller';
import { InternalEventsController } from '../internal/internal-events.controller';
import { InternalTokenGuard } from '../internal/internal-token.guard';
import { RoomMessagesModule } from '../room-messages/room-messages.module';
import { MessagesController } from './messages.controller';
import { MessagesGateway } from './messages.gateway';
import { DestinatairesService } from './destinataires.service';
import { MessagesService } from './messages.service';

@Module({
  imports: [RoomMessagesModule],
  controllers: [
    MessagesController,
    InternalEventsController,
    InternalDonneesController,
  ],
  providers: [
    MessagesService,
    DestinatairesService,
    MessagesGateway,
    PrismaService,
    RedisService,
    JwtAuthGuard,
    InternalTokenGuard,
  ],
})
export class MessagesModule {}
