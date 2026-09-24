import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { verifierSecretsProduction } from './partage/secrets-production';

async function bootstrap(): Promise<void> {
  // Avant tout : pas de démarrage en production avec des secrets de dev.
  verifierSecretsProduction({
    jetonInterne: true,
    urlsAvecMotDePasse: ['DATABASE_URL', 'REDIS_URL'],
  });
  const app = await NestFactory.create(AppModule);
  // SIGTERM (docker stop) : fermeture propre (Prisma, Redis, minuteurs).
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: false });
  await app.listen(Number(process.env.PORT ?? 3004), '0.0.0.0');
}
void bootstrap();
