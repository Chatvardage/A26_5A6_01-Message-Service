import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import { DestinatairesService } from '../destinataires.service';
import { MessagesService } from '../messages/messages.service';
import { RoomMessagesService } from '../room-messages/room-messages.service';
import {
  EN_TETE_JETON_INTERNE,
  InternalTokenGuard,
} from './internal-token.guard';

/** Salons supprimés dans Room-Service (qui les envoie par lots de 500). */
export class SalonsSupprimesDto {
  @ApiProperty({ type: [String], maxItems: 500 })
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
@ApiTags('Interne')
@ApiHeader({ name: EN_TETE_JETON_INTERNE, required: true })
@Controller('internal')
@UseGuards(InternalTokenGuard)
export class InternalDonneesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly roomMessages: RoomMessagesService,
    private readonly destinataires: DestinatairesService,
  ) {}

  @Post('salons-supprimes')
  @ApiOperation({
    summary:
      'Efface les messages de salons supprimés (appelée par Room-Service)',
  })
  @HttpCode(200)
  async salonsSupprimes(
    @Body() dto: SalonsSupprimesDto,
  ): Promise<{ messagesSalons: number }> {
    return {
      messagesSalons: await this.roomMessages.purgerSalons(dto.salonIds),
    };
  }

  @Delete('users/:userId')
  @ApiOperation({
    summary:
      "Efface les messages d'un compte supprimé (appelée par Authentification)",
  })
  async supprimerUtilisateur(
    @Param('userId') userId: string,
  ): Promise<{ messagesPrives: number; messagesSalons: number }> {
    // Avant l'effacement : plus aucun nouveau message ne doit lui parvenir.
    this.destinataires.oublier(userId);
    const [messagesPrives, messagesSalons] = await Promise.all([
      this.messages.supprimerUtilisateur(userId),
      this.roomMessages.supprimerAuteur(userId),
    ]);
    return { messagesPrives, messagesSalons };
  }
}
