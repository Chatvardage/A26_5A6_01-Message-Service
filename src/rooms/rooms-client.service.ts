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

/** Salon lisible par un utilisateur, avec son arrivée dans le serveur
 * (`null` : pas de ligne de membre, voir Room-Service). */
export type SalonLisible = {
  salonId: string;
  serveurId: string;
  depuis: Date | null;
};

export type Acteur = Pick<AuthenticatedUser, 'id' | 'role'>;

/**
 * Client des routes internes de Room-Service
 * (`GET /api/internal/channels/:id/access/:userId` et
 * `GET /api/internal/users/:userId/channels`), protégées par le secret
 * partagé INTERNAL_SERVICE_TOKEN. Room-Service est la seule source de vérité
 * des permissions (salons réservés aux modérateurs, écriture réservée de
 * #annonces…) : ce service ne recode aucune règle.
 *
 * Cache : chaque envoi ou lecture de message de salon demande l'accès ; un
 * accès obtenu est donc mémorisé `ROOM_ACCESS_CACHE_TTL_MS` (10 s par
 * défaut), tout comme la liste des salons lisibles. Room-Service prévient de
 * chaque changement d'un serveur (voir MessagesGateway.broadcastServeurEvent),
 * qui oublie alors tous les accès à ce serveur et toutes les listes
 * (`oublierServeur`) : une expulsion ou un salon rendu réservé est pris en
 * compte aussitôt. Les erreurs ne sont jamais mémorisées.
 */
@Injectable()
export class RoomsClientService {
  // Configuration lue et validée au démarrage du service.
  private readonly config = lireConfigRoomsClient();
  private readonly cache = new Map<
    string,
    { acces: AccesSalon; expireA: number }
  >();
  private readonly cacheListes = new Map<
    string,
    { salons: SalonLisible[]; expireA: number }
  >();

  async verifierAcces(roomId: string, acteur: Acteur): Promise<AccesSalon> {
    const clef = `${roomId}|${acteur.id}|${acteur.role}`;
    const entree = this.cache.get(clef);
    if (entree) {
      if (entree.expireA > Date.now()) return entree.acces;
      this.cache.delete(clef);
    }
    const acces = await this.demanderAcces(roomId, acteur);
    this.memoriser(this.cache, clef, { acces });
    return acces;
  }

  /** Salons que l'utilisateur peut lire (recherche, messages non lus). */
  async salonsLisibles(acteur: Acteur): Promise<SalonLisible[]> {
    const clef = `${acteur.id}|${acteur.role}`;
    const entree = this.cacheListes.get(clef);
    if (entree) {
      if (entree.expireA > Date.now()) return entree.salons;
      this.cacheListes.delete(clef);
    }
    const corps = await this.lireJson(
      `/api/internal/users/${encodeURIComponent(acteur.id)}` +
        `/channels?role=${encodeURIComponent(acteur.role)}`,
      null,
    );
    const salons = lireSalonsLisibles(corps);
    this.memoriser(this.cacheListes, clef, { salons });
    return salons;
  }

  /** Oublie les accès mémorisés aux salons d'un serveur qui a changé, et
   * toutes les listes : un salon créé ou un serveur rejoint les modifie
   * sans qu'elles mentionnent encore ce serveur. */
  oublierServeur(serveurId: string): void {
    for (const [clef, { acces }] of this.cache) {
      if (acces.serveurId === serveurId) this.cache.delete(clef);
    }
    this.cacheListes.clear();
  }

  private memoriser<T>(
    cache: Map<string, T & { expireA: number }>,
    clef: string,
    valeur: T,
  ): void {
    if (this.config.dureeCacheMs <= 0) return;
    if (cache.size >= TAILLE_MAX_CACHE_ACCES) {
      cache.delete(cache.keys().next().value as string);
    }
    cache.set(clef, {
      ...valeur,
      expireA: Date.now() + this.config.dureeCacheMs,
    });
  }

  private async demanderAcces(
    roomId: string,
    acteur: Acteur,
  ): Promise<AccesSalon> {
    const acces = (await this.lireJson(
      `/api/internal/channels/${encodeURIComponent(roomId)}` +
        `/access/${encodeURIComponent(acteur.id)}?role=${encodeURIComponent(acteur.role)}`,
      'Salon introuvable',
    )) as Partial<AccesSalon> | null;

    if (
      typeof acces !== 'object' ||
      acces === null ||
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

  /** Appelle une route interne et renvoie son corps JSON. `introuvable` :
   * message du 404 renvoyé au client, ou `null` si un 404 est une panne. */
  private async lireJson(
    chemin: string,
    introuvable: string | null,
  ): Promise<unknown> {
    const jeton = this.config.jetonInterne;
    if (!jeton) {
      throw new ServiceUnavailableException(
        'INTERNAL_SERVICE_TOKEN non configuré',
      );
    }

    let response: Response;

    try {
      response = await fetch(`${this.config.urlService}${chemin}`, {
        headers: { 'x-internal-token': jeton },
        signal: AbortSignal.timeout(this.config.delaiMs),
      });
    } catch {
      throw new ServiceUnavailableException('Service des salons indisponible');
    }

    if (response.status === 404 && introuvable !== null) {
      throw new NotFoundException(introuvable);
    }

    if (!response.ok) {
      throw new ServiceUnavailableException('Validation du salon impossible');
    }

    try {
      return await response.json();
    } catch {
      throw new BadGatewayException('Réponse invalide du service des salons');
    }
  }
}

/** Valide `{ salons: [{ salonId, serveurId, depuis }] }` (502 sinon). */
function lireSalonsLisibles(corps: unknown): SalonLisible[] {
  const invalide = () =>
    new BadGatewayException('Réponse invalide du service des salons');
  const salons = (corps as { salons?: unknown } | null)?.salons;
  if (!Array.isArray(salons)) throw invalide();
  return salons.map((brut: unknown) => {
    const salon = brut as Partial<Record<keyof SalonLisible, unknown>> | null;
    if (
      typeof salon?.salonId !== 'string' ||
      typeof salon.serveurId !== 'string' ||
      (salon.depuis !== null && typeof salon.depuis !== 'string')
    ) {
      throw invalide();
    }
    const depuis = salon.depuis === null ? null : new Date(salon.depuis);
    if (depuis !== null && Number.isNaN(depuis.getTime())) throw invalide();
    return { salonId: salon.salonId, serveurId: salon.serveurId, depuis };
  });
}
