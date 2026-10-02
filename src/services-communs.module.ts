import { Module } from '@nestjs/common';
import { JwtAuthService } from './auth/jwt-auth.service';
import { DestinatairesService } from './destinataires.service';
import { LimiteEnvoiService } from './limite-envoi.service';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

/**
 * Services utilisés par plusieurs modules, en une seule instance pour tout
 * Message-Service : la limite d'envoi porte sur tous les envois d'un
 * utilisateur (privés et de salon), les caches (jetons, destinataires) sont
 * communs, et la base comme Redis n'ont qu'un jeu de connexions.
 */
@Module({
  providers: [
    JwtAuthService,
    DestinatairesService,
    LimiteEnvoiService,
    PrismaService,
    RedisService,
  ],
  exports: [
    JwtAuthService,
    DestinatairesService,
    LimiteEnvoiService,
    PrismaService,
    RedisService,
  ],
})
export class ServicesCommunsModule {}
