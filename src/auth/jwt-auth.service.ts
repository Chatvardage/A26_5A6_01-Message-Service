import { Injectable } from '@nestjs/common';
import {
  ClientAuth,
  UtilisateurAuthentifie,
  extraireJetonBearer,
} from '../partage/client-auth';

export type AuthenticatedUser = UtilisateurAuthentifie;

/**
 * Valide le JWT (REST et connexion Socket.IO) auprès d'Authentification.
 * Configuration, cache et traduction des erreurs : src/partage/client-auth.ts,
 * partagé avec Room-Service. Une seule instance (exportée par
 * RoomMessagesModule) pour que le cache soit commun à tout le service.
 */
@Injectable()
export class JwtAuthService {
  // Configuration lue et validée au démarrage du service.
  private readonly client = new ClientAuth();

  bearerToken(authorization?: string): string {
    return extraireJetonBearer(authorization);
  }

  verifyToken(token: string): Promise<AuthenticatedUser> {
    return this.client.verifierJeton(token);
  }
}
