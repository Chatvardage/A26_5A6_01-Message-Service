import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt-auth.service';

// Borne la mémoire du cache : au-delà, l'entrée la plus ancienne est oubliée.
export const TAILLE_MAX_CACHE_ACCES = 10_000;

/** Durée de mémorisation d'un accès (ms), 10 s par défaut, 0 = sans cache. */
export function dureeCacheAccesMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const brut = (env.ROOM_ACCESS_CACHE_TTL_MS ?? '10000').trim();
  if (!/^\d+$/.test(brut)) {
    throw new Error(
      `ROOM_ACCESS_CACHE_TTL_MS doit être un entier : "${env.ROOM_ACCESS_CACHE_TTL_MS}"`,
    );
  }
  return Number(brut);
}

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
 *
 * Cache : chaque envoi ou lecture de message de salon demande l'accès ; un
 * accès obtenu est donc mémorisé `ROOM_ACCESS_CACHE_TTL_MS` (10 s par
 * défaut). Room-Service prévient de chaque changement d'un serveur (voir
 * MessagesGateway.broadcastServeurEvent), qui oublie alors tous les accès à
 * ce serveur (`oublierServeur`) : une expulsion ou un salon rendu réservé
 * est pris en compte aussitôt. Les erreurs ne sont jamais mémorisées.
 */
@Injectable()
export class RoomsClientService {
  private readonly dureeCacheMs = dureeCacheAccesMs();
  private readonly cache = new Map<
    string,
    { acces: AccesSalon; expireA: number }
  >();

  async verifierAcces(roomId: string, acteur: Acteur): Promise<AccesSalon> {
    const clef = `${roomId}|${acteur.id}|${acteur.role}`;
    const entree = this.cache.get(clef);
    if (entree) {
      if (entree.expireA > Date.now()) return entree.acces;
      this.cache.delete(clef);
    }
    const acces = await this.demanderAcces(roomId, acteur);
    if (this.dureeCacheMs > 0) {
      if (this.cache.size >= TAILLE_MAX_CACHE_ACCES) {
        this.cache.delete(this.cache.keys().next().value as string);
      }
      this.cache.set(clef, { acces, expireA: Date.now() + this.dureeCacheMs });
    }
    return acces;
  }

  /** Oublie les accès mémorisés aux salons d'un serveur qui a changé. */
  oublierServeur(serveurId: string): void {
    for (const [clef, { acces }] of this.cache) {
      if (acces.serveurId === serveurId) this.cache.delete(clef);
    }
  }

  private async demanderAcces(
    roomId: string,
    acteur: Acteur,
  ): Promise<AccesSalon> {
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
