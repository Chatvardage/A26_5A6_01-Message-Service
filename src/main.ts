import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { verifierSecretsProduction } from './secrets-production';

async function bootstrap(): Promise<void> {
  // Avant tout : pas de démarrage en production avec des secrets de dev.
  verifierSecretsProduction();
  const app = await NestFactory.create(AppModule);
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
