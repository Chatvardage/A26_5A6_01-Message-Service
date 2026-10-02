// Fichier partagé : identique dans Room-Service et Message-Service
// (src/partage/). Le modifier dans les deux dépôts à la fois ;
// A26_5A6_01-Infra/scripts/verifier-fichiers-partages.sh le vérifie.
import {
  BadGatewayException,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

// Rôles globaux d'Authentification. Le modérateur n'existe que dans un
// serveur (Room-Service), jamais comme rôle global.
export const ROLES_GLOBAUX = ['admin', 'utilisateur'] as const;
export type RoleGlobal = (typeof ROLES_GLOBAUX)[number];

/** Utilisateur renvoyé par `GET /api/auth/me` (champs utilisés ici). */
export type UtilisateurAuthentifie = {
  id: string;
  pseudo: string;
  courriel: string;
  role: RoleGlobal;
};

export type ConfigClientAuth = {
  /** Origine du service Authentification, sans chemin. */
  urlService: string;
  delaiMs: number;
  /** Durée de mémorisation d'un jeton validé ; 0 désactive le cache. */
  dureeCacheMs: number;
};

// Borne la mémoire du cache : au-delà, l'entrée la plus ancienne est oubliée.
export const TAILLE_MAX_CACHE = 10_000;

function entierEnv(
  env: NodeJS.ProcessEnv,
  nom: string,
  defaut: number,
  minimum: number,
): number {
  const brut = env[nom] ?? String(defaut);
  const normalise = brut.trim();
  if (!/^\d+$/.test(normalise)) {
    throw new Error(`${nom} doit être un entier : "${brut}"`);
  }
  const valeur = Number(normalise);
  if (valeur < minimum) {
    throw new Error(
      `${nom} doit être supérieur ou égal à ${minimum} : "${brut}"`,
    );
  }
  return valeur;
}

/**
 * Lit et valide la configuration au démarrage (erreur immédiate plutôt qu'à
 * la première requête) :
 * - `AUTH_SERVICE_URL` : origine seule (sans chemin ni paramètres), HTTPS
 *   obligatoire en production ;
 * - `AUTH_SERVICE_TIMEOUT_MS` : délai d'appel, 3000 ms par défaut ;
 * - `AUTH_CACHE_TTL_MS` : durée de mémorisation d'un jeton validé, 10 000 ms
 *   par défaut, 0 pour interroger Authentification à chaque requête.
 */
export function lireConfigClientAuth(
  env: NodeJS.ProcessEnv = process.env,
): ConfigClientAuth {
  const brute = env.AUTH_SERVICE_URL ?? 'http://localhost:3001';
  let url: URL;
  try {
    url = new URL(brute.replace(/\/+$/, ''));
  } catch {
    throw new Error('AUTH_SERVICE_URL doit être une URL valide');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(
      `AUTH_SERVICE_URL ne doit pas contenir de chemin ou paramètres : "${brute}"`,
    );
  }
  if (env.NODE_ENV?.trim() === 'production' && url.protocol !== 'https:') {
    throw new Error('AUTH_SERVICE_URL doit utiliser HTTPS en production');
  }

  return {
    urlService: url.origin,
    delaiMs: entierEnv(env, 'AUTH_SERVICE_TIMEOUT_MS', 3000, 1),
    dureeCacheMs: entierEnv(env, 'AUTH_CACHE_TTL_MS', 10_000, 0),
  };
}

/** Jeton d'un en-tête `Authorization: Bearer <jeton>`, sinon 401. */
export function extraireJetonBearer(authorization?: string): string {
  // Les noms de schémas d'authentification HTTP sont insensibles à la casse.
  const correspondance = authorization?.match(/^Bearer\s+(\S+)\s*$/i);
  if (!correspondance) {
    throw new UnauthorizedException('Authorization Bearer requis');
  }
  return correspondance[1];
}

function estUtilisateur(valeur: unknown): valeur is UtilisateurAuthentifie {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) {
    return false;
  }
  const u = valeur as Record<string, unknown>;
  return (
    typeof u.id === 'string' &&
    u.id.trim() !== '' &&
    typeof u.pseudo === 'string' &&
    u.pseudo.trim() !== '' &&
    typeof u.courriel === 'string' &&
    u.courriel.trim() !== '' &&
    ROLES_GLOBAUX.includes(u.role as RoleGlobal)
  );
}

