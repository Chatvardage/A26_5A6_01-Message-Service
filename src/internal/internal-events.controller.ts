import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { RedisService } from '../redis.service';
import { EvenementServeurDto } from './evenement-serveur.dto';
import { InternalTokenGuard } from './internal-token.guard';

export const SERVEUR_CHANNEL = 'serveur.change';

/**
 * Point d'entrée des événements temps réel produits par d'autres services
 * (Room-Service n'a ni Redis ni Socket.IO). Publie sur Redis ; la passerelle
 * Socket.IO de chaque instance relaie aux destinataires (voir
 * MessagesGateway, `serveur.change`).
 */
@Controller('internal')
@UseGuards(InternalTokenGuard)
export class InternalEventsController {
  constructor(private readonly redis: RedisService) {}

  @Post('events')
  @HttpCode(202)
  async recevoir(@Body() dto: EvenementServeurDto): Promise<{ accepte: true }> {
    await this.redis.publish(SERVEUR_CHANNEL, {
      serveurId: dto.serveurId,
      raison: dto.raison,
      cibleId: dto.cibleId ?? null,
      tous: dto.tous === true,
      utilisateurIds: dto.tous ? [] : [...new Set(dto.utilisateurIds)],
    });
    return { accepte: true };
  }
}
