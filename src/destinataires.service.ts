import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  lireConfigClientAuth,
  ROLES_GLOBAUX,
  RoleGlobal,
} from './partage/client-auth';

/** Durée pendant laquelle un destinataire existant est mémorisé. */
export const DUREE_CACHE_DESTINATAIRE_MS = 10 * 60_000;
// Borne la mémoire du cache : au-delà, l'entrée AJOUTÉE la première est
// oubliée (FIFO, pas LRU : une lecture ne la rajeunit pas). Sans gravité :
// une entrée évincée coûte seulement un nouvel appel à Authentification.
export const TAILLE_MAX_CACHE_DESTINATAIRES = 10_000;

/**
 * Vérifie qu'un destinataire de message privé existe, auprès
 * d'Authentification (`GET /api/users/lookup`, ouverte à tout utilisateur
 * connecté, avec le jeton de l'expéditeur). Sans cette vérification, un
 * message pouvait viser n'importe quel UUID et rester en base pour toujours,
 * sans personne pour le lire.
 *
 * Un destinataire trouvé est mémorisé DUREE_CACHE_DESTINATAIRE_MS : un
 * échange ne coûte qu'un appel. Un compte supprimé est oublié aussitôt
 * (route interne, voir InternalDonneesController). Échec fermé : sans
 * réponse d'Authentification, le message est refusé (503).
 *
 * Sert aussi aux routes d'administration : l'auteur choisi par un admin
 * (`roleDe`).
 */
@Injectable()
export class DestinatairesService {
  private readonly config = lireConfigClientAuth();
  private readonly connus = new Map<string, number>();

  async exigerExistant(id: string, jeton: string): Promise<void> {
    const expireA = this.connus.get(id);
    if (expireA !== undefined) {
      if (expireA > Date.now()) return;
      this.connus.delete(id);
    }

    const reponse = await this.appeler(
      `/api/users/lookup?ids=${encodeURIComponent(id)}`,
      jeton,
      'Vérification du destinataire impossible',
    );
    const trouves = await this.lireJson(reponse);
    if (!Array.isArray(trouves)) {
      throw new BadGatewayException(
        "Réponse invalide du service d'authentification",
      );
    }
    if (
      !trouves.some(
        (u: unknown) =>
          typeof u === 'object' &&
          u !== null &&
          (u as { id?: unknown }).id === id,
      )
    ) {
      throw new NotFoundException('Destinataire introuvable');
    }

    if (this.connus.size >= TAILLE_MAX_CACHE_DESTINATAIRES) {
      this.connus.delete(this.connus.keys().next().value as string);
    }
    this.connus.set(id, Date.now() + DUREE_CACHE_DESTINATAIRE_MS);
  }

  /** Compte supprimé : ne plus le considérer comme existant. */
  oublier(id: string): void {
    this.connus.delete(id);
  }

  /**
   * Rôle global d'un compte (`GET /api/users/:id`, réservée aux admins :
   * `jeton` est celui de l'admin). Room-Service calcule les droits d'un
   * salon à partir de ce rôle (un admin global peut tout) : l'auteur d'un
   * message créé par un admin doit donc être évalué avec son vrai rôle.
   * Jamais mémorisé : un rôle peut changer à tout moment.
   */
  async roleDe(id: string, jeton: string): Promise<RoleGlobal> {
    const reponse = await this.appeler(
      `/api/users/${encodeURIComponent(id)}`,
      jeton,
      "Vérification de l'auteur impossible",
      'Auteur introuvable',
    );
    const corps = await this.lireJson(reponse);
    const role = (corps as { role?: unknown } | null)?.role;
    if (!ROLES_GLOBAUX.includes(role as RoleGlobal)) {
      throw new BadGatewayException(
        "Réponse invalide du service d'authentification",
      );
    }
    return role as RoleGlobal;
  }

  /** `introuvable` : message d'une 404 d'Authentification ; sans lui, une
   * 404 est une erreur comme une autre (503). */
  private async appeler(
    chemin: string,
    jeton: string,
    indisponible: string,
    introuvable?: string,
  ): Promise<Response> {
    let reponse: Response;
    try {
      reponse = await fetch(new URL(chemin, this.config.urlService), {
        headers: { Authorization: `Bearer ${jeton}` },
        signal: AbortSignal.timeout(this.config.delaiMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Service d'authentification indisponible",
      );
    }
    if (reponse.status === 401 || reponse.status === 403) {
      throw new UnauthorizedException('Jeton invalide ou expiré');
    }
    if (introuvable && reponse.status === 404) {
      throw new NotFoundException(introuvable);
    }
    if (!reponse.ok) {
      throw new ServiceUnavailableException(indisponible);
    }
    return reponse;
  }

  private async lireJson(reponse: Response): Promise<unknown> {
    try {
      return await reponse.json();
    } catch {
      throw new BadGatewayException(
        "Réponse invalide du service d'authentification",
      );
    }
  }
}