/**
 * Valide un JWT auprès d'Authentification (`GET /api/auth/me`), seule
 * source de vérité du rôle et des révocations.
 *
 * Cache : un jeton validé est mémorisé `dureeCacheMs` (clé = empreinte
 * SHA-256, le jeton lui-même n'est pas conservé). Compromis assumé : un
 * jeton révoqué (mot de passe changé, compte supprimé) ou un rôle modifié
 * n'est pris en compte qu'à l'expiration de l'entrée. Les refus (401/403)
 * et les pannes ne sont jamais mémorisés. Des validations simultanées d'un
 * même jeton ne font qu'un seul appel.
 */
export class ClientAuth {
  private readonly logger = new Logger(ClientAuth.name);
  private readonly cache = new Map<
    string,
    { utilisateur: UtilisateurAuthentifie; expireA: number }
  >();
  private readonly enCours = new Map<string, Promise<UtilisateurAuthentifie>>();

  constructor(
    private readonly config: ConfigClientAuth = lireConfigClientAuth(),
    private readonly maintenant: () => number = Date.now,
  ) {}

  async authentifier(authorization?: string): Promise<UtilisateurAuthentifie> {
    return this.verifierJeton(extraireJetonBearer(authorization));
  }

  async verifierJeton(jeton: string): Promise<UtilisateurAuthentifie> {
    const clef = createHash('sha256').update(jeton).digest('hex');
    const entree = this.cache.get(clef);
    if (entree) {
      if (entree.expireA > this.maintenant()) return entree.utilisateur;
      this.cache.delete(clef);
    }

    const existante = this.enCours.get(clef);
    if (existante) return existante;

    const promesse = this.demanderAuService(jeton)
      .then((utilisateur) => {
        this.memoriser(clef, utilisateur);
        return utilisateur;
      })
      .finally(() => this.enCours.delete(clef));
    this.enCours.set(clef, promesse);
    return promesse;
  }

  /** Nombre d'entrées en cache (diagnostic et tests). */
  get tailleCache(): number {
    return this.cache.size;
  }

  private memoriser(clef: string, utilisateur: UtilisateurAuthentifie): void {
    if (this.config.dureeCacheMs === 0) return;
    if (this.cache.size >= TAILLE_MAX_CACHE) {
      const plusAncienne = this.cache.keys().next().value as string;
      this.cache.delete(plusAncienne);
    }
    this.cache.set(clef, {
      utilisateur,
      expireA: this.maintenant() + this.config.dureeCacheMs,
    });
  }

  private async demanderAuService(
    jeton: string,
  ): Promise<UtilisateurAuthentifie> {
    let reponse: Response;
    try {
      reponse = await fetch(new URL('/api/auth/me', this.config.urlService), {
        headers: { Authorization: `Bearer ${jeton}` },
        signal: AbortSignal.timeout(this.config.delaiMs),
      });
    } catch (erreur: unknown) {
      if (erreur instanceof Error && erreur.name === 'TimeoutError') {
        this.logger.warn(
          'Délai dépassé lors de la validation auprès du service Auth',
        );
      } else {
        this.logger.error(
          'Erreur réseau lors de la validation auprès du service Auth',
        );
      }
      throw new ServiceUnavailableException(
        "Service d'authentification indisponible",
      );
    }

    if (reponse.status === 401) {
      throw new UnauthorizedException('Jeton invalide, expiré ou révoqué');
    }
    if (reponse.status === 403) {
      throw new ForbiddenException('Accès refusé par le service Auth');
    }
    if (!reponse.ok) {
      throw new ServiceUnavailableException(
        "Validation de l'authentification impossible",
      );
    }

    let corps: unknown;
    try {
      corps = await reponse.json();
    } catch {
      throw new BadGatewayException(
        "Réponse invalide du service d'authentification : JSON illisible",
      );
    }
    if (!estUtilisateur(corps)) {
      throw new BadGatewayException(
        "Réponse invalide du service d'authentification : champs utilisateur invalides",
      );
    }

    return {
      id: corps.id,
      pseudo: corps.pseudo,
      courriel: corps.courriel,
      role: corps.role,
    };
  }
}
