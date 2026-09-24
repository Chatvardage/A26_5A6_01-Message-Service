import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt-auth.service';

// Borne la mémoire du cache : au-delà, l'entrée AJOUTÉE la première est
// oubliée (FIFO, pas LRU : une lecture ne la rajeunit pas). Suffisant avec
// une durée de vie courte : une entrée expire bien avant d'être évincée,
// sauf avec plus de 10 000 entrées vivantes à la fois.
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

export type ConfigRoomsClient = {
  /** Origine de Room-Service, sans chemin. */
  urlService: string;
  /** INTERNAL_SERVICE_TOKEN ; absent, chaque appel échoue en 503. */
  jetonInterne: string | null;
  delaiMs: number;
  dureeCacheMs: number;
};

/**
 * Lit et valide la configuration au démarrage (erreur immédiate plutôt
 * qu'un 503 générique au premier message de salon), comme
 * lireConfigClientAuth pour Authentification :
 * - `ROOM_SERVICE_URL` : origine HTTP(S) seule, sans chemin ni paramètres.
 *   HTTPS n'est pas exigé en production : l'appel reste sur le réseau interne
 *   des services, jamais relayé par Serveur-API ;
 * - `ROOM_SERVICE_TIMEOUT_MS` : entier ≥ 1, 3000 ms par défaut ;
 * - `ROOM_ACCESS_CACHE_TTL_MS` : voir dureeCacheAccesMs.
 */
export function lireConfigRoomsClient(
  env: NodeJS.ProcessEnv = process.env,
): ConfigRoomsClient {
  const brute = env.ROOM_SERVICE_URL ?? 'http://localhost:3003';
  let url: URL;
  try {
    url = new URL(brute.trim().replace(/\/+$/, ''));
  } catch {
    throw new Error(`ROOM_SERVICE_URL doit être une URL valide : "${brute}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `ROOM_SERVICE_URL doit utiliser HTTP ou HTTPS : "${brute}"`,
    );
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(
      `ROOM_SERVICE_URL ne doit pas contenir de chemin ou paramètres : "${brute}"`,
    );
  }

  const delaiBrut = (env.ROOM_SERVICE_TIMEOUT_MS ?? '3000').trim();
  if (!/^\d+$/.test(delaiBrut) || Number(delaiBrut) < 1) {
    throw new Error(
      `ROOM_SERVICE_TIMEOUT_MS doit être un entier supérieur ou égal à 1 : "${env.ROOM_SERVICE_TIMEOUT_MS}"`,
    );
  }

  return {
    urlService: url.origin,
    jetonInterne: env.INTERNAL_SERVICE_TOKEN?.trim() || null,
    delaiMs: Number(delaiBrut),
    dureeCacheMs: dureeCacheAccesMs(env),
  };
}

/** Accès d'un utilisateur à un salon, calculé par Room-Service. */
export type AccesSalon = {
  salonId: string;
  serveurId: string;
  estMembre: boolean;
  peutLire: boolean;
  peutEcrire: boolean;
  /** Modérateur du serveur (ou propriétaire, admin) : peut supprimer les
   * messages des autres. Absent d'un Room-Service plus ancien : faux. */
  peutModerer: boolean;
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
  // Configuration lue et validée au démarrage du service.
  private readonly config = lireConfigRoomsClient();
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
    if (this.config.dureeCacheMs > 0) {
      if (this.cache.size >= TAILLE_MAX_CACHE_ACCES) {
        this.cache.delete(this.cache.keys().next().value as string);
      }
      this.cache.set(clef, {
        acces,
        expireA: Date.now() + this.config.dureeCacheMs,
      });
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
    const jeton = this.config.jetonInterne;
    if (!jeton) {
      throw new ServiceUnavailableException(
        'INTERNAL_SERVICE_TOKEN non configuré',
      );
    }

    let response: Response;

    try {
      response = await fetch(
        `${this.config.urlService}/api/internal/channels/${encodeURIComponent(roomId)}` +
          `/access/${encodeURIComponent(acteur.id)}?role=${encodeURIComponent(acteur.role)}`,
        {
          headers: { 'x-internal-token': jeton },
          signal: AbortSignal.timeout(this.config.delaiMs),
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
      typeof acces.peutEcrire !== 'boolean' ||
      (acces.peutModerer !== undefined &&
        typeof acces.peutModerer !== 'boolean')
    ) {
      throw new BadGatewayException('Réponse invalide du service des salons');
    }

    return {
      salonId: acces.salonId,
      serveurId: acces.serveurId,
      estMembre: acces.estMembre,
      peutLire: acces.peutLire,
      peutEcrire: acces.peutEcrire,
      peutModerer: acces.peutModerer ?? false,
    };
  }
}
