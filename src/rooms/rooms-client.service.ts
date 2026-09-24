import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt-auth.service';

/** Accès d'un utilisateur à un salon, calculé par Room-Service. */
export type AccesSalon = {
  salonId: string;
  serveurId: string;
  estMembre: boolean;
  peutLire: boolean;
  peutEcrire: boolean;
};

export type Acteur = Pick<AuthenticatedUser, 'id' | 'role'>;

/**
 * Client de la route interne de Room-Service
 * (`GET /api/internal/channels/:id/access/:userId`), protégée par le secret
 * partagé INTERNAL_SERVICE_TOKEN. Room-Service est la seule source de vérité
 * des permissions (salons réservés aux modérateurs, écriture réservée de
 * #annonces…) : ce service ne recode aucune règle.
 */
@Injectable()
export class RoomsClientService {
  async verifierAcces(roomId: string, acteur: Acteur): Promise<AccesSalon> {
    const baseUrl = (
      process.env.ROOM_SERVICE_URL ?? 'http://localhost:3003'
    ).replace(/\/$/, '');
    const jeton = process.env.INTERNAL_SERVICE_TOKEN?.trim();
    if (!jeton) {
      throw new ServiceUnavailableException(
        'INTERNAL_SERVICE_TOKEN non configuré',
      );
    }

    const configuredTimeout = Number(
      process.env.ROOM_SERVICE_TIMEOUT_MS ?? 3000,
    );
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 3000;

    let response: Response;

    try {
      response = await fetch(
        `${baseUrl}/api/internal/channels/${encodeURIComponent(roomId)}` +
          `/access/${encodeURIComponent(acteur.id)}?role=${acteur.role}`,
        {
          headers: { 'x-internal-token': jeton },
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException('Service des salons indisponible');
    }

    if (response.status === 404) {
      throw new NotFoundException('Salon introuvable');
    }

    if (!response.ok) {
      throw new ServiceUnavailableException('Validation du salon impossible');
    }

    let acces: Partial<AccesSalon>;

    try {
      acces = (await response.json()) as Partial<AccesSalon>;
    } catch {
      throw new BadGatewayException('Réponse invalide du service des salons');
    }

    if (
      typeof acces.salonId !== 'string' ||
      typeof acces.serveurId !== 'string' ||
      typeof acces.estMembre !== 'boolean' ||
      typeof acces.peutLire !== 'boolean' ||
      typeof acces.peutEcrire !== 'boolean'
    ) {
      throw new BadGatewayException('Réponse invalide du service des salons');
    }

    return acces as AccesSalon;
  }
}
