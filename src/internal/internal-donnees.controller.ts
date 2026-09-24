import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import { MessagesService } from '../messages/messages.service';
import { RoomMessagesService } from '../room-messages/room-messages.service';
import { InternalTokenGuard } from './internal-token.guard';

/** Salons supprimés dans Room-Service (qui les envoie par lots de 500). */
export class SalonsSupprimesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  salonIds!: string[];
}

/**
 * Effacement de données demandé par les autres services, quand ce qu'elles
 * concernent n'existe plus : salons supprimés (Room-Service), compte
 * supprimé (Authentification). Idempotent : un second appel n'efface rien.
 */
@Controller('internal')
@UseGuards(InternalTokenGuard)
export class InternalDonneesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly roomMessages: RoomMessagesService,
  ) {}

  @Post('salons-supprimes')
  @HttpCode(200)
  async salonsSupprimes(
    @Body() dto: SalonsSupprimesDto,
  ): Promise<{ messagesSalons: number }> {
    return {
      messagesSalons: await this.roomMessages.purgerSalons(dto.salonIds),
    };
  }

  @Delete('users/:userId')
  async supprimerUtilisateur(
    @Param('userId') userId: string,
  ): Promise<{ messagesPrives: number; messagesSalons: number }> {
    const [messagesPrives, messagesSalons] = await Promise.all([
      this.messages.supprimerUtilisateur(userId),
      this.roomMessages.supprimerAuteur(userId),
    ]);
    return { messagesPrives, messagesSalons };
  }
}
